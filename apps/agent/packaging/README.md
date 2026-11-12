# apps/agent/packaging

Files that ship only in the packaged agent runtime (plan 11.4, phase 3b).

- `python-licenses/<version>/`: the licences of the libraries built into the shipped interpreter, per desktop target, from python-build-standalone's `full` archives (`make agent-python-licenses`; rerun after a Hermes sync moves the Python pin).
- `licenses/dists.json` and `licenses/dists/`: licence texts for wheels that ship none. `licenses/copyleft.json`: the reviewed distributions that ship GPL or LGPL binaries, their libraries and sources; `licenses/gnu/` holds the full GNU texts they need.
- `boot.py`: the root entry point of a staged runtime, `python -I <agent>/boot.py <command>`. It drops its own folder from `sys.path`, turns bytecode writing off and runs `app/timely_agent/boot.py` as `__main__`.

`apps/web/electron/stage-agent.mjs` (`make stage-agent`) builds the runtime into `apps/web/.electron-agent/<os>-<arch>/`; `apps/web/electron/smoke-agent.mjs` (`make smoke-agent READ_ONLY=1`) checks it from a read-only folder. The layout, the checks and the measured sizes are in `docs/desktop/README.md`.
