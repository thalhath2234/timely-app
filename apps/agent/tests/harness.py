"""Test harness: prepare an agent folder, render an account and drive a real worker process.

The worker is started exactly as Go starts it: ``<venv python> -I boot.py worker`` with an
environment built from scratch (``env_check.build_env``), protocol on stdin/stdout, logs on
stderr. Every folder lives under ``$HOME/.cache/timely-agent-test`` (never ``~/.hermes``).
"""

from __future__ import annotations

import json
import os
import queue
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path
from typing import Any, Optional

AGENT_DIR = Path(__file__).resolve().parent.parent
BOOT = AGENT_DIR / "timely_agent" / "boot.py"
TEST_BASE = Path(os.environ.get("TIMELY_AGENT_TEST_ROOT") or Path.home() / ".cache" / "timely-agent-test")
# A loaded machine (a TLA+ check, other suites) can take tens of seconds to start a worker: set
# TIMELY_AGENT_TEST_TIMEOUT_SCALE (e.g. 3) to wait longer for every message.
try:
    TIMEOUT_SCALE = max(1.0, float(os.environ.get("TIMELY_AGENT_TEST_TIMEOUT_SCALE") or 1))
except ValueError:
    TIMEOUT_SCALE = 1.0
TEST_ROOT = TEST_BASE / f"run-{os.getpid()}"  # removed at the end of the session (conftest)

if str(AGENT_DIR) not in sys.path:
    sys.path.insert(0, str(AGENT_DIR))

from timely_agent import env_check, paths  # noqa: E402


def python() -> str:
    """The runtime interpreter (``make agent-install``), else the one running the tests."""
    for cand in (AGENT_DIR / ".venv" / "bin" / "python", AGENT_DIR / ".venv" / "Scripts" / "python.exe"):
        if cand.exists():
            return str(cand)
    return sys.executable


def new_root(prefix: str = "t") -> Path:
    TEST_ROOT.mkdir(parents=True, exist_ok=True)
    return Path(tempfile.mkdtemp(prefix=prefix + "-", dir=TEST_ROOT))


def run_cli(command: str, agent_dir: Path, stdin: dict | None = None, *extra: str) -> dict:
    env = {"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "HOME": str(agent_dir.parent / "cli-home")}
    for name in ("SYSTEMROOT", "TMPDIR", "TEMP", "TMP"):
        if os.environ.get(name):
            env[name] = os.environ[name]
    if os.name == "nt":
        env["USERPROFILE"] = env["HOME"]
    proc = subprocess.run([python(), "-I", str(BOOT), command, "--agent-dir", str(agent_dir), *extra],
                          input=json.dumps(stdin or {}), capture_output=True, text=True, env=env, timeout=120)
    lines = [ln for ln in proc.stdout.splitlines() if ln.strip()]
    if not lines:
        raise AssertionError(f"{command} printed nothing (rc={proc.returncode}): {proc.stderr[-3000:]}")
    out = json.loads(lines[-1])
    out["_rc"], out["_stderr"] = proc.returncode, proc.stderr
    return out


class Agent:
    """A prepared agent folder with one rendered account."""

    def __init__(self, root: Path, account: str = "user-1", settings: dict | None = None,
                 prepare_opts: dict | None = None):
        self.root = root
        self.dir = root / "agent"
        self.account = account
        self.layout = paths.AgentLayout.at(self.dir)
        self.prepared = run_cli("prepare", self.dir, prepare_opts or {})
        assert self.prepared.get("ok"), self.prepared
        self.render(settings or {})

    def render(self, settings: dict) -> dict:
        # what Go passes from prepare's answer (PrepareResult), never runtime/prepared.json
        prepared = {k: self.prepared[k] for k in ("timely_skills_dir", "seed_skills_dir", "browser_executable",
                                                  "skills_default_off")}
        self.rendered = run_cli("render-account", self.dir, settings, "--account", self.account,
                                "--prepared", json.dumps(prepared))
        assert self.rendered.get("ok"), self.rendered
        return self.rendered

    @property
    def home(self) -> Path:
        return Path(self.rendered["home"])

    def env(self, **extra: str) -> dict[str, str]:
        base = {k: os.environ[k] for k in ("PATH", "LANG", "TZ", "SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT")
                if os.environ.get(k)}
        env = dict(base)
        env.update(self.rendered["env"])
        env["TMPDIR"] = str(self.root / "tmp")
        (self.root / "tmp").mkdir(exist_ok=True)
        env["HERMES_REAL_HOME"] = str(self.root / "real-home")
        if os.name == "nt":
            # What Go's BuildEnv adds on Windows: CPython finds the home folder
            # through USERPROFILE (not HOME), and Hermes' Windows bootstrap would
            # add the two UTF-8 names after the start check (env_drift).
            profile = env["HOME"]
            env["USERPROFILE"] = profile
            env["APPDATA"] = str(Path(profile) / "AppData" / "Roaming")
            env["LOCALAPPDATA"] = str(Path(profile) / "AppData" / "Local")
            env["TEMP"] = env["TMP"] = env["TMPDIR"]
            env["PYTHONUTF8"] = "1"
            env["PYTHONIOENCODING"] = "utf-8"
            if os.environ.get("SYSTEMDRIVE"):
                env["SYSTEMDRIVE"] = os.environ["SYSTEMDRIVE"]
        env.update(extra)
        return env

    def hello(self, **over: Any) -> dict:
        msg = {"type": "hello", "id": "h1", "account": self.account, "protocol": 1,
               "home": str(self.home), "settings_hash": self.rendered["config_sha256"],
               "catalog_version": "test-1",
               # what Go passes from prepare's answer (PrepareResult)
               "timely_skills_dir": self.prepared["timely_skills_dir"],
               "managed_sha256": self.prepared["managed_sha256"],
               "browser_executable": self.prepared.get("browser_executable", ""),
               "skills_default_off": self.prepared["skills_default_off"]}
        msg.update(over)
        return msg


class Worker:
    """A running worker process with a reader thread splitting stdout lines into messages."""

    def __init__(self, env: dict[str, str], argv: list[str] | None = None):
        """``argv`` replaces ``[<venv python>, -I, boot.py, worker]`` (the contract tests' probe wrapper)."""
        self.proc = subprocess.Popen(argv or [python(), "-I", str(BOOT), "worker"], stdin=subprocess.PIPE,
                                     stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env)
        self.messages: "queue.Queue[dict]" = queue.Queue()
        self.raw_lines: list[bytes] = []
        self.stderr_chunks: list[bytes] = []
        threading.Thread(target=self._read_out, daemon=True).start()
        threading.Thread(target=self._read_err, daemon=True).start()

    def _read_out(self) -> None:
        assert self.proc.stdout is not None
        for line in self.proc.stdout:
            self.raw_lines.append(line)
            try:
                self.messages.put(json.loads(line))
            except ValueError:
                self.messages.put({"type": "__not_json__", "line": line.decode("utf-8", "replace")})
        self.messages.put({"type": "__eof__"})

    def _read_err(self) -> None:
        assert self.proc.stderr is not None
        for chunk in iter(lambda: self.proc.stderr.read1(4096), b""):
            self.stderr_chunks.append(chunk)

    @property
    def stderr(self) -> str:
        return b"".join(self.stderr_chunks).decode("utf-8", "replace")

    def send(self, msg: dict) -> None:
        assert self.proc.stdin is not None
        self.proc.stdin.write((json.dumps(msg) + "\n").encode())
        self.proc.stdin.flush()

    def send_raw(self, data: bytes) -> None:
        assert self.proc.stdin is not None
        self.proc.stdin.write(data)
        self.proc.stdin.flush()

    def recv(self, timeout: float = 60.0, skip=("heartbeat", "log")) -> dict:
        timeout *= TIMEOUT_SCALE
        deadline = time.monotonic() + timeout
        while True:
            left = deadline - time.monotonic()
            if left <= 0:
                raise AssertionError(f"no message within {timeout}s; stderr tail:\n{self.stderr[-4000:]}")
            try:
                msg = self.messages.get(timeout=left)
            except queue.Empty:
                continue
            if msg.get("type") in skip:
                continue
            return msg

    def until(self, mtype: str, timeout: float = 60.0) -> tuple[dict, list[dict]]:
        """Messages up to and including the first of ``mtype``."""
        seen: list[dict] = []
        while True:
            msg = self.recv(timeout)
            seen.append(msg)
            if msg.get("type") == mtype:
                return msg, seen
            if msg.get("type") == "__eof__":
                raise AssertionError(f"worker exited before {mtype}; got {seen}; stderr:\n{self.stderr[-4000:]}")

    def close(self, timeout: float = 15.0) -> Optional[int]:
        try:
            if self.proc.stdin and not self.proc.stdin.closed:
                self.proc.stdin.close()
        except OSError:
            pass
        try:
            return self.proc.wait(timeout)
        except subprocess.TimeoutExpired:
            self.proc.kill()
            return self.proc.wait(5)


TIMELY_TOOLS_FILE = Path(__file__).resolve().parent / "fixtures" / "timely_tools.json"
PHASE2_TOOLSETS = ["timely", "todo", "skills"]
BLOCK_MESSAGE = "That isn't available in Timely yet"
PROPOSAL_RECORDED = "Proposal recorded; reply to the person in one sentence."


def timely_tools(names: list[str] | None = None) -> dict:
    """``hello.timely_tools`` from the spec fixture (all 49 specs, or only ``names``)."""
    specs = json.loads(TIMELY_TOOLS_FILE.read_text(encoding="utf-8"))["tools"]
    if names is not None:
        specs = [s for s in specs if s["name"] in names]
    canonical = json.dumps(specs, sort_keys=True, separators=(",", ":")).encode()
    import hashlib
    return {"catalog_version": hashlib.sha256(canonical).hexdigest(), "tools": specs}


def ready_worker(agent: Agent, argv: list[str] | None = None, hello: dict | None = None,
                 **env_extra: str) -> tuple[Worker, dict]:
    w = Worker(agent.env(**env_extra), argv)
    w.send(agent.hello(**(hello or {})))
    ready, _ = w.until("ready", timeout=120)
    return w, ready


def go_answer(name: str, args: dict) -> dict:
    """What the Go stand-in answers a ``tool.call``: ``{result, outside, end_turn}``."""
    if name == "propose_changes":
        return {"result": {"recorded": True, "message": PROPOSAL_RECORDED}, "outside": False, "end_turn": True}
    if name in ("ask_bot", "preview_bot", "list_bot_findings", "list_bots"):
        return {"result": {"page": "Outside page text: the price is 42."}, "outside": True, "end_turn": False}
    return {"result": {"tool": name, "ok": True, "args": args}, "outside": False, "end_turn": False}


def drive(worker: Worker, account: str, run_id: str, *, answer=go_answer, verdict: tuple[str, str] = ("block", BLOCK_MESSAGE),
          on_message=None, timeout: float = 60.0) -> tuple[dict, list[dict]]:
    """Play Go for one run: answer ``tool.call`` with ``answer(name, args)`` and ``gate.ask`` with
    ``verdict`` until the run's ``run.done``. ``on_message(msg)`` sees every message first and may
    send run controls. Returns ``(run.done, every message)``."""
    seen: list[dict] = []
    while True:
        msg = worker.recv(timeout)
        seen.append(msg)
        if on_message is not None:
            on_message(msg)
        t = msg.get("type")
        if t == "tool.call" and msg.get("run") == run_id:
            reply = answer(msg["name"], msg.get("args") or {})
            if reply is not None:
                worker.send({"type": "tool.result", "id": msg["id"], "account": account, **reply})
        elif t == "gate.ask" and msg.get("run") == run_id:
            worker.send({"type": "gate.verdict", "id": msg["id"], "account": account,
                         "verdict": verdict[0], "message": verdict[1]})
        elif t == "run.done" and msg.get("run") == run_id:
            return msg, seen
        elif t == "__eof__":
            raise AssertionError(f"worker exited during {run_id}; seen {seen}; stderr:\n{worker.stderr[-4000:]}")


def model_cfg(stub) -> dict:
    return {"provider": "custom", "model": "stub-model", "base_url": stub.base_url, "api_key": "sk-stub",
            "api_mode": "chat_completions"}


def run_start(agent: Agent, stub, run_id: str = "r1", text: str = "hello", conversation: str = "conv-1",
              toolsets: list[str] | None = None, **extra: Any) -> dict:
    msg = {"type": "run.start", "id": f"s-{run_id}", "account": agent.account, "run": run_id,
           "conversation_id": conversation, "session_key": f"timely:{agent.account}:{conversation}",
           "user_message": text, "model": model_cfg(stub), "toolsets": toolsets if toolsets is not None else [],
           "flags": {}, "budgets": {"max_iterations": 6}, "tainted_sources": []}
    msg.update(extra)
    return msg


__all__ = ["Agent", "Worker", "ready_worker", "run_start", "new_root", "run_cli", "python", "env_check",
           "timely_tools", "drive", "go_answer"]
