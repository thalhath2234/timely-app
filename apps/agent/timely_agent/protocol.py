"""Newline-delimited JSON between the Go API and one worker (plan section 5.1, ``apps/agent/PROTOCOL.md``).

Stdlib only. One message per line, UTF-8, no embedded newlines (``json.dumps`` escapes them).
Every message carries ``type`` and ``account``; requests carry ``id`` and the reply to a
request carries the same ``id``. The account is checked on every message in both directions.
"""

from __future__ import annotations

import io
import json
import math
import os
import threading
from typing import Any, Callable, Optional

PROTOCOL_VERSION = 1
MAX_LINE_BYTES = 32 * 1024 * 1024  # a run.start with a history seed or images can be large

# Go -> worker
GO_TYPES = frozenset({
    "hello", "ping", "run.start", "bot.run", "run.stop", "run.steer", "approval.answer",
    "tool.result", "gate.verdict", "session.delete", "shutdown", "settings.update",
    "clarify.answer",  # phase 4 (PROTOCOL.md section 11)
})
GO_PREFIX_TYPES = ("learning.",)
# worker -> Go
WORKER_TYPES = frozenset({
    "ready", "event", "tool.call", "gate.ask", "taint", "run.done", "bot.done", "log",
    "ack", "error", "heartbeat", "pong", "learning", "learning.result",
})
# Phase 3 run.start lists (PROTOCOL.md section 10): conversation ids and hosts, all strings.
RUN_START_LISTS = ("tainted_conversations", "search_exclude", "search_allow")
RUN_START_BOOL_FLAGS = ("learning_writes", "search_history", "web", "from_bot", "sensitive", "answer_only",
                        "rich_ui", "no_persist")
# Phase 4: the only toolsets a no-persist run may have (PROTOCOL.md section 11).
NO_PERSIST_TOOLSETS = ("timely", "todo")

# error.code values (PROTOCOL.md "Errors")
E_BAD_JSON = "bad_json"
E_BAD_MESSAGE = "bad_message"
E_UNKNOWN_TYPE = "unknown_type"
E_WRONG_ACCOUNT = "wrong_account"
E_PROTOCOL = "protocol_mismatch"
E_NOT_READY = "not_ready"
E_REFUSED = "refused"
E_HOME = "home_mismatch"
E_CONFIG = "config_mismatch"
E_BUSY = "busy"
E_UNKNOWN_RUN = "unknown_run"
E_DUPLICATE_RUN = "duplicate_run"
E_UNSUPPORTED = "unsupported"
E_INTERNAL = "internal"
E_NOT_FOUND = "not_found"  # learning.* (section 10.3)


class ProtocolError(Exception):
    def __init__(self, code: str, message: str, msg_id: Optional[str] = None):
        super().__init__(message)
        self.code, self.message, self.msg_id = code, message, msg_id


def is_go_type(t: str) -> bool:
    return t in GO_TYPES or t.startswith(GO_PREFIX_TYPES)


def decode(line: bytes, account: Optional[str]) -> dict[str, Any]:
    """Parse and validate one Go -> worker line; raises :class:`ProtocolError`.

    ``account`` is the account this worker serves (``None`` before ``hello``, when
    any non-empty account is accepted and later pinned by the caller).
    """
    try:
        msg = json.loads(line)
    except (ValueError, UnicodeDecodeError) as exc:
        raise ProtocolError(E_BAD_JSON, f"line is not JSON: {exc}") from None
    if not isinstance(msg, dict):
        raise ProtocolError(E_BAD_MESSAGE, "message must be a JSON object")
    msg_id = msg.get("id") if isinstance(msg.get("id"), str) else None
    mtype = msg.get("type")
    if not isinstance(mtype, str) or not mtype:
        raise ProtocolError(E_BAD_MESSAGE, "message has no type", msg_id)
    if not is_go_type(mtype):
        raise ProtocolError(E_UNKNOWN_TYPE, f"unknown message type {mtype!r}", msg_id)
    acct = msg.get("account")
    if not isinstance(acct, str) or not acct:
        raise ProtocolError(E_BAD_MESSAGE, "message has no account", msg_id)
    if account is not None and acct != account:
        raise ProtocolError(E_WRONG_ACCOUNT, "message is for another account", msg_id)
    return msg


def _finite(value: Any) -> Any:
    """``value`` with every NaN/Infinity float replaced by ``None`` (tuples become lists)."""
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    if isinstance(value, dict):
        return {k: _finite(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_finite(v) for v in value]
    return value


def encode(msg: dict[str, Any]) -> bytes:
    """One line. Non-ASCII is escaped (``\\uXXXX``): a lone surrogate from a model stream split
    inside an emoji would make a UTF-8 encode raise and lose the message; escaped, Go's decoder
    turns it into U+FFFD.

    Never ``NaN``/``Infinity``: Go's decoder refuses them and a refused line stops the account's
    whole worker. Model-made tool arguments can hold them (Hermes parses arguments with
    ``json.loads``), so they are sent as ``null``."""
    opts: dict[str, Any] = {"ensure_ascii": True, "separators": (",", ":"), "default": str, "allow_nan": False}
    try:
        text = json.dumps(msg, **opts)
    except ValueError:
        text = json.dumps(_finite(msg), **opts)
    return (text + "\n").encode("ascii")


class Channel:
    """The worker's end of the pipe pair: blocking line reads, thread-safe writes."""

    def __init__(self, fd_in: int, fd_out: int):
        self._in = io.open(fd_in, "rb", buffering=1024 * 64, closefd=True)
        self._out = io.open(fd_out, "wb", buffering=0, closefd=True)
        self._lock = threading.Lock()
        self.account: Optional[str] = None
        self.closed = False

    def readline(self) -> Optional[bytes]:
        """One line without its newline, or ``None`` at EOF (Go closed the pipe)."""
        line = self._in.readline(MAX_LINE_BYTES + 1)
        if not line:
            return None
        if len(line) > MAX_LINE_BYTES and not line.endswith(b"\n"):
            # Drain the rest of the oversized line so the next read starts clean.
            while True:
                chunk = self._in.readline(MAX_LINE_BYTES)
                if not chunk or chunk.endswith(b"\n"):
                    break
            raise ProtocolError(E_BAD_MESSAGE, "line is longer than the 32 MiB limit")
        return line.rstrip(b"\r\n")

    def send(self, msg: dict[str, Any]) -> bool:
        if self.account is not None:
            msg.setdefault("account", self.account)
        data = encode(msg)
        with self._lock:
            if self.closed:
                return False
            try:
                view = memoryview(data)
                while view:
                    n = os.write(self._out.fileno(), view)
                    view = view[n:]
                return True
            except OSError:
                self.closed = True
                return False

    def error(self, code: str, message: str, msg_id: Optional[str] = None, **extra: Any) -> None:
        msg: dict[str, Any] = {"type": "error", "code": code, "message": message}
        if msg_id:
            msg["id"] = msg_id
        msg.update(extra)
        self.send(msg)

    def close_output(self) -> None:
        """Stop writing (closes only the output; a reader blocked on the input keeps it)."""
        with self._lock:
            self.closed = True
            try:
                self._out.close()
            except OSError:
                pass

    def close(self) -> None:
        with self._lock:
            self.closed = True
            for f in (self._out, self._in):
                try:
                    f.close()
                except OSError:
                    pass


class PendingRequests:
    """Worker -> Go requests (``tool.call``, ``gate.ask``) waiting for their reply by id."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._waiters: dict[str, tuple[threading.Event, list]] = {}
        self._runs: dict[str, str] = {}  # request id -> run id
        self._seq = 0

    def new_id(self, prefix: str = "w") -> str:
        with self._lock:
            self._seq += 1
            return f"{prefix}-{self._seq}"

    def ask(self, send: Callable[[dict], bool], msg: dict[str, Any], timeout: float) -> Optional[dict]:
        """Send ``msg`` (an ``id`` is added) and wait for the reply; ``None`` on timeout or a closed pipe."""
        msg_id = msg.setdefault("id", self.new_id())
        event, box = threading.Event(), []
        with self._lock:
            self._waiters[msg_id] = (event, box)
            if isinstance(msg.get("run"), str):
                self._runs[msg_id] = msg["run"]
        try:
            if not send(msg):
                return None
            event.wait(timeout)
            return box[0] if box else None
        finally:
            with self._lock:
                self._waiters.pop(msg_id, None)
                self._runs.pop(msg_id, None)

    def resolve(self, msg: dict[str, Any]) -> bool:
        with self._lock:
            waiter = self._waiters.get(msg.get("id") or "")
        if waiter is None:
            return False
        waiter[1].append(msg)
        waiter[0].set()
        return True

    def cancel_run(self, run_id: str) -> None:
        """Wake every request of one run (its waiters return None)."""
        with self._lock:
            waiters = [self._waiters[i] for i, r in self._runs.items() if r == run_id and i in self._waiters]
        for event, _ in waiters:
            event.set()

    def cancel_all(self) -> None:
        with self._lock:
            waiters = list(self._waiters.values())
        for event, _ in waiters:
            event.set()
