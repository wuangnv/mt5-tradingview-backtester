# Dukascopy metadata catalog cache — 2026-10-08

User requested an instrument list usable offline, without realtime/continuous Internet. User confirmed no Trading Tools key. This slice prepares the official keyed integration and local cache; actual inventory acquisition remains pending that credential.

## Behavior and state

The local imported-history API configures DukascopyCatalog under the artifact root's catalog directory. Existing datasets retain workspace ownership. Provider instrument metadata is public, shared within this local catalog, and confers no historical/quote/trading authority. Ordinary authorized GET reads only cache. Empty configured UI bootstraps once; cached/stale catalog opens never request upstream. Toolbar refresh uses the existing workspace authorization dependency. One backend refresh lock serializes updates; a short memory lock keeps cached reads responsive. Successful responses are validated and public fields atomically saved with UTC retrieval time and SHA256. Failures retain the last valid snapshot.

Key comes from TW_DUKASCOPY_API_KEY in the backend launch process. No VITE config, UI key field, persistent key, shared browser profile, account creation, paid API or live/MT5 integration was added. The documented instrumentList fields do not provide asset category or historical coverage, so those remain unknown. History download controls remain disabled. Seven-day-old metadata gets a stale notice. Rate limiting uses a five-minute cooldown; other calls use 60 seconds. UI cooldown is a local timer, with no polling.

## Verified

- Final Vite build PASS; four existing data-library model tests PASS.
- Ten focused Python tests PASS: missing key/no I/O, cache restart without credentials, malformed/denied/oversized/redirect/error retention, no persisted key/extras, stale reads, cooldown, 5000-item cache round-trip, and nonblocking cached reads during refresh.
- `api_verify.py` PASS: actual FastAPI and PostgreSQL in a newly created disposable loopback database and temporary artifact root; upstream MockTransport only. Denied workspace makes no network/cache write. Authorized refresh persists metadata; subsequent GET/cooldown makes no network request; restart without key reads cache. Temporary database dropped in finally. No user DB touched by this test.
- `verify.mjs` PASS 8 journeys: four real missing-key desktop/mobile light/dark plus four explicitly labeled transport-fixture cases (cache reload, stale, configured bootstrap, failed manual refresh/cooldown). No page errors, forbidden requests or horizontal content overflow. Primary screenshots inspected desktop dark and mobile light.
- Independent review PASS 25 UI fixture journeys and 6 backend probe groups. Runnable evidence and source fingerprints: `independent/REVIEW.md`. Initial oversized-cache proof preserved; repaired to a single sanitized persisted representation, with the normalized list in memory.
- Actual local API restarted with existing imported-history launcher and port8010, no MT5/ticks args. Launcher10552/listener13404 at verification. Actual GET returns0 datasets/0 instruments, configured=false, empty cache. Browser displays missing-key state and disabled refresh truthfully. This is not a successfully fetched catalog.

## Research limits

Anonymous public common/instruments and metadata/HistoryStart requests returned429, with the former explicitly reporting bot blocked and linking the official S3 data-export guide. No retry through alternate identity/header/profile or key extraction was attempted. Official Trading Tools documentation requires a key for instrumentList:
https://www.dukascopy.com/trading-tools/api/documentation/instruments.json

There is no real-key upstream acceptance, full asset count, complete coverage, automated-history-license acceptance or download implementation. The prior successful individual historical-file probe is not treated as perpetual anonymous availability. Next external integration check needs the user's issued key configured locally; credentials must not be sent in chat.

Rollback: revert this focused commit and restart the local API; user datasets/sessions remain unchanged. Cache metadata may be retained offline.
