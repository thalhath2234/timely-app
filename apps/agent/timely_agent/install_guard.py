"""Runtime override: no package installs inside a worker (plan sections 4.4 and 12).

Hermes' package manager (``pm``) installs Python extras, tools and browsers on first use. A
Timely worker runs from a fixed, reviewed runtime (read-only when packaged), so every install
path is refused. The config floor ``security.allow_lazy_installs: false`` and
``HERMES_DISABLE_LAZY_INSTALLS=1`` already ask pm to refuse; this module makes it certain by
replacing the pm entry points at boot, before any Hermes module that could bind them is
imported. Listed in ``.hermes-sync/patches.md`` as a runtime override (no vendored file edited).

Replaced function objects (``OVERRIDES``):

- ``pm.install.lazy_installs_allowed`` -> always False
- ``pm.client._request`` -> refuses: every pm worker operation (ensure, sync_venv, tool and
  environment builds) goes through it
- ``pm.client.ensure`` / ``pm.client.sync_venv`` / ``pm.install.ensure`` / ``pm.install.sync_venv``
  -> refuse (the in-process "runtime" branch skips ``_request``)
- ``pm.extras.ensure_import`` -> no-op when the extra's anchor imports, otherwise refuses
- ``agent.lsp.install.try_install`` -> probe only (Hermes' ``manual`` strategy) whatever strategy
  the caller asks for; a missing language server is recorded as a refusal
- ``agent.lsp.install._run_installer`` -> refuses (returns False, Hermes' "install failed")

The LSP auto-installer (``agent/lsp/install.py``) runs ``go install`` and ``npm install`` from
PATH directly, without pm, whenever ``write_file``/``patch`` touches a file a missing language
server would handle. The managed floor ``lsp.install_strategy: manual`` already asks it not to;
the overrides make it certain.

Each pm refusal raises pm's own ``InstallError``, which Hermes callers already handle as
"feature unavailable". The LSP overrides return Hermes' own failure values instead (``None`` /
``False``), because the LSP layer must never break a write and expects those, not exceptions.
"""

from __future__ import annotations

import logging
import os
from typing import Any

logger = logging.getLogger("timely_agent.install_guard")

OVERRIDES = (
    "pm.install.lazy_installs_allowed",
    "pm.client._request",
    "pm.client.ensure",
    "pm.client.sync_venv",
    "pm.install.ensure",
    "pm.install.sync_venv",
    "pm.extras.ensure_import",
    "agent.lsp.install.try_install",
    "agent.lsp.install._run_installer",
)

REFUSAL = "Timely's agent runtime is fixed: installing packages or tools while it runs is turned off"
HINT = "ask whoever runs this Timely server to update Timely"

_installed = False
refusals: list[str] = []


def _refuse(what: str) -> None:
    refusals.append(what)
    logger.warning("install guard refused %s", what)


def _error(what: str) -> Exception:
    from pm.package import InstallError
    _refuse(what)
    return InstallError(what, REFUSAL, HINT)


def install() -> None:
    """Apply the overrides (idempotent). Call before importing ``run_agent`` or ``model_tools``."""
    global _installed
    if _installed:
        return
    os.environ["HERMES_DISABLE_LAZY_INSTALLS"] = "1"
    import agent.lsp.install as lsp_install
    import pm.client
    import pm.extras
    import pm.install

    def lazy_installs_allowed() -> bool:
        return False

    def refuse_request(operation, arguments=None, **_: Any):
        raise _error(f"pm operation {operation!r}")

    def refuse_ensure(name, *_, **__):
        raise _error(f"install of {name!r}")

    def refuse_sync(extras=None, *_, **__):
        raise _error(f"dependency sync {list(extras or [])!r}")

    original_available = pm.extras.available

    def ensure_import(extra: str) -> None:
        if original_available(extra):
            return
        raise _error(f"optional extra {extra!r}")

    original_try_install = lsp_install.try_install

    def try_install(pkg, strategy="auto"):
        found = original_try_install(pkg, "manual")  # probe PATH and <HERMES_HOME>/lsp/bin only
        if found is None and strategy == "auto":
            _refuse(f"language server install {pkg!r}")
        return found

    def refuse_installer(tool, pkg, cmd, *_, **__):
        _refuse(f"{tool} install of {pkg!r}")
        return False

    pm.install.lazy_installs_allowed = lazy_installs_allowed
    pm.client._request = refuse_request
    pm.client.ensure = refuse_ensure
    pm.client.sync_venv = refuse_sync
    pm.install.ensure = refuse_ensure
    pm.install.sync_venv = refuse_sync
    pm.extras.ensure_import = ensure_import
    lsp_install.try_install = try_install
    lsp_install._run_installer = refuse_installer
    for fn in (lazy_installs_allowed, refuse_request, refuse_ensure, refuse_sync, ensure_import,
               try_install, refuse_installer):
        fn.__timely_install_guard__ = True  # type: ignore[attr-defined]
    _installed = True


def active() -> bool:
    """True when every override is in place (part of the self-test)."""
    import importlib
    for dotted in OVERRIDES:
        mod_name, _, attr = dotted.rpartition(".")
        fn = getattr(importlib.import_module(mod_name), attr, None)
        if not getattr(fn, "__timely_install_guard__", False):
            return False
    return True
