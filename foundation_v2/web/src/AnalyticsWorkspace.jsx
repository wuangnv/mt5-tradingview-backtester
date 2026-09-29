import React, { useCallback, useEffect, useMemo, useState } from 'react'
import './analytics-story.css'

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
  const providedNet = firstKnown(metrics.net_pnl, metrics.net_profit, result?.net_pnl)
  const netPnl = providedNet ?? netFromLedger(ledger)
  const providedTradeCount = firstKnown(result?.trade_count, metrics.trade_count, metrics.closed_trade_count)
  const tradeCount = providedTradeCount ?? (Array.isArray(result?.ledger) ? ledger.length : null)
  const wins = finite(firstKnown(metrics.wins, metrics.winning_trades)) ? Number(firstKnown(metrics.wins, metrics.winning_trades)) : ledger.filter((trade) => finite(trade?.net_pnl) && Number(trade.net_pnl) > 0).length
  const losses = finite(firstKnown(metrics.losses, metrics.losing_trades)) ? Number(firstKnown(metrics.losses, metrics.losing_trades)) : ledger.filter((trade) => finite(trade?.net_pnl) && Number(trade.net_pnl) < 0).length
  const breakeven = finite(firstKnown(metrics.breakeven, metrics.breakeven_trades)) ? Number(firstKnown(metrics.breakeven, metrics.breakeven_trades)) : (ledger.length ? Math.max(0, ledger.length - wins - losses) : null)
  const providedWinRate = firstKnown(metrics.win_rate_pct, metrics.win_rate, result?.win_rate_pct)
  const winRate = providedWinRate ?? (ledger.length ? (wins / ledger.length) * 100 : null)
  const providedExpectancy = firstKnown(metrics.expectancy, metrics.expectancy_account, metrics.expectancy_net_per_trade)
  const expectancy = providedExpectancy ?? (finite(netPnl) && finite(tradeCount) && Number(tradeCount) > 0 ? Number(netPnl) / Number(tradeCount) : null)
  const rawCurve = Array.isArray(metrics.closed_trade_balance_curve) ? metrics.closed_trade_balance_curve : Array.isArray(metrics.equity_curve) ? metrics.equity_curve : []
  const curve = rawCurve.map((point, index) => ({ index, value: finite(point?.closed_trade_balance ?? point?.balance ?? point?.value ?? point) ? Number(point?.closed_trade_balance ?? point?.balance ?? point?.value ?? point) : null, tradeId: point?.trade_id || null })).filter((point) => point.value !== null)
  const rawDrawdown = Array.isArray(metrics.closed_trade_balance_drawdown_curve) ? metrics.closed_trade_balance_drawdown_curve : []
  let peak = null
  const drawdown = rawDrawdown.length ? rawDrawdown.map((point, index) => ({ index, drawdown: finite(point?.drawdown) ? Number(point.drawdown) : null, drawdownPct: finite(point?.drawdown_pct) ? Number(point.drawdown_pct) : null })) : curve.map((point, index) => { peak = peak === null ? point.value : Math.max(peak, point.value); const value = Math.max(0, peak - point.value); return { index, drawdown: value, drawdownPct: peak ? (value / peak) * 100 : null } })
  const maxDrawdown = firstKnown(metrics.closed_trade_balance_max_drawdown, metrics.max_drawdown, metrics.max_dd) ?? (drawdown.length ? Math.max(...drawdown.map((point) => point.drawdown).filter(Number.isFinite)) : null)
  const observedRange = result?.observed_range || result?.range || {}
  const observedStart = observedRange.start_utc || observedRange.start || observedRange.from_utc || observedRange.from
  const observedEnd = observedRange.end_utc || observedRange.end || observedRange.to_utc || observedRange.to
  const ledgerDates = ledger.flatMap((trade) => [trade?.open_time_utc, trade?.close_time_utc]).filter((value) => finite(value)).map((value) => new Date(Number(value) > 100000000000 ? Number(value) : Number(value) * 1000)).filter((date) => !Number.isNaN(date.getTime())).sort((a, b) => a - b)
  const dateLabel = (value) => { if (!value) return 'N/A'; const date = new Date(value); return Number.isNaN(date.getTime()) ? 'N/A' : new Intl.DateTimeFormat('vi-VN', { dateStyle: 'medium', timeZone: 'UTC' }).format(date) }
  const rows = ledger.map((trade, index) => { const pnl = finite(trade?.net_pnl) ? Number(trade.net_pnl) : null; const dateValue = finite(trade?.close_time_utc) ? Number(trade.close_time_utc) : null; const date = dateValue === null ? null : new Date(dateValue > 100000000000 ? dateValue : dateValue * 1000); return { ...trade, rowIndex: index, tradeId: trade?.trade_id || `trade-${index + 1}`, pnl, outcome: pnl === null ? 'unknown' : pnl > 0 ? 'win' : pnl < 0 ? 'loss' : 'breakeven', source: trade?.source?.session_id || trade?.session_id || trade?.source_id || 'research ledger', closeDate: date && !Number.isNaN(date.getTime()) ? new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeZone: 'UTC' }).format(date) : 'N/A' } })
  const startBalance = firstKnown(metrics.starting_balance, result?.starting_balance, curve[0]?.value)
  const endingBalance = firstKnown(metrics.ending_closed_trade_balance, metrics.ending_balance, curve[curve.length - 1]?.value)
  const strategy = result?.strategy_version || result?.playbook_id || result?.engine_version || 'N/A'
  const range = { start: dateLabel(observedStart || ledgerDates[0]?.toISOString()), end: dateLabel(observedEnd || ledgerDates[ledgerDates.length - 1]?.toISOString()) }
  const takeaway = !tradeCount ? 'Chưa có trade đóng để kể kết quả.' : !finite(netPnl) ? `Đã có ${formatNumber(tradeCount, 0)} trade đóng, nhưng Net P/L chưa được cung cấp nên chưa thể kết luận hiệu suất.` : `Kết quả đang ${Number(netPnl) > 0 ? 'dương' : Number(netPnl) < 0 ? 'âm' : 'đi ngang'} ${formatNumber(netPnl)} sau ${formatNumber(tradeCount, 0)} trade đóng.${finite(maxDrawdown) ? ` Drawdown balance đóng lớn nhất là ${formatNumber(maxDrawdown)}.` : ' Drawdown balance đóng chưa có trong nguồn.'}`
  return {
    result: result || null,
    metrics,
    ledger: rows,
    tradeCount,
    netPnl,
    winRate,
    expectancy,
    maxDrawdown,
    profitFactor: firstKnown(metrics.profit_factor, metrics.profit_factor_after_cost),
    payoffRatio: firstKnown(metrics.payoff_ratio_after_cost, metrics.payoff_ratio),
    wins,
    losses,
    breakeven,
    curve,
    drawdown,
    startBalance,
    endingBalance,
    observed: range,
    strategy,
    sourceHash: result?.dataset_sha256 || result?.artifact_sha256 || 'N/A',
    derivedNet: !finite(providedNet) && finite(netPnl),
    derivedWinRate: !finite(providedWinRate) && finite(winRate),
    derivedExpectancy: !finite(providedExpectancy) && finite(expectancy),
    takeaway,
  }
}

async function readJson(response) {
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(String(payload?.detail || `HTTP ${response.status}`))
  return payload
}

function BalanceEvidence({ model, selectedTradeId, onSelect }) {
  const points = model.curve
  if (points.length < 2) return <div className="as-chart-empty">Chưa có đường balance đóng đủ dữ liệu để vẽ.</div>
  const values = points.map((point) => point.value)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const y = (value) => 92 - ((value - min) / span) * 76
  const x = (index) => (index / Math.max(1, points.length - 1)) * 100
  const line = points.map((point, index) => `${x(index)},${y(point.value)}`).join(' ')
  const knownDrawdowns = model.drawdown.map((point) => Number(point.drawdown)).filter(Number.isFinite)
  const maxDrawdown = knownDrawdowns.length ? Math.max(1, ...knownDrawdowns) : null
  return (
    <div className="as-chart-frame">
      <svg className="as-balance-chart" viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="Closed-trade balance evidence">
        {[20, 44, 68, 92].map((grid) => <line className="as-chart-grid" key={grid} x1="0" x2="100" y1={grid} y2={grid} />)}
        <polyline className="as-balance-line" points={line} />
        {points.map((point, index) => {
          const trade = model.ledger[index - 1]
          const tradeId = point.tradeId || trade?.tradeId || null
          const selected = tradeId && tradeId === selectedTradeId
          return <circle key={`${point.index}-${tradeId || 'start'}`} className={`as-chart-point ${selected ? 'is-selected' : ''}`} cx={x(index)} cy={y(point.value)} r={selected ? 2.2 : 1.4} tabIndex="0" role={tradeId ? 'button' : undefined} aria-label={tradeId ? `${tradeId}, balance ${formatNumber(point.value)}` : `Starting balance ${formatNumber(point.value)}`} onClick={() => tradeId && onSelect(tradeId)} onKeyDown={(event) => { if (tradeId && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onSelect(tradeId) } }} />
        })}
      </svg>
      <div className="as-chart-axis"><span>{formatNumber(min)}</span><span>{formatNumber(max)}</span></div>
      <div className="as-drawdown-strip" aria-label="Closed-trade drawdown">
        {model.drawdown.map((point) => {
          const drawdown = Number(point.drawdown)
          if (!Number.isFinite(drawdown) || maxDrawdown === null) return <span key={point.index} className="as-drawdown-bar is-unknown" title="DD N/A" aria-label="Drawdown chưa có dữ liệu" />
          return <span key={point.index} className="as-drawdown-bar" style={{ '--as-dd-height': `${Math.max(2, (drawdown / maxDrawdown) * 100)}%` }} title={`DD ${formatNumber(drawdown)}`} />
        })}
      </div>
      <div className="as-chart-legend"><span><i className="as-legend-line" /> Balance sau trade đóng</span><span><i className="as-legend-dd" /> Drawdown đóng</span><small>Không phải floating equity · scope UTC</small></div>
    </div>
  )
}

// Kept as a compatibility helper for the legacy route body below while the
// data-story workspace is introduced. It is never used by the exported view.
function StoryMetric({ label, value, detail, source, tone = '' }) {
  return <div className={'as-story-metric ' + tone}><dt>{label}</dt><dd>{value}</dd><small>{detail}</small><em>{source}</em></div>
}

function ContextValue({ label, value, code = false }) {
  const displayValue = value === null || value === undefined || value === '' ? 'N/A' : value
  return <div className="as-context-value"><dt>{label}</dt><dd className={code ? 'as-code' : ''}>{displayValue}</dd></div>
}

function ProvenanceInspector({ model, selectedTrade, journalCount, links }) {
  return (
    <aside className="as-inspector" aria-label="Provenance và drilldown">
      <div className="as-section-head"><div><span className="as-eyebrow">PROVENANCE / DRILL-DOWN</span><h2>{selectedTrade ? selectedTrade.tradeId : 'Nguồn và giới hạn'}</h2></div><span className="as-inspector-state">READ ONLY</span></div>
      {selectedTrade ? (
        <section className="as-inspector-selection" aria-label="Trade detail">
          <div className="as-selection-outcome"><span className={'as-outcome-dot is-' + selectedTrade.outcome} />{selectedTrade.outcome === 'win' ? 'Thắng' : selectedTrade.outcome === 'loss' ? 'Thua' : selectedTrade.outcome === 'breakeven' ? 'Hòa vốn' : 'Chưa xác định'}<strong>{formatNumber(selectedTrade.pnl)}</strong></div>
          <dl className="as-detail-list"><ContextValue label="Đóng (UTC)" value={selectedTrade.closeDate} /><ContextValue label="Side" value={selectedTrade.side} /><ContextValue label="Net R" value={formatNumber(selectedTrade.realized_r, 2, 'R')} /><ContextValue label="Risk budget" value={formatNumber(selectedTrade.planned_risk_budget)} /></dl>
          <p className="as-inspector-note">{selectedTrade.source === 'closed balance curve' ? 'Result chỉ cung cấp trade ID trên balance curve; full ledger record chưa có nên các field còn lại giữ N/A.' : 'Trade được đọc nguyên bản từ research ledger. Chọn Journal để ghi nhận diễn giải riêng; không sửa fill/result trong Analytics.'}</p>
          <details className="as-raw-details"><summary>Xem record gốc</summary><pre>{JSON.stringify(selectedTrade, null, 2)}</pre></details>
        </section>
      ) : <div className="as-inspector-empty">Chọn một điểm trên đường balance hoặc một dòng trade để mở chi tiết.</div>}
      <dl className="as-provenance-list"><ContextValue label="Dataset" value={model.result?.dataset_id} code /><ContextValue label="Artifact SHA" value={model.sourceHash} code /><ContextValue label="Strategy / engine" value={model.strategy} /><ContextValue label="Split" value={model.result?.split} /><ContextValue label="Metric schema" value={model.result?.metrics_schema_version || model.metrics.metric_schema_version} code /><ContextValue label="Observed range" value={model.observed.start + ' → ' + model.observed.end} /><ContextValue label="Journal context" value={journalCount === null ? 'N/A' : journalCount + ' entries'} /></dl>
      <p className="as-limit-note">N/A nghĩa là nguồn chưa cung cấp dữ liệu cần thiết. Research/simulation đang broker locked; không có đường nào gửi lệnh.</p>
      <div className="as-inspector-actions"><a href={links.journal}>Mở Journal →</a>{links.replay && <a href={links.replay}>Mở Replay →</a>}</div>
    </aside>
  )
}

function TradeLedger({ model, selectedTradeId, onSelect }) {
  return <section className="as-ledger-section" aria-label="Trade ledger"><div className="as-section-head"><div><span className="as-eyebrow">TRADE LEDGER</span><h2>{model.ledger.length ? model.ledger.length + ' trade đóng' : 'Chưa có trade ledger'}</h2></div><span className="as-source-note">N/A = source chưa cung cấp</span></div>{!model.ledger.length ? <div className="as-empty-inline">Research result không có ledger để drill-down.</div> : <div className="as-table-wrap"><table className="as-table"><thead><tr><th>Trade</th><th>Đóng UTC</th><th>Source / session</th><th>Net P/L</th><th>Net R</th><th>Kết quả</th></tr></thead><tbody>{model.ledger.map((trade) => <tr key={trade.tradeId} className={trade.tradeId === selectedTradeId ? 'is-selected' : ''} tabIndex="0" role="button" onClick={() => onSelect(trade.tradeId)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(trade.tradeId) } }}><td><code>{trade.tradeId}</code></td><td>{trade.closeDate}</td><td>{trade.source}</td><td className={trade.pnl > 0 ? 'is-positive' : trade.pnl < 0 ? 'is-negative' : ''}>{formatNumber(trade.pnl)}</td><td>{formatNumber(trade.realized_r, 2, 'R')}</td><td><span className={'as-outcome-text is-' + trade.outcome}>{trade.outcome === 'win' ? 'Thắng' : trade.outcome === 'loss' ? 'Thua' : trade.outcome === 'breakeven' ? 'Hòa' : 'N/A'}</span></td></tr>)}</tbody></table></div>}</section>
}

function AnalyticsStoryWorkspace({ workspace = 'tenant-a', query = new URLSearchParams() }) {
  const jobId = query?.get('job') || query?.get('job_id') || ''
  const sessionId = query?.get('session') || query?.get('replay_session') || ''
  const tradeId = query?.get('trade') || query?.get('trade_id') || ''
  const [state, setState] = useState({ status: jobId ? 'loading' : 'idle', payload: null, error: null })
  const [journalCount, setJournalCount] = useState(null)
  const [selectedTradeId, setSelectedTradeId] = useState(tradeId)

  const load = useCallback(async () => {
    if (!jobId) return
    setState((current) => ({ ...current, status: 'loading', error: null }))
    try {
      const response = await fetch('/api/v2/research/jobs/' + encodeURIComponent(jobId), { headers: { 'X-Workspace-Id': workspace } })
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
            return (!sessionId || [source.session_id, source.replay_session_id, source.id].includes(sessionId)) && (!tradeId || [source.trade_id, source.id].includes(tradeId))
          })
          setJournalCount(sessionId || tradeId ? matching.length : items.length)
        }
      })
      .catch(() => { if (!cancelled) setJournalCount(null) })
    return () => { cancelled = true }
  }, [sessionId, tradeId, workspace])

  const result = state.payload?.result || (state.payload?.ledger ? state.payload : null)
  const model = useMemo(() => buildAnalyticsModel(result), [result])
  const selectedTrade = model.ledger.find((trade) => trade.tradeId === selectedTradeId) || (() => {
    const point = model.curve.find((item) => item.tradeId === selectedTradeId)
    return point ? { tradeId: point.tradeId, pnl: null, realized_r: null, planned_risk_budget: null, closeDate: 'N/A', source: 'closed balance curve', outcome: 'unknown', balance: point.value } : null
  })()
  const replayParams = new URLSearchParams({ workspace, view: 'replay' })
  if (sessionId) replayParams.set('session', sessionId)
  const journalParams = new URLSearchParams({ workspace, view: 'journal' })
  if (sessionId) journalParams.set('session', sessionId)
  if (selectedTradeId) journalParams.set('trade', selectedTradeId)
  const researchParams = new URLSearchParams({ workspace, view: 'research' })
  if (jobId) researchParams.set('job', jobId)
  const links = { journal: '/?' + journalParams.toString(), replay: sessionId ? '/?' + replayParams.toString() : '', research: '/?' + researchParams.toString() }

  return <main className="as-page" data-testid="analytics-workspace">
    <header className="as-page-header"><div><span className="as-eyebrow">ANALYTICS / DATA STORY</span><h1>Analytics</h1><p>Đọc từ context → takeaway → bằng chứng → drill-down. Dữ liệu thiếu vẫn giữ nguyên là N/A.</p></div><div className="as-header-status"><span className="as-status-dot" />Research / local · broker locked</div></header>
    <section className="as-context-bar" aria-label="Ngữ cảnh analytics"><dl className="as-context-grid"><ContextValue label="Research job" value={jobId || 'Chưa chọn'} code /><ContextValue label="Replay" value={sessionId || 'Không gắn session'} code /><ContextValue label="Trade focus" value={selectedTradeId || 'Chưa chọn'} code /></dl><div className="as-context-actions"><a href={'/?' + researchParams.toString()}>Mở Research</a>{sessionId && <a href={'/?' + replayParams.toString()}>Mở Replay</a>}<a href={'/?' + journalParams.toString()}>Mở Journal</a></div></section>

    {!jobId && <section className="as-empty-state as-large-empty"><span className="as-eyebrow">START WITH CONTEXT</span><h2>Chưa có research job được chọn</h2><p>Mở Analytics từ một kết quả Research để xem metric, đường balance đóng và trade ledger. Không có dữ liệu thì không dựng số 0 thay thế.</p><a className="as-primary-button" href={'/?' + researchParams.toString()}>Đi tới Research</a></section>}
    {state.status === 'loading' && <div className="as-message" role="status">Đang tải research result…</div>}
    {state.status === 'error' && <div className="as-message as-error" role="alert">Không đọc được research result: {state.error}<button className="as-inline-button" type="button" onClick={load}>Thử lại</button></div>}
    {state.payload && !result && state.status === 'ready' && <section className="as-empty-state as-large-empty"><span className="as-eyebrow">RUN STATUS</span><h2>Job chưa có result</h2><p>Trạng thái hiện tại: {state.payload.status || 'N/A'}. Analytics sẽ kể câu chuyện khi job hoàn tất.</p></section>}

    {result && <>
      <section className="as-story-lead" aria-labelledby="analytics-takeaway"><div><span className="as-eyebrow">TAKEAWAY / ONE CLEAR READ</span><h2 id="analytics-takeaway">{model.takeaway}</h2><p>Phạm vi: {model.result?.dataset_id || 'N/A'} · {model.strategy} · {model.result?.split || 'split N/A'} · {model.observed.start} → {model.observed.end}. Đây là research result, không phải broker performance.</p></div><span className="as-story-badge">N = {finite(model.tradeCount) ? formatNumber(model.tradeCount, 0) : 'N/A'}</span></section>
      <section className="as-scope-strip" aria-label="Phạm vi kết quả"><ContextValue label="Dataset" value={model.result?.dataset_id} code /><ContextValue label="Strategy / playbook" value={model.strategy} /><ContextValue label="Observed UTC" value={model.observed.start + ' → ' + model.observed.end} /><ContextValue label="Mode" value="Research / simulation" /><ContextValue label="Broker" value="Locked" /></section>
      <section className="as-metric-strip" aria-label="Metrics chính"><StoryMetric label="Net P/L" value={formatNumber(model.netPnl)} detail="account units · net" source={model.derivedNet ? 'derived from ledger' : 'research result'} tone={model.netPnl > 0 ? 'is-positive' : model.netPnl < 0 ? 'is-negative' : ''} /><StoryMetric label="Win rate" value={formatNumber(model.winRate, 1, '%')} detail={formatNumber(model.wins, 0) + ' thắng · ' + formatNumber(model.losses, 0) + ' thua · ' + formatNumber(model.breakeven, 0) + ' hòa'} source={model.derivedWinRate ? 'derived from ledger' : 'research result'} /><StoryMetric label="Trades" value={formatNumber(model.tradeCount, 0)} detail="closed-trade ledger" source="research result" /><StoryMetric label="Max DD" value={formatNumber(model.maxDrawdown)} detail="closed-trade balance" source="research result / derived" /></section>
      <section className="as-evidence-grid"><article className="as-evidence-panel"><div className="as-section-head"><div><span className="as-eyebrow">EVIDENCE / BALANCE PATH</span><h2>Closed-trade balance</h2></div><span className="as-source-note">{model.curve.length ? model.curve.length + ' points' : 'N/A'}</span></div><BalanceEvidence model={model} selectedTradeId={selectedTradeId} onSelect={setSelectedTradeId} /><div className="as-secondary-metrics"><div><span>Starting balance</span><strong>{formatNumber(model.startBalance)}</strong></div><div><span>Ending balance</span><strong>{formatNumber(model.endingBalance)}</strong></div><div><span>Expectancy</span><strong>{formatNumber(model.expectancy)}</strong><small>{model.derivedExpectancy ? 'derived from ledger' : 'research result'}</small></div><div><span>Profit factor</span><strong>{formatNumber(model.profitFactor)}</strong><small>gross profit / loss</small></div></div><details className="as-definition"><summary>Cách đọc đường này</summary><p>Đường chỉ nối balance sau từng trade đóng. Dataset hiện tại không cung cấp floating path, nên không gọi đây là equity curve hay intratrade drawdown.</p></details></article><ProvenanceInspector model={model} selectedTrade={selectedTrade} journalCount={journalCount} links={links} /></section>
      <TradeLedger model={model} selectedTradeId={selectedTradeId} onSelect={setSelectedTradeId} />
      <section className="as-next-action" aria-label="Next action"><div><span className="as-eyebrow">NEXT ACTION</span><h2>{selectedTrade ? 'Review ' + selectedTrade.tradeId + ' trong context' : 'Chọn một điểm để tiếp tục review'}</h2><p>{selectedTrade ? 'Đối chiếu ledger với Journal hoặc Replay nếu result có session tương ứng.' : 'Bắt đầu từ một trade hoặc một điểm trên đường balance; số liệu chi tiết mở sau phần takeaway.'}</p></div><div className="as-next-links"><a className="as-primary-button" href={selectedTrade ? links.journal : links.research}>{selectedTrade ? 'Mở Journal' : 'Về Research'}</a>{sessionId && <a className="as-secondary-button" href={links.replay}>Mở Replay</a>}</div></section>
    </>}
  </main>
}

export default AnalyticsStoryWorkspace

