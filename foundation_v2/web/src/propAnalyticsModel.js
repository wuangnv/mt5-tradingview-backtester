// The report's persisted replay cursor owns the challenge's historical scope.
export function propReplayQuery(report, source = new URLSearchParams()) {
  const binding = report?.provenance?.replay_binding, cursor = report?.provenance?.replay_cursor
  if (report?.schema_version !== 'prop-attempt-report-v1' || report.mode !== 'simulation' || report.broker_execution_capability !== false || !binding?.replay_session_id || !Number.isSafeInteger(cursor?.bar_index) || cursor.bar_index < 0) return null
  const query = new URLSearchParams(source)
  for (const key of ['session', 'replay_session', 'job', 'job_id', 'cursor', 'cursor_index', 'cutoff', 'decision_cutoff', 'trade', 'trade_id', 'dataset']) query.delete(key)
  query.set('session', binding.replay_session_id)
  query.set('cursor', String(cursor.bar_index))
  if (!Number.isSafeInteger(binding.last_replay_event_sequence) || binding.last_replay_event_sequence < 0) return null
  query.set('event_sequence', String(binding.last_replay_event_sequence))
  if (binding.dataset_id) query.set('dataset', binding.dataset_id)
  return query
}
import { closeTime } from './sessionPerformanceModel.js'
import { known } from './tradingAnalyticsModel.js'


export function buildPropAnalyticsView(view, report) {
  const binding = report.provenance.replay_binding, provenance = view.provenance || {}
  if (provenance.session_id !== binding.replay_session_id || provenance.dataset_id !== binding.dataset_id || provenance.dataset_sha256 !== binding.dataset_sha256 || provenance.branch_id !== binding.branch_id || provenance.execution_event_sequence !== binding.last_replay_event_sequence || provenance.phase_index !== report.phase.phase_index || (report.phase.currency && provenance.account_currency !== report.phase.currency)) throw new Error('prop_replay_scope_mismatch')
  if (!view.analytics_available) return view
  const start = closeTime(report.attempt.virtual_start_utc)
  if (!start || !known(report.phase.initial_balance) || Number(report.phase.initial_balance) <= 0 || view.ledger.some(row => !Number.isInteger(row.close_phase_index))) throw new Error('prop_phase_scope_unavailable')
  const rows = view.ledger.filter(row => row.close_phase_index === report.phase.phase_index && closeTime(row.close_time_utc) >= start)
  const complete = rows.every(row => known(row.net_pnl))
  let balance = Number(report.phase.initial_balance), peak = balance
  const curve = complete ? [{ closed_trade_balance: balance }] : [], dd = []
  for (const row of complete ? rows : []) {
    balance += Number(row.net_pnl); peak = Math.max(peak, balance)
    curve.push({ closed_trade_balance: balance, trade_id: row.trade_id })
    dd.push({ drawdown: peak - balance, drawdown_pct: peak > 0 ? (peak - balance) / peak * 100 : null })
  }
  return { ...view, ledger: rows, metrics: { starting_balance: Number(report.phase.initial_balance), closed_trade_count: rows.length, net_pnl: complete ? rows.reduce((sum, row) => sum + Number(row.net_pnl), 0) : null, ending_closed_trade_balance: complete ? balance : null, closed_trade_balance_curve: curve, closed_trade_balance_drawdown_curve: dd }, scope: { ...view.scope, selected_trade_count: rows.length, active_filters: true, prop_phase: report.phase.phase_index, balance_curve_scope: 'selected closed trades in report phase and attempt interval replayed from phase initial capital; not account equity; carried positions assigned by close phase' } }
}
