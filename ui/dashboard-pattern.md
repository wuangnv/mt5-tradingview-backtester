# Dashboard trial — 03/10/2026

Owner requested a real Dashboard trial before wider page migration. This is a provisional project pattern, not a shared-system release or approval to propagate every layout.

On03/10/2026 the owner approved the rendered trial and requested application across the remaining MT5 pages. The current extension and page-specific choices are in [workspace-patterns.md](workspace-patterns.md); the trial history below remains its reference.

The page has a compact title/session scope/action row, a small replay continuation row, four metrics, one dominant result chart, and at most three recently updated active sessions. Search, archive and metadata management stay in Sessions; detailed filters and reports stay in Analytics. Prop and education are secondary links. Spacing, type and alignment group content; there are no nested cards or colored left accents.

Catalog owns available scopes; `dashboard_session` in the URL owns an explicit selection. Otherwise use a valid remembered playable session, then the newest updated playable session. An explicit missing ID remains unavailable with a recovery action. The stored replay preference changes only on actual replay navigation, not when browsing results.

Results come from the existing workspace-scoped session Analytics read model and reuse `buildAnalyticsModel`. All four metrics refer to the full canonical selected session. Dashboard does not aggregate unlike currencies or inherit an old replay cursor/date filter. Analytics is the place for date/cutoff drilldown. Max drawdown and cumulative P/L describe balance after closed trades; neither describes floating equity or intratrade drawdown.

Changing scopes clears previous numbers; abort guards prevent late replies from replacing the selection. Blocked results hide metrics. Zero, unknown, loading, error, stale and partial states remain distinct. The chart rejects missing/nonsequential balances, wrong starting balance, truncated counts and endpoints inconsistent with net P/L. Money retains cents; absent currency is explicitly shown as account units.

Header and rail icon centers align within one CSS pixel in expanded/collapsed/mobile resting states. The full wordmark and44px menu target remain visible; navigation separators remain absent.

Evidence and independent review are linked from `foundation_v2/evidence/ui-dashboard-pattern-20261003/CHECKPOINT.md`. Future pages can reuse the spacing, typography, action hierarchy and state rules, while their layout follows the task. Keep global/domain layers unchanged until broader adoption is approved and verified.
