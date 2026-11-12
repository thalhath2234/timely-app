"""A tiny OpenAI-compatible model server for worker tests. Stdlib only, no network beyond 127.0.0.1.

Behaviour, decided from the last user message of each ``/chat/completions`` request that does
not contain ``STEER`` (tests mark steered text with it, so a steer continues the turn it landed
in). "After the directive" means the messages that follow that user message in the request:

- ``CALL <tool> <json args>``: the first answer is that tool call; once a tool result follows the
  directive, the answer is ``STUB_FINAL`` + the tool result's first 200 characters.
- ``SLOW <seconds>``: waits before answering (interrupt tests).
- ``STREAM <chars> [<chunk> [<delay ms>]]``: a reply of ``<chars>`` characters, streamed in
  ``<chunk>``-character pieces (default 2) with ``<delay ms>`` between them (default 0).
- ``LOOP <n>``: calls ``todo_list`` ``n`` times, one call per answer, then replies.
- ``SCRIPT <json list>``: answer ``k`` (``k`` = assistant messages after the directive) is step
  ``k``: ``{"calls": [[name, args], ...]}`` (one assistant message with several tool calls),
  ``{"text": "..."}``, optionally with ``"sleep": <s>`` before answering and
  ``"stream": [<chunk>, <delay ms>]`` for text. Past the last step the answer is ``STUB_FINAL`` +
  the last tool result (200 characters), or ``STUB_REPLY``; a steer after the directive adds
  ``Steered: <text>``.
- ``REVIEW <json list>`` (anywhere in a user message, usually after a ``SCRIPT`` list): what the
  stub answers in Hermes' learning pass. A request whose last user message is Hermes' review
  prompt (it ends "Other tools will be denied at runtime") plays the steps of the last ``REVIEW``
  list found in the earlier user messages, like ``SCRIPT``; without one it answers
  ``REVIEW_NOTHING``.
- ``REFUSE <code>``: answers HTTP ``<code>`` with an error body (a provider refusing the request;
  Hermes writes a request dump for a 4xx it does not retry).
- anything else: ``STUB_REPLY`` + the message.

Streaming (``stream: true``) and plain responses are both supported. Usage is a fixed
``USAGE``, or with ``real_usage=True`` the request's size (4 bytes a token) so Hermes' context
compression can trigger. Every request is kept in
``server.requests`` (with its ``Authorization`` header as ``auth``) for assertions.

Run standalone: ``python -I stub_openai.py <port>`` (0 = any free port; prints the port).
"""

from __future__ import annotations

import json
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

STUB_MODEL = "stub-model"
STUB_REPLY = "Stub reply: "
STUB_FINAL = "Done after tool: "
STEERED = "Steered: "
USAGE = {"prompt_tokens": 1234, "completion_tokens": 56, "total_tokens": 1290}
ALPHABET = "abcdefghijklmnopqrstuvwxyz "
STEER_MARK = "STEER"
REVIEW_MARK = "Other tools will be denied"  # Hermes' suffix on every learning-pass prompt
REVIEW_NOTHING = "Nothing to save."


def is_review(text: str) -> bool:
    return REVIEW_MARK in text


def _text(content) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return " ".join(str(p.get("text", "")) for p in content if isinstance(p, dict))
    return ""


def stream_text(n: int) -> str:
    """The deterministic reply of ``STREAM <n>``."""
    return "".join(ALPHABET[i % len(ALPHABET)] for i in range(n))


def _calls(pairs) -> dict:
    calls = []
    for i, pair in enumerate(pairs):
        name, args = pair[0], pair[1] if len(pair) > 1 else {}
        calls.append({"id": f"call_{i + 1}", "type": "function",
                      "function": {"name": name, "arguments": args if isinstance(args, str) else json.dumps(args)}})
    return {"role": "assistant", "content": None, "tool_calls": calls}


def _refusal(body: dict) -> int:
    """The HTTP status a ``REFUSE <code>`` in the last user message asks for, else 0."""
    users = [m for m in body.get("messages") or [] if m.get("role") == "user"]
    text = _text(users[-1].get("content")) if users else ""
    if "REFUSE " in text:
        word = text[text.index("REFUSE ") + len("REFUSE "):].split()[:1]
        if word and word[0].isdigit():
            return int(word[0])
    return 0


def decide(body: dict) -> tuple[dict, str, dict]:
    """``(assistant message, finish reason, stream options)``."""
    msgs = body.get("messages") or []
    users = [i for i, m in enumerate(msgs) if m.get("role") == "user"]
    # A steer (a user message the tests start with STEER_MARK) continues the turn it landed in.
    anchor = next((i for i in reversed(users) if STEER_MARK not in _text(msgs[i].get("content"))[:200]), -1)
    directive = _text(msgs[anchor].get("content")) if anchor >= 0 else ""
    after = msgs[anchor + 1:] if anchor >= 0 else []
    tool_results = [m for m in after if m.get("role") == "tool"]
    answers = sum(1 for m in after if m.get("role") == "assistant")
    steers = [_text(m.get("content")) for m in after if m.get("role") == "user"]
    stream: dict = {}

    if is_review(directive):
        directive = ""
        for m in reversed(msgs[:anchor]):
            text = _text(m.get("content")) if m.get("role") == "user" else ""
            if "REVIEW " in text:
                directive = "SCRIPT " + text[text.index("REVIEW ") + len("REVIEW "):]
                break
        if not directive:
            return {"role": "assistant", "content": REVIEW_NOTHING}, "stop", stream

    def final() -> dict:
        text = STUB_FINAL + _text(tool_results[-1].get("content"))[:200] if tool_results else STUB_REPLY + directive
        if steers:
            text += " " + STEERED + steers[-1][:200]
        return {"role": "assistant", "content": text}

    if directive.startswith("SLOW "):
        try:
            time.sleep(float(directive.split()[1]))
        except (IndexError, ValueError):
            pass
    if directive.startswith("CALL ") and not tool_results:
        parts = directive.split(" ", 2)
        name = parts[1] if len(parts) > 1 else "todo_list"
        args = parts[2] if len(parts) > 2 else "{}"
        return _calls([[name, args]]), "tool_calls", stream
    if directive.startswith("STREAM "):
        parts = (directive.split() + ["", "", ""])[1:4]
        n = int(parts[0] or 100)
        stream = {"chunk": int(parts[1] or 2), "delay": float(parts[2] or 0) / 1000}
        return {"role": "assistant", "content": stream_text(n)}, "stop", stream
    if directive.startswith("LOOP "):
        n = int(directive.split()[1])
        if answers < n:
            todo = {"todos": [{"id": "1", "content": f"loop {answers + 1}", "status": "in_progress"}]}
            return _calls([["todo_list", todo]]), "tool_calls", stream
        return {"role": "assistant", "content": f"Looped {n} times"}, "stop", stream
    if directive.startswith("SCRIPT "):
        steps, _ = json.JSONDecoder().raw_decode(directive[len("SCRIPT "):])  # text may follow the list
        if answers < len(steps):
            step = steps[answers]
            if step.get("sleep"):
                time.sleep(float(step["sleep"]))
            if step.get("stream"):
                stream = {"chunk": int(step["stream"][0]), "delay": float(step["stream"][1]) / 1000}
            if step.get("calls"):
                msg = _calls(step["calls"])
                if step.get("text"):
                    msg["content"] = step["text"]
                return msg, "tool_calls", stream
            return {"role": "assistant", "content": str(step.get("text", ""))}, "stop", stream
        return final(), "stop", stream
    if tool_results:
        return final(), "stop", stream
    return {"role": "assistant", "content": STUB_REPLY + directive}, "stop", stream


class Handler(BaseHTTPRequestHandler):
    server: "StubServer"

    def log_message(self, *args):  # quiet
        pass

    def _json(self, obj, code=200):
        data = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        self.server.requests.append({"method": "GET", "path": self.path, "auth": self.headers.get("Authorization")})
        if self.path.rstrip("/").endswith("/models"):
            return self._json({"object": "list", "data": [
                {"id": STUB_MODEL, "object": "model", "context_length": self.server.context_length}]})
        self._json({"error": {"message": "not found"}}, 404)

    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(n) or b"{}"
        body = json.loads(raw)
        self.server.requests.append({"method": "POST", "path": self.path, "body": body, "bytes": len(raw),
                                     "auth": self.headers.get("Authorization")})
        if not self.path.rstrip("/").endswith("/chat/completions"):
            return self._json({"error": {"message": "not found"}}, 404)
        refuse = _refusal(body)
        if refuse:
            return self._json({"error": {"message": "bad request", "type": "invalid_request_error"}}, refuse)
        try:
            self._answer(body, raw)
        except (BrokenPipeError, ConnectionResetError):
            pass  # the worker hung up (a Stop mid-stream)

    def _answer(self, body: dict, raw: bytes) -> None:
        msg, finish, opts = decide(body)
        base = {"id": "c1", "created": int(time.time()), "model": STUB_MODEL}
        usage = USAGE
        if self.server.real_usage:  # the prompt's size (4 bytes a token), so compression can trigger
            prompt = max(1, len(raw) // 4)
            usage = {"prompt_tokens": prompt, "completion_tokens": 56, "total_tokens": prompt + 56}
        if not body.get("stream"):
            return self._json({**base, "object": "chat.completion",
                               "choices": [{"index": 0, "message": msg, "finish_reason": finish}], "usage": usage})
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.end_headers()
        chunk = {**base, "object": "chat.completion.chunk"}

        def ev(obj):
            self.wfile.write(b"data: " + json.dumps(obj).encode() + b"\n\n")
            self.wfile.flush()

        text = msg.get("content") or ""
        if text:
            size = opts.get("chunk") or max(1, (len(text) + 1) // 2)
            pieces = [text[i:i + size] for i in range(0, len(text), size)]
            for i, piece in enumerate(pieces):
                delta = {"content": piece}
                if i == 0:
                    delta["role"] = "assistant"
                ev({**chunk, "choices": [{"index": 0, "delta": delta, "finish_reason": None}]})
                if opts.get("delay"):
                    time.sleep(opts["delay"])
        for i, call in enumerate(msg.get("tool_calls") or []):
            delta = {"tool_calls": [dict(call, index=i)]}
            if i == 0 and not text:
                delta["role"] = "assistant"
            ev({**chunk, "choices": [{"index": 0, "delta": delta, "finish_reason": None}]})
        ev({**chunk, "choices": [{"index": 0, "delta": {}, "finish_reason": finish}]})
        ev({**chunk, "choices": [], "usage": usage})
        self.wfile.write(b"data: [DONE]\n\n")
        self.wfile.flush()


class StubServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, port: int = 0, context_length: int = 128000, real_usage: bool = False):
        super().__init__(("127.0.0.1", port), Handler)
        self.requests: list[dict] = []
        self.context_length = context_length
        self.real_usage = real_usage

    @property
    def base_url(self) -> str:
        return f"http://127.0.0.1:{self.server_address[1]}/v1"

    def start(self) -> "StubServer":
        threading.Thread(target=self.serve_forever, name="stub-openai", daemon=True).start()
        return self


if __name__ == "__main__":
    srv = StubServer(int(sys.argv[1]) if len(sys.argv) > 1 else 0)
    print(srv.server_address[1], flush=True)
    srv.serve_forever()
