"""Worker environment rules (plan section 6.4). Stdlib only: runs before Hermes is imported.

Go builds the worker environment from scratch out of an allowlist. This module is the
worker's own check of that contract, and the reference list both sides share:

- ``REQUIRED``: the worker refuses to start without them. Without ``HERMES_HOME``
  Hermes falls back to the owner's live ``~/.hermes`` (``hermes_constants.get_hermes_home``).
- ``FORBIDDEN`` / ``FORBIDDEN_PREFIXES``: Timely secrets, Hermes behaviour flags and
  messaging platform credentials. Any of them present is a refusal, not a warning.
- ``HERMES_LANGUAGE`` and ``HERMES_BUNDLED_LOCALES`` are forbidden: the copy ships only
  ``locales/en.yaml`` and the managed config pins ``display.language: en`` (sync finding 6).
  Every other ``HERMES_*`` name outside ``ALLOWED`` is forbidden too: Hermes reads dozens of
  them as behaviour switches (``HERMES_YOLO_MODE`` turns the approval gate off,
  ``HERMES_ALLOW_PRIVATE_URLS`` beats ``security.allow_private_urls``).
- Dotenv files: Hermes loads ``$HERMES_HOME/.env`` (over the environment Go built),
  ``$HERMES_HOME/.op.env``, ``<agent>/hermes/.env`` and ``$HERMES_MANAGED_DIR/.env`` when
  ``run_agent`` is imported, after :func:`check` ran. The worker sets the home's files aside
  before that import (:func:`set_aside_home_dotenv`), the self-test fails while any of them
  exists (:func:`dotenv_files`), and :func:`drift` reports every name that changed after the
  start check.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Mapping

REQUIRED = (
    "HERMES_HOME", "HERMES_MANAGED_DIR", "HERMES_RUNTIME_DIR", "HERMES_GATEWAY_LOCK_DIR",
    "XDG_STATE_HOME", "HOME",
)

# Names Go may pass (section 6.4), besides the account's tool keys under their Hermes names.
ALLOWED = frozenset({
    *REQUIRED, "PATH", "LANG", "LC_ALL", "TZ", "TMPDIR", "TEMP", "TMP", "HERMES_REAL_HOME",
    "HERMES_BUNDLED_SKILLS", "HERMES_OPTIONAL_SKILLS", "TERMINAL_CWD", "PYTHONNOUSERSITE",
    "PYTHONDONTWRITEBYTECODE", "PYTHONUTF8", "PYTHONIOENCODING", "HERMES_EXEC_ASK",
    # Windows process basics: without them CPython and subprocesses misbehave.
    "SYSTEMROOT", "SYSTEMDRIVE", "WINDIR", "COMSPEC", "PATHEXT", "USERPROFILE", "APPDATA",
    "LOCALAPPDATA", "PROGRAMDATA", "PROGRAMFILES", "PROGRAMFILES(X86)", "NUMBER_OF_PROCESSORS",
    "PROCESSOR_ARCHITECTURE",
})

FORBIDDEN = frozenset({
    "JWT_SECRET", "HERMES_YOLO", "HERMES_YOLO_MODE", "HERMES_ALLOW_PRIVATE_URLS", "HERMES_ACP_AUTO_APPROVE",
    "HERMES_SAFE_MODE", "HERMES_CRON_SESSION",
    "HERMES_ENABLE_PROJECT_PLUGINS", "HERMES_CONFIG_BACKEND", "HERMES_LANGUAGE",
    "HERMES_BUNDLED_LOCALES", "HERMES_MANAGED", "HERMES_ACCEPT_HOOKS", "HERMES_PROFILE",
    "DATABASE_URL", "PYTHONPATH", "PYTHONHOME", "PYTHONSTARTUP",
    # Q-4.1: a Claude Code sign-in token never reaches a worker (Hermes reads these before any key),
    # nor a pointer at another Claude Code login folder.
    "ANTHROPIC_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN", "CLAUDE_CONFIG_DIR",
})

FORBIDDEN_PREFIXES = (
    "DB_", "TIMELY_", "API_", "POSTGRES", "PG",
    # Messaging platforms (decision 6): their tokens can never reach a worker. Same list as Go's
    # deniedPrefixes (apps/api/internal/agenthost/env.go); make hermes-sync-check fails when a
    # kind: platform manifest reads a name either list lets through.
    "TELEGRAM_", "DISCORD_", "SLACK_", "WHATSAPP_", "SIGNAL_", "MATRIX_", "MATTERMOST_",
    "FEISHU_", "LARK_", "WECOM_", "WEIXIN_", "DINGTALK_", "TEAMS_", "MSGRAPH_", "TWILIO_",
    "IMESSAGE_", "BLUEBUBBLES_", "PHOTON_", "LINE_", "EMAIL_", "SMTP_", "IMAP_", "QQ_",
    "QQBOT_", "SMS_", "YUANBAO_", "A2A_", "NTFY_", "IRC_", "SIMPLEX_", "BUZZ_", "RAFT_",
    "GOOGLE_CHAT_", "GOOGLE_APPLICATION_",
)


def _is_forbidden(name: str) -> bool:
    upper = name.upper()
    if upper.startswith("HERMES_") and upper not in ALLOWED:
        return True  # Hermes behaviour switches: only the names Go sets may be present
    return upper in FORBIDDEN or upper.startswith(FORBIDDEN_PREFIXES)


# Dotenv files Hermes' ``load_hermes_dotenv`` reads. The home's own are set aside before Hermes
# is imported; the install's and the managed folder's belong to Timely and are only refused.
HOME_DOTENV = (".env", ".op.env")
SET_ASIDE_SUFFIX = ".timely-disabled"


def dotenv_files(home: os.PathLike | str, hermes_dir: os.PathLike | str,
                 managed_dir: os.PathLike | str | None) -> list[Path]:
    """Dotenv files that exist where Hermes would load them."""
    cands = [Path(home) / n for n in HOME_DOTENV] + [Path(hermes_dir) / ".env"]
    if managed_dir:
        cands.append(Path(managed_dir) / ".env")
    return [p for p in cands if p.exists() or p.is_symlink()]


def set_aside_home_dotenv(home: os.PathLike | str) -> list[Path]:
    """Rename ``<home>/.env`` and ``<home>/.op.env`` to ``*.timely-disabled`` (replacing an older
    one) so Hermes never loads them; returns the files moved. Timely never writes them, so one
    there was planted (an approved terminal command can write into the home)."""
    moved = []
    for name in HOME_DOTENV:
        src = Path(home) / name
        if src.exists() or src.is_symlink():
            dst = src.with_name(name + SET_ASIDE_SUFFIX)
            try:
                if dst.is_dir() and not dst.is_symlink():
                    raise IsADirectoryError(str(dst))
                os.replace(src, dst)
                moved.append(src)
            except OSError:
                pass  # left in place: dotenv_files() still sees it and the self-test refuses
    return moved


def drift(before: Mapping[str, str], after: Mapping[str, str], *, ignore: frozenset[str] | set[str] = frozenset()) -> list[str]:
    """Names added, changed or removed between two environments, minus ``ignore``: the worker's
    own later changes. Anything else changed the environment Go built (a dotenv file, a secret
    source), so the self-test fails on it."""
    out = []
    for name in sorted(set(before) | set(after)):
        if name in ignore or before.get(name) == after.get(name):
            continue
        state = "added" if name not in before else "removed" if name not in after else "changed"
        out.append(f"{name} {state}")
    return out


def real_user_home() -> Path | None:
    """The OS user's real home, independent of the ``HOME`` Go overrides."""
    raw = os.environ.get("HERMES_REAL_HOME", "").strip()
    if raw:
        return Path(raw)
    try:
        import pwd
        return Path(pwd.getpwuid(os.getuid()).pw_dir)
    except (ImportError, KeyError, AttributeError):
        profile = os.environ.get("USERPROFILE", "").strip()
        return Path(profile) if profile else None


def _under(child: Path, parent: Path) -> bool:
    try:
        child.resolve().relative_to(parent.resolve())
        return True
    except (ValueError, OSError):
        return False


def check(env: Mapping[str, str] | None = None, *, strict_unknown: bool = False) -> tuple[list[str], list[str]]:
    """``(problems, warnings)`` for a worker environment. Any problem means: do not start.

    Unknown names are warnings (they may be tool keys under Hermes names); with
    ``strict_unknown`` they are problems.
    """
    env = dict(os.environ if env is None else env)
    problems: list[str] = []
    warnings: list[str] = []
    for name in REQUIRED:
        if not env.get(name, "").strip():
            problems.append(f"{name} is not set")
    for name in sorted(env):
        if _is_forbidden(name):
            problems.append(f"{name} must not be in the worker environment")
        elif name.upper() not in ALLOWED and name not in ALLOWED and not name.upper().endswith(("_API_KEY", "_TOKEN", "_KEY")):
            (problems if strict_unknown else warnings).append(f"{name} is not on the worker allowlist")
    home_raw = env.get("HERMES_HOME", "").strip()
    if home_raw:
        home = Path(home_raw)
        if not home.is_absolute():
            problems.append("HERMES_HOME must be an absolute path")
        elif home.parent.name != "accounts":
            problems.append("HERMES_HOME must be <agent>/accounts/<account folder>")
        elif not home.is_dir():
            problems.append(f"HERMES_HOME {home} does not exist")
        real = real_user_home()
        if real is not None and _under(home, real / ".hermes"):
            problems.append("HERMES_HOME points into the user's own ~/.hermes")
        user_home = env.get("HOME", "").strip()
        if user_home and Path(user_home).absolute() != (home / "home").absolute():
            problems.append("HOME must be <HERMES_HOME>/home")
        managed = env.get("HERMES_MANAGED_DIR", "").strip()
        if managed and _under(Path(managed), home):
            problems.append("HERMES_MANAGED_DIR must be outside the account home")
    return problems, warnings


def build_env(layout, account: str, *, seed_skills: os.PathLike | str | None = None,
              base: Mapping[str, str] | None = None, extra: Mapping[str, str] | None = None) -> dict[str, str]:
    """Reference worker environment for an account (what Go's allowlist produces).

    Used by ``render-account`` (its JSON output carries these values for Go) and by tests.
    """
    base = os.environ if base is None else base
    home = layout.account_home(account)
    env = {
        "HERMES_HOME": str(home),
        "HOME": str(home / "home"),
        "HERMES_MANAGED_DIR": str(layout.managed_dir),
        "HERMES_RUNTIME_DIR": str(layout.runtime_dir),
        "HERMES_GATEWAY_LOCK_DIR": str(layout.locks_dir),
        "XDG_STATE_HOME": str(layout.locks_dir / "state"),
        "TERMINAL_CWD": str(home / "workspace"),
        "PYTHONNOUSERSITE": "1",
    }
    if seed_skills:
        env["HERMES_BUNDLED_SKILLS"] = str(seed_skills)
    for name in ("PATH", "LANG", "TZ", "TMPDIR", "SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT", "TEMP", "TMP"):
        if base.get(name):
            env[name] = base[name]
    real = real_user_home()
    if real is not None:
        env["HERMES_REAL_HOME"] = str(real)
    env.update(extra or {})
    return env
