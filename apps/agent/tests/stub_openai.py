"""A tiny OpenAI-compatible model server for worker tests. Stdlib only, no network beyond 127.0.0.1.

Behaviour, decided from the last user message of each ``/chat/completions`` request:

- ``CALL <tool> <json args>``: the first answer is that tool call; once the request carries a
  tool result, the answer is ``STUB_FINAL`` + the tool result's first 200 characters.
- ``SLOW <seconds>``: waits before answering (interrupt tests).
- anything else: ``STUB_REPLY`` + the message.

Streaming (``stream: true``) and plain responses are both supported. Every request is kept in
``server.requests`` for assertions.

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
USAGE = {"prompt_tokens": 1234, "completion_tokens": 56, "total_tokens": 1290}


def _text(content) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return " ".join(str(p.get("text", "")) for p in content if isinstance(p, dict))
    return ""


def decide(body: dict) -> tuple[dict, str]:
    msgs = body.get("messages") or []
    last_user = next((_text(m.get("content")) for m in reversed(msgs) if m.get("role") == "user"), "")
    tool_results = [m for m in msgs if m.get("role") == "tool"]
    if last_user.startswith("SLOW "):
        try:
            time.sleep(float(last_user.split()[1]))
        except (IndexError, ValueError):
            pass
    if last_user.startswith("CALL ") and not tool_results:
        parts = last_user.split(" ", 2)
        name = parts[1] if len(parts) > 1 else "todo_list"
        args = parts[2] if len(parts) > 2 else "{}"
        call = {"id": "call_1", "type": "function", "function": {"name": name, "arguments": args}}
        return {"role": "assistant", "content": None, "tool_calls": [call]}, "tool_calls"
    if tool_results:
        return {"role": "assistant", "content": STUB_FINAL + _text(tool_results[-1].get("content"))[:200]}, "stop"
    return {"role": "assistant", "content": STUB_REPLY + last_user}, "stop"


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
        self.server.requests.append({"method": "GET", "path": self.path})
        if self.path.rstrip("/").endswith("/models"):
            return self._json({"object": "list", "data": [{"id": STUB_MODEL, "object": "model", "context_length": 128000}]})
        self._json({"error": {"message": "not found"}}, 404)

    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0)
        body = json.loads(self.rfile.read(n) or b"{}")
        self.server.requests.append({"method": "POST", "path": self.path, "body": body})
        if not self.path.rstrip("/").endswith("/chat/completions"):
            return self._json({"error": {"message": "not found"}}, 404)
        msg, finish = decide(body)
        base = {"id": "c1", "created": int(time.time()), "model": STUB_MODEL}
        if not body.get("stream"):
            return self._json({**base, "object": "chat.completion",
                               "choices": [{"index": 0, "message": msg, "finish_reason": finish}], "usage": USAGE})
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.end_headers()
        chunk = {**base, "object": "chat.completion.chunk"}

        def ev(obj):
            self.wfile.write(b"data: " + json.dumps(obj).encode() + b"\n\n")
            self.wfile.flush()

        if msg.get("tool_calls"):
            tc = dict(msg["tool_calls"][0], index=0)
            ev({**chunk, "choices": [{"index": 0, "delta": {"role": "assistant", "tool_calls": [tc]}, "finish_reason": None}]})
        else:
            text = msg["content"]
            half = len(text) // 2
            ev({**chunk, "choices": [{"index": 0, "delta": {"role": "assistant", "content": text[:half]}, "finish_reason": None}]})
            ev({**chunk, "choices": [{"index": 0, "delta": {"content": text[half:]}, "finish_reason": None}]})
        ev({**chunk, "choices": [{"index": 0, "delta": {}, "finish_reason": finish}]})
        ev({**chunk, "choices": [], "usage": USAGE})
        self.wfile.write(b"data: [DONE]\n\n")
        self.wfile.flush()


class StubServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, port: int = 0):
        super().__init__(("127.0.0.1", port), Handler)
        self.requests: list[dict] = []

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
