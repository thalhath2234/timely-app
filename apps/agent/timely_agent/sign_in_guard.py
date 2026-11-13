"""Runtime override R5: Hermes' Nous Portal sign-in is never tried (Q-4.1, plan sections 5.7 and 12).

A Timely worker uses API keys and the CLI providers through Go's loopback gateway only: no
Hermes-native OAuth sign-in. ``run.start`` refuses a sign-in provider and the self-test
(``no_sign_in``) refuses a home holding a sign-in, but Hermes' auxiliary resolver still walks its
built-in discovery chain (OpenRouter -> Nous Portal -> ...) whenever no main provider is set. The
tool registry's ``vision_analyze`` / ``video_analyze`` check does that at every worker start, and
asks for ``provider: "auto"`` explicitly, so no ``auxiliary.*`` config can pin it: Hermes then
reads the Nous credential pool and auth store and logs "Auxiliary Nous client unavailable".

``install()`` runs right after the worker imports ``run_agent`` and replaces, in
``agent.auxiliary_client``:

- ``_read_nous_auth`` -> None (no Nous credential pool or auth store read)
- ``_resolve_nous_runtime_api`` -> None (no Nous token refresh)
- ``_try_nous`` -> ``(None, None)`` (the Nous auxiliary client is never built)
- ``_get_provider_chain`` -> Hermes' chain without its ``nous`` entry
- ``_VISION_AUTO_PROVIDER_ORDER`` -> Hermes' order without ``nous``

Every caller looks these names up in the module at call time, so all of them get the override.
Listed in ``.hermes-sync/patches.md`` as R5; the self-test (``no_sign_in``) refuses a worker where
it is missing.
"""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger("timely_agent.sign_in_guard")

MODULE = "agent.auxiliary_client"
FUNCTIONS = ("_read_nous_auth", "_resolve_nous_runtime_api", "_try_nous", "_get_provider_chain")
SIGN_IN_LABEL = "nous"

_installed = False


def _mark(fn: Any) -> Any:
    fn.__timely_sign_in_guard__ = True
    return fn


def install() -> None:
    """Apply the override (idempotent). Call after ``import run_agent``."""
    global _installed
    if _installed:
        return
    from agent import auxiliary_client as aux

    hermes_chain = aux._get_provider_chain

    @_mark
    def _read_nous_auth(*_: Any, **__: Any) -> None:
        return None

    @_mark
    def _resolve_nous_runtime_api(*_: Any, **__: Any) -> None:
        return None

    @_mark
    def _try_nous(*_: Any, **__: Any) -> tuple[None, None]:
        return None, None

    @_mark
    def _get_provider_chain() -> list[tuple]:
        return [entry for entry in hermes_chain() if entry[0] != SIGN_IN_LABEL]

    aux._read_nous_auth = _read_nous_auth
    aux._resolve_nous_runtime_api = _resolve_nous_runtime_api
    aux._try_nous = _try_nous
    aux._get_provider_chain = _get_provider_chain
    aux._VISION_AUTO_PROVIDER_ORDER = tuple(
        p for p in aux._VISION_AUTO_PROVIDER_ORDER if p != SIGN_IN_LABEL)
    _installed = True


def active() -> bool:
    """True when every override is in place (part of the ``no_sign_in`` self-test check)."""
    import importlib
    aux = importlib.import_module(MODULE)
    if any(not getattr(getattr(aux, name, None), "__timely_sign_in_guard__", False) for name in FUNCTIONS):
        return False
    if SIGN_IN_LABEL in getattr(aux, "_VISION_AUTO_PROVIDER_ORDER", (SIGN_IN_LABEL,)):
        return False
    return all(label != SIGN_IN_LABEL for label, _ in aux._get_provider_chain())
