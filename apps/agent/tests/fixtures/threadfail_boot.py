"""Test-only wrapper around ``timely_agent/boot.py``: the first run thread fails to start.

    python -I threadfail_boot.py worker

Makes the first ``Thread.start`` of a thread named ``timely-run-*`` raise ``RuntimeError("can't
start new thread")``, as it does when RLIMIT_NPROC or a cgroup's pids.max is reached. Everything
else is the real boot path (``boot.main`` loaded from its own file).
"""

from __future__ import annotations

import importlib.util
import os
import sys
import threading

HERE = os.path.dirname(os.path.abspath(__file__))
BOOT = os.path.join(os.path.dirname(os.path.dirname(HERE)), "timely_agent", "boot.py")

_start = threading.Thread.start
_failed = False


def _failing_start(self, *args, **kwargs):
    global _failed
    if not _failed and self.name.startswith("timely-run-"):
        _failed = True
        raise RuntimeError("can't start new thread")
    return _start(self, *args, **kwargs)


threading.Thread.start = _failing_start

if __name__ == "__main__":
    # -I put this folder first on sys.path; boot.py only removes its own folder.
    sys.path[:] = [p for p in sys.path if os.path.abspath(p or ".") != HERE]
    spec = importlib.util.spec_from_file_location("timely_boot", BOOT)
    boot = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(boot)
    sys.exit(boot.main(sys.argv[1:]))
