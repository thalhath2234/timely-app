# apps/agent/packaging

Files that ship only in the packaged agent runtime (plan 11.4, phase 3b).

- `boot.py`: the root entry point of a staged runtime, `python -I <agent>/boot.py <command>`. It drops its own folder from `sys.path`, turns bytecode writing off and runs `app/timely_agent/boot.py` as `__main__`.

`apps/web/electron/stage-agent.mjs` (`make stage-agent`) builds the runtime into `apps/web/.electron-agent/<os>-<arch>/`; `apps/web/electron/smoke-agent.mjs` (`make smoke-agent READ_ONLY=1`) checks it from a read-only folder. The layout, the checks and the measured sizes are in `docs/desktop/README.md`.
