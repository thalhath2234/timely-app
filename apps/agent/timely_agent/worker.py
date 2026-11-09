"""The per-account worker: ``python -I boot.py worker`` (plan sections 3.3, 5.1, 6.2).

``boot.py`` has already moved the protocol to private descriptors and fixed ``sys.path``. This
module checks the environment, installs the runtime-install guard and the plugin distribution,
then serves the protocol: ``hello`` -> ``ready`` (with the self-test), runs, and ``shutdown``.
Closing stdin (Go exiting or restarting) is the lifeline: runs are interrupted and the worker
exits. The wire format is ``apps/agent/PROTOCOL.md``.
"""

from __future__ import annotations

import contextvars
import json
import logging
import os
import sys
import threading
import time
from pathlib import Path
from typing import Any, Optional

from timely_agent import bridge, env_check, paths
from timely_agent import protocol as P

logger = logging.getLogger("timely_agent.worker")

MAX_RUNS = 3  # per-account run cap (section 3.3)
HEARTBEAT_S = 10.0
EXIT_REFUSED_ENV = 3


def _setup_logging() -> None:
    level = logging.INFO
    handler = logging.StreamHandler(sys.stderr)
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s"))
    root = logging.getLogger()
    root.handlers[:] = [handler]
    root.setLevel(logging.WARNING)
    logging.getLogger("timely_agent").setLevel(level)


def hermes_tag() -> str:
    try:
        data = json.loads((paths.hermes_dir() / "HERMES_UPSTREAM.json").read_text(encoding="utf-8"))
        return str(data.get("tag") or data.get("commit") or "")
    except (OSError, ValueError):
        return ""


def tracked_children() -> int:
    """Background processes Hermes' process registry tracks as running (``terminal`` with
    ``background: true``). Go never reaps a worker while this is above zero: stopping the worker
    would make Hermes' owner-death supervisor kill them."""
    reg_mod = sys.modules.get("tools.process_registry")
    reg = getattr(reg_mod, "process_registry", None)
    running = getattr(reg, "_running", None)
    if not isinstance(running, dict):
        return 0
    lock = getattr(reg, "_lock", None)
    try:
        if lock is not None:
            with lock:
                return len(running)
        return len(running)
    except Exception:
        return 0


class Worker:
    def __init__(self, chan: P.Channel):
        from timely_agent.run_chat import AgentCache
        self.chan = chan
        self.pending = P.PendingRequests()
        self.cache = AgentCache()
        self.runs: dict[str, Any] = {}
        self.runs_lock = threading.Lock()
        self.ready = False
        self.refused_reason: Optional[str] = None
        self.stopping = False
        self.home = Path(os.environ["HERMES_HOME"]).resolve()
        bridge.ask = self._ask

    # ------------------------------------------------------------ plumbing
    def send(self, msg: dict[str, Any]) -> bool:
        return self.chan.send(msg)

    def _ask(self, msg: dict[str, Any], timeout: float) -> Optional[dict]:
        return self.pending.ask(self.send, msg, timeout)

    def log(self, level: str, text: str) -> None:
        self.send({"type": "log", "level": level, "text": text})

    # ------------------------------------------------------------ hello
    def on_hello(self, msg: dict[str, Any]) -> None:
        mid = msg.get("id")
        account = msg["account"]
        if msg.get("protocol") != P.PROTOCOL_VERSION:
            raise P.ProtocolError(P.E_PROTOCOL, f"worker speaks protocol {P.PROTOCOL_VERSION}, got {msg.get('protocol')!r}", mid)
        home = Path(str(msg.get("home") or "")).resolve()
        if home != self.home:
            raise P.ProtocolError(P.E_HOME, f"home {home} is not this worker's HERMES_HOME {self.home}", mid)
        if self.home.name != paths.account_dir_name(account):
            raise P.ProtocolError(P.E_WRONG_ACCOUNT, "HERMES_HOME does not belong to this account", mid)
        config = self.home / "config.yaml"
        from timely_agent.config_render import sha256_file
        actual = sha256_file(config) if config.is_file() else ""
        layout = paths.layout_for_home(self.home)
        from timely_agent.cli import load_prepared, render_account
        prepared = load_prepared(layout)
        timely_skills = prepared.get("timely_skills_dir")
        settings = msg.get("settings")
        if isinstance(settings, dict):
            # Go sent the settings themselves: render here (same code as `boot.py render-account`).
            if msg.get("settings_hash") and actual and actual != msg.get("settings_hash"):
                # stderr, not a protocol "log": the account is not pinned yet, and Go kills a
                # worker whose line names no account.
                logger.warning("config.yaml did not match settings_hash (edited since the last render); re-rendered")
            actual = render_account(layout, account, settings)["config_sha256"]
        elif not msg.get("settings_hash") or actual != msg.get("settings_hash"):
            raise P.ProtocolError(P.E_CONFIG, "config.yaml does not match settings_hash: re-render it and respawn", mid)
        self.chan.account = account

        started = time.monotonic()
        # Hermes loads <home>/.env over the environment Go built when run_agent is imported
        # (hermes_cli/env_loader.py). Timely never writes one, so one there was planted: set it
        # aside first. The self-test refuses while any dotenv file remains, and compares the
        # environment from here on (env_drift).
        for planted in env_check.set_aside_home_dotenv(self.home):
            logger.warning("set aside %s: Hermes would load it over the worker environment", planted)
        env_before = dict(os.environ)
        import run_agent  # noqa: F401  (the agent loop; also loads model_tools)
        # Bridge the account's terminal.* config into the TERMINAL_* process env, as Hermes' CLI and
        # gateway do at start: some readers (HOME for children: terminal.home_mode) only look there.
        # hermes_cli.config's bridge leaves out home_mode (only gateway/run.py bridges it), so
        # TERMINAL_HOME_MODE is set here: children get HOME=<home>/home, never the real home.
        from hermes_cli.config import apply_terminal_config_to_env, load_config
        apply_terminal_config_to_env()
        home_mode = str((load_config().get("terminal") or {}).get("home_mode") or "profile")
        os.environ["TERMINAL_HOME_MODE"] = home_mode
        # The terminal bridge (Hermes runs it inside its dotenv load too, then this code) is the
        # only expected change: TERMINAL_* names holding exactly what the account config gives
        # them when bridged onto the start environment. Anything else is drift.
        bridged = apply_terminal_config_to_env(env=dict(env_before))
        bridged["TERMINAL_HOME_MODE"] = home_mode
        ours = {n for n, v in bridged.items() if n.startswith("TERMINAL_") and os.environ.get(n) == v}
        from hermes_cli.plugins import discover_plugins
        discover_plugins()
        skills_sync: dict[str, Any] = {}
        try:
            from tools.skills_sync import sync_skills
            res = sync_skills(quiet=True) or {}
            skills_sync = {k: (len(v) if isinstance(v, (list, tuple, set, dict)) else v) for k, v in res.items()}
        except Exception as exc:
            skills_sync = {"error": f"{type(exc).__name__}: {exc}"}
        from timely_agent import selftest
        result = selftest.run(expected_home=str(self.home), timely_skills_dir=timely_skills,
                              env_before=env_before, env_ignore=ours)
        from hermes_cli.plugins import get_plugin_manager
        loaded = sorted(p.get("key") or p.get("name") for p in get_plugin_manager().list_plugins() if p.get("enabled"))
        self.ready = result["ok"]
        if not result["ok"]:
            self.refused_reason = "; ".join(f"{c['name']}: {c['detail']}" for c in result["checks"] if not c["ok"])
            logger.error("self-test failed, refusing to serve: %s", self.refused_reason)
        failures = [f"{c['name']}: {c['detail']}" for c in result["checks"] if not c["ok"]]
        self.send({
            "type": "ready", "id": mid, "protocol": P.PROTOCOL_VERSION, "hermes_tag": hermes_tag(),
            "tools": result["tools"], "plugins_loaded": loaded,
            "self_test": {"ok": result["ok"], "failures": failures, "checks": result["checks"]},
            "config_sha256": actual,
            "skills_sync": skills_sync, "boot_ms": int((time.monotonic() - started) * 1000),
            "catalog_version": msg.get("catalog_version"),
        })
        threading.Thread(target=self._heartbeat, name="timely-heartbeat", daemon=True).start()

    def busy(self) -> dict[str, Any]:
        """Work Go cannot see on its own (plan 6.2): live runs, a learning pass, tracked children."""
        with self.runs_lock:
            runs = len(self.runs)
        # Learning passes arrive in phase 4; until then learning is always False.
        return {"runs": runs, "learning": False, "children": tracked_children()}

    def _heartbeat(self) -> None:
        while not self.chan.closed and not self.stopping:
            time.sleep(HEARTBEAT_S)
            self.send({"type": "heartbeat", "busy": self.busy()})

    # ------------------------------------------------------------ runs
    def _require_ready(self, mid: Optional[str]) -> None:
        if self.refused_reason:
            raise P.ProtocolError(P.E_REFUSED, f"the worker failed its self-test: {self.refused_reason}", mid)
        if not self.ready:
            raise P.ProtocolError(P.E_NOT_READY, "hello has not been answered yet", mid)
        if self.stopping:
            raise P.ProtocolError(P.E_NOT_READY, "the worker is shutting down", mid)

    def on_run_start(self, msg: dict[str, Any]) -> None:
        from timely_agent.run_chat import Run, run_turn
        mid = msg.get("id")
        self._require_ready(mid)
        run_id, conversation = msg.get("run"), msg.get("conversation_id")
        if not isinstance(run_id, str) or not run_id or not isinstance(conversation, str) or not conversation:
            raise P.ProtocolError(P.E_BAD_MESSAGE, "run.start needs run and conversation_id", mid)
        if not isinstance(msg.get("toolsets"), list):
            raise P.ProtocolError(P.E_BAD_MESSAGE, "run.start needs an explicit toolsets list", mid)
        with self.runs_lock:
            if run_id in self.runs:
                raise P.ProtocolError(P.E_DUPLICATE_RUN, f"run {run_id} is already running", mid)
            if any(r.msg.get("conversation_id") == conversation for r in self.runs.values()):
                raise P.ProtocolError(P.E_BUSY, "this conversation already has a live run", mid)
            if len(self.runs) >= MAX_RUNS:
                raise P.ProtocolError(P.E_BUSY, f"the account already has {MAX_RUNS} live runs", mid)
            run = Run(run_id=run_id, request_id=mid, msg=msg)
            self.runs[run_id] = run

        def emit(kind: str, payload: dict) -> None:
            self.send({"type": "event", "run": run_id, "kind": kind, "payload": payload})

        def body() -> None:
            from tools.approval import register_gateway_notify, unregister_gateway_notify
            session_key = str(msg.get("session_key") or f"timely:{conversation}")

            def notify(data: dict) -> None:
                emit("approval.request", {k: v for k, v in data.items()
                                          if isinstance(v, (str, int, float, bool, type(None)))})

            register_gateway_notify(session_key, notify)
            try:
                done = run_turn(run, self.cache, emit)
            finally:
                unregister_gateway_notify(session_key)
                with self.runs_lock:
                    self.runs.pop(run_id, None)
            try:
                self.send({"type": "run.done", "id": mid, "run": run_id, **done})
            except Exception as exc:  # Go must always get a run.done, or the run stays live there
                logger.exception("run.done for %s could not be sent", run_id)
                self.send({"type": "run.done", "id": mid, "run": run_id, "completed": False,
                           "interrupted": False, "error": f"run.done could not be encoded: {type(exc).__name__}"})

        ctx = contextvars.copy_context()
        run.thread = threading.Thread(target=ctx.run, args=(body,), name=f"timely-run-{run_id}"[:40], daemon=True)
        run.thread.start()

    def _find_run(self, msg: dict[str, Any]):
        with self.runs_lock:
            run = self.runs.get(str(msg.get("run") or ""))
        if run is None:
            raise P.ProtocolError(P.E_UNKNOWN_RUN, f"no live run {msg.get('run')!r}", msg.get("id"))
        return run

    def on_run_stop(self, msg: dict[str, Any]) -> None:
        run = self._find_run(msg)
        run.stop_reason = str(msg.get("reason") or "stopped")
        if run.agent is not None:
            try:
                run.agent.interrupt(run.stop_reason, hard_cancel=True)
            except TypeError:
                run.agent.interrupt(run.stop_reason)

    def on_run_steer(self, msg: dict[str, Any]) -> None:
        run = self._find_run(msg)
        ok = bool(run.agent is not None and run.agent.steer(str(msg.get("text") or "")))
        self.send({"type": "ack", "id": msg.get("id"), "ok": ok})

    def on_approval_answer(self, msg: dict[str, Any]) -> None:
        run = self._find_run(msg)
        choice = msg.get("choice")
        if choice not in ("once", "deny"):
            raise P.ProtocolError(P.E_BAD_MESSAGE, "choice must be once or deny", msg.get("id"))
        from tools.approval import resolve_gateway_approval
        key = str(run.msg.get("session_key") or f"timely:{run.msg.get('conversation_id')}")
        n = resolve_gateway_approval(key, choice, request_id=msg.get("request_id") or None)
        self.send({"type": "ack", "id": msg.get("id"), "ok": n > 0})

    def on_session_delete(self, msg: dict[str, Any]) -> None:
        conversation = str(msg.get("conversation_id") or "")
        if not conversation:
            raise P.ProtocolError(P.E_BAD_MESSAGE, "session.delete needs conversation_id", msg.get("id"))
        with self.runs_lock:
            if any(r.msg.get("conversation_id") == conversation for r in self.runs.values()):
                raise P.ProtocolError(P.E_BUSY, "the conversation has a live run; stop it first", msg.get("id"))
        self.cache.drop(conversation)
        ok = False
        try:
            from hermes_state import SessionDB
            ok = bool(SessionDB().delete_session(conversation))
        except Exception as exc:
            logger.warning("session.delete %s: %s", conversation, exc)
        self.send({"type": "ack", "id": msg.get("id"), "ok": ok})

    # ------------------------------------------------------------ shutdown
    def stop_all(self, reason: str) -> None:
        with self.runs_lock:
            runs = list(self.runs.values())
        for run in runs:
            run.stop_reason = reason
            if run.agent is not None:
                try:
                    run.agent.interrupt(reason, hard_cancel=True)
                except Exception:
                    pass
        self.pending.cancel_all()

    def wait_runs(self, grace: float) -> None:
        deadline = time.monotonic() + max(0.0, grace)
        while time.monotonic() < deadline:
            with self.runs_lock:
                if not self.runs:
                    return
            time.sleep(0.05)

    # ------------------------------------------------------------ loop
    def dispatch(self, msg: dict[str, Any]) -> bool:
        """Handle one message; False means exit."""
        t = msg["type"]
        if t == "ping":
            self.send({"type": "pong", "id": msg.get("id"), "account": msg["account"], "busy": self.busy()})
        elif t == "hello":
            if self.chan.account is not None:
                raise P.ProtocolError(P.E_BAD_MESSAGE, "hello was already received", msg.get("id"))
            self.on_hello(msg)
        elif self.chan.account is None:
            raise P.ProtocolError(P.E_NOT_READY, "the first message must be hello", msg.get("id"))
        elif t in ("tool.result", "gate.verdict"):
            if not self.pending.resolve(msg):
                logger.warning("%s for unknown or expired request %s", t, msg.get("id"))
        elif t == "run.start":
            self.on_run_start(msg)
        elif t == "run.stop":
            self.on_run_stop(msg)
        elif t == "run.steer":
            self.on_run_steer(msg)
        elif t == "approval.answer":
            self.on_approval_answer(msg)
        elif t == "session.delete":
            self.on_session_delete(msg)
        elif t == "shutdown":
            grace = msg.get("grace")
            grace = float(grace) if isinstance(grace, (int, float)) else 5.0
            self.stopping = True
            self.wait_runs(grace)
            self.stop_all("shutdown")
            self.wait_runs(2.0)
            return False
        else:  # bot.run, learning.*: later phases
            raise P.ProtocolError(P.E_UNSUPPORTED, f"{t} is not supported by this worker yet", msg.get("id"))
        return True

    def serve(self) -> int:
        while True:
            try:
                line = self.chan.readline()
            except P.ProtocolError as exc:
                self.chan.error(exc.code, exc.message, exc.msg_id)
                continue
            if line is None:
                logger.info("protocol input closed: stopping")
                self.stopping = True
                self.stop_all("host closed the pipe")
                self.wait_runs(2.0)
                return 0
            if not line.strip():
                continue
            try:
                msg = P.decode(line, self.chan.account)
                if not self.dispatch(msg):
                    return 0
            except P.ProtocolError as exc:
                self.chan.error(exc.code, exc.message, exc.msg_id, **self._error_extra(line))
            except Exception as exc:
                logger.exception("message handling failed")
                mid = None
                try:
                    mid = json.loads(line).get("id")
                except Exception:
                    pass
                self.chan.error(P.E_INTERNAL, f"{type(exc).__name__}: {exc}", mid, **self._error_extra(line))

    def _error_extra(self, line: bytes) -> dict[str, str]:
        """Fields an error reply copies from the request: ``run`` (so Go can end a refused run),
        and before hello the account the message named (afterwards every line carries the
        worker's own account)."""
        try:
            req = json.loads(line)
        except Exception:
            return {}
        if not isinstance(req, dict):
            return {}
        out = {}
        if isinstance(req.get("run"), str) and req["run"]:
            out["run"] = req["run"]
        if self.chan.account is None and isinstance(req.get("account"), str) and req["account"]:
            out["account"] = req["account"]
        return out


def main(fds: tuple[int, int]) -> int:
    _setup_logging()
    chan = P.Channel(*fds)
    problems, warnings = env_check.check()
    for w in warnings:
        logger.warning("environment: %s", w)
    if problems:
        chan.error(P.E_REFUSED, "worker environment refused: " + "; ".join(problems))
        logger.error("refusing to start: %s", "; ".join(problems))
        chan.close()
        return EXIT_REFUSED_ENV
    if sys.platform.startswith("linux"):
        try:  # keep same-user processes from ptrace/core-dumping the worker's keys (section 6.2)
            import ctypes
            ctypes.CDLL(None).prctl(4, 0, 0, 0, 0)  # PR_SET_DUMPABLE = 4
        except Exception:
            pass
    from timely_agent import install_guard, plugin_dist
    install_guard.install()
    plugin_dist.register()
    worker = Worker(chan)
    code = 0
    try:
        code = worker.serve()
    finally:
        chan.close()
        sys.stderr.flush()
    # Hermes leaves non-daemon helper threads behind; the protocol is done, so leave now.
    os._exit(code)
