# Independent session controls review

Status: **PASS_SCOPED_SESSION_CONTROLS**, after owner corrections. Combined acceptance covers **28 distinct cases**: 27 prior scoped passes plus the 4 affected Dashboard reruns (3 overlap, 1 closes the prior contrast failure).

Verified source/diff and runtime on local 5180. Actual APIs were restricted to GET/HEAD/OPTIONS; external origins, writes and WebSockets were blocked. No user data mutation, source edit, server start or commit performed by reviewer.

- Archive/restore controls and `manage=archive` entry removed from Sessions and Dashboard; action dispatch accepts only supported metadata/duplicate/delete paths. Existing archived data/backend behavior remains present.
- Sessions Delete is visible text with no trash icon. Both actual and demo toolbar buttons, Dashboard delete icons, and enabled confirmation buttons retain the palette danger color before/after hover in dark/light at 1377/360. Delete dialogs require the displayed exact name; tests filled it then closed the dialog without submitting.
- Dashboard filter is 32×32 desktop and 44×44 mobile with a 16px glyph. Expanded status options have no archived action/filter option. Trades actions have `align-items:center`; desktop control centers differ by at most 1px. Mobile actions wrap into separate aligned rows without document overflow.
- Four explicitly intercepted archived fixtures reuse deterministic demo records only in synthetic GET responses: report remains visible, chart action absent, duplicate action disabled, archive deep link opens no action dialog. Final source also hides misleading duplicate-management instructions for archived records.

First run found genuine danger-color cascade failure in default and hover rules; owner fixed through local control-text binding. Harness-only failures were corrected separately: shipped English archived copy differs from initial oracle, and mobile actions intentionally wrap rather than share a single vertical center.

Second stable run retained 27/28 passing cases and one Dashboard dark contrast failure. It exposed legacy `styles.css` card-info color `#7b8790` inherited by names/asset/facts on `#232B30`; owner changed info to the palette text role and facts to muted. Final targeted Dashboard rerun: 4/4 light/dark desktop/mobile passed, both desktop Axe scans clean. The prior run had 5 clean desktop Axe scans plus the retained failure; those failures are not converted to successes retrospectively.

Screenshots reviewed: enabled demo delete confirmation dark desktop, actual Sessions light mobile, archived fixture light mobile, final Dashboard recent dark desktop/light mobile. Danger semantics, readable names, report state and controls look consistent with current system. Latest source pins include `styles.css` and `dashboard-session.css`; prior 27 passes plus final affected 4 passes form the bounded receipt, not a claim that all28 ran on the latest revision.

Reports: `r1-report.json` (retained initial failures), `final/report.json` (27 scoped passes and contrast finding), `final-r3/report.json` (4 final affected passes), `final-receipt.json` (final pins and scope). This review does not independently exercise actual delete/rename writes or accept full product/broker functionality; owner maintains separate mutation test evidence.
