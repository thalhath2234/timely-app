"""apps/agent/tests/stub_openai.py, also answering Ollama's native API (127.0.0.1 only).

Usage: python3 -I ollama_shim.py <port> <apps/agent/tests> [<phrases.json>]
Point the API's OLLAMA_BASE_URL at http://127.0.0.1:<port>; see README.md.

Classic chat on the "ollama" provider calls native /api/chat; the agent engine's
worker calls the OpenAI-compatible /v1/chat/completions. Both are the stub's
decide(). The directive (CALL/SCRIPT/STREAM...) may sit after Timely's turn
preamble, so user messages are cut to start at it. Hermes' learning-pass
prompt is left as it is, so the stub plays the conversation's REVIEW list.
"""
import json
import os
import re
import sys
import time
from http.server import ThreadingHTTPServer

if __name__ == "__main__":
    sys.path.insert(0, sys.argv[2])
import stub_openai  # noqa: E402

# Host tool shorthands (phase 5): one call to a host tool, for the phrase table. Each becomes a
# CALL directive, so a continuation turn that carries no directive of its own replays the same
# call (the shim gives it the newest directive of the conversation) and the approved call's
# arguments, hence its hash, are the ones the card showed.
#   TERMINAL <command>                   -> CALL terminal {"command": <command>}
#   READ_FILE <path>                     -> CALL read_file {"path": <path>}
#   WRITE_FILE <path> :: <content>       -> CALL write_file {"path": <path>, "content": <content>}
#   MCP_TOOL <server> <tool> [<json args>] -> CALL mcp__<server>__<tool> <json args>
HOST_DIRECTIVES = ("TERMINAL ", "READ_FILE ", "WRITE_FILE ", "MCP_TOOL ")
DIRECTIVES = ("SCRIPT ", "CALL ", "STREAM ", "LOOP ", "SLOW ") + HOST_DIRECTIVES
# Optional: TIMELY_SHIM_LOG names a JSONL file that gets each model request's
# last messages (each cut at 2,000 characters), to show what the model saw.
LOG = os.environ.get("TIMELY_SHIM_LOG", "")


def log_request(path, body):
    if not LOG:
        return
    tail = []
    for m in (body.get("messages") or [])[-8:]:
        tail.append({"role": m.get("role"), "content": stub_openai._text(m.get("content"))[:2000],
                     "tool_calls": [c.get("function", {}).get("name") for c in m.get("tool_calls") or []]})
    with open(LOG, "a") as f:
        f.write(json.dumps({"at": time.time(), "path": path, "messages": tail}) + "\n")


# Optional: a JSON file {phrase: directive}; a user message holding the phrase
# gets that directive, so the chat shows the person's words, not the directive.
PHRASES = sys.argv[3] if __name__ == "__main__" and len(sys.argv) > 3 else ""


def phrase_directive(text):
    if not PHRASES:
        return None
    try:
        table = json.load(open(PHRASES))
    except (OSError, ValueError):
        return None
    for phrase, directive in table.items():
        if phrase in text:
            return directive
    return None


HOST_LINE = re.compile(r"(?m)^(?:%s)" % "|".join(HOST_DIRECTIVES))


def host_call(text):
    """A host tool shorthand as the CALL directive it stands for (see HOST_DIRECTIVES)."""
    head, _, rest = text.split("\n", 1)[0].partition(" ")  # one line: what follows is Timely's own text
    rest = rest.strip()
    if head == "TERMINAL":
        return "CALL terminal " + json.dumps({"command": rest})
    if head == "READ_FILE":
        return "CALL read_file " + json.dumps({"path": rest})
    if head == "WRITE_FILE":
        path, _, content = rest.partition(" :: ")
        return "CALL write_file " + json.dumps({"path": path.strip(), "content": content})
    if head == "MCP_TOOL":
        server, _, more = rest.partition(" ")
        tool, _, args = more.strip().partition(" ")
        return "CALL mcp__%s__%s %s" % (server, tool, args.strip() or "{}")
    return text


def cut(text):
    hits = [i for i in (text.find(d) for d in DIRECTIVES if d not in HOST_DIRECTIVES) if i >= 0]
    # A host shorthand counts only at the start of a line, so prose that happens to hold the word
    # is not turned into a tool call.
    hits += [m.start() for m in HOST_LINE.finditer(text)]
    return host_call(text[min(hits):]) if hits else text


def cut_body(body):
    """Each user message keeps its directive; Timely's per-turn context message
    (after the person's own) carries the newest directive seen before it."""
    out, last = [], None
    for m in body.get("messages") or []:
        m = dict(m)
        if m.get("role") == "user":
            text = stub_openai._text(m.get("content"))
            mapped = phrase_directive(text)
            if stub_openai.is_review(text):
                pass  # the learning pass: decide() plays the REVIEW list it finds
            elif mapped:
                last = host_call(mapped)
                m["content"] = last
            elif any(d in text for d in DIRECTIVES if d not in HOST_DIRECTIVES) or HOST_LINE.search(text):
                last = cut(text)
                m["content"] = last
            elif last and stub_openai.STEER_MARK not in text[:200]:
                m["content"] = last
        out.append(m)
    return {**body, "messages": out}


class H(stub_openai.Handler):
    def do_GET(self):
        if self.path.startswith("/api/tags"):
            return self._json({"models": [{"name": stub_openai.STUB_MODEL}]})
        if self.path.startswith("/api/version"):
            return self._json({"version": "0.12.0"})
        return super().do_GET()

    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(n) or b"{}"
        body = json.loads(raw)
        if self.path.startswith("/api/show"):
            return self._json({"capabilities": ["completion", "tools"], "model_info": {}})
        if self.path.startswith("/api/chat"):
            log_request(self.path, body)
            msg, _, _ = stub_openai.decide(cut_body(body))
            calls = []
            for c in msg.get("tool_calls") or []:
                args = c["function"]["arguments"]
                calls.append({"id": c["id"], "function": {"name": c["function"]["name"], "arguments": json.loads(args) if isinstance(args, str) else args}})
            out = {"role": "assistant", "content": msg.get("content") or ""}
            if calls:
                out["tool_calls"] = calls
            return self._json({"model": stub_openai.STUB_MODEL, "message": out, "done": True, "done_reason": "stop"})
        if self.path.rstrip("/").endswith("/chat/completions"):
            log_request(self.path, body)
            body = cut_body(body)
            try:
                return self._answer(body, json.dumps(body).encode())
            except (BrokenPipeError, ConnectionResetError):
                return None
        return self._json({"error": {"message": "not found"}}, 404)


if __name__ == "__main__":
    srv = ThreadingHTTPServer(("127.0.0.1", int(sys.argv[1])), H)
    srv.daemon_threads = True
    srv.requests = []
    srv.context_length = 128000
    srv.real_usage = False
    print(srv.server_address[1], flush=True)
    srv.serve_forever()
