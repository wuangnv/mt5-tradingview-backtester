import React, { useCallback, useEffect, useMemo, useState } from 'react'
import './journal-analytics.css'

function finite(value) {
  return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value))
}

function firstKnown(...values) {
  return values.find((value) => finite(value))
}

function formatDate(value) {
  if (!value) return 'N/A'
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? 'N/A' : new Intl.DateTimeFormat('vi-VN', { dateStyle: 'medium', timeStyle: 'short' }).format(parsed)
}

function formatNumber(value, digits = 2, suffix = '') {
  if (!finite(value)) return 'N/A'
  return `${new Intl.NumberFormat('vi-VN', { maximumFractionDigits: digits }).format(Number(value))}${suffix}`
}

function netFromLedger(ledger) {
  if (!Array.isArray(ledger) || !ledger.length || !ledger.every((trade) => finite(trade?.net_pnl))) return null
  return ledger.reduce((total, trade) => total + Number(trade.net_pnl), 0)
}

export function buildAnalyticsModel(result) {
  const metrics = result?.metrics && typeof result.metrics === 'object' ? result.metrics : {}
  const ledger = Array.isArray(result?.ledger) ? result.ledger : []
  const netPnl = firstKnown(metrics.net_pnl, metrics.net_profit, result?.net_pnl) ?? netFromLedger(ledger)
  const tradeCount = firstKnown(result?.trade_count, metrics.trade_count) ?? (Array.isArray(result?.ledger) ? ledger.length : null)
  const wins = ledger.filter((trade) => finite(trade?.net_pnl) && Number(trade.net_pnl) > 0).length
  const winRate = firstKnown(metrics.win_rate_pct, metrics.win_rate, result?.win_rate_pct)
    ?? (ledger.length ? (wins / ledger.length) * 100 : null)
  const expectancy = firstKnown(metrics.expectancy, metrics.expectancy_account, metrics.expectancy_net_per_trade)
    ?? (finite(netPnl) && finite(tradeCount) && Number(tradeCount) > 0 ? Number(netPnl) / Number(tradeCount) : null)
  return {
    metrics,
    ledger,
    tradeCount,
    netPnl,
    winRate,
    expectancy,
    maxDrawdown: firstKnown(metrics.max_drawdown, metrics.closed_trade_balance_max_drawdown, metrics.max_dd),
    profitFactor: firstKnown(metrics.profit_factor, metrics.profit_factor_after_cost),
    curve: Array.isArray(metrics.closed_trade_balance_curve) ? metrics.closed_trade_balance_curve
      : Array.isArray(metrics.equity_curve) ? metrics.equity_curve : [],
    derivedNet: !finite(firstKnown(metrics.net_pnl, metrics.net_profit, result?.net_pnl)) && finite(netPnl),
    derivedWinRate: !finite(firstKnown(metrics.win_rate_pct, metrics.win_rate, result?.win_rate_pct)) && finite(winRate),
    derivedExpectancy: !finite(firstKnown(metrics.expectancy, metrics.expectancy_account, metrics.expectancy_net_per_trade)) && finite(expectancy),
  }
}

async function readJson(response) {
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(String(payload?.detail || `HTTP ${response.status}`))
  return payload
}

function Sparkline({ points }) {
  const values = points.map((point) => Number(point?.closed_trade_balance ?? point?.value ?? point)).filter(Number.isFinite)
  if (values.length < 2) return <div className="ja-chart-empty">Chưa có equity curve đủ dữ liệu để vẽ.</div>
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const polyline = values.map((value, index) => `${(index / (values.length - 1)) * 100},${100 - ((value - min) / span) * 86 - 7}`).join(' ')
  return (
    <div className="ja-sparkline-wrap">
      <svg className="ja-sparkline" viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="Equity curve">
        <polyline points={polyline} fill="none" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="ja-chart-labels"><span>{formatNumber(min)}</span><span>{formatNumber(max)}</span></div>
    </div>
  )
}

function Metric({ label, value, unit, source }) {
  return (
    <article className="ja-metric">
      <span>{label}</span>
      <strong>{value}</strong>
      {unit && <small>{unit}</small>}
      <em>{source}</em>
    </article>
  )
}

function ledgerDate(value) {
  if (!finite(value)) return 'N/A'
  return new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeZone: 'UTC' }).format(new Date(Number(value) * 1000))
}

export default function AnalyticsWorkspace({ workspace = 'tenant-a', query = new URLSearchParams() }) {
  const jobId = query?.get('job') || query?.get('job_id') || ''
  const sessionId = query?.get('session') || query?.get('replay_session') || ''
  const tradeId = query?.get('trade') || query?.get('trade_id') || ''
  const [state, setState] = useState({ status: jobId ? 'loading' : 'idle', payload: null, error: null })
  const [journalCount, setJournalCount] = useState(null)

  const load = useCallback(async () => {
    if (!jobId) return
    setState((current) => ({ ...current, status: 'loading', error: null }))
    try {
      const response = await fetch(`/api/v2/research/jobs/${encodeURIComponent(jobId)}`, { headers: { 'X-Workspace-Id': workspace } })
      const payload = await readJson(response)
      setState({ status: 'ready', payload, error: null })
    } catch (error) {
      setState({ status: 'error', payload: null, error: String(error.message || error) })
    }
  }, [jobId, workspace])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    let cancelled = false
    fetch('/api/v2/journal', { headers: { 'X-Workspace-Id': workspace } })
      .then((response) => readJson(response))
      .then((payload) => {
        if (!cancelled) {
          const items = Array.isArray(payload.items) ? payload.items : []
          const matching = items.filter((record) => {
            const source = record.payload?.source || {}
            return (!sessionId || [source.session_id, source.replay_session_id, source.id].includes(sessionId))
              && (!tradeId || [source.trade_id, source.id].includes(tradeId))
          })
          setJournalCount(sessionId || tradeId ? matching.length : items.length)
        }
      })
      .catch(() => { if (!cancelled) setJournalCount(null) })
    return () => { cancelled = true }
  }, [sessionId, tradeId, workspace])

  const result = state.payload?.result || (state.payload?.ledger ? state.payload : null)
  const model = useMemo(() => buildAnalyticsModel(result), [result])
  const sourceLabel = (derived) => derived ? 'derived from ledger' : 'research result'
  const replayParams = new URLSearchParams({ workspace, view: 'replay' })
  if (sessionId) replayParams.set('session', sessionId)
  const journalParams = new URLSearchParams({ workspace, view: 'journal' })
  if (sessionId) journalParams.set('session', sessionId)
  if (tradeId) journalParams.set('trade', tradeId)
  const researchParams = new URLSearchParams({ workspace, view: 'research' })
  if (jobId) researchParams.set('job', jobId)

  return (
    <main className="ja-page analytics-page" data-testid="analytics-workspace">
      <header className="ja-page-header">
        <div>
          <span className="ja-eyebrow">FXREPLAY / PERFORMANCE REVIEW</span>
          <h1>Analytics</h1>
          <p>Đọc kết quả từ research ledger, giữ rõ nguồn và không biến dữ liệu thiếu thành số 0.</p>
        </div>
        <div className="ja-header-status"><span className="ja-status-dot" />Research / local · broker locked</div>
      </header>

      <section className="ja-context-bar" aria-label="Ngữ cảnh analytics">
        <div className="ja-context-copy">
          <span className="ja-eyebrow">RESULT CONTEXT</span>
          <strong>{jobId ? `Research job ${jobId}` : 'Chưa chọn research job'}</strong>
          {sessionId && <span>Replay <code>{sessionId}</code></span>}
          {tradeId && <span>Trade <code>{tradeId}</code></span>}
        </div>
        <div className="ja-context-actions">
          <a className="ja-text-link" href={`/?${researchParams.toString()}`}>Mở Research</a>
          {sessionId && <a className="ja-text-link" href={`/?${replayParams.toString()}`}>Mở replay</a>}
          <a className="ja-text-link" href={`/?${journalParams.toString()}`}>Mở Journal</a>
        </div>
      </section>

      {!jobId && (
        <section className="ja-empty-state ja-large-empty">
          <strong>Chưa có research job được chọn</strong>
          <span>Mở Analytics từ một kết quả Research để xem metric, equity curve và trade ledger. Dữ liệu chưa có không được hiển thị thành 0.</span>
          <a className="ja-button ja-button-primary" href={`/?${researchParams.toString()}`}>Đi tới Research</a>
        </section>
      )}
      {state.status === 'loading' && <div className="ja-message" role="status">Đang tải research result…</div>}
      {state.status === 'error' && <div className="ja-message ja-message-error" role="alert">Không đọc được research result: {state.error} <button className="ja-inline-button" type="button" onClick={load}>Thử lại</button></div>}
      {state.payload && !result && state.status === 'ready' && (
        <section className="ja-empty-state ja-large-empty"><strong>Job chưa có result</strong><span>Trạng thái hiện tại: {state.payload.status || 'N/A'}. Analytics sẽ hiện khi job hoàn tất.</span></section>
      )}

      {result && (
        <>
          <section className="ja-metric-grid" aria-label="Metrics research">
            <Metric label="Net P/L" value={formatNumber(model.netPnl)} unit="account units" source={sourceLabel(model.derivedNet)} />
            <Metric label="Win rate" value={formatNumber(model.winRate, 1, '%')} unit="closed trades" source={sourceLabel(model.derivedWinRate)} />
            <Metric label="Trades" value={formatNumber(model.tradeCount, 0)} unit="ledger entries" source="research result" />
            <Metric label="Max drawdown" value={formatNumber(model.maxDrawdown)} unit="account units" source="research result" />
            <Metric label="Expectancy" value={formatNumber(model.expectancy)} unit="account units / trade" source={sourceLabel(model.derivedExpectancy)} />
            <Metric label="Profit factor" value={formatNumber(model.profitFactor)} unit="gross profit / loss" source="research result" />
          </section>
          <section className="ja-analytics-grid">
            <article className="ja-panel ja-equity-panel">
              <div className="ja-section-head"><div><span className="ja-eyebrow">EQUITY</span><strong>Closed-trade balance</strong></div><span className="ja-source-note">{model.curve.length ? `${model.curve.length} points` : 'N/A'}</span></div>
              <Sparkline points={model.curve} />
            </article>
            <aside className="ja-panel ja-provenance-panel">
              <div className="ja-section-head"><div><span className="ja-eyebrow">PROVENANCE</span><strong>Điều kiện đọc số</strong></div></div>
              <dl className="ja-provenance-list">
                <div><dt>Dataset</dt><dd>{result.dataset_id || 'N/A'}</dd></div>
                <div><dt>Strategy / playbook</dt><dd>{result.strategy_version || result.playbook_id || 'N/A'}</dd></div>
                <div><dt>Split</dt><dd>{result.split || 'N/A'}</dd></div>
                <div><dt>Created</dt><dd>{formatDate(result.created_at_utc)}</dd></div>
                <div><dt>Journal context</dt><dd>{journalCount === null ? 'N/A' : `${journalCount} entries`}</dd></div>
              </dl>
              <p className="ja-panel-note">Số liệu chỉ phản ánh ledger/result đang chọn. Không có broker execution authority.</p>
            </aside>
          </section>
          <section className="ja-panel ja-ledger-panel">
            <div className="ja-section-head"><div><span className="ja-eyebrow">TRADE LEDGER</span><strong>{model.ledger.length ? `${model.ledger.length} trades` : 'Chưa có trade ledger'}</strong></div><span className="ja-source-note">`N/A` = source chưa cung cấp</span></div>
            {!model.ledger.length ? <div className="ja-empty-inline">Research result không có ledger để hiển thị.</div> : (
              <div className="ja-table-wrap"><table className="ja-table"><thead><tr><th>Trade</th><th>Side</th><th>Open</th><th>Close</th><th>Net P/L</th><th>R</th><th>Exit</th></tr></thead><tbody>
                {model.ledger.map((trade, index) => <tr key={trade.trade_id || index}><td><code>{trade.trade_id || 'N/A'}</code></td><td>{trade.side || 'N/A'}</td><td>{ledgerDate(trade.open_time_utc)}</td><td>{ledgerDate(trade.close_time_utc)}</td><td className={finite(trade.net_pnl) ? Number(trade.net_pnl) >= 0 ? 'is-positive' : 'is-negative' : ''}>{formatNumber(trade.net_pnl)}</td><td>{formatNumber(trade.realized_r)}</td><td>{trade.exit_reason || trade.exit_model || 'N/A'}</td></tr>)}
              </tbody></table></div>
            )}
          </section>
        </>
      )}
    </main>
  )
}

