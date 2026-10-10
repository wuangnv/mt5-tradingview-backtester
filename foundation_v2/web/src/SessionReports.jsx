import { navigate } from './clientNavigation.js'
import { useTestingLocale } from './testingLocale.jsx'
import TestingReadState from './TestingReadState.jsx'
import { TestingWelcome, TestingPageSkeleton, TestingResourceNotice } from './TestingPageState.jsx'
import { buildWorkspaceHref } from './workspaceContext.js'
import { useEffect, useMemo, useState } from 'react'
import AnalyticsWorkspace, { analyticsQuery, buildAnalyticsModel, ProvenanceInspector, readAnalyticsFilters } from './AnalyticsWorkspace.jsx'
import { FxAnalyticsFilters } from './FxAnalytics.jsx'
import FxTradeLedger, { TradeInspector } from './FxTradeLedger.jsx'
import SessionFilter from './SessionFilter.jsx'
import { defaultSession, fetchReplaySessions, readLastSession, reportSessions, sessionAnalyticsQuery } from './sessionCatalog.js'
import { DEFAULT_EXTRA_FILTERS, readAnalyticsExtraFilters, validateTradesPagePayload } from './tradingAnalyticsModel.js'
import useReadRefresh from './useReadRefresh.js'

function AggregateTrades({ workspace, ids, query, sessionControl, onClearSessions }) {
  const { t } = useTestingLocale()

  const filters = useMemo(() => readAnalyticsFilters(query), [query])
  const extra = useMemo(() => readAnalyticsExtraFilters(query), [query])
  const [readState, setState] = useState({ status: 'loading', payload: null })
  const [reload, setReload] = useState(0), [selected, setSelected] = useState(''), [paging, setPaging] = useState({ page: 1, pageSize: 10, sort: { key: 'close_time_utc', direction: 'desc' } })
  const params = useMemo(() => {
    const params = analyticsQuery(filters)
    if (ids !== null) params.set('sessions', ids.join(','))
    params.set('page', paging.page); params.set('page_size', paging.pageSize); params.set('sort_key', paging.sort.key); params.set('sort_direction', paging.sort.direction); params.set('extra_filters', JSON.stringify(extra))
    return params.toString()
  }, [ids, filters, extra, paging])
  const state = readState.params === params && readState.workspace === workspace ? readState : { status: 'loading', payload: null, facets: readState.payload?.facets || readState.facets }
  useEffect(() => { setPaging(current => ({ ...current, page: 1 })); setSelected('') }, [workspace, ids])
  useReadRefresh(() => setReload(value => value + 1))
  useEffect(() => {
    const controller = new AbortController()
    setState(current => current.params === params && current.workspace === workspace && current.payload ? { ...current, refreshing: true, error: null } : { status: 'loading', payload: null, params, workspace, facets: current.payload?.facets || current.facets })
    fetch(`/api/v2/replay/trades?${params}`, { headers: { 'X-Workspace-Id': workspace }, signal: controller.signal }).then(async response => {
      const payload = await response.json()
      if (!response.ok) throw Object.assign(new Error(payload.detail || `HTTP ${response.status}`), { status: response.status })
      validateTradesPagePayload(payload)
      if (!controller.signal.aborted) {
        if (readState.params === params && readState.payload?.snapshot_key && readState.payload.snapshot_key !== payload.snapshot_key && paging.page > 1) { setPaging(current => ({ ...current, page: 1 })); return }
        const signature = JSON.stringify([payload.snapshot_key, payload.pagination, payload.ledger])
        setState(current => current.signature === signature && current.params === params && current.workspace === workspace ? { ...current, status: payload.status, refreshing: false, error: null } : { status: payload.status, payload, signature, params, workspace })
      }
    }).catch(error => { if (!controller.signal.aborted) setState(current => current.params === params && current.workspace === workspace && current.payload && ![401,403].includes(error.status) ? { ...current, status: 'stale', refreshing: false, error: error.message } : { status: 'error', error: error.message, payload: null, params, workspace }) })
    return () => controller.abort()
  }, [workspace, params, reload])
  useEffect(() => { setSelected('') }, [workspace, params])
  const changeFilters = patch => {
    const url = new URL(window.location.href)
    const next = { ...readAnalyticsFilters(url.searchParams), ...patch }
    for (const key of ['from_close_utc', 'to_close_utc']) url.searchParams.delete(key)
    for (const [key, value] of Object.entries(next)) value && value !== 'all' ? url.searchParams.set(key, value) : url.searchParams.delete(key)
    setPaging(current => ({ ...current, page: 1 }))
    navigate(url, { replace: true })
  }
  const changeExtra = patch => {
    const url = new URL(window.location.href)
    const next = { ...readAnalyticsExtraFilters(url.searchParams), ...patch }
    for (const [key, value] of Object.entries(next)) {
      const param = key === 'source' ? 'analytics_trade_source' : `analytics_${key}`
      value !== DEFAULT_EXTRA_FILTERS[key] ? url.searchParams.set(param, value) : url.searchParams.delete(param)
    }
    setPaging(current => ({ ...current, page: 1 }))
    navigate(url, { replace: true })
  }
  const model = useMemo(() => {
    const base = buildAnalyticsModel({ ledger: state.payload?.ledger || [], metrics: {}, scope: state.payload?.scope, multi_session: true, account_currency: t('Đơn vị từng phiên'), paged: true })
    return { ...base, ledger: base.ledger.map(row => ({ ...row, tradeId: JSON.stringify([row.session_id, row.trade_id]) })) }
  }, [state.payload, t])
  const row = model.ledger.find(row => row.tradeId === selected)
  useEffect(() => { if (selected && !row) setSelected('') }, [row, selected])
  const detailModel = useMemo(() => buildAnalyticsModel({ ...row?.source_provenance, ledger: row ? [row] : [], metrics: {} }), [row])
  const link = view => {
    const params = new URLSearchParams({ workspace, view, session: row.session_id, trade: row.trade_id })
    if (view === 'replay') { params.set('surface', 'workspace'); params.set('cursor', row.close_cursor_index); params.set('event_sequence', row.close_event_sequence); if (row.source_provenance.dataset_id) params.set('dataset', row.source_provenance.dataset_id) }
    return `/?${params}`
  }
  return <section className="as-page fxa-page wm-page" aria-label={t("Trades")} data-testid="aggregate-trades">
    <FxTradeLedger emptyMessage={state.payload?.pagination.filtered_count === 0 && state.payload.status !== 'partial' && !Object.values(filters).some(value => value && value !== 'all') && Object.entries(extra).every(([key, value]) => value === DEFAULT_EXTRA_FILTERS[key]) ? 'Chưa có giao dịch đóng trong phạm vi này.' : undefined} model={model} extra={extra} selected={selected} onSelect={setSelected} remotePage={{ page: state.payload?.pagination.page || paging.page, pageSize: paging.pageSize, sort: paging.sort, totalCount: state.payload?.pagination.filtered_count ?? null, pending: state.status === 'loading', onChange: patch => setPaging(current => ({ ...current, ...patch })) }} renderFilters={columnControl => <FxAnalyticsFilters filters={filters} onChange={changeFilters} extra={extra} onExtra={changeExtra} rows={model.ledger} facets={state.payload?.facets || state.facets} sessionControl={sessionControl} onClearSessions={onClearSessions} pending={!state.payload} columnControl={columnControl} ledgerOnly />} />
    <TestingResourceNotice state={state.refreshing ? 'refreshing' : state.status === 'stale' ? 'stale' : undefined} resource="bảng giao dịch" onRetry={state.status === 'stale' ? () => setReload(value => value + 1) : undefined} />
    {state.status === 'error' && <TestingReadState error message={t('Không đọc được giao dịch: {error}', { error: state.error })} onRetry={() => setReload(value => value + 1)} />}
    {state.payload?.status === 'partial' && <TestingReadState message={t('Một số phiên chưa đủ dữ liệu; bảng chỉ gồm các giao dịch đã đọc được.')} />}
    {state.payload && <>
      {row && <TradeInspector onClose={() => setSelected('')} className="fxa-trade-inspector" aria-label={t("Chi tiết giao dịch")}><div className="fxa-section-heading"><h2>{t("Trade detail ·")} {row.session_name}</h2><button className="fxa-button" type="button" onClick={() => setSelected('')}>{t("Đóng chi tiết")}</button></div><ProvenanceInspector model={detailModel} selectedTrade={{ ...row, tradeId: row.trade_id }} journalCount={null} links={{ replay: link('replay'), journal: link('journal') }} /></TradeInspector>}
    </>}
  </section>
}

export default function SessionReports({ workspace, query, ledgerOnly = false }) {
  const { t } = useTestingLocale()

  const [catalogState, setCatalog] = useState({ workspace, status: 'loading', items: [] })
  const catalog = catalogState.workspace === workspace ? catalogState : { status: 'loading', items: [] }
  const [scope, setScope] = useState(() => ledgerOnly ? reportSessions(query) : query.get('session') || query.get('replay_session') || '')
  const [reload, setReload] = useState(0)
  useReadRefresh(() => setReload(value => value + 1))
  useEffect(() => {
    const controller = new AbortController()
    setCatalog(current => current.workspace === workspace && ['ready','stale'].includes(current.status) ? { ...current, refreshing: true } : { workspace, status: 'loading', items: [] })
    fetchReplaySessions(workspace, controller.signal).then(items => { if (!controller.signal.aborted) { setCatalog({ workspace, status: 'ready', items }); if (!ledgerOnly) setScope(current => defaultSession(items, current, readLastSession(workspace))) } }).catch(error => { if (!controller.signal.aborted) setCatalog(current => current.workspace === workspace && ['ready','stale'].includes(current.status) && ![401,403].includes(error.status) ? { ...current, status: 'stale', refreshing: false, error: error.message } : { workspace, status: 'error', items: [], error: error.message }) })
    return () => controller.abort()
  }, [workspace, reload, ledgerOnly])
  const change = next => {
    const url = new URL(window.location.href)
    for (const key of ['session', 'replay_session', 'sessions', 'dataset', 'cursor', 'cutoff', 'cursor_index', 'decision_cutoff', 'event_sequence', 'trade', 'trade_id']) url.searchParams.delete(key)
    if (ledgerOnly) { if (next === null) url.searchParams.set('sessions', 'all'); else if (!next.length) url.searchParams.set('sessions', 'none'); else next.forEach(id => url.searchParams.append('sessions', id)) }
    else url.searchParams.set('session', next)
    navigate(url, { replace: true }); setScope(next)
  }
  const control = <SessionFilter items={catalog.items} multiple={ledgerOnly} value={scope} onChange={change} disabled={catalog.status !== 'ready'} />
  const sessionId = ledgerOnly ? scope?.length === 1 ? scope[0] : '' : scope
  const item = catalog.items.find(item => item.record_id === sessionId)
  const scopedQuery = item ? sessionAnalyticsQuery(new URLSearchParams(window.location.search), item) : query
  useEffect(() => {
    if (ledgerOnly || !scope || query.get('session') || query.get('replay_session')) return
    const url = new URL(window.location.href); url.searchParams.set('session', scope); navigate(url, { replace: true })
  }, [scope, ledgerOnly])
  if (catalog.status === 'loading') return <TestingPageSkeleton view={ledgerOnly ? 'trade' : 'analytics'} label="Đang tải danh mục phiên…" />
  if (catalog.status === 'error') return <TestingReadState error message={t('Không tải được danh mục phiên:') + ' ' + t(catalog.error)} onRetry={() => setReload(value => value + 1)} />
  if (!catalog.items.length && !query.get('session') && !query.get('replay_session')) return <TestingWelcome backtestHref={buildWorkspaceHref('overview', workspace, query)} propHref={buildWorkspaceHref('testing', workspace, query)} />
  return <>
    {catalog.status === 'stale' && <TestingReadState message="Dữ liệu danh mục phiên chưa cập nhật." onRetry={() => setReload(value => value + 1)} />}
    {ledgerOnly && !(sessionId && ['cursor', 'cursor_index', 'cutoff', 'decision_cutoff', 'event_sequence', 'trade', 'trade_id'].some(key => new URLSearchParams(window.location.search).has(key))) ? <AggregateTrades workspace={workspace} ids={scope} query={query} sessionControl={control} onClearSessions={() => change(null)} /> : <AnalyticsWorkspace key={`${workspace}:${sessionId}`} workspace={workspace} query={scopedQuery} ledgerOnly={ledgerOnly} sessionName={item?.name || ''} sessionControl={control} />}
  </>
}
