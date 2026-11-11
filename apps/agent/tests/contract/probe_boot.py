"""Test-only wrapper around ``timely_agent/boot.py`` for contract tests 5, 6, 18 and 19.

    python -I probe_boot.py [--net-log FILE] [--stdout-tool] [--taint-tool] [--system-via MODE]
                            [--tool-search MODE] worker

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
