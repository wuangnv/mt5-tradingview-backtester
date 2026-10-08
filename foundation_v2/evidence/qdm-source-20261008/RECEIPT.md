# Dukascopy source / QDM download engine — 08/10/2026

Owner corrected the naming: data source is Dukascopy, QDM is the download tool.
UI source column, source filter, catalog drawer and saved dataset details now
show Dukascopy. Drawer and QDM dataset details separately show
`Công cụ tải: QuantDataManager (QDM) · CLI`.

Catalog/download/job metadata includes source and download engine separately.
New imports retain engine alongside upstream in export provenance. Internal
provider identity remains QuantDataManager so QDM jobs/updates cannot attach to
dukascopy-node data. Source filtering uses the upstream; availability, duplicate
catalog suppression and job association use the download engine. Old immutable
QDM manifests render correctly without rewriting files, hashes or dataset IDs.
QDM source rename does not invent Bid pricing or enable pause/cancel controls.

At QDM download, SQ Default and each asset's own default source Instrument remain
in use. Workspace imports price-only OHLC/volume, not QDM broker specifications.
Workspace replay initialization still takes explicit InstrumentSpec/cost model;
this task does not claim default QDM instruments have been wired into execution.
FTMO broker specs/rules need their separately scoped implementation.

Validation:
- 15 focused Python QDM/catalog tests pass (real opt-in is separately run).
- 17 Node model/metrics tests pass: same-source/different-engine filtering and
  job isolation, older imports, explicit metadata, unchanged source objects,
  no invented Bid label and null/error input.
- Vite production build passes.
- Licensed CLI/FastAPI/disposable loopback PostgreSQL integration passes in
  42.112s: 725 assets, explicit Dukascopy source/QDM engine, non-FX symbols,
  real EUR/USD import of 1,438 records on 05/10/2026, UTC provenance with engine,
  cross-workspace denial. Quality remains review; raw hash unchanged from prior
  receipt. No production dataset writes or database truncation.
- Full-catalog UI QA and progress/import UI fixtures both pass at 1710/768/360.
  Full catalog harness consumes sanitized prior real API payload. It covers
  Dukascopy filter -> drawer selection, engine label, pagination/category/search,
  invalid refresh retention/recovery, missing installation and both mode URLs.
  Progress fixture covers download -> phase progress -> completed older dataset,
  Dukascopy source + QDM tool in details, disabled controls and busy recovery.
  Browser calls are intercepted; no real API writes/download calls from UI.
  Representative desktop/mobile screenshots reviewed.

Docs reflect the source/engine boundary and default-instrument scope. Historical
receipts remain unchanged. No user data migration, broker/MT5 invocation, license
change or active API restart was performed. Existing API 8010 needs the manual
restart helper to load backend metadata changes; previous tool-policy restart
rejection was not circumvented. Git contains code and sanitized QA, not QDM
distribution/metadata, license/cookies or price cache.
