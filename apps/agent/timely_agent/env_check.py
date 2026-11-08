"""Worker environment rules (plan section 6.4). Stdlib only: runs before Hermes is imported.

Go builds the worker environment from scratch out of an allowlist. This module is the
worker's own check of that contract, and the reference list both sides share:

- ``REQUIRED``: the worker refuses to start without them. Without ``HERMES_HOME``
  Hermes falls back to the owner's live ``~/.hermes`` (``hermes_constants.get_hermes_home``).
- ``FORBIDDEN`` / ``FORBIDDEN_PREFIXES``: Timely secrets, Hermes behaviour flags and
  messaging platform credentials. Any of them present is a refusal, not a warning.
- ``HERMES_LANGUAGE`` and ``HERMES_BUNDLED_LOCALES`` are forbidden: the copy ships only
  ``locales/en.yaml`` and the managed config pins ``display.language: en`` (sync finding 6).
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
    "JWT_SECRET", "HERMES_YOLO", "HERMES_SAFE_MODE", "HERMES_CRON_SESSION",
    "HERMES_ENABLE_PROJECT_PLUGINS", "HERMES_CONFIG_BACKEND", "HERMES_LANGUAGE",
    "HERMES_BUNDLED_LOCALES", "HERMES_MANAGED", "HERMES_ACCEPT_HOOKS", "HERMES_PROFILE",
    "DATABASE_URL", "PYTHONPATH", "PYTHONHOME", "PYTHONSTARTUP",
})

FORBIDDEN_PREFIXES = (
    "DB_", "TIMELY_", "API_", "POSTGRES", "PG",
    # Messaging platforms (decision 6): their tokens can never reach a worker.
    "TELEGRAM_", "DISCORD_", "SLACK_", "WHATSAPP_", "SIGNAL_", "MATRIX_", "MATTERMOST_",
    "FEISHU_", "LARK_", "WECOM_", "WEIXIN_", "DINGTALK_", "TEAMS_", "MSGRAPH_", "TWILIO_",
    "IMESSAGE_", "BLUEBUBBLES_", "PHOTON_", "LINE_", "EMAIL_", "SMTP_", "IMAP_", "QQ_",
)


def _is_forbidden(name: str) -> bool:
    upper = name.upper()
    return upper in FORBIDDEN or upper.startswith(FORBIDDEN_PREFIXES)


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
