# QDM CLI pilot — 08/10/2026

Owner authorized replacing the web downloader with QDM, closing its GUI for a
CLI test, and moving integration into Trading Workspace/GitHub. No broker/live,
new license/account, distribution upload or API restart was performed.

## Local relocation and transport

The existing licensed installation was moved from `D:/ANNAM/Tools/QuantDataManager`
to `foundation_v2/.runtime/quantdatamanager` before this checkpoint. Its CLI binary
hash was unchanged by the move. Old directory now absent; new CLI present.
`git check-ignore` confirms the entire runtime is excluded. Raw CLI logs can
contain activation diagnostics/cookies and stay ignored; this receipt contains
only sanitized results. `open-qdm.bat` opens the new location when the user runs it.

Actual QDM 125.2692 CLI update for integration symbol EURUSD_TW completed in
8m16s and listed 8,755,235 M1 records, 05/05/2003–07/10/2026. Despite date args,
update fetched full history. Its log identified StrategyQuant CDN transport.
This is command wall time, not measured Internet throughput or an integrity
audit of every record. One-day UTC CSV export worked without manual GUI steps.

## Code and state flow

The offline launcher defaults to `qdm`; `--download-engine dukascopy` rolls back.
Jobs use a separate QDM journal and PostgreSQL advisory locks. CLI symbol/source/
instrument/M1/UTC must match. Creation explicitly selects EURUSD, Dukascopy, M1,
startofbar and internal SQ Default. Adapter does not import that broker profile's
contract sizes/costs as trading authority. Imported datasets are price-only and
retain QDM/version/export hash plus Dukascopy upstream provenance.

CLI exit code 0 alone is rejected when busy/license/error text appears or the
success marker is absent. Early errors cannot disappear behind bounded progress
output. Export is normalized and quality checked before immutable publication.
Updates append verified parent data into a new dataset; old versions remain.
Stop during export cannot publish; subsequent retry can complete from QDM cache.
No forced CLI termination or promise of byte-exact recovery/network retry exists.

Pilot catalog is one verified asset, EUR/USD, not Dukascopy's entire catalog.
Refresh probes CLI/version/readiness and updates download availability too.
QDM byte totals/speed/ETA are unknown. Percent is phase progress, never overall
completion; export/validation can show unknown progress. Pause/cancel are disabled
in row controls and detail dialog because safe mid-command controls are unproven.
The source cell uses QDM, with QuantDataManager in its title/filter/provenance.

## Verification

- `test_qdm_downloads.py`: 9 focused cases; fixture import/update, early errors,
  invalid timezone/data, busy/license, stop/retry, explicit symbol parameters.
- `test_dukascopy_full_downloads.py`: 26 regressions pass after lifecycle reuse.
- Node model/metrics suites: 16 pass. Vite production build passes.
- Opt-in `test_qdm_cli_integration.py`: real licensed CLI + actual FastAPI +
  **disposable loopback PostgreSQL**, 05/10/2026 EUR/USD, 1,438 candles published
  and listed with provider QuantDataManager, category Forex and nonzero size.
  Cross-workspace request denied, unsupported pause denied. DB created/dropped
  by name; no user DB truncate or user-dataset edits. Latest run: 42.485s with
  warm QDM history; `real-api.txt` captures sanitized output.
- Raw normalized CSV SHA256:
  `a0e59a0e6260ec498c013484ae9771496380a2083f958246ab9fc4a2c30dd796`.
  Quality stays **review**, not promoted to verified gap-free history.
- `qa.mjs`: intercepted UI at 1710/768/360, POST download → phase percent →
  unknown export progress → completed catalog reload; no Bid claim or fake
  network speed; disabled controls; busy recovery through refresh; no page
  overflow. Screenshots reviewed. These are fixtures, separate from real API smoke.
- First UI run found an actual state bug: Not downloaded filter hid the job
  immediately after POST. `first-failure.json` retained; fixed by selecting
  Downloading on successful start from that filter. Current `qa.json` passes.

## Operational limits

API 8010 was not restarted by this task; user should run restart-offline-api.bat
to load the default QDM engine and then reload UI. Prior automatic restart action
was denied by tool policy; no alternate stop/start workaround was attempted.
Full-history export/import performance, tick/Bid–Ask precision, more instruments,
QDM broker-profile selection and prop-firm rule integration are not accepted here.
See `docs/quantdatamanager.md` for setup, configuration boundaries and rollback.
GitHub receives adapter/tests/docs/evidence, not vendor installation or credentials.
