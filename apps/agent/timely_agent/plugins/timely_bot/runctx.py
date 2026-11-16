"""What the bot plugin and ``timely_gate`` know about the Bot tick a worker thread is running
(plan 7.4, 7.5). Stdlib only, so the gate's bot rules are unit-testable without Hermes.

``run_bot`` builds one :class:`BotRun` per ``bot.run`` and registers it under the run id; the
bridge's :class:`RunContext` (``kind == "bot"``) only carries the shared taint list. The hosts a
tick may reach are decided here and nowhere else:

- **bot hosts**: the hosts of the Bot's Reads (from ``data.readings`` and ``tools.read_hosts``), its
  browser grant sites (``tools.browser_sites``) and its ``egress`` list, plus the hosts a
  ``web_search`` returned earlier in the same tick before the tick was tainted;
- **browser sites** (the grants): the only hosts ``bot_browser_read`` may read without a card.

A host matches a listed host when it is that host or a subdomain of it (``www.`` is ignored).
"""

from __future__ import annotations

import re
import threading
from dataclasses import dataclass, field
from typing import Any, Iterable, Optional
from urllib.parse import urlsplit

URL_IN_TEXT = re.compile(r"https?://[^\s\"'<>)\]\\]+", re.IGNORECASE)
MAX_REPORTS = 5


def norm_host(value: Any) -> str:
    """A URL's or bare host's name as policy compares it: lower case, no ``www.``, no port, no
    trailing dot, no brackets. "" when there is none."""
    if not isinstance(value, str) or not value.strip():
        return ""
    text = value.strip()
    if text.startswith("//"):
        text = "http:" + text
    elif "://" not in text:
        text = "http://" + text
    try:
        host = (urlsplit(text).hostname or "").strip().lower().rstrip(".").strip("[]")
    except ValueError:
        return ""
    return host[4:] if host.startswith("www.") else host


def norm_hosts(values: Any) -> list[str]:
    out: list[str] = []
    for item in values if isinstance(values, (list, tuple, set)) else []:
        if isinstance(item, dict):
            item = item.get("url") or item.get("host") or item.get("site")
        host = norm_host(item)
        if host and host not in out:
            out.append(host)
    return out


def host_in(host: str, listed: Iterable[str]) -> bool:
    """Whether ``host`` is one of ``listed`` or a subdomain of one."""
    host = norm_host(host)
    if not host:
        return False
    return any(host == h or host.endswith("." + h) for h in listed)


def urls_in(value: Any, key: str = "") -> list[str]:
    """Every URL a tool's arguments name: a ``url``/``urls``/``href`` value whole, and each
    ``http(s)://`` literal in any string at any depth."""
    out: list[str] = []
    if isinstance(value, str):
        if key in ("url", "urls", "href", "uri", "link") and value.strip():
            out.append(value.strip())
        out += URL_IN_TEXT.findall(value)
    elif isinstance(value, dict):
        for k, v in value.items():
            out += urls_in(v, str(k))
    elif isinstance(value, (list, tuple)):
        for v in value:
            out += urls_in(v, key)
    return out


@dataclass
class BotRun:
    run_id: str
    bot_id: str
    check_id: str
    permission: str = "auto"
    dry_run: bool = False
    read_hosts: list[str] = field(default_factory=list)
    browser_sites: list[str] = field(default_factory=list)
    egress: list[str] = field(default_factory=list)
    # MCP servers the person allows for this bot: name -> allowed tool names (None = every tool)
    mcp: dict[str, Optional[set[str]]] = field(default_factory=dict)
    web: bool = True
    # Hosts web_search returned before the tick was tainted (they may then be read).
    search_hosts: list[str] = field(default_factory=list)
    # call ids of web_search calls that ran before the tick was tainted (their result hosts count)
    search_calls: set[str] = field(default_factory=set)
    reports: list[dict[str, Any]] = field(default_factory=list)
    parked: list[dict[str, Any]] = field(default_factory=list)
    trace: list[dict[str, Any]] = field(default_factory=list)
    hosts_used: list[str] = field(default_factory=list)
    overlay: dict[str, Optional[str]] = field(default_factory=dict)  # dry run: note writes stay here
    # (tool, args_hash) of the gate-only script calls a continuation's pre_approved names (``script.py``):
    # the only ones their handlers run, each once.
    scripts: set[tuple[str, str]] = field(default_factory=set)
    lock: threading.Lock = field(default_factory=threading.Lock, repr=False, compare=False)

    @property
    def full(self) -> bool:
        """Full Access (Go sends ``permission: full`` only after the step-up): the egress policy is lifted."""
        return self.permission == "full"

    @property
    def bot_hosts(self) -> list[str]:
        return list(dict.fromkeys([*self.read_hosts, *self.browser_sites, *self.egress, *self.search_hosts]))

    def is_bot_host(self, host: str) -> bool:
        return host_in(host, self.bot_hosts)

    def is_granted(self, host: str) -> bool:
        return host_in(host, self.browser_sites)

    def add_search_hosts(self, hosts: Iterable[str]) -> None:
        with self.lock:
            for h in hosts:
                if h and h not in self.search_hosts:
                    self.search_hosts.append(h)

    def note_blocked(self, tool: str, args: Any, message: str) -> None:
        """A call the gate refused (Hermes reports no completion for it): one trace entry, not ok. ``at`` is
        a monotonic stamp for ordering against the agent's own tool callbacks."""
        import time
        host = ""
        if isinstance(args, dict):
            urls = urls_in(args)
            host = norm_host(urls[0]) if urls else ""
        item: dict[str, Any] = {"name": tool, "ok": False, "ms": 0, "at": time.monotonic(),
                                "note": (message or "blocked")[:200]}
        if host:
            item["host"] = host
        with self.lock:
            self.trace.append(item)

    def note_host(self, host: str) -> None:
        if host:
            with self.lock:
                if host not in self.hosts_used:
                    self.hosts_used.append(host)

    def allow_script(self, tool: str, args_hash: str) -> None:
        with self.lock:
            self.scripts.add((tool, args_hash))

    def take_script(self, tool: str, args_hash: str) -> bool:
        """Whether this script call was the continuation's approved one; it can be taken once."""
        with self.lock:
            if (tool, args_hash) not in self.scripts:
                return False
            self.scripts.discard((tool, args_hash))
            return True

    def mcp_allowed(self, server: str, tool: str) -> bool:
        if server not in self.mcp:
            return False
        tools = self.mcp[server]
        return tools is None or tool in tools


_runs: dict[str, BotRun] = {}
_runs_lock = threading.Lock()


def register(run: BotRun) -> BotRun:
    with _runs_lock:
        _runs[run.run_id] = run
    return run


def get(run_id: str) -> Optional[BotRun]:
    with _runs_lock:
        return _runs.get(run_id)


def forget(run_id: str) -> None:
    with _runs_lock:
        _runs.pop(run_id, None)


def parse_mcp(value: Any) -> dict[str, Optional[set[str]]]:
    """``tools.mcp`` as ``{server: tools|None}``: server names, or ``{server, tools?}`` objects."""
    out: dict[str, Optional[set[str]]] = {}
    for item in value if isinstance(value, (list, tuple)) else []:
        if isinstance(item, str) and item.strip():
            out[item.strip()] = None
        elif isinstance(item, dict) and isinstance(item.get("server"), str) and item["server"].strip():
            tools = item.get("tools")
            out[item["server"].strip()] = ({str(t) for t in tools} if isinstance(tools, list) and tools else None)
    return out
