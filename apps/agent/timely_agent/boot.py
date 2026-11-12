"""Entry point of Timely's agent runtime: ``python -I boot.py <command>``.

Commands (plan sections 3.3, 6.3, 9.1; the wire format is ``apps/agent/PROTOCOL.md``):

- ``worker``          one per-account worker speaking newline JSON on stdin/stdout
- ``prepare``         API start: seed tree, read-only Timely skills copy, managed config
- ``render-account``  before each spawn: account home layout, ``config.yaml``, ``SOUL.md``
- ``agent-export``, ``agent-import``, ``agent-reconcile``  an account's agent state in a backup
  (plan 6.5; ``timely_agent.backup``)
- ``agent-forget``    delete chats the person deleted while the account had no worker

This file must stay importable before anything else: it runs with ``-I`` (no
``PYTHONPATH``, no user site, no script-dir surprises once we fix ``sys.path``),
moves the protocol off the standard descriptors for ``worker`` BEFORE any Hermes
import, then hands over to ``timely_agent``.
"""

from __future__ import annotations

import os
import sys


def _move_protocol_off_stdio() -> tuple[int, int]:
    """Give the protocol private descriptors and turn fd 0/1 into null input and stderr.

    ``os.dup`` returns non-inheritable descriptors (PEP 446), so terminal children
    never receive the protocol pipes. Afterwards fd 0 reads the null device, fd 1 is
    a copy of fd 2, and ``sys.stdout`` is ``sys.stderr``: a stray ``print`` in Hermes
    or a child process writing to its stdout lands in the log stream, never on the
    protocol (contract test 19).
    """
    proto_in = os.dup(0)
    proto_out = os.dup(1)
    null = os.open(os.devnull, os.O_RDONLY)
    try:
        os.dup2(null, 0)
    finally:
        os.close(null)
    os.dup2(2, 1)
    sys.stdout.flush()
    sys.stdout = sys.stderr
    try:
        sys.stdin.close()
    except OSError:
        pass
    sys.stdin = open(os.devnull, encoding="utf-8")  # noqa: SIM115 - lives for the process
    return proto_in, proto_out


def agent_dir() -> str:
    """``apps/agent`` (dev) or the packaged ``app/`` folder: the parent of ``timely_agent/``."""
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _fix_sys_path() -> None:
    """``sys.path = [<agent>/hermes, <agent>, site-packages...]`` (plan 4.3).

    ``-I`` puts the script's own folder (``timely_agent/``) first; it has to go, or
    ``timely_agent/plugins`` would shadow Hermes' top-level ``plugins`` package.

    The packaged runtime's ``app/site-packages`` is a plain folder, not a venv, so site.py
    never reads its ``.pth`` files. ``site.addsitedir`` does: pywin32 (the MCP SDK's Windows
    dependency) is only importable once ``pywin32.pth`` put ``win32/`` and ``win32/lib/`` on the
    path and ran ``pywin32_bootstrap`` for its DLLs. The folders a ``.pth`` adds come right
    after site-packages, before the stdlib.
    """
    base = agent_dir()
    script_dir = os.path.dirname(os.path.abspath(__file__))
    hermes = os.path.join(base, "hermes")
    packaged_site = os.path.join(base, "site-packages")
    rest = [p for p in sys.path if p and os.path.abspath(p) not in {script_dir, base, hermes, packaged_site}]
    extra: list[str] = []
    if os.path.isdir(packaged_site):
        import site

        known = set(sys.path)
        site.addsitedir(packaged_site)
        added = [p for p in sys.path if p not in known and os.path.abspath(p) != os.path.abspath(packaged_site)]
        extra = [packaged_site, *added]
    sys.path[:] = [hermes, base, *extra, *rest]


USAGE = ("usage: boot.py worker | prepare --agent-dir DIR | render-account --agent-dir DIR --account UID --prepared JSON"
         " | agent-export --agent-dir DIR --account UID --out ZIP | agent-import --agent-dir DIR --account UID --zip ZIP"
         " | agent-reconcile --agent-dir DIR | agent-forget --agent-dir DIR --account UID --sessions JSON\n")


def main(argv: list[str]) -> int:
    if not argv:
        sys.stderr.write(USAGE)
        return 2
    command, rest = argv[0], argv[1:]
    fds = _move_protocol_off_stdio() if command == "worker" else None
    _fix_sys_path()
    if command == "worker":
        from timely_agent import worker
        return worker.main(fds)
    if command in ("prepare", "render-account", "agent-export", "agent-import", "agent-reconcile", "agent-forget"):
        from timely_agent import cli
        return cli.main(command, rest)
    sys.stderr.write(USAGE)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
