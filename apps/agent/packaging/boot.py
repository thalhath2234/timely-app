"""Entry point of the packaged agent runtime: ``python -I <agent>/boot.py <command>``.

``stage-agent.mjs`` copies this file to the root of the staged runtime (plan 11.4)::

    agent/boot.py   this shim
    agent/python/   the interpreter
    agent/app/      hermes/, timely_agent/, skills/, site-packages/, .hermes-sync/policy/

It runs ``app/timely_agent/boot.py`` as ``__main__``, so Go, CI and people start the packaged
runtime and the dev one (``python -I apps/agent/timely_agent/boot.py``) the same way. ``-I`` puts
this folder first on ``sys.path``; it holds no Python package and is removed so nothing is found
in it. The packaged runtime is read-only and its ``.pyc`` files are compiled at staging time, so
bytecode is never written (``-I`` ignores ``PYTHONDONTWRITEBYTECODE``, hence the flag here).
"""

import os
import runpy
import sys

sys.dont_write_bytecode = True
_here = os.path.dirname(os.path.abspath(__file__))
sys.path[:] = [p for p in sys.path if p and os.path.abspath(p) != _here]
runpy.run_path(os.path.join(_here, "app", "timely_agent", "boot.py"), run_name="__main__")
