"""Make Timely's plugins visible to Hermes as entry-point plugins (plan section 4.3).

Hermes discovers general plugins in ``<bundled>/plugins``, ``$HERMES_HOME/plugins`` and the
``hermes_agent.plugins`` entry-point group. Phase 1 decision: Timely uses the entry-point
group, served by an in-memory distribution that ``boot.py`` registers on ``sys.meta_path``.
Nothing is copied into account homes, nothing is pip-installed, and the plugin code stays in
``timely_agent/plugins/`` (importable as ``timely_agent.plugins.<name>``; a folder named
``plugins`` beside ``hermes/`` would collide with Hermes' own top-level ``plugins`` package).
Hermes still loads only names listed in ``plugins.enabled``, which the managed config pins.
"""

from __future__ import annotations

import importlib.abc
import importlib.metadata as md
import re
import sys
from pathlib import Path
from typing import Iterable

DIST_NAME = "timely-agent-plugins"
GROUP = "hermes_agent.plugins"
# The phase 1 plugins keep their order (hook registration order); any other folder follows, sorted.
_FIRST = ("timely_gate", "timely_tools", "timely_learning", "timely_bot")
_REGISTER = re.compile(r"^def register\(", re.MULTILINE)


def plugin_names(root: Path | None = None) -> tuple[str, ...]:
    """Every package folder under ``timely_agent/plugins/`` whose ``__init__.py`` defines
    ``register`` (read as text: nothing is imported). A new plugin is enabled by adding its folder."""
    root = root or Path(__file__).resolve().parent / "plugins"
    found = set()
    for init in root.glob("*/__init__.py"):
        name = init.parent.name
        if not re.fullmatch(r"[a-z][a-z0-9_]*", name):
            continue
        try:
            if _REGISTER.search(init.read_text(encoding="utf-8")):
                found.add(name)
        except OSError:
            continue
    return tuple(n for n in _FIRST if n in found) + tuple(sorted(found - set(_FIRST)))


PLUGINS = plugin_names()


def _entry_points_txt() -> str:
    lines = [f"[{GROUP}]"] + [f"{name} = timely_agent.plugins.{name}:register" for name in PLUGINS]
    return "\n".join(lines) + "\n"


class TimelyPluginsDistribution(md.Distribution):
    _files = {
        "METADATA": f"Metadata-Version: 2.1\nName: {DIST_NAME}\nVersion: 1\nSummary: Timely's Hermes plugins\n",
        "entry_points.txt": _entry_points_txt(),
    }

    def read_text(self, filename: str) -> str | None:
        return self._files.get(filename)

    def locate_file(self, path) -> Path:
        return Path(__file__).parent / str(path)


class TimelyPluginsFinder(importlib.abc.MetaPathFinder):
    """Imports nothing; only answers distribution queries."""

    def find_spec(self, fullname, path=None, target=None):  # noqa: D401 - finder protocol
        return None

    def find_distributions(self, context=md.DistributionFinder.Context()) -> Iterable[md.Distribution]:
        name = getattr(context, "name", None)
        if name is None or md.Prepared.normalize(name) == md.Prepared.normalize(DIST_NAME):
            yield TimelyPluginsDistribution()


def register() -> None:
    if not any(isinstance(f, TimelyPluginsFinder) for f in sys.meta_path):
        sys.meta_path.append(TimelyPluginsFinder())
