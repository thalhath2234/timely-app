"""The real browser profile is the real home's (phase 5, Q-5.3; runtime override R7).

Hermes' real-profile browsing (``tools/browser_session_real_profile.py``) snapshots the default
Chromium profile into ``HERMES_HOME/browser-profile`` and launches the real browser binary on the
copy. It finds both through ``~``: ``hermes_cli.browser_connect.real_profile_data_dir`` joins the
profile folder onto ``os.path.expanduser("~")`` and ``_run_stdout`` runs ``xdg-settings`` (Linux) or
``defaults`` (macOS) to name the default browser. A worker's ``HOME`` is the account's profile home
(``<HERMES_HOME>/home``, plan 6.4), which holds no browser, so both would come up empty and the
browser would fall back to signed out. ``install`` replaces the two functions so they resolve
against ``HERMES_REAL_HOME`` (the OS user's home; a sandbox folder in tests), the home Q-5.3 means:

- ``real_profile_data_dir``: Hermes' own table (``_BROWSER_BY_KEY``, snap and Flatpak folders),
  rooted at the real home (``LOCALAPPDATA`` under it on Windows).
- ``_run_stdout``: runs Hermes' probe with ``HOME`` set to the real home; on Linux the real home's
  ``.config/mimeapps.list`` is read first (``default_from_mimeapps``), so a desktop's own settings
  daemon is never asked.

``source_problem`` is the self-test's check that the resolved snapshot source lies under
``HERMES_REAL_HOME`` (decision 20: in tests that is inside ``$HOME/.cache/p5-sandbox``).
"""

from __future__ import annotations

import logging
import os
import platform
from pathlib import Path
from typing import Optional

from timely_agent import env_check

logger = logging.getLogger("timely_agent.real_profile")

_MARK = "_timely_real_home"


def real_home() -> Optional[Path]:
    return env_check.real_user_home()


def default_from_mimeapps(home: Path) -> str:
    """The ``.desktop`` id ``mimeapps.list`` names for https (or http, or text/html), else ""."""
    want = ("x-scheme-handler/https", "x-scheme-handler/http", "text/html")
    for path in (home / ".config" / "mimeapps.list", home / ".local" / "share" / "applications" / "mimeapps.list"):
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        section, found = "", {}
        for line in text.splitlines():
            line = line.strip()
            if line.startswith("[") and line.endswith("]"):
                section = line[1:-1]
            elif section == "Default Applications" and "=" in line:
                key, _, value = line.partition("=")
                first = value.split(";")[0].strip()
                if first:
                    found.setdefault(key.strip(), first)
        for key in want:
            if found.get(key):
                return found[key]
    return ""


def install() -> None:
    from hermes_cli import browser_connect as bc
    if getattr(bc.real_profile_data_dir, _MARK, False):
        return
    original_run = bc._run_stdout

    def real_profile_data_dir(browser: str, system: str | None = None) -> str | None:
        b = bc._BROWSER_BY_KEY.get(browser)
        home = real_home()
        if b is None or home is None:
            return None
        system = system or platform.system()
        if system == "Darwin":
            return str(home.joinpath("Library", "Application Support", *b.mac_support))
        if system == "Windows":
            return str(home.joinpath("AppData", "Local", *b.win_profile))
        parts = b.linux_config.split("/")
        candidates = [home.joinpath(".config", *parts)]
        if browser in bc._LINUX_SNAP_PROFILE_PARTS:
            candidates.append(home.joinpath(*bc._LINUX_SNAP_PROFILE_PARTS[browser]))
        if browser in bc._LINUX_FLATPAK_IDS:
            candidates.append(home.joinpath(".var", "app", bc._LINUX_FLATPAK_IDS[browser], "config", *parts))
        return str(next((c for c in candidates if c.is_dir()), candidates[0]))

    def run_stdout(argv: list[str]) -> str | None:
        home = real_home()
        if home is None:
            return None
        if argv[:3] == ["xdg-settings", "get", "default-web-browser"]:
            found = default_from_mimeapps(home)
            if found:
                return found + "\n"
        import subprocess
        env = dict(os.environ, HOME=str(home))
        env.pop("XDG_CONFIG_HOME", None)
        try:
            return subprocess.run(argv, capture_output=True, text=True, encoding="utf-8", errors="replace",
                                  timeout=5, check=False, env=env).stdout
        except Exception:
            return None

    for fn in (real_profile_data_dir, run_stdout):
        setattr(fn, _MARK, True)
    run_stdout.__wrapped__ = original_run  # type: ignore[attr-defined]
    bc.real_profile_data_dir = real_profile_data_dir
    bc._run_stdout = run_stdout


def active() -> bool:
    try:
        from hermes_cli import browser_connect as bc
        return bool(getattr(bc.real_profile_data_dir, _MARK, False) and getattr(bc._run_stdout, _MARK, False))
    except Exception:
        return False


def resolved_source() -> tuple[str, str]:
    """``(browser key, profile folder)`` Hermes would snapshot now, ``("", "")`` when the real home
    names no supported Chromium default (Hermes then browses signed out, with its own note)."""
    from hermes_cli import browser_connect as bc
    browser = bc.detect_default_chromium()
    if not browser or browser == bc.UNSUPPORTED_CHANNEL:
        return "", ""
    return str(browser), str(bc.real_profile_data_dir(browser) or "")


def source_problem() -> str:
    """Why the real-profile snapshot source is not under ``HERMES_REAL_HOME``, else ""."""
    if not active():
        return "the real-profile override (R7) is not installed"
    home = real_home()
    if home is None:
        return "HERMES_REAL_HOME is not known"
    try:
        _, folder = resolved_source()
    except Exception as exc:
        return f"resolving the default browser failed: {type(exc).__name__}: {exc}"
    if not folder:
        return ""
    try:
        Path(folder).resolve().relative_to(home.resolve())
    except ValueError:
        return f"the browser profile {folder} is not under HERMES_REAL_HOME {home}"
    return ""
