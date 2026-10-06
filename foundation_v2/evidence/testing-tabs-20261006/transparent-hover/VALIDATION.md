# Text-only hover and continuous Analytics underline

This refinement supersedes the earlier neutral-filled tab hover: the owner now
requires pointer hover to brighten only text/icons. The rail toggle also has no
default or hover fill. Other round controls retain their established surfaces.

On Analytics, the existing parent underline bridges the flex gap and meets the
child-nav underline. That single line extends through both source tabs, including
the inactive source. Selected source text is still driven by `analytics_source`
in the URL. No wrapper, JavaScript measurement or new navigation state was added.
Keyboard focus keeps a visible outline. Light theme retains dark text/line for
contrast; dark theme uses white.

Primary verification:

- `npm run build --prefix foundation_v2/web`: PASS.
- From `foundation_v2/web`,
  `TESTING_QA_OUTPUT=../evidence/testing-tabs-20261006/transparent-hover/smoke node tests/testing-standard.browser.mjs`:
  12 Testing route checks and 2 component reference journeys passed; no writes.
- Existing in-app Analytics tab was refreshed to apply the source update.
- Independent hover, underline geometry, toggle, focus and mobile acceptance is
  recorded in the adjacent review/receipt. Earlier receipts remain historical.
- The root's `menu-final.mjs` also passed 4 stable demo cases (dark/light,
  1377/360px), confirming transparent pointer background/border and retained
  keyboard focus after the final menu specificity correction.

Actual browser QA only reads local services on 5180/8010. No broker, provider,
session mutation or financial calculation acceptance is implied. Raw screenshots
and per-case browser reports remain local evidence.
