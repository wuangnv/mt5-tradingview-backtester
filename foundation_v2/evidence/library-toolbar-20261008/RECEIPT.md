# Library toolbar and clear defaults — 08/10/2026

Owner reported that selecting All statuses wraps filters beneath search at
1526px; Clear filters is disabled on All but enabled on the default Downloaded.

Reproduced on actual UI5180/API8010. Before: toolbar height 44px on Downloaded,
100px on All statuses; status width grew from 89.47px to 149.22px and the flex
group moved below search. Clear's predicate/reset still used `all` despite the
initial state having been changed to `downloaded`. Baseline JSON/image retained.

Fixed: reserve status width 150px; keep desktop toolbar on one row with flexible
search. Container-width breakpoint <=1164px deliberately puts search above
wrapping filters, independent of selected status. Narrow layouts retain readable
controls and no page overflow. Only this page's styles were changed.
Clear now detects status deviations from Downloaded and resets category/source
to All, status to Downloaded, search to empty and page to 1. Sort remains separate
and is preserved by Clear. Other active filters still enable Clear on Downloaded.

Verification:
- `qa.mjs`: fixtures using prior real QDM catalog payload at 1710/1526/1440/1280/
  768/360. All four status selections keep the toolbar/control y positions and
  heights stable; 1710/1526 search and status share a centerline. Clear/default,
  category/source/search reset, pagination reset, independent sort, reload,
  no document overflow or browser errors pass. Screenshots reviewed at the
  reported width. No fixture download/API mutations.
- `live-qa.mjs`: actual UI5180/API8010 at 1526, source Dukascopy, EUR/USD download
  button enabled; All status/search centerline both y=163, toolbar height 44px;
  Clear restores Downloaded and disables. No non-GET API calls occurred.
- Read-only API checks: 725 catalog entries, engine QuantDataManager, available
  true, catalog error null, no active/existing jobs. No download was started.
- Vite production build and 10 data-library model regressions pass.

Frontend-only fix needs a page reload, no backend/API restart. Code does not
change QDM download settings, broker/Instrument specs, stored datasets or FTMO
rules. User can choose Not downloaded, search EUR/USD and start their own test.
