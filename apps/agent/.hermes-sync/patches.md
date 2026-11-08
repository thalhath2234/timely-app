# Timely changes to Hermes

Plan section 4.4. Budget for patch points: start at zero, hard cap five; fixes that belong upstream go upstream.

## Patch points (vendored files edited)

None. Each future entry names the file as its full path from the repo root (apps/agent/hermes/ followed by the upstream path) inside backticks, the form `scripts/hermes-sync/check.sh` reads, its `# TIMELY(Pn)` marker, why no seam works, and the upstream issue or PR.

## Runtime overrides (no vendored file edited)

Timely code that replaces a Hermes function object at worker boot, for behaviour Hermes offers no seam for. Each has a contract test. They are not patch points and do not count toward the cap, but a sync that changes the replaced function needs the same review as a conflict.

| Override | Replaced at runtime | Why | Code | Test |
| --- | --- | --- | --- | --- |
| R1 install guard | `pm.install.lazy_installs_allowed`, `pm.client._request`, `pm.client.ensure`, `pm.client.sync_venv`, `pm.install.ensure`, `pm.install.sync_venv`, `pm.extras.ensure_import` | A worker runs from a fixed, reviewed runtime (read-only when packaged); Hermes' package manager would otherwise install Python extras, tools and browsers on first use. The config floor `security.allow_lazy_installs: false` and `HERMES_DISABLE_LAZY_INSTALLS=1` are set too; the override makes every install path refuse with pm's own `InstallError`. Applied by `timely_agent/install_guard.py` before `run_agent` is imported; the self-test (`install_guard` check) refuses a worker where any override is missing. | `apps/agent/timely_agent/install_guard.py` | `apps/agent/tests/test_worker.py::test_install_guard_refuses_in_worker_runtime` |
