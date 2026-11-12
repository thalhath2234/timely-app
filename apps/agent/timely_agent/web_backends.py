"""The keyed web backends Timely offers in Settings (plan 8.2, Q-3.8), and which ones this runtime can use.

Without a search key every account uses ``timely`` (the ``timely_web`` plugin: Go runs the search
with the chat provider's own search, and fetches pages through its netguard). A key the person
saves in Settings picks one of the backends below instead; Go passes the key to the worker under
the backend's Hermes env name and renders ``web.search_backend`` / ``web.extract_backend``.

Each backend is one of Hermes' bundled web plugins (``hermes/plugins/web/<plugin>``) whose SDK is a
pip extra (``.hermes-sync/extras.txt``; the install guard blocks run-time installs, so an extra
that is missing stays missing). :func:`available` lists the backends whose extra's anchor import
resolves and whose plugin folder is in the copy: the worker reports it in ``ready.web_backends``
and Settings offers only those. Keyless backends (``ddgs``, the keyless tiers) are never offered:
``web.keyless_fallback`` and ``web.keyless_rescue`` are floored off.

Stdlib only: no Hermes import (the self-test and the pytest process both call it).
"""

from __future__ import annotations

import importlib.util
from dataclasses import asdict, dataclass
from typing import Callable, Optional

from timely_agent import paths

TIMELY = "timely"  # the default backend: Go answers web_search / web_extract (plugins/timely_web)


@dataclass(frozen=True)
class Backend:
    id: str          # web.search_backend / web.extract_backend value, and agent_web_keys.backend
    label: str       # what Settings shows
    env: str         # the Hermes env name Go passes the key under
    extra: str       # pyproject extra (.hermes-sync/extras.txt)
    anchor: str      # the import that proves the extra is installed (hermes/pm/extras.py ANCHORS)
    plugin: str      # folder under hermes/plugins/web/
    key_url: str     # where the person gets a key
    search: bool = True
    extract: bool = True


BACKENDS: tuple[Backend, ...] = (
    Backend(id="exa", label="Exa", env="EXA_API_KEY", extra="exa", anchor="exa_py", plugin="exa",
            key_url="https://dashboard.exa.ai/api-keys"),
    Backend(id="firecrawl", label="Firecrawl", env="FIRECRAWL_API_KEY", extra="firecrawl", anchor="firecrawl",
            plugin="firecrawl", key_url="https://www.firecrawl.dev/app/api-keys"),
    Backend(id="parallel", label="Parallel", env="PARALLEL_API_KEY", extra="parallel-web", anchor="parallel",
            plugin="parallel", key_url="https://platform.parallel.ai/"),
)


def get(backend_id: str) -> Optional[Backend]:
    return next((b for b in BACKENDS if b.id == backend_id), None)


def _resolves(anchor: str, find_spec: Callable) -> bool:
    try:
        return find_spec(anchor) is not None
    except (ImportError, ValueError, AttributeError):
        return False


def available(find_spec: Optional[Callable] = None) -> list[str]:
    """The ids of the backends whose anchor import resolves and whose Hermes plugin is in the copy,
    in ``BACKENDS`` order. ``find_spec`` is ``importlib.util.find_spec`` (tests pass their own)."""
    find_spec = find_spec or importlib.util.find_spec
    web = paths.hermes_dir() / "plugins" / "web"
    return [b.id for b in BACKENDS
            if (web / b.plugin / "__init__.py").is_file() and _resolves(b.anchor, find_spec)]


def describe() -> list[dict]:
    """Every backend Timely offers, as plain data (the static list behind Settings)."""
    return [asdict(b) for b in BACKENDS]
