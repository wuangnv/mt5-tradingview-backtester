# Independent source-select review

PASS: scoped source review and four complete browser journeys (dark/light ×360/1440). No blocking findings.

Run: `node foundation_v2/evidence/catalog-source-20261008/independent/qa.mjs`.

Fixtures contain two Dukascopy assets and three CSV versions representing two distinct CSV assets. Dataset/catalog/download GETs and catalog refresh POST are explicitly mocked. All unrelated mutations, external/provider/live/category APIs and WebSockets are blocked. No actual refresh, dataset/session mutation or broker activity occurred.

One-way synchronization verified: changing outside source to CSV/all/Dukascopy updates the drawer source. Selecting inside source changes neither outside filter nor grid row count. Drawer selection survives close/reopen until an outside source change. Hiding outside filters restores all sources and updates the drawer. Keyboard ArrowDown/End/Enter selects a drawer source; Escape closes the popup before the drawer, and final close returns focus to the opener. Popup fits mobile viewport.

Counts verified distinct provider+instrument identity (all4, CSV2, Dukascopy2), excluding duplicate saved versions. CSV timestamp uses latest saved version11:00 rather than old version09:00 or fallback10:00; all-source timestamp is explicitly labelled Dukascopy03:00. CSV update button is disabled and its click causes zero POSTs; Dukascopy update uses one mocked POST and advances timestamp12:00 without changing the outside source filter/grid membership. Both themes/mobile screenshots were inspected and no document overflow/page errors were observed.

Reviewed DataDeskWorkspace.jsx/FxSelect.jsx/data-library.css/testing-copy.json. Source direction is explicit: effect copies providerFilter to catalogProvider; drawer handler only updates catalogProvider. Provider catalog and underlying asset classes remain unchanged. This acceptance is limited to mocked UI/interaction; no upstream provider freshness/integration claim is made.

Evidence: results.json and source-*.png. No source edits or commits were made by this reviewer.
