# Dialog close controls and compact session tabs — 09/10/2026

The Dashboard's generic 44px minimum button height inflated session tabs to
52px and the close control to 44px. The session-type selector now declares its
compact dimensions: 28px buttons, 36px group, 65px header on desktop. Coarse
pointers retain 44px targets.

Explicit `wm-dialog-close` actions share a transparent, borderless surface;
hover/active only changes the icon color. Keyboard focus remains visible.
The role is applied to Quick Session, session settings/actions, data dialogs,
ledger filters, Help, Live preview and the chart order modal. No form state,
API contract, dataset or session mutation behavior changes.

Build passed. [Browser report](report.json) records 16 passing cases: seven
actual dialog/drawer types in both dark/light themes, plus mobile mouse/touch.
Checks cover no hover background/border/shadow, color feedback, stable geometry,
keyboard focus, closing and session-type switching. Live preview and chart order
modal class wiring was source-reviewed and built, not exercised in this run.
All API mutations were blocked during browser QA; no user data changed.

Reviewed [desktop](quick-dark.png) and [mobile](quick-mobile-mouse.png).
