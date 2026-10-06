# Neutral workspace tabs and local restart

The existing Vite UI on 5180 was retained. The imported Exness-history API was
restarted on 8010 using `foundation_v2/scripts/serve_exness_history.py --port 8010`,
without MT5 synchronization. Launcher logs/PIDs remain local under
`D:/ANNAM/TradingWorkspace/.artifacts/mt5-local-launch-20261006/`.

Workspace tabs now use neutral hover without a bright pointer border, transparent
selection with contrast text and a 2px underline, and existing 18px SVG icons.
Analytics source tabs remain on the same scrolling row without a vertical divider.
Keyboard focus remains visible. Existing URL parameters still select routes and
Analytics sources; existing theme/language state determines presentation. Dark
theme uses white selection; light theme uses dark selection for contrast.

Verified on 06 October 2026:

- `npm run build`: PASS.
- `TESTING_QA_OUTPUT=../evidence/testing-tabs-20261006/smoke node tests/testing-standard.browser.mjs`:
  12 route checks and 2 component reference journeys passed, no writes.
- `node foundation_v2/evidence/testing-tabs-20261006/dashboard.mjs` from the product
  root: 4 actual Dashboard cases passed (dark/light, 1320/360px); 20 API responses
  returned 200, no page errors, no writes or horizontal document overflow.
- Independent review: 48 Sessions/Analytics cases passed, EN/VI, dark/light,
  demo/actual and 1320/768/360px. Both Analytics sources, pointer hover, keyboard
  focus and horizontal navigation were exercised; 138 API reads had no errors.
- Representative Dashboard and Analytics images were inspected visually. The
  user's existing in-app Dashboard was reloaded and confirmed to show actual data.
- `git diff --check`: PASS.

Curated receipts and replayable scripts are versioned here. Raw per-case reports
and screenshots remain local evidence. Actual browser traffic was restricted to
local GET/HEAD/OPTIONS. This acceptance covers navigation presentation and local
data loading, not financial calculation, broker execution or full-product gates.
