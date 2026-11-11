"""The per-account worker: ``python -I boot.py worker`` (plan sections 3.3, 5.1, 6.2).

``boot.py`` has already moved the protocol to private descriptors and fixed ``sys.path``. This
module checks the environment, installs the runtime-install guard and the plugin distribution,
then serves the protocol: ``hello`` -> ``ready`` (with the self-test), runs, and ``shutdown``.
Closing stdin (Go exiting or restarting) is the lifeline: runs are interrupted and the worker
exits. ``shutdown`` lets live runs finish within its grace while the reader keeps serving them. The wire format is ``apps/agent/PROTOCOL.md``.
"""

from __future__ import annotations

import contextvars
import json
import logging
import os
import re
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
MAINTENANCE_S = 600.0  # curator tick (its own gates decide whether a pass is due)
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


def web_backends() -> list[str]:
    """``ready.web_backends``: keyed web backends this runtime can use (``timely_agent.web_backends``,
    worker-web's module; [] while it is missing)."""
    try:
        from timely_agent import web_backends as wb
    except ImportError:
        return []
    try:
        return sorted(str(b) for b in wb.available())
    except Exception:
        logger.exception("web_backends.available failed")
        return []


def skills_upstream() -> int:
    """``ready.skills_upstream``: edited bundled skills whose upstream changed
    (``timely_agent.skills_admin``; 0 while it is missing)."""
    try:
        from timely_agent import skills_admin
    except ImportError:
        return 0
    try:
        return int(skills_admin.upstream_count())
    except Exception:
        logger.exception("skills_admin.upstream_count failed")
        return 0


def run_start_problem(msg: dict[str, Any]) -> Optional[str]:
    """Why a run.start's optional fields have the wrong shape, else None. Checked before the run
    thread starts, so a malformed start is refused with an error answering its id instead of
    killing the thread before run.done."""
    shapes = {
        "tainted_sources": (list,), "pre_approved": (dict,), "history": (list,), "budgets": (dict,),
        "flags": (dict,), "model": (dict,), "session_key": (str,), "user_message": (str,),
        "system_text": (str,),
    }
    for field, types in shapes.items():
        value = msg.get(field)
        if value is not None and not isinstance(value, types):
            return f"{field} must be a {' or '.join(t.__name__ for t in types)}, not {type(value).__name__}"
    if any(not isinstance(t, str) for t in msg.get("toolsets") or []):
        return "toolsets must be a list of strings"
    from timely_agent.config_render import NEVER_TOOLSETS
    never = [t for t in msg.get("toolsets") or [] if t in NEVER_TOOLSETS or t.startswith("hermes-")]
    if never:
        # never-offered toolsets (decision 6, section 8.1) and Hermes' platform bundles, which
        # carry terminal, execute_code, delegate_task and the rest along
        return f"toolsets {never} are never offered in Timely"
    if any(not isinstance(t, (dict, str)) for t in msg.get("tainted_sources") or []):
        return "tainted_sources must be a list of source objects"
    if any(not isinstance(h, dict) for h in msg.get("history") or []):
        return "history must be a list of message objects"
    permission = msg.get("permission")
    if permission is not None and permission not in bridge.PERMISSIONS:
        return f"permission must be one of {list(bridge.PERMISSIONS)}, not {permission!r}"
    flags = msg.get("flags") or {}
    for name in P.RUN_START_BOOL_FLAGS:
        if flags.get(name) is not None and not isinstance(flags.get(name), bool):
            return f"flags.{name} must be a bool"
    for name in P.RUN_START_LISTS:
        value = msg.get(name)
        if value is not None and (not isinstance(value, list) or any(not isinstance(v, str) for v in value)):
            return f"{name} must be a list of strings"
    return None


TOOL_NAME = re.compile(r"^[A-Za-z_][A-Za-z0-9_-]{0,63}$")


def timely_tools_problem(value: Any) -> Optional[str]:
    """Why ``hello.timely_tools`` has the wrong shape, else None (PROTOCOL.md section 6)."""
    if value is None:
        return None
    if not isinstance(value, dict):
        return "timely_tools must be an object"
    if not isinstance(value.get("catalog_version", ""), str):
        return "timely_tools.catalog_version must be a string"
    tools = value.get("tools")
    if not isinstance(tools, list):
        return "timely_tools.tools must be a list"
    from timely_agent import policy
    seen: set[str] = set()
    for spec in tools:
        if not isinstance(spec, dict) or not isinstance(spec.get("name"), str):
            return "each timely_tools.tools entry needs a name"
        name = spec["name"]
        if not TOOL_NAME.match(name) or policy.is_blocked(name):
            return f"timely_tools.tools has a name Timely cannot offer: {name!r}"
        if name in seen:
            return f"timely_tools.tools names {name!r} twice"
        seen.add(name)
        if not isinstance(spec.get("description", ""), str):
            return f"timely_tools.tools {name}: description must be a string"
        if not isinstance(spec.get("parameters", {}), dict):
            return f"timely_tools.tools {name}: parameters must be an object"
        if not isinstance(spec.get("outside", False), bool):
            return f"timely_tools.tools {name}: outside must be a bool"
    return None


class Worker:
    def __init__(self, chan: P.Channel):
        from timely_agent.learning.counters import Counters
        from timely_agent.run_chat import AgentCache
        self.chan = chan
        self.pending = P.PendingRequests()
        self.home = Path(os.environ["HERMES_HOME"]).resolve()
        self.counters = Counters.for_home(self.home)
        self.cache = AgentCache(counters=self.counters)
        self.prepared: dict[str, Any] = {}
        self.runs: dict[str, Any] = {}
        self.runs_lock = threading.Lock()
        self.ready = False
        self.refused_reason: Optional[str] = None
        self.stopping = False
        self._shutdown_started = False
        bridge.ask = self._ask
        bridge.notify = self.send

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
        from timely_agent.cli import effective_default_off, render_account
        # What prepare reported, from Go (never from runtime/prepared.json, which sits in the same
        # writable agent folder): the managed file must be exactly the floors these values render,
        # and every reviewed default-off skill stays in skills.disabled unless the person turned
        # it on.
        timely_skills, managed_sha = msg.get("timely_skills_dir"), msg.get("managed_sha256")
        browser = msg.get("browser_executable", "")
        default_off = msg.get("skills_default_off")
        if not (isinstance(timely_skills, str) and timely_skills and isinstance(managed_sha, str) and managed_sha
                and isinstance(browser, str)):
            raise P.ProtocolError(P.E_BAD_MESSAGE, "hello needs prepare's timely_skills_dir and managed_sha256", mid)
        if not isinstance(default_off, list) or any(not isinstance(n, str) for n in default_off):
            raise P.ProtocolError(P.E_BAD_MESSAGE, "hello needs prepare's skills_default_off list", mid)
        if not paths.within(layout.root, timely_skills):
            raise P.ProtocolError(P.E_BAD_MESSAGE, "hello.timely_skills_dir is outside the agent folder", mid)
        problem = timely_tools_problem(msg.get("timely_tools"))
        if problem:
            raise P.ProtocolError(P.E_BAD_MESSAGE, f"hello {problem}", mid)
        timely_tools = msg.get("timely_tools") or {}
        settings = msg.get("settings")
        if isinstance(settings, dict):
            # Go sent the settings themselves: render here (same code as `boot.py render-account`).
            if msg.get("settings_hash") and actual and actual != msg.get("settings_hash"):
                # stderr, not a protocol "log": the account is not pinned yet, and Go kills a
                # worker whose line names no account.
                logger.warning("config.yaml did not match settings_hash (edited since the last render); re-rendered")
            prepared = {"timely_skills_dir": timely_skills, "browser_executable": browser,
                        "seed_skills_dir": os.environ.get("HERMES_BUNDLED_SKILLS", ""),
                        "skills_default_off": default_off}
            actual = render_account(layout, account, settings, prepared)["config_sha256"]
            required_off: Optional[list[str]] = effective_default_off(default_off, settings)
        elif not msg.get("settings_hash") or actual != msg.get("settings_hash"):
            raise P.ProtocolError(P.E_CONFIG, "config.yaml does not match settings_hash: re-render it and respawn", mid)
        else:
            # Go rendered config.yaml with render-account from the same list; which skills the
            # person turned on is not known here, so the self-test skips that check.
            required_off = None
        self.chan.account = account

        started = time.monotonic()
        # Hermes loads <home>/.env over the environment Go built when run_agent is imported
        # (hermes_cli/env_loader.py). Timely never writes one, so one there was planted: set it
        # aside first. The self-test refuses while any dotenv file remains, and compares the
        # environment from here on (env_drift).
        for planted in env_check.set_aside_home_dotenv(self.home):
            logger.warning("set aside %s: Hermes would load it over the worker environment", planted)
        env_before = dict(os.environ)
        # Timely tool specs before Hermes discovers plugins (importing run_agent already does):
        # timely_tools.register reads them (plan 5.2).
        bridge.set_timely_tools(timely_tools.get("tools") or [], timely_tools.get("catalog_version") or "")
        import run_agent  # noqa: F401  (the agent loop; also loads model_tools)
        from timely_agent import dotenv_guard
        dotenv_guard.install()  # R2: no dotenv reload after this point (MCP config loads call it)
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
                              browser_executable=browser, managed_sha256=managed_sha,
                              env_before=env_before, env_ignore=ours, required_disabled=required_off,
                              timely_tools=[t["name"] for t in bridge.timely_tools()])
        from hermes_cli.plugins import get_plugin_manager
        loaded = sorted(p.get("key") or p.get("name") for p in get_plugin_manager().list_plugins() if p.get("enabled"))
        self.ready = result["ok"]
        if not result["ok"]:
            self.refused_reason = "; ".join(f"{c['name']}: {c['detail']}" for c in result["checks"] if not c["ok"])
            logger.error("self-test failed, refusing to serve: %s", self.refused_reason)
        failures = [f"{c['name']}: {c['detail']}" for c in result["checks"] if not c["ok"]]
        self.prepared = {"timely_skills_dir": timely_skills, "browser_executable": browser,
                         "seed_skills_dir": os.environ.get("HERMES_BUNDLED_SKILLS", ""),
                         "skills_default_off": default_off}
        from timely_agent.learning import feed as learning_feed
        learning_feed.install(learning_feed.Feed(self.home, self.send))
        self.send({
            "type": "ready", "id": mid, "protocol": P.PROTOCOL_VERSION, "hermes_tag": hermes_tag(),
            "pid": os.getpid(),  # Go checks this interpreter is in its process group / Job Object
            "tools": result["tools"], "plugins_loaded": loaded,
            "self_test": {"ok": result["ok"], "failures": failures, "checks": result["checks"]},
            "config_sha256": actual,
            "skills_sync": skills_sync, "boot_ms": int((time.monotonic() - started) * 1000),
            "catalog_version": msg.get("catalog_version"),
            "timely_tools": {"catalog_version": bridge.timely_catalog_version(),
                             "registered": sorted(result.get("timely_registered") or [])},
            "web_backends": web_backends(), "skills_upstream": skills_upstream(),
        })
        threading.Thread(target=self._heartbeat, name="timely-heartbeat", daemon=True).start()
        threading.Thread(target=self._maintenance, name="timely-maintenance", daemon=True).start()

    def busy(self) -> dict[str, Any]:
        """Work Go cannot see on its own (plan 6.2): live runs, a learning pass or curator run,
        tracked children."""
        from timely_agent.learning import passes
        with self.runs_lock:
            runs = len(self.runs)
        return {"runs": runs, "learning": passes.active(), "children": tracked_children()}

    def _maintenance(self) -> None:
        """The maintenance tick (plan 9b.2 item 6): Hermes' curator, while nothing else runs."""
        from timely_agent.learning import curator, passes
        while not self.chan.closed and not self.stopping:
            time.sleep(MAINTENANCE_S)
            if not self.ready or self.stopping or passes.active():
                continue
            with self.runs_lock:
                if self.runs:
                    continue
            curator.tick(self.home)

    # ------------------------------------------------------------ learning (PROTOCOL.md section 10)
    def on_learning(self, msg: dict[str, Any]) -> None:
        """``learning.*`` and ``settings.update``: answered on a thread of their own (an export or
        a skill sync takes a moment) with ``learning.result {id, ok, data}`` or ``error``."""
        from timely_agent.learning import api
        mid = msg.get("id")
        self._require_ready(mid)
        if not isinstance(mid, str) or not mid:
            raise P.ProtocolError(P.E_BAD_MESSAGE, f"{msg['type']} needs an id", mid)
        problem = api.problem(msg)
        if problem:
            raise P.ProtocolError(P.E_BAD_MESSAGE, problem, mid)
        host = api.Host(home=self.home, account=str(self.chan.account), render=self._render_settings,
                        after_settings=self._drop_idle_agents)

        def body() -> None:
            try:
                data = api.handle(msg, host)
                self.send({"type": "learning.result", "id": mid, "ok": True, "data": data})
            except api.Failed as exc:
                self.send({"type": "learning.result", "id": mid, "ok": False, "data": exc.data})
            except api.ApiError as exc:
                self.chan.error(exc.code, exc.message, mid)
            except Exception as exc:  # noqa: BLE001 - Go waits for an answer
                logger.exception("%s failed", msg.get("type"))
                self.chan.error(P.E_INTERNAL, f"{type(exc).__name__}: {exc}", mid)

        threading.Thread(target=contextvars.copy_context().run, args=(body,), name="timely-learning-api",
                         daemon=True).start()

    def _render_settings(self, settings: dict[str, Any]) -> str:
        from timely_agent.cli import render_account
        layout = paths.layout_for_home(self.home)
        return render_account(layout, str(self.chan.account), settings, self.prepared)["config_sha256"]

    def _drop_idle_agents(self) -> None:
        """After a settings change: cached agents of conversations without a live run are rebuilt
        on their next turn (counters kept), so the new skills list and backends reach them."""
        with self.runs_lock:
            live = {r.msg.get("conversation_id") for r in self.runs.values()}
        for conversation, _agent in self.cache.items():
            if conversation not in live:
                self.cache.drop(conversation)

    def _heartbeat(self) -> None:
        # Also during the shutdown grace: Go still watches a stopping worker.
        while not self.chan.closed:
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
        problem = run_start_problem(msg)
        if problem:
            # answers the start's own id, so Go ends the run (PROTOCOL.md "Errors")
            raise P.ProtocolError(P.E_BAD_MESSAGE, f"run.start {problem}", mid)
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
            done: Optional[dict[str, Any]] = None
            try:
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
            except BaseException as exc:  # noqa: BLE001 - Go must hear about every way a run ends
                logger.exception("run %s failed outside the turn", run_id)
                done = {"final_response": "", "completed": False, "interrupted": bool(run.stop_reason),
                        "error": f"{type(exc).__name__}: {exc}"[:2000]}
            finally:
                with self.runs_lock:
                    self.runs.pop(run_id, None)
                self._send_run_done(mid, run_id, done)

        try:
            ctx = contextvars.copy_context()
            run.thread = threading.Thread(target=ctx.run, args=(body,), name=f"timely-run-{run_id}"[:40], daemon=True)
            run.thread.start()
        except BaseException:
            # The internal error serve() sends answers the start's id, which ends the run in Go;
            # body() never ran, so forget the run here or its conversation stays busy for good.
            with self.runs_lock:
                self.runs.pop(run_id, None)
            raise

    def _send_run_done(self, mid: Optional[str], run_id: str, done: Optional[dict[str, Any]]) -> None:
        """Send run.done; Go keeps a run live until it arrives, so this never gives up silently."""
        if done is None:
            done = {"final_response": "", "completed": False, "interrupted": False,
                    "error": "the run ended without a result"}
        try:
            if self.send({"type": "run.done", "id": mid, "run": run_id, **done}):
                return
        except Exception as exc:
            logger.exception("run.done for %s could not be sent", run_id)
            reason = f"run.done could not be encoded: {type(exc).__name__}"
        else:
            reason = "run.done could not be sent"
        try:
            self.send({"type": "run.done", "id": mid, "run": run_id, "completed": False,
                       "interrupted": False, "error": reason})
        except Exception:
            logger.exception("fallback run.done for %s could not be sent", run_id)

    def _find_run(self, msg: dict[str, Any]):
        with self.runs_lock:
            run = self.runs.get(str(msg.get("run") or ""))
        if run is None:
            raise P.ProtocolError(P.E_UNKNOWN_RUN, f"no live run {msg.get('run')!r}", msg.get("id"))
        return run

    def on_run_stop(self, msg: dict[str, Any]) -> None:
        run = self._find_run(msg)
        run.stop(str(msg.get("reason") or "stopped"))
        self.pending.cancel_run(run.run_id)  # a tool.call or gate.ask waiting on Go ends at once

    def on_run_steer(self, msg: dict[str, Any]) -> None:
        run = self._find_run(msg)
        ok = run.steer(str(msg.get("text") or ""))
        self.send({"type": "ack", "id": msg.get("id"), "ok": ok})

    def on_approval_answer(self, msg: dict[str, Any]) -> None:
        run = self._find_run(msg)
        choice = msg.get("choice")
        if choice not in ("once", "deny"):
            raise P.ProtocolError(P.E_BAD_MESSAGE, "choice must be once or deny", msg.get("id"))
        request_id = msg.get("request_id")
        if not isinstance(request_id, str) or not request_id:
            # Without an id Hermes resolves the session's oldest pending approval (FIFO), which
            # may not be the one the person answered.
            raise P.ProtocolError(P.E_BAD_MESSAGE, "approval.answer needs the approval.request's request_id",
                                  msg.get("id"))
        from tools.approval import resolve_gateway_approval
        key = str(run.msg.get("session_key") or f"timely:{run.msg.get('conversation_id')}")
        n = resolve_gateway_approval(key, choice, request_id=request_id)
        self.send({"type": "ack", "id": msg.get("id"), "ok": n > 0})

    def on_session_delete(self, msg: dict[str, Any]) -> None:
        conversation = str(msg.get("conversation_id") or "")
        if not conversation:
            raise P.ProtocolError(P.E_BAD_MESSAGE, "session.delete needs conversation_id", msg.get("id"))
        with self.runs_lock:
            if any(r.msg.get("conversation_id") == conversation for r in self.runs.values()):
                raise P.ProtocolError(P.E_BUSY, "the conversation has a live run; stop it first", msg.get("id"))
        self.cache.drop(conversation, keep_counters=False)
        self.counters.forget(conversation)
        bridge.forget_session(conversation)
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
            try:
                run.stop(reason)
            except Exception:
                run.stop_reason = reason
        self.pending.cancel_all()

    def begin_shutdown(self, grace: float) -> None:
        """``shutdown``: refuse new work, and let live runs finish within ``grace`` on another
        thread, so the reader keeps handling what they still need from Go (tool.result,
        gate.verdict, approval.answer) and run.stop. Then interrupt the rest and exit."""
        self.stopping = True
        if self._shutdown_started:
            return
        self._shutdown_started = True
        threading.Thread(target=self._shutdown, args=(grace,), name="timely-shutdown", daemon=True).start()

    def _shutdown(self, grace: float) -> None:
        code = 0
        try:
            self.wait_runs(grace)
            self.stop_all("shutdown")
            self.wait_runs(2.0)
            self.cache.store_all()  # review counters survive the restart (plan 3.3)
        except BaseException:  # noqa: BLE001 - exit whatever happens
            logger.exception("shutdown failed")
            code = 1
        finally:
            # Go keeps stdin open through the grace, so the reader would never see EOF: exit here.
            self.chan.close_output()
            sys.stderr.flush()
            os._exit(code)

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
        elif t.startswith("learning.") or t == "settings.update":
            self.on_learning(msg)
        elif t == "shutdown":
            grace = msg.get("grace")
            self.begin_shutdown(float(grace) if isinstance(grace, (int, float)) and not isinstance(grace, bool)
                                else 5.0)
        else:  # bot.run: phase 6
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
                self.cache.store_all()
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
