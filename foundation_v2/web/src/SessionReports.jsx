import React, { useEffect, useMemo, useState } from 'react'
import AnalyticsWorkspace, { analyticsQuery, buildAnalyticsModel, ProvenanceInspector, readAnalyticsFilters } from './AnalyticsWorkspace.jsx'
import { FxAnalyticsFilters } from './FxAnalytics.jsx'
import FxTradeLedger from './FxTradeLedger.jsx'
import SessionFilter from './SessionFilter.jsx'
import { defaultSession, fetchReplaySessions, readLastSession, reportSessions, sessionAnalyticsQuery } from './sessionCatalog.js'
import { filterAnalyticsRows, DEFAULT_EXTRA_FILTERS, readAnalyticsExtraFilters, tradesCsv, validateTradesPayload } from './tradingAnalyticsModel.js'
import useReadRefresh from './useReadRefresh.js'

function AggregateTrades({ workspace, ids, query, sessionControl, onClearSessions }) {
  const [filters, setFilters] = useState(() => readAnalyticsFilters(query))
  const [extra, setExtra] = useState(() => readAnalyticsExtraFilters(query))
  const [state, setState] = useState({ status: 'loading', payload: null })
  const [reload, setReload] = useState(0), [selected, setSelected] = useState(''), [journal, setJournal] = useState([])
  const [exportError, setExportError] = useState('')
  const params = useMemo(() => {
    const params = analyticsQuery(filters)
    if (ids !== null) params.set('sessions', ids.join(','))
    return params.toString()
  }, [ids, filters])
  useReadRefresh(() => setReload(value => value + 1))
  useEffect(() => {
    const controller = new AbortController()
    setState(current => current.params === params && current.workspace === workspace && current.payload ? { ...current, refreshing: true } : { status: 'loading', payload: null })
    fetch(`/api/v2/replay/trades?${params}`, { headers: { 'X-Workspace-Id': workspace }, signal: controller.signal }).then(async response => {
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.detail || `HTTP ${response.status}`)
      validateTradesPayload(payload)
      if (!controller.signal.aborted) {
        const signature = JSON.stringify([payload.status, payload.scope, payload.sources, payload.excluded, payload.ledger])
        setState(current => current.signature === signature && current.params === params && current.workspace === workspace ? { ...current, refreshing: false } : { status: payload.status, payload, signature, params, workspace })
      }
    }).catch(error => { if (!controller.signal.aborted) setState({ status: 'error', error: error.message, payload: null }) })
    fetch('/api/v2/journal', { headers: { 'X-Workspace-Id': workspace }, signal: controller.signal }).then(async response => response.ok ? (await response.json()).items || [] : []).then(items => { if (!controller.signal.aborted) setJournal(current => JSON.stringify(current) === JSON.stringify(items) ? current : items) }).catch(() => { if (!controller.signal.aborted) setJournal([]) })
    return () => controller.abort()
  }, [workspace, params, reload])
  useEffect(() => { setSelected('') }, [workspace, params])
  useEffect(() => {
    const url = new URL(window.location.href)
    for (const key of ['from_close_utc', 'to_close_utc']) url.searchParams.delete(key)
    for (const [key, value] of Object.entries(filters)) value && value !== 'all' ? url.searchParams.set(key, value) : url.searchParams.delete(key)
    for (const [key, value] of Object.entries(extra)) {
      const param = key === 'source' ? 'analytics_trade_source' : `analytics_${key}`
      value !== DEFAULT_EXTRA_FILTERS[key] ? url.searchParams.set(param, value) : url.searchParams.delete(param)
    }
    window.history.replaceState({}, '', url)
  }, [filters, extra])
  const model = useMemo(() => {
    const base = buildAnalyticsModel({ ledger: state.payload?.ledger || [], metrics: {}, scope: state.payload?.scope, multi_session: true, account_currency: 'đơn vị từng phiên' })
    return { ...base, ledger: base.ledger.map(row => ({ ...row, tradeId: JSON.stringify([row.session_id, row.trade_id]), tags: [...new Set([...(row.tags || []), ...journal.flatMap(record => {
      const source = record.payload?.source || {}
      return [source.session_id, source.replay_session_id].includes(row.session_id) && [source.trade_id, source.id].includes(row.trade_id) ? record.payload?.tags || [] : []
    })])] })) }
  }, [state.payload, journal])
  const row = model.ledger.find(row => row.tradeId === selected)
  useEffect(() => { if (selected && !row) setSelected('') }, [row, selected])
  const detailModel = useMemo(() => buildAnalyticsModel({ ...row?.source_provenance, ledger: row ? [row] : [], metrics: {} }), [row])
  const link = view => {
    const params = new URLSearchParams({ workspace, view, session: row.session_id, trade: row.trade_id })
    if (view === 'replay') { params.set('surface', 'workspace'); params.set('cursor', row.close_cursor_index); params.set('event_sequence', row.close_event_sequence); if (row.source_provenance.dataset_id) params.set('dataset', row.source_provenance.dataset_id) }
    return `/?${params}`
  }
  const exportCsv = () => {
    try {
      const rows = filterAnalyticsRows(model.ledger, extra)
      const blob = new Blob([tradesCsv(rows, '', { sessions: JSON.stringify(ids), filters: JSON.stringify({ ...filters, ...extra }), aggregation: state.payload.scope.aggregation })], { type: 'text/csv;charset=utf-8' })
      const url = URL.createObjectURL(blob), anchor = document.createElement('a')
      anchor.href = url; anchor.download = 'trades.csv'; anchor.click(); URL.revokeObjectURL(url); setExportError('')
    } catch (error) { setExportError(`Không tạo được CSV: ${error.message}`) }
  }
  return <section className="as-page fxa-page wm-page" aria-label="Trades" data-testid="aggregate-trades">
    <FxAnalyticsFilters filters={filters} onChange={patch => setFilters(current => ({ ...current, ...patch }))} extra={extra} onExtra={patch => setExtra(current => ({ ...current, ...patch }))} rows={model.ledger} sessionControl={sessionControl} onClearSessions={onClearSessions} onExport={exportCsv} pending={!state.payload} ledgerOnly />
    {state.status === 'loading' && <p role="status">Đang tải giao dịch…</p>}
    {state.status === 'error' && <p role="alert">Không đọc được giao dịch: {state.error}. Sẽ kiểm tra lại khi quay về ứng dụng.</p>}
    {exportError && <p role="alert">{exportError}</p>}
    {state.payload && <>
      {state.payload.excluded.length > 0 && <details className="as-stale-banner"><summary>{state.payload.excluded.length} phiên chưa có dữ liệu khả dụng · đang hiển thị {state.payload.scope.readable_session_count}/{state.payload.scope.session_count} phiên</summary><ul>{state.payload.excluded.map(item => <li key={item.session_id}>{item.session_id} · {item.reason}</li>)}</ul></details>}
      <FxTradeLedger model={model} extra={extra} selected={selected} onSelect={setSelected} />
      <details className="as-scope-details"><summary>Phạm vi và nguồn dữ liệu</summary><p>{state.payload.scope.session_count} phiên · đã loại {state.payload.scope.duplicate_trade_count} giao dịch kế thừa trùng. Tiền và Return (%) theo đơn vị và vốn ban đầu của từng phiên.</p><pre>{JSON.stringify(state.payload.sources, null, 2)}</pre></details>
      {row && <section className="fxa-trade-inspector" aria-label="Chi tiết giao dịch"><div className="fxa-section-heading"><h2>Trade detail · {row.session_name}</h2><button className="fxa-button" type="button" onClick={() => setSelected('')}>Đóng chi tiết</button></div><ProvenanceInspector model={detailModel} selectedTrade={{ ...row, tradeId: row.trade_id }} journalCount={null} links={{ replay: link('replay'), journal: link('journal') }} /></section>}
    </>}
  </section>
}

export default function SessionReports({ workspace, query, ledgerOnly = false }) {
  const [catalog, setCatalog] = useState({ status: 'loading', items: [] })
  const [scope, setScope] = useState(() => ledgerOnly ? reportSessions(query) : query.get('session') || query.get('replay_session') || '')
  const [reload, setReload] = useState(0)
  useReadRefresh(() => setReload(value => value + 1))
  useEffect(() => {
    const controller = new AbortController()
    fetchReplaySessions(workspace, controller.signal).then(items => { if (!controller.signal.aborted) { setCatalog({ status: 'ready', items }); if (!ledgerOnly) setScope(current => defaultSession(items, current, readLastSession(workspace))) } }).catch(error => { if (!controller.signal.aborted) setCatalog({ status: 'error', items: [], error: error.message }) })
    return () => controller.abort()
  }, [workspace, reload, ledgerOnly])
  const change = next => {
    const url = new URL(window.location.href)
    for (const key of ['session', 'replay_session', 'sessions', 'dataset', 'cursor', 'cutoff', 'cursor_index', 'decision_cutoff', 'event_sequence', 'trade', 'trade_id']) url.searchParams.delete(key)
    if (ledgerOnly) { if (next === null) url.searchParams.set('sessions', 'all'); else if (!next.length) url.searchParams.set('sessions', 'none'); else next.forEach(id => url.searchParams.append('sessions', id)) }
    else url.searchParams.set('session', next)
    window.history.replaceState({}, '', url); setScope(next)
  }
  const control = <SessionFilter items={catalog.items} multiple={ledgerOnly} value={scope} onChange={change} disabled={catalog.status !== 'ready'} />
  const sessionId = ledgerOnly ? scope?.length === 1 ? scope[0] : '' : scope
  const item = catalog.items.find(item => item.record_id === sessionId)
  const scopedQuery = item ? sessionAnalyticsQuery(new URLSearchParams(window.location.search), item) : query
  useEffect(() => {
    if (ledgerOnly || !scope || query.get('session') || query.get('replay_session')) return
    const url = new URL(window.location.href); url.searchParams.set('session', scope); window.history.replaceState({}, '', url)
  }, [scope, ledgerOnly])
  return <>
    {catalog.status === 'error' && <p role="alert">Không tải được danh mục phiên: {catalog.error}</p>}
    {ledgerOnly && !(sessionId && ['cursor', 'cursor_index', 'cutoff', 'decision_cutoff', 'event_sequence', 'trade', 'trade_id'].some(key => new URLSearchParams(window.location.search).has(key))) ? <AggregateTrades workspace={workspace} ids={scope} query={query} sessionControl={control} onClearSessions={() => change(null)} /> : <AnalyticsWorkspace key={`${workspace}:${sessionId}`} workspace={workspace} query={scopedQuery} ledgerOnly={ledgerOnly} sessionName={item?.name || ''} sessionControl={control} />}
  </>
}
