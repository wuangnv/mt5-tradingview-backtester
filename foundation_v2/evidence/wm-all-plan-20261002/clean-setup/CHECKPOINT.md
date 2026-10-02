# Clean tracked-source Windows setup — 2026-10-02

Status: PASS_WARM_CACHE_WINDOWS_SETUP / FULL_U9_NOT_ACCEPTED.

The rehearsal extracts Git-tracked HEAD `8bde8fe145f375fb37101ec1ecff3b0e379094f2`
to a fresh directory under the workspace's ignored `.artifacts/`. It copies no
virtual environment, node_modules, .env, user datasets or untracked evidence.
Source archive size is 14,305,280 bytes. `receipt.json` pins the source tree,
dependency locks, observed tool versions and retained log hashes.

From that extracted repository root:

```powershell
uv sync --offline --locked --project foundation_v2 --python 3.12
uv sync --offline --locked --project foundation_v2/engine_runtime --python 3.12
Push-Location foundation_v2/web
npm ci --offline --ignore-scripts --no-audit --no-fund
node --test tests/*.test.mjs
npm run build
Pop-Location
uv run --offline --project foundation_v2 --with pytest==9.1.1 python -m pytest -q foundation_v2/tests/test_u5b_manual_execution_parity.py foundation_v2/tests/test_replay_execution_core.py foundation_v2/tests/test_replay_session_catalog.py
```

The initial control-runtime sync installed 21 packages; locked verification passed.
The separately locked engine installed 15 packages, including Nautilus 1.231.0
and PyArrow 25.0.1. Web install used 69 packages. Web tests passed 76/76;
Vite built 77 modules; backend smoke passed 44 tests with two existing warnings.
Database environment variables were removed for the smoke tests. They used no
database, provider or broker. No development service was started or restarted.

After installing the engine, the actual control boundary reports
`runtime_ready=true`, Python 3.12.10, Nautilus 1.231.0 and PyArrow 25.0.1.
The first import probe recorded native availability false before that separate
installation. A raw Python command must include both the repository root and
`foundation_v2` on its import path because retained modules still live at root:

```powershell
uv run --offline --locked --project foundation_v2 python -c 'import sys; sys.path.insert(0,"foundation_v2"); from trading_workspace_v2.nautilus_worker import runtime_ready; print(runtime_ready())'
```

Direct import from the repository root without adding `foundation_v2`, or from
inside `foundation_v2` without the retained root modules, failed during follow-up
probes. The corrected root-path probe passed; these failures are import-path
constraints, not evidence of an independently installable Python package.

Tools observed: Windows, Python 3.12.10, Node 24.19.0, uv 0.12.5. The existing
740.40 kB Vite chunk warning remains. Offline install deliberately disables npm
install scripts; this project's build worked under that scope.

This demonstrates fresh tracked-source setup using an existing local dependency
cache. It does not verify cold downloads, new-machine/browser/PostgreSQL setup,
user backup restoration, macOS, external license/cost acceptance or all U9/M7
requirements. The synthetic PostgreSQL restore rehearsal has its own receipt.
No source, lockfile or runtime configuration was changed to make setup pass.
