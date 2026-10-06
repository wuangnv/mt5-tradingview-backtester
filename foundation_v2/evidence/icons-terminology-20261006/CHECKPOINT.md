# Icons and Vietnamese trading terminology — 06 October 2026

Owner scope: five browser comments and correct Vietnamese backtesting/prop-firm
terminology. This checkpoint covers presentation and copy, not new journal logic.

- Dashboard removes its partial-scope info icon and obsolete tooltip CSS.
  Scope stays in the section's accessible description. Existing calculations,
  partial-state payloads, error/blocked notices and unknown values are unchanged.
- Trades detail and Sessions Journal reuse one 16px notebook SVG from TestingIcon.
  The ledger button still opens its existing inspector; the Journal link still
  navigates to session notes. Detail content is intentionally retained per owner.
- New session includes a separate 16px plus SVG before localized text in actual
  and demo mode, so translation cannot remove the icon.
- A decorative 1×18px divider separates table tools from the filter group.
- Backtesting: Kiểm thử lịch sử; session: Phiên kiểm thử. It describes testing a
  trading method on historical data. Prop firm means a company providing trading
  capital. The app's evaluation simulation is labeled Thử thách cấp vốn, with
  simulated-challenge descriptions retained. No real funding is implied.
  API identifiers, user session names and English copy are unchanged.

Build and 18 focused unit checks pass. Delete recovery browser checks: 11 PASS,
all writes intercepted; no saved session mutation. Independent route, locale,
theme, responsive, icon-geometry and inspector open/close QA is documented in
independent/REVIEW.md and its receipts. Review detected Sessions Journal inheriting
18px from an older rule despite SVG16 attributes; a scoped shared size rule fixes
the rendered geometry. Failed pre-fix runs remain diagnostic evidence.

Demo data remains component-local and actual reads never fall back to demo.
The existing UI/API remain running. This is scoped UI acceptance, not broker,
deployment or whole-product acceptance.
