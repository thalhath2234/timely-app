"""Runtime override R2: no dotenv reload after the worker's start (plan sections 6.2 and 12).

Hermes loads ``$HERMES_HOME/.env`` (and the managed and profile dotenv files) into
``os.environ`` when ``run_agent`` is imported, and again whenever some code paths call
``hermes_cli.env_loader.load_hermes_dotenv()`` at run time: loading the MCP config does
(``tools/mcp_tool_config.py`` ``_load_mcp_config``, ``hermes_cli/mcp_config.py``). The worker sets
planted dotenv files aside before that import and the self-test compares the environment once,
at ``hello``; a ``.env`` written later (by an approved terminal command, say) would otherwise
switch on ``HERMES_YOLO_MODE`` or ``HERMES_ALLOW_PRIVATE_URLS`` for the rest of the worker's life.

``install()`` runs right after the worker imports ``run_agent`` and replaces the module attribute
``hermes_cli.env_loader.load_hermes_dotenv`` with a no-op that returns ``[]`` (Hermes' "nothing
loaded"). Every run-time caller imports it from the module inside the function, so they all get
the no-op. Listed in ``.hermes-sync/patches.md`` as R2; the self-test (``dotenv_guard``) refuses
a worker where it is missing.
"""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger("timely_agent.dotenv_guard")

OVERRIDES = ("hermes_cli.env_loader.load_hermes_dotenv",)

_installed = False
calls: list[str] = []


def install() -> None:
    """Apply the override (idempotent). Call after ``import run_agent``, whose own dotenv load
    must still run (on the files the worker left in place)."""
    global _installed
    if _installed:
        return
    from hermes_cli import env_loader

    def load_hermes_dotenv(*_: Any, **kwargs: Any) -> list:
        where = str(kwargs.get("hermes_home") or "the worker home")
        calls.append(where)
        if len(calls) == 1:
            logger.warning("dotenv reload after start skipped (%s): the worker environment is fixed", where)
        return []

    load_hermes_dotenv.__timely_dotenv_guard__ = True  # type: ignore[attr-defined]
    env_loader.load_hermes_dotenv = load_hermes_dotenv
    _installed = True


def active() -> bool:
    """True when the override is in place (part of the self-test)."""
    import importlib
    for dotted in OVERRIDES:
        mod_name, _, attr = dotted.rpartition(".")
        fn = getattr(importlib.import_module(mod_name), attr, None)
        if not getattr(fn, "__timely_dotenv_guard__", False):
            return False
    return True
