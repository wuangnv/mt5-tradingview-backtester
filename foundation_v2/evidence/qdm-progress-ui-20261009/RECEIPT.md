# Hide unsupported QDM download telemetry

Owner request: remove download size, network throughput and ETA from the UI when the QDM adapter does not provide them.

Verified contract: QdmDownloads._public always supplies progress_scope=phase and transferred_bytes=null. The adapter reports phase progress, not overall transferred bytes. This does not establish what the standalone QDM GUI can display.

Changes: phase-scoped grid progress retains its bar, with no transfer/ETA placeholders in visible text, accessible name or tooltip. The progress dialog also omits unsupported transfer size and overall completed-day counters for those jobs. Saved dataset size remains available. Day-scoped downloader telemetry is retained.

Validation: 7 browser cases passed via tests/qdmProgress.browser.mjs (known/unknown QDM phase progress and native telemetry at 1710/360px, dialog behavior, live saved file size). All fixture API calls are GET; live API mutations are blocked. Reviewed the desktop screenshot. Seven existing download metric tests, npm run build and git diff --check passed. No QDM command, new download, API restart or backend contract change.
