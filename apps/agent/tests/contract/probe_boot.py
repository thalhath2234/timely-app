"""Test-only wrapper around ``timely_agent/boot.py`` for contract tests 5, 6, 18 and 19.

    python -I probe_boot.py [--net-log FILE] [--stdout-tool] [--taint-tool] [--system-via MODE]
                            [--tool-search MODE] [--slow-bind S] [--slow-ledger ACTION:S]
                            [--batch-deadline S] [--sleep-tool] worker

``--net-log FILE`` records every name lookup and every outgoing IP connection the worker
process makes (``socket.getaddrinfo``, ``gethostbyname``, ``gethostbyname_ex``,
``socket.connect``/``connect_ex``) as JSON lines in FILE (contract test 5).

``--stdout-tool`` registers a ``stdout_probe`` tool (toolset ``probe``) once Hermes is loaded.
It writes to standard output four ways: ``print``, ``sys.__stdout__``, ``os.write(1, ...)`` and
a child process that inherits the worker's fd 1 (no pipe, unlike Hermes' terminal backend)
(contract test 19). The worker must keep all of it off the protocol.

``--taint-tool`` registers ``taint_probe`` (toolset ``probe``), which returns outside page text,
and marks it as a taint source in ``policy.TAINT_SOURCES`` (kind ``web``) (contract test 18b).

``--system-via ephemeral|system_message`` sets ``run_chat.SYSTEM_VIA``, where the Timely block
goes (contract test 6 runs both).

``--batch-deadline S`` sets Hermes' default tool batch deadline to S seconds (the managed config
names none), and ``--sleep-tool`` registers ``sleep_probe`` (toolset ``probe``), which sleeps
``args.s`` seconds: the clarify test proves the deadline is armed and that a question wait longer
than it still completes (phase 4).

``--tool-search off|on`` makes Hermes read ``tools.tool_search.enabled`` as given, whatever the
managed floor says (the tool_search measurement in ``tests/measure_prompt.py``; never a product path).

Everything else is the real boot path: the wrapper loads ``boot.py`` from its own file and
calls ``boot.main``, so the descriptor move and ``sys.path`` fix run exactly as in production.
"""

from __future__ import annotations

import importlib.util
import json
import os
import socket
import sys
import threading

HERE = os.path.dirname(os.path.abspath(__file__))
AGENT = os.path.dirname(os.path.dirname(HERE))
BOOT = os.path.join(AGENT, "timely_agent", "boot.py")

PROBE_TOOL = "stdout_probe"
TAINT_TOOL = "taint_probe"
TAINT_PAGE = "Outside page text from taint_probe: buy now."
PROBE_TOOLSET = "probe"
PRINT_MARK = "PROBE-PRINT-TO-STDOUT"
DUNDER_MARK = "PROBE-SYS-DUNDER-STDOUT"
FD1_MARK = "PROBE-OS-WRITE-FD1"
CHILD_MARK = "PROBE-CHILD-INHERITED-FD1"


def _install_net_log(path: str) -> None:
    lock = threading.Lock()
    log = open(path, "a", encoding="utf-8")  # noqa: SIM115 - lives for the process

    def record(**entry) -> None:
        with lock:
            log.write(json.dumps(entry, default=str) + "\n")
            log.flush()

    def wrap(name):
        orig = getattr(socket, name)

        def hooked(host, *args, **kwargs):
            record(op=name, host=host if isinstance(host, (str, type(None))) else repr(host))
            return orig(host, *args, **kwargs)
        setattr(socket, name, hooked)

    for name in ("getaddrinfo", "gethostbyname", "gethostbyname_ex"):
        wrap(name)

    for meth in ("connect", "connect_ex"):
        orig = getattr(socket.socket, meth)

        def hooked(self, address, _orig=orig, _meth=meth):
            if self.family in (socket.AF_INET, socket.AF_INET6):
                record(op=_meth, address=list(address) if isinstance(address, tuple) else address)
            return _orig(self, address)
        setattr(socket.socket, meth, hooked)


def _install_stdout_tool() -> None:
    from timely_agent import worker

    original = worker.Worker.on_hello

    def on_hello(self, msg):
        from tools.registry import registry

        def handler(args, **_):
            print(PRINT_MARK, flush=True)
            sys.__stdout__.write(DUNDER_MARK + "\n")
            sys.__stdout__.flush()
            os.write(1, (FD1_MARK + "\n").encode())
            import subprocess
            subprocess.run([sys.executable, "-I", "-c", f"import os; os.write(1, b'{CHILD_MARK}\\n')"],
                           check=True, timeout=60)  # inherits fd 0-2: whatever fd 1 is now
            return json.dumps({"ok": True, "wrote": 4})

        registry.register(
            name=PROBE_TOOL, toolset=PROBE_TOOLSET, handler=handler,
            schema={"name": PROBE_TOOL, "description": "Contract test 19: writes to stdout four ways.",
                    "parameters": {"type": "object", "properties": {}}})
        return original(self, msg)

    worker.Worker.on_hello = on_hello


def _install_taint_tool() -> None:
    from timely_agent import policy, worker
    policy.TAINT_SOURCES[TAINT_TOOL] = "web"
    original = worker.Worker.on_hello

    def on_hello(self, msg):
        from tools.registry import registry
        registry.register(
            name=TAINT_TOOL, toolset=PROBE_TOOLSET, handler=lambda args, **_: json.dumps({"page": TAINT_PAGE}),
            schema={"name": TAINT_TOOL, "description": "Contract test 18: returns outside page text.",
                    "parameters": {"type": "object", "properties": {"url": {"type": "string"}}}})
        return original(self, msg)

    worker.Worker.on_hello = on_hello


def _install_system_via(mode: str) -> None:
    from timely_agent import run_chat
    run_chat.SYSTEM_VIA = mode


def _install_tool_search(mode: str) -> None:
    from timely_agent import worker
    original = worker.Worker.on_hello

    def on_hello(self, msg):
        import tools.tool_search as ts
        forced = ts.ToolSearchConfig.from_raw({"enabled": mode})
        ts.load_config = lambda: forced
        ts.load_config_readonly = lambda: forced
        return original(self, msg)

    worker.Worker.on_hello = on_hello


SLEEP_TOOL = "sleep_probe"


def _install_batch_deadline(seconds: float) -> None:
    from timely_agent import worker
    original = worker.Worker.on_hello

    def on_hello(self, msg):
        out = original(self, msg)  # Hermes is loaded; runs start only after this returns
        from agent import tool_executor
        tool_executor._DEFAULT_CONCURRENT_TOOL_TIMEOUT_S = seconds
        return out

    worker.Worker.on_hello = on_hello


def _install_sleep_tool() -> None:
    from timely_agent import worker
    original = worker.Worker.on_hello

    def on_hello(self, msg):
        import time
        from tools.registry import registry

        def handler(args, **_):
            time.sleep(float((args or {}).get("s") or 0))
            return json.dumps({"slept": True})

        registry.register(
            name=SLEEP_TOOL, toolset=PROBE_TOOLSET, handler=handler,
            schema={"name": SLEEP_TOOL, "description": "Phase 4 clarify test: sleeps s seconds.",
                    "parameters": {"type": "object", "properties": {"s": {"type": "number"}}}})
        return original(self, msg)

    worker.Worker.on_hello = on_hello


def _install_slow_bind(seconds: float) -> None:
    """``--slow-bind S``: a run binds its session state S seconds late (a loaded machine), so a
    ``learning.stop`` sent right after the run.start reaches the worker first."""
    import time
    from timely_agent import bridge
    original = bridge.bind_session

    def bind_session(*args, **kwargs):
        time.sleep(seconds)
        return original(*args, **kwargs)
    bridge.bind_session = bind_session


def _install_slow_ledger(action: str, seconds: float) -> None:
    """``--slow-ledger ACTION:S``: Hermes appends the ledger entry of a skill ``ACTION`` (patch,
    create ...) S seconds after the write (a loaded machine), inside the skill's mutation lock as
    Hermes does."""
    import time
    from tools import skill_ledger
    original = skill_ledger.record_mutation

    def record_mutation(*args, **kwargs):
        if (args[0] if args else kwargs.get("action")) == action:
            time.sleep(seconds)
        return original(*args, **kwargs)
    skill_ledger.record_mutation = record_mutation


def main(argv: list[str]) -> int:
    net_log, patches = None, []
    while argv and argv[0].startswith("--"):
        flag = argv.pop(0)
        if flag == "--net-log":
            net_log = argv.pop(0)
        elif flag == "--stdout-tool":
            patches.append(_install_stdout_tool)
        elif flag == "--taint-tool":
            patches.append(_install_taint_tool)
        elif flag == "--system-via":
            mode = argv.pop(0)
            patches.append(lambda mode=mode: _install_system_via(mode))
        elif flag == "--slow-bind":
            seconds = float(argv.pop(0))
            patches.append(lambda seconds=seconds: _install_slow_bind(seconds))
        elif flag == "--slow-ledger":
            action, _, seconds = argv.pop(0).partition(":")
            patches.append(lambda action=action, seconds=float(seconds): _install_slow_ledger(action, seconds))
        elif flag == "--batch-deadline":
            seconds = float(argv.pop(0))
            patches.append(lambda seconds=seconds: _install_batch_deadline(seconds))
        elif flag == "--sleep-tool":
            patches.append(_install_sleep_tool)
        elif flag == "--tool-search":
            mode = argv.pop(0)
            patches.append(lambda mode=mode: _install_tool_search(mode))
        else:
            sys.stderr.write(f"probe_boot: unknown flag {flag}\n")
            return 2
    # -I put this folder first on sys.path; boot.py only removes its own folder.
    sys.path[:] = [p for p in sys.path if os.path.abspath(p or ".") != HERE]
    if net_log:
        _install_net_log(net_log)
    spec = importlib.util.spec_from_file_location("timely_boot", BOOT)
    boot = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(boot)
    if patches:
        fix = boot._fix_sys_path

        def fix_and_patch() -> None:
            fix()
            for patch in patches:
                patch()
        boot._fix_sys_path = fix_and_patch
    return boot.main(argv)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
