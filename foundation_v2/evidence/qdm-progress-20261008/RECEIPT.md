# QDM unknown-progress feedback — 08/10/2026

Owner saw a motionless empty bar and three dashes during EUR/USD download.
Read-only API confirmed a running QDM phase job, no error, processing after CSV
export. The phase percent, transfer size, speed and ETA were legitimately unknown.
The UI incorrectly made unknown activity look like an empty 0% bar.

Frontend fix: animate an indeterminate segment for active unknown phase jobs;
do not assign a numeric ARIA value or display a percentage. QDM metadata becomes
a clock with wall time since job creation, not an ETA or active-download duration.
Existing shared timer now ticks for active jobs. Known QDM phase percentages
remain visible; node byte/speed/ETA behavior is unchanged. Paused/failed jobs do
not animate or imply completion. Reduced motion uses a static segment. Existing
tooltip and click-through dialog retain phase details; no status text reintroduced
into the action cell. No API restart or job mutation.

Actual user job completed while verification was running. Read-only service and
live browser show saved EUR/USD dataset, 8,755,235 candles, 140,930,011 replay bytes
(134.4 MiB), dates 05/05/2003–07/10/2026. No error; dataset quality remains
unverified. This confirms import/publication, not independent coverage/price audit.
Live completed screenshot retained; active animation validated on labeled fixture.

Validation: `qa.mjs` covers unknown, 42% known, paused, failed, node and reduced
motion, clock advance, ARIA distinction and processing dialog. Live services
confirm completed row and disappearance of progress; no API writes. Screenshots
reviewed. Vite build and 17 model/metrics tests pass. First attempt's node fixture
had QDM catalog identity, so provider matching correctly hid its job; fixed fixture
source identity and retained failed attempt report separately.
