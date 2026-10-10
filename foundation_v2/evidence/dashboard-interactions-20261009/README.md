# Dashboard and library interaction fixes — 2026-10-09

The dashboard session card previously showed an unknown balance whenever
analytics were unavailable, even though current metadata supplied the account
balance. It now reuses session settings' balance priority: portfolio account,
execution balance, configured starting balance, then analytics. Analytics remain
unavailable until their own prerequisites are met. The current owner's session
shows 100,000 USD without fabricating trades or changing financial state.

Expansion previously mounted/unmounted its content immediately. It now retains
content after the first expansion and transitions a grid track and opacity using
the existing 220ms dialog duration/easing. Rapid opposite clicks reverse the
transition; the latest state wins. Hidden content is inert and aria-hidden, and
reduced-motion disables transitions. Action buttons do not toggle the card;
text selection blocks a header click only when the selection belongs to it.
Hover uses the design system hover surface independently of expansion.

The data library retained a default dataset for internal operations and painted
it as selected immediately. Selected styling now applies only while that
dataset's details dialog is open. Closing details restores neutral rows; pointer
hover remains a separate temporary state.

## Verification

- `node --test tests/dashboardModel.test.mjs tests/sessionSettingsModel.test.mjs
  tests/dashboardSessions.test.mjs`: 20 tests passed.
- Production Vite build passed into `.runtime/dashboard-interactions/dist`.
- `node tests/dashboardInteractions.browser.mjs`: actual local GET API checks in
  dark/light at 1710, 1440 and 390px. Six cases passed with no errors or writes.
  Balance is compared with the actual metadata response. Checks cover hover,
  interpolated collapse heights, rapid reversal, keyboard activation, action
  isolation, inert closed panels, reduced-motion, no implicit library selection,
  explicit details selection and neutral appearance after close/pointer leave.
- Independent source and screenshot review approved the scoped changes.

No user session was stepped, modified, created or deleted. No API restart,
database migration or backend change was required. Browser guard blocks all
mutating requests. This receipt covers these interactions, not whole-product
acceptance or a frame-rate benchmark under heavy charts.
