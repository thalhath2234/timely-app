"""The on-disk layout of Timely's agent state (plan section 6.1). Stdlib only, no Hermes imports.

::

    <data>/agent/
      instance.json          layout version (+ Postgres identity, written by Go)
      managed/config.yaml    HERMES_MANAGED_DIR: host-wide floors
      runtime/               HERMES_RUNTIME_DIR (regenerable)
      locks/                 HERMES_GATEWAY_LOCK_DIR and XDG_STATE_HOME
      seed/<hash>/skills/    HERMES_BUNDLED_SKILLS (section 9.1)
      timely-skills/<hash>/  skills.external_dirs, read-only
      accounts/account-<sha256(uid)[:12] as hex>/   HERMES_HOME of one account
      .trash/  .restore-*/
"""

from __future__ import annotations

import hashlib
import os
from dataclasses import dataclass
from pathlib import Path

LAYOUT_VERSION = 1

# Durable and regenerable folders inside one account home (section 6.1).
HOME_DIRS = ("memories", "skills", "pending", "sessions", "workspace", "home", "cache", "logs")


def agent_dir() -> Path:
    """``apps/agent`` in a checkout, or the packaged ``app/`` folder."""
    return Path(__file__).resolve().parent.parent


def hermes_dir() -> Path:
    return agent_dir() / "hermes"


def timely_skills_src() -> Path:
    """Timely-owned skills (``apps/agent/skills``); ``overrides/`` inside it feeds the seed tree."""
    return agent_dir() / "skills"


def skills_reviewed_file() -> Path:
    return agent_dir() / ".hermes-sync" / "policy" / "skills-reviewed.json"


def account_dir_name(account: str) -> str:
    """``account-<hex of the first 12 bytes of sha256(uid)>``, the same name as
    ``portability/service.go`` ``safeAccountDirectory`` (24 hex characters)."""
    if not account:
        raise ValueError("account id is empty")
    return "account-" + hashlib.sha256(account.encode("utf-8")).digest()[:12].hex()


@dataclass(frozen=True)
class AgentLayout:
    """Paths under ``<data>/agent``; nothing is created until :meth:`ensure`."""

    root: Path

    @classmethod
    def at(cls, root: os.PathLike | str) -> "AgentLayout":
        return cls(Path(root).expanduser().absolute())

    @property
    def instance_file(self) -> Path:
        return self.root / "instance.json"

    @property
    def managed_dir(self) -> Path:
        return self.root / "managed"

    @property
    def managed_config(self) -> Path:
        return self.managed_dir / "config.yaml"

    @property
    def runtime_dir(self) -> Path:
        return self.root / "runtime"

    @property
    def locks_dir(self) -> Path:
        return self.root / "locks"

    @property
    def seed_root(self) -> Path:
        return self.root / "seed"

    @property
    def timely_skills_root(self) -> Path:
        return self.root / "timely-skills"

    @property
    def accounts_dir(self) -> Path:
        return self.root / "accounts"

    @property
    def trash_dir(self) -> Path:
        return self.root / ".trash"

    def account_home(self, account: str) -> Path:
        return self.accounts_dir / account_dir_name(account)

    def ensure(self) -> None:
        for d in (self.managed_dir, self.runtime_dir, self.locks_dir, self.seed_root,
                  self.timely_skills_root, self.accounts_dir):
            d.mkdir(parents=True, exist_ok=True)

    def ensure_home(self, account: str) -> Path:
        """Create the account home and its folders (idempotent); returns ``HERMES_HOME``."""
        home = self.account_home(account)
        for name in HOME_DIRS:
            (home / name).mkdir(parents=True, exist_ok=True)
        return home


def layout_for_home(home: os.PathLike | str) -> AgentLayout:
    """The layout an account home belongs to (``<root>/accounts/<home>``)."""
    home = Path(home).absolute()
    if home.parent.name != "accounts":
        raise ValueError(f"{home} is not inside an 'accounts' folder")
    return AgentLayout(home.parent.parent)


def within(root: os.PathLike | str, path: os.PathLike | str) -> bool:
    """True when ``path`` resolves inside ``root`` (or is ``root``)."""
    try:
        Path(path).resolve().relative_to(Path(root).resolve())
    except (ValueError, OSError):
        return False
    return True
