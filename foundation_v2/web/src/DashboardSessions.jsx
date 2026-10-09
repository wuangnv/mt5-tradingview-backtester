import ProjectDateInput from './ProjectDateInput.jsx'
import TestingReadState, { TestingSkeleton } from './TestingReadState.jsx'
import { useTestingLocale } from './testingLocale.jsx'
import PaginationFooter from './PaginationFooter.jsx'
import { useEffect, useMemo, useRef, useState } from 'react'
import { buildWorkspaceHref } from './workspaceContext.js'
import { deleteSession, readLastSession, sessionMutationError, duplicateSession, fetchReplaySessions, rememberSession, sessionNavigationHref, updateSessionMetadata } from './sessionCatalog.js'
import { dashboardFilters, dashboardRecentSessions, dashboardPeriod, dashboardPeriodRange, dashboardNumber, readDashboardAnalytics, readDashboardDatasets, readDashboardReplayContext, updateDashboardQuery } from './dashboardModel.js'
import { analyticsViewResult, buildAnalyticsModel } from './AnalyticsWorkspace.jsx'
import DashboardPerformance from './DashboardPerformance.jsx'
import DashboardSessionCard from './DashboardSessionCard.jsx'
import { SessionActionDialog } from './SessionActions.jsx'
import SessionSettingsDrawer from './SessionSettingsDrawer.jsx'
import QuickSessionDialog from './QuickSessionDialog.jsx'
import FxSelect, { FilterIcon } from './FxSelect.jsx'
import PropAnalytics from './PropAnalytics.jsx'

function ActionIcon({ kind }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{kind === 'backtest' ? <path d="M12 4v16M4 12h16" /> : kind === 'prop' ? <><path d="M8 3h8v7a4 4 0 0 1-8 0ZM8 5H4v3a4 4 0 0 0 4 4M16 5h4v3a4 4 0 0 1-4 4M12 14v6M8 21h8" /></> : <><path d="m2 9 10-5 10 5-10 5ZM6 11v6c4 3 8 3 12 0v-6M22 9v7" /></>}</svg>
}

const periodLabels = { 'last-week': 'Last week', 'last-month': 'Last month', lifetime: 'Lifetime', custom: 'Khoảng tùy chọn', '7d': '7 ngày gần nhất', '30d': '30 ngày gần nhất', '90d': '90 ngày gần nhất' }

export default function DashboardSessions({ workspace, query, preview = null }) {
  const { t } = useTestingLocale()

  const initialQuery = preview ? new URLSearchParams() : query
  const [catalog, setCatalog] = useState({ status: preview ? 'ready' : 'loading', loaded: Boolean(preview), items: preview?.items || [], error: null })
  const [datasetState, setDatasetState] = useState({ status: preview ? 'ready' : 'loading', loaded: Boolean(preview), items: preview?.datasets || [], error: '' })
  const datasets = datasetState.items
  const [datasetReload, setDatasetReload] = useState(0), [detailReload, setDetailReload] = useState(0)
  const [reload, setReload] = useState(0)
  const [filters, setFilters] = useState(() => dashboardFilters(initialQuery))
  const [period, setPeriod] = useState(() => dashboardPeriod(dashboardFilters(initialQuery)))
  const [search, setSearch] = useState(initialQuery.get('dashboard_search') || '')
  const [sort, setSort] = useState(['oldest', 'last', 'profit'].includes(initialQuery.get('dashboard_sort')) ? initialQuery.get('dashboard_sort') : 'newest')
  const [source, setSource] = useState(['prop', 'all'].includes(initialQuery.get('dashboard_source')) ? initialQuery.get('dashboard_source') : 'backtest')
  const [asset, setAsset] = useState(initialQuery.get('dashboard_asset') || ''), [strategy, setStrategy] = useState(initialQuery.get('dashboard_strategy') || '')
  const [filtersOpen, setFiltersOpen] = useState(Boolean(asset || strategy))
  const [detailState, setDetailState] = useState({ workspace, items: {} })
  const [page, setPage] = useState(Math.max(1, Number.parseInt(initialQuery.get('dashboard_page'), 10) || 1))
  const [dialog, setDialog] = useState(null), [pending, setPending] = useState(false), [mutationError, setMutationError] = useState(''), [notice, setNotice] = useState('')
  const [needsRefresh, setNeedsRefresh] = useState(false)
  const [creating, setCreating] = useState(false)
  const uncertainDelete = useRef(null)
  const cleanDeletedScope = item => {
    if (readLastSession(workspace) === item.record_id) rememberSession(workspace, '')
    const url = new URL(window.location.href)
    if (url.searchParams.get('dashboard_session') === item.record_id) url.searchParams.delete('dashboard_session')
    if ((url.searchParams.get('session') || url.searchParams.get('replay_session')) === item.record_id) {
      for (const key of ['session', 'replay_session', 'dataset', 'cursor', 'cutoff', 'trade', 'trade_id', 'manage']) url.searchParams.delete(key)
      window.location.assign(url.href)
      return
    }
    window.history.replaceState({}, '', url)
    setFilters(current => current.session === item.record_id ? { ...current, session: '' } : current)
  }
  const details = detailState.workspace === workspace ? detailState.items : {}
  const needsAllDetails = Boolean(filtersOpen || sort === 'profit' || strategy)
  const matching = dashboardRecentSessions(catalog.items, { search, sort, asset, strategy, details })
  const pages = Math.max(1, Math.ceil(matching.length / 6)), currentPage = Math.min(page, pages)
  const visible = matching.slice((currentPage - 1) * 6, currentPage * 6)
  const readItems = needsAllDetails ? catalog.items : visible
  const readKey = JSON.stringify(readItems.map(item => [item.record_id, item.revision]))
  const updateQuery = values => { if (!preview) updateDashboardQuery(values) }

  useEffect(() => {
    if (preview) return
    const refresh = () => setReload(value => value + 1)
    window.addEventListener('focus', refresh); window.addEventListener('online', refresh)
    return () => { window.removeEventListener('focus', refresh); window.removeEventListener('online', refresh) }
  }, [preview])

  useEffect(() => {
    if (preview) return
    const controller = new AbortController()
    setCatalog(current => current.loaded ? { ...current, refreshing: true, error: null } : { status: 'loading', loaded: false, items: [], refreshing: true, error: null })
    fetchReplaySessions(workspace, controller.signal).then(items => {
      if (!controller.signal.aborted) {
        setCatalog({ status: 'ready', loaded: true, items, error: null }); setNeedsRefresh(false)
        setDetailState(current => ({ ...current, items: Object.fromEntries(Object.entries(current.items).filter(([id]) => items.some(item => item.record_id === id))) }))
        if (uncertainDelete.current && !items.some(item => item.record_id === uncertainDelete.current.record_id)) {
          cleanDeletedScope(uncertainDelete.current); setDialog(null); setNotice('Đã đối chiếu: phiên không còn trong danh mục.')
        }
        uncertainDelete.current = null
      }
    }).catch(error => {
      if (controller.signal.aborted) return
      const denied = [401, 403].includes(error.status)
      if (denied) { setDialog(null); setCreating(false); setDetailState({ workspace, items: {} }) }
      setCatalog(current => denied ? { status: 'error', loaded: false, items: [], refreshing: false, error: error.message } : { ...current, status: current.loaded ? 'stale' : 'error', refreshing: false, error: error.message })
    })
    return () => controller.abort()
  }, [workspace, reload, preview])

  useEffect(() => {
    if (preview) return
    const controller = new AbortController()
    setDatasetState(current => current.loaded ? { ...current, refreshing: true, error: '' } : { status: 'loading', loaded: false, items: [], error: '' })
    readDashboardDatasets(workspace, controller.signal).then(items => {
      if (!controller.signal.aborted) setDatasetState({ status: 'ready', loaded: true, items, error: '' })
    }).catch(error => {
      if (!controller.signal.aborted) setDatasetState(current => [401, 403].includes(error.status) ? { status: 'error', loaded: false, items: [], error: error.message } : { ...current, status: current.loaded ? 'stale' : 'error', refreshing: false, error: error.message })
    })
    return () => controller.abort()
  }, [workspace, reload, datasetReload, preview])

  useEffect(() => {
    if (catalog.status !== 'ready') return
    const missing = readItems.filter(item => details[item.record_id]?.revision !== item.revision || !['ready', 'error'].includes(details[item.record_id]?.status))
    if (!missing.length) return
    const controller = new AbortController()
    setDetailState(current => ({ workspace, items: { ...(current.workspace === workspace ? current.items : {}), ...Object.fromEntries(missing.map(item => [item.record_id, { revision: item.revision, status: 'loading' }])) } }))
    Promise.all(missing.map(async item => {
      const recordPromise = preview ? Promise.resolve(preview.replayContext(item)) : readDashboardReplayContext(workspace, item, controller.signal).catch(() => null)
      try {
        const payload = preview ? preview.analytics(item, workspace) : await readDashboardAnalytics(workspace, item.record_id, controller.signal)
        const model = payload.analytics_available ? buildAnalyticsModel(analyticsViewResult(payload)) : null
        return [item.record_id, { revision: item.revision, status: 'ready', payload, model, replayRecord: await recordPromise, strategy: payload.provenance?.playbook_id || (await recordPromise)?.payload?.playbook_id, pnl: payload.analytics_available && dashboardNumber(payload.metrics?.net_pnl) !== '—' ? Number(payload.metrics.net_pnl) : null, currency: payload.metrics?.account_currency || payload.provenance?.account_currency || null }]
      } catch { return [item.record_id, { revision: item.revision, status: 'error', unavailable: true, replayRecord: await recordPromise }] }
    })).then(values => { if (!controller.signal.aborted) setDetailState(current => ({ workspace, items: { ...(current.workspace === workspace ? current.items : {}), ...Object.fromEntries(values) } })) })
    return () => controller.abort()
  }, [workspace, catalog.status, readKey, detailReload, preview])

  const retryDetails = id => {
    if (catalogBlocked) return
    setDetailState(current => ({ ...current, items: Object.fromEntries(Object.entries(current.items).filter(([key, entry]) => entry.status !== 'error' || id && key !== id)) }))
    setDetailReload(value => value + 1)
  }

  const previewPayload = useMemo(() => preview?.overview(filters, catalog.items), [preview, filters, catalog.items])
  const setPerformanceFilters = next => { setFilters(next); updateQuery({ dashboard_session: next.session, dashboard_from: next.from, dashboard_to: next.to }) }
  const changePeriod = value => { setPeriod(value); if (value !== 'custom') setPerformanceFilters({ ...filters, ...dashboardPeriodRange(value) }) }
  const changeRecent = (key, value, setter) => { setter(value); setPage(1); updateQuery({ ['dashboard_' + key]: value, dashboard_page: '' }) }
  const clearFilters = () => { setAsset(''); setStrategy(''); setSearch(''); setPage(1); updateQuery({ dashboard_asset: '', dashboard_strategy: '', dashboard_status: '', dashboard_search: '', dashboard_page: '' }) }
  const href = (item, view = 'replay', overrides = {}) => preview
    ? buildWorkspaceHref(view, workspace, query, { demo_session: item.source_record_id || item.record_id, select: '1', analytics_source: 'sessions', ...overrides })
    : sessionNavigationHref(view, workspace, query, item, { manage: null, ...overrides })
  const dialogItem = catalog.items.find(item => item.record_id === dialog?.id)
  const selectedDialog = dialogItem
  const catalogBlocked = !catalog.loaded || catalog.status !== 'ready' || Boolean(catalog.refreshing)
  const openDialog = (mode, item) => { if (catalogBlocked) return; setMutationError(''); setDialog({ mode, id: item.record_id }) }
  const mutate = async (action, item, draft) => {
    if (pending || needsRefresh || catalogBlocked || !['rename', 'duplicate', 'delete'].includes(action)) return
    setPending(true); setMutationError(''); setNotice('')
    try {
      if (preview) {
        const now = new Date().toISOString()
        setCatalog(current => ({ ...current, items: action === 'delete' ? current.items.filter(entry => entry.record_id !== item.record_id) : action === 'duplicate' ? [...current.items, { ...item, source_record_id: item.source_record_id || item.record_id, record_id: 'demo-copy-' + crypto.randomUUID(), name: item.name + ' (copy)', revision: 1, created_at_utc: now, updated_at_utc: now }] : current.items.map(entry => entry.record_id === item.record_id ? { ...entry, name: draft.name.trim(), description: draft.description, revision: entry.revision + 1, updated_at_utc: now } : entry) }))
      } else {
        const result = action === 'delete' ? await deleteSession(workspace, item, draft) : action === 'duplicate' ? await duplicateSession(workspace, item) : await updateSessionMetadata(workspace, item, { name: draft.name.trim(), description: draft.description })
        if (action === 'duplicate' && (typeof result.record_id !== 'string' || !result.record_id)) throw new Error('Phản hồi tạo bản sao thiếu session id.')
        setCatalog(current => ({ ...current, refreshing: true })); setReload(value => value + 1)
      }
      if (action === 'delete' && !preview) cleanDeletedScope(item)
      setDialog(null)
      setNotice((action === 'delete' ? 'Đã xóa phiên' : action === 'rename' ? 'Đã lưu thay đổi' : 'Đã tạo bản sao') + (preview ? ' trong bản xem thử.' : '.'))
    } catch (error) {
      const uncertain = !error.status || error.status >= 500
      if (action === 'delete' && (uncertain || error.status === 404)) uncertainDelete.current = item
      setMutationError(error.message === 'replay_linked_to_prop_attempt' || error.message === 'session_delete_confirmation_mismatch' ? sessionMutationError(error) : error.status === 409 ? 'Phiên đã thay đổi ở nơi khác. Đang đọc revision mới; kiểm tra rồi lưu lại.' : uncertain ? 'Chưa xác định thao tác đã được lưu hay chưa. Đang đối chiếu danh mục; kiểm tra trước khi thử lại.' : 'Không lưu được phiên: ' + error.message)
      if ((error.status === 409 && error.message !== 'replay_linked_to_prop_attempt') || uncertain || error.status === 404) { setNeedsRefresh(true); setReload(value => value + 1) }
    } finally { setPending(false) }
  }
  const performanceControls = <>
    <FxSelect label={t("Phạm vi Performance")} value={source} icon="performance" onChange={value => { setSource(value); updateQuery({ dashboard_source: value === 'backtest' ? '' : value }) }} options={[{ value: 'backtest', label: 'Backtesting' }, { value: 'battles', label: 'Battles', disabled: true, detail: 'Chưa có nguồn dữ liệu Battles' }, { value: 'prop', label: 'Prop Firm' }, { value: 'all', label: 'All' }]} />
    {source !== 'prop' && <FxSelect label={t("Thời gian Performance")} value={period} icon="calendar" onChange={changePeriod} triggerContent={source === 'all' ? t('Backtesting') + ' · ' + t(periodLabels[period]) : null} options={['last-week', 'last-month', 'lifetime', 'custom', ...(['7d', '30d', '90d'].includes(period) ? [period] : [])].map(value => ({ value, label: periodLabels[value] }))} />}
  </>
  const currencies = new Set(matching.map(item => details[item.record_id]).filter(value => value?.pnl != null).map(value => value.currency))
  const detailsLoading = catalog.items.some(item => !details[item.record_id] || details[item.record_id].status === 'loading')
  const detailFailed = catalog.items.some(item => details[item.record_id]?.unavailable)
  const propReport = preview ? preview.propReport : <PropAnalytics workspace={workspace} query={query} embedded />

  return <>
    <h1 className="sr-only">{t("Dashboard")}</h1>
    <nav className="fx-dashboard-quick-actions" aria-label={t("Bắt đầu luyện tập")}>
      {preview ? <><button type="button" className="fx-dashboard-quick-action is-primary" disabled><ActionIcon kind="backtest" /><span><strong>{t("Backtesting session")}</strong><small>{t("Tạo phiên backtest")}</small></span></button><button type="button" className="fx-dashboard-quick-action" disabled><ActionIcon kind="prop" /><span><strong>{t("Prop firm session")}</strong><small>{t("Bắt đầu challenge mô phỏng")}</small></span></button></> : <><button type="button" className="fx-dashboard-quick-action is-primary" onClick={() => setCreating(true)}><ActionIcon kind="backtest" /><span><strong>{t("Backtesting session")}</strong><small>{t("Tạo phiên backtest")}</small></span></button><a className="fx-dashboard-quick-action" href={buildWorkspaceHref('testing', workspace, query)}><ActionIcon kind="prop" /><span><strong>{t("Prop firm session")}</strong><small>{t("Bắt đầu challenge mô phỏng")}</small></span></a></>}
      <a className="fx-dashboard-quick-action" href={buildWorkspaceHref('learn', workspace, query)}><ActionIcon kind="learn" /><span><strong>{t("Tutorials")}</strong><small>{t("Học và luyện tập")}</small></span></a>
    </nav>
    {source !== 'prop' ? <DashboardPerformance workspace={workspace} filters={filters} reload={reload} previewPayload={previewPayload} controls={performanceControls} sourceHeading={source === 'all' ? t("Backtesting") : null} dateControls={<>{filters.session && <div className="fx-dashboard-selected-session"><span>{catalog.items.find(item => item.record_id === filters.session)?.name || t("Phiên đang chọn")}</span><button type="button" aria-label={t("Bỏ chọn phiên Performance")} onClick={() => setPerformanceFilters({ ...filters, session: '' })}>×</button></div>}{period === 'custom' && <div className="fx-dashboard-date-controls"><label><span>{t("Từ ngày (UTC)")}</span><ProjectDateInput type="date" value={filters.from} onChange={event => setPerformanceFilters({ ...filters, from: event.target.value })} /></label><label><span>{t("Đến ngày (UTC)")}</span><ProjectDateInput type="date" value={filters.to} onChange={event => setPerformanceFilters({ ...filters, to: event.target.value })} /></label></div>}</>} /> : <section className="fx-dashboard-results"><div className="fx-dashboard-section-head"><h2>{t("Performance")}</h2><div className="fx-dashboard-performance-filters">{performanceControls}</div></div>{propReport}</section>}
    {source === 'all' && <section className="fx-dashboard-prop-section" aria-label={t("Prop Firm Performance")}><h3>{t("Prop Firm")}</h3>{propReport}</section>}
    <section className="fx-dashboard-recent" data-testid="dashboard-recent" data-state={catalog.status} aria-busy={catalog.status === 'loading' || Boolean(catalog.refreshing)} aria-label={t("Recent Sessions")}>
      <div className="fx-dashboard-section-head"><h2>{t("Recent Sessions")}</h2></div>
      <div className="fx-dashboard-recent-toolbar"><label className="fx-dashboard-search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4 4" /></svg><input type="search" aria-label={t("Tìm phiên gần đây")} placeholder={t("Tìm tên phiên, symbol…")} value={search} onChange={event => changeRecent('search', event.target.value, setSearch)} /></label><div className="fx-dashboard-list-filters">
        <button className="fx-dashboard-filter-toggle" type="button" aria-label={filtersOpen ? t("Ẩn bộ lọc phiên") : t("Hiện bộ lọc phiên")} aria-expanded={filtersOpen} onClick={() => { if (filtersOpen) clearFilters(); setFiltersOpen(!filtersOpen) }}>{filtersOpen ? '×' : <FilterIcon kind="filter" />}</button>
        {filtersOpen && <><FxSelect label={t("Assets")} triggerContent={t("Assets")} value={asset} onChange={value => changeRecent('asset', value, setAsset)} searchable placeholder={t("Tìm asset…")} options={[{ value: '', label: 'Tất cả assets' }, ...[...new Set(catalog.items.map(item => item.instrument_id).filter(Boolean))].sort().map(value => ({ value, label: value, localize: false }))]} /><FxSelect label={t("Strategy")} triggerContent={t("Strategy")} value={strategy} onChange={value => changeRecent('strategy', value, setStrategy)} searchable placeholder={t("Tìm strategy…")} disabled={detailsLoading} options={[{ value: '', label: 'Tất cả strategies' }, ...[...new Set(catalog.items.map(item => details[item.record_id]).filter(Boolean).map(value => value.strategy).filter(Boolean))].map(value => ({ value, label: value, localize: false })), ...(catalog.items.some(item => details[item.record_id]?.strategy === null) ? [{ value: 'unassigned', label: 'Chưa gắn strategy' }] : [])]} /></>}
        <FxSelect label={t("Sắp xếp phiên")} value={sort} icon="sort" onChange={value => changeRecent('sort', value, setSort)} options={[{ value: 'newest', label: 'Newest to oldest' }, { value: 'oldest', label: 'Oldest to newest' }, { value: 'last', label: 'Last updated' }, { value: 'profit', label: 'Most profit' }]} />
      </div></div>
      {catalog.loaded && <div className="fx-dashboard-session-count" role="status"><span>{t("{count} of {total} sessions", { count: matching.length, total: catalog.items.length })}</span><progress aria-label={t("Phiên khớp bộ lọc")} value={matching.length} max={Math.max(1, catalog.items.length)} /></div>}
      {catalog.loaded && catalog.refreshing ? <p role="status">{t('Đang cập nhật danh mục…')}</p> : catalog.status === 'stale' && <TestingReadState message="Dữ liệu chưa cập nhật." onRetry={() => setReload(value => value + 1)} />}
      {notice && <p className="fx-dashboard-action-notice" role="status">{t(notice)}</p>}
      {sort === 'profit' && detailsLoading && <p role="status">{t("Đang đọc lợi nhuận phiên…")}</p>}
      <div data-testid="dashboard-dataset-state" data-state={datasetState.status} aria-busy={datasetState.status === 'loading' || Boolean(datasetState.refreshing)}>
        {datasetState.loaded && datasetState.refreshing ? <p role="status">{t('Đang cập nhật…')}</p> : datasetState.status === 'stale' && <TestingReadState message="Thông tin dữ liệu chưa cập nhật." onRetry={() => setDatasetReload(value => value + 1)} />}
        {datasetState.status === 'error' && <TestingReadState error message={t('Chưa đọc được thông tin dữ liệu:') + ' ' + t(datasetState.error)} onRetry={() => setDatasetReload(value => value + 1)} />}
      </div>
      {(filtersOpen || sort === 'profit') && detailFailed && <TestingReadState message="Một số phiên chưa đọc được kết quả; bộ lọc Strategy và lợi nhuận chưa đầy đủ." onRetry={catalogBlocked ? undefined : () => retryDetails()} />}
      {sort === 'profit' && (currencies.size > 1 || currencies.has(null)) && <p role="status">{t("Tiền tệ khác nhau hoặc chưa rõ; giữ thứ tự tạo phiên để tránh so sánh lợi nhuận sai.")}</p>}
      {catalog.loaded && visible.length ? <><div className="fx-dashboard-session-list">{visible.map(item => <DashboardSessionCard key={item.record_id} item={item} detail={details[item.record_id]?.revision === item.revision ? details[item.record_id] : null} dataset={datasets.find(dataset => dataset.dataset_id === item.dataset_id)} preview={Boolean(preview)} href={(view, overrides) => href(item, view, overrides)} onManage={openDialog} onRetryDetail={catalogBlocked ? undefined : () => retryDetails(item.record_id)} actionsDisabled={pending || needsRefresh || catalogBlocked} onRemember={() => rememberSession(workspace, item.record_id)} />)}</div>{pages > 1 && <PaginationFooter label="Phân trang phiên gần đây" page={currentPage} pages={pages} onPageChange={value => { setPage(value); updateQuery({ dashboard_page: String(value) }) }} />}</> : <div className="fx-dashboard-catalog-status">{catalog.status === 'loading' ? <TestingSkeleton label="Đang tải danh sách phiên…" /> : detailsLoading && strategy ? t("Đang đọc Strategy của các phiên…") : catalog.status === 'error' ? <TestingReadState error message={t('Chưa tải được danh sách:') + ' ' + t(catalog.error)} onRetry={() => setReload(value => value + 1)} /> : catalog.items.length ? <div role="status">{t("Không có phiên khớp bộ lọc.")}<button type="button" onClick={clearFilters}>{t("Xóa bộ lọc danh sách")}</button></div> : <p role="status">{t("Chưa có phiên. Tạo backtest đầu tiên ở phía trên.")}</p>}</div>}
    </section>
    {selectedDialog && (dialog.mode === 'rename' ? <SessionSettingsDrawer key={dialog.id} item={selectedDialog} dataset={datasets.find(entry => entry.dataset_id === selectedDialog.dataset_id)} payload={details[selectedDialog.record_id]?.payload} model={details[selectedDialog.record_id]?.model} replayRecord={details[selectedDialog.record_id]?.replayRecord} workspace={workspace} preview={Boolean(preview)} pending={pending} blocked={needsRefresh || catalogBlocked} error={mutationError} onClose={() => setDialog(null)} onSubmit={draft => mutate('rename', selectedDialog, draft)} /> : <SessionActionDialog key={dialog.mode + ':' + dialog.id} mode={dialog.mode} item={selectedDialog} preview={Boolean(preview)} pending={pending} blocked={needsRefresh || catalogBlocked} error={mutationError} onClose={() => setDialog(null)} onSubmit={mutate} />)}
    {creating && !preview && <QuickSessionDialog workspace={workspace} query={query} sessions={catalog.items} onClose={() => setCreating(false)} />}
  </>
}
