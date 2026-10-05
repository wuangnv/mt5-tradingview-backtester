import React, { useEffect, useState } from 'react'
import { buildWorkspaceHref } from './workspaceContext.js'
import { canResumeSession, fetchReplaySessions, rememberSession, sessionNavigationHref } from './sessionCatalog.js'
import { dashboardFilters, dashboardRecentSessions, dashboardPeriod, dashboardPeriodRange, dashboardNumber, readDashboardAnalytics, updateDashboardQuery } from './dashboardModel.js'
import DashboardPerformance from './DashboardPerformance.jsx'
import FxSelect, { FilterIcon } from './FxSelect.jsx'
import PropAnalytics from './PropAnalytics.jsx'

const statusLabel = item => item.archived ? 'Đã lưu trữ' : ({ paused: 'Tạm dừng', completed: 'Hoàn thành', running: 'Đang chạy', ready: 'Sẵn sàng' }[item.status] || 'Chưa rõ trạng thái')
const sessionName = item => item.name || `Phiên ${item.record_id.slice(0, 8)}`
const sessionContext = item => `${item.instrument_id || 'Chưa rõ symbol'} · ${item.timeframe || 'Chưa rõ timeframe'} · ${Number.isInteger(item.cursor_index) ? `nến #${item.cursor_index}` : 'Chưa rõ vị trí nến'}`
const updatedLabel = item => Number.isFinite(Date.parse(item.updated_at_utc)) ? new Intl.DateTimeFormat('vi-VN', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(item.updated_at_utc)) : 'Chưa rõ ngày cập nhật'

function ActionIcon({ kind }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{kind === 'backtest' ? <path d="M12 4v16M4 12h16" /> : kind === 'prop' ? <><path d="M8 3h8v7a4 4 0 0 1-8 0ZM8 5H4v3a4 4 0 0 0 4 4M16 5h4v3a4 4 0 0 1-4 4M12 14v6M8 21h8" /></> : <><path d="m2 9 10-5 10 5-10 5ZM6 11v6c4 3 8 3 12 0v-6M22 9v7" /></>}</svg>
}

export default function DashboardSessions({ workspace, query }) {
  const [catalog, setCatalog] = useState({ status: 'loading', items: [], error: null })
  const [reload, setReload] = useState(0)
  const [filters, setFilters] = useState(() => dashboardFilters(query))
  const [period, setPeriod] = useState(() => dashboardPeriod(dashboardFilters(query)))
  const [search, setSearch] = useState(query.get('dashboard_search') || '')
  const [status, setStatus] = useState(['paused', 'running', 'ready', 'completed', 'archived', 'all'].includes(query.get('dashboard_status')) ? query.get('dashboard_status') : 'active')
  const [sort, setSort] = useState(['oldest', 'last', 'profit'].includes(query.get('dashboard_sort')) ? query.get('dashboard_sort') : 'newest')
  const [source, setSource] = useState(['prop', 'all'].includes(query.get('dashboard_source')) ? query.get('dashboard_source') : 'backtest')
  const [asset, setAsset] = useState(query.get('dashboard_asset') || ''), [strategy, setStrategy] = useState(query.get('dashboard_strategy') || '')
  const [filtersOpen, setFiltersOpen] = useState(Boolean(asset || strategy || query.get('dashboard_status')))
  const [detailState, setDetailState] = useState({ workspace, items: {}, loading: false, failed: false })
  const details = detailState.workspace === workspace ? detailState.items : {}
  const needsDetails = Boolean(filtersOpen || sort === 'profit' || strategy)
  const [page, setPage] = useState(Math.max(1, Number.parseInt(query.get('dashboard_page'), 10) || 1))
  useEffect(() => {
    const refresh = () => setReload(value => value + 1)
    window.addEventListener('focus', refresh)
    window.addEventListener('online', refresh)
    return () => { window.removeEventListener('focus', refresh); window.removeEventListener('online', refresh) }
  }, [])
  useEffect(() => {
    const controller = new AbortController()
    setCatalog({ status: 'loading', items: [], error: null })
    fetchReplaySessions(workspace, controller.signal).then(items => {
      if (!controller.signal.aborted) setCatalog({ status: 'ready', items, error: null })
    }).catch(error => {
      if (!controller.signal.aborted) setCatalog({ status: 'error', items: [], error: error.message })
    })
    return () => controller.abort()
  }, [workspace, reload])
  useEffect(() => {
    if (catalog.status !== 'ready' || !needsDetails) return
    const controller = new AbortController()
    setDetailState({ workspace, items: {}, loading: true, failed: false })
    Promise.all(catalog.items.map(async item => {
      try {
        const view = await readDashboardAnalytics(workspace, item.record_id, controller.signal)
        return [item.record_id, { strategy: view.provenance?.playbook_id, pnl: view.analytics_available && dashboardNumber(view.metrics?.net_pnl) !== '—' ? Number(view.metrics.net_pnl) : null, currency: view.metrics?.account_currency || view.provenance?.account_currency || null }]
      } catch { return [item.record_id, { unavailable: true }] }
    })).then(values => { if (!controller.signal.aborted) setDetailState({ workspace, items: Object.fromEntries(values), loading: false, failed: values.some(([, value]) => value.unavailable) }) })
    return () => controller.abort()
  }, [workspace, catalog.items, catalog.status, needsDetails])
  const setPerformanceFilters = next => {
    setFilters(next)
    updateDashboardQuery({ dashboard_session: next.session, dashboard_from: next.from, dashboard_to: next.to })
  }
  const changePeriod = value => {
    setPeriod(value)
    if (value !== 'custom') setPerformanceFilters({ ...filters, ...dashboardPeriodRange(value) })
  }
  const changeRecent = (key, value, setter) => {
    setter(value)
    setPage(1)
    updateDashboardQuery({ [`dashboard_${key}`]: value, dashboard_page: '' })
  }
  const matching = dashboardRecentSessions(catalog.items, { search, status, sort, asset, strategy, details })
  const pages = Math.max(1, Math.ceil(matching.length / 6))
  const currentPage = Math.min(page, pages)
  const visible = matching.slice((currentPage - 1) * 6, currentPage * 6)
  const ready = catalog.status === 'ready'
  const href = (item, overrides = {}) => sessionNavigationHref('replay', workspace, query, item, { manage: null, ...overrides })
  const newHref = buildWorkspaceHref('replay', workspace, query, { fresh: '1', surface: 'workspace', session: null, dataset: null, cursor: null, cutoff: null, playbook: null, playbook_revision: null, mode: 'Practice' })
  const chosen = catalog.items.find(item => item.record_id === filters.session)
  const paginate = next => { setPage(next); updateDashboardQuery({ dashboard_page: next === 1 ? '' : String(next) }) }
  const clearFilters = () => { setAsset(''); setStrategy(''); setStatus('active'); setSearch(''); setPage(1); updateDashboardQuery({ dashboard_asset: '', dashboard_strategy: '', dashboard_status: '', dashboard_search: '', dashboard_page: '' }) }
  const performanceControls = <>
    <FxSelect label="Phạm vi Performance" value={source} icon="performance" onChange={value => { setSource(value); updateDashboardQuery({ dashboard_source: value === 'backtest' ? '' : value }) }} options={[{ value: 'backtest', label: 'Backtesting' }, { value: 'battles', label: 'Battles', disabled: true, detail: 'Chưa có nguồn dữ liệu Battles' }, { value: 'prop', label: 'Prop Firm' }, { value: 'all', label: 'All' }]} />
    {source !== 'prop' && <FxSelect label="Thời gian Performance" value={period} icon="calendar" onChange={changePeriod} triggerContent={source === 'all' ? `Backtesting · ${{ '7d': 'Last week', '30d': 'Last month', lifetime: 'Lifetime', custom: 'Khoảng tùy chọn', '90d': '90 ngày gần nhất' }[period]}` : null} options={[{ value: '7d', label: 'Last week' }, { value: '30d', label: 'Last month' }, { value: 'lifetime', label: 'Lifetime' }, { value: 'custom', label: 'Khoảng tùy chọn' }, ...(period === '90d' ? [{ value: '90d', label: '90 ngày gần nhất' }] : [])]} />}
  </>
  const currencies = new Set(matching.map(item => details[item.record_id]).filter(value => value?.pnl != null).map(value => value.currency))
  return <>
    <h1 className="sr-only">Dashboard</h1>
    <nav className="fx-dashboard-quick-actions" aria-label="Bắt đầu luyện tập">
      <a className="fx-dashboard-quick-action is-primary" href={newHref}><ActionIcon kind="backtest" /><span><strong>Backtesting session</strong><small>Tạo phiên backtest</small></span><span className="fx-dashboard-action-arrow" aria-hidden="true">↗</span></a>
      <a className="fx-dashboard-quick-action" href={buildWorkspaceHref('testing', workspace, query)}><ActionIcon kind="prop" /><span><strong>Prop firm session</strong><small>Bắt đầu challenge mô phỏng</small></span><span className="fx-dashboard-action-arrow" aria-hidden="true">↗</span></a>
      <a className="fx-dashboard-quick-action" href={buildWorkspaceHref('learn', workspace, query)}><ActionIcon kind="learn" /><span><strong>Tutorials</strong><small>Học và luyện tập</small></span><span className="fx-dashboard-action-arrow" aria-hidden="true">↗</span></a>
    </nav>
    {source !== 'prop' ? <DashboardPerformance workspace={workspace} filters={filters} reload={reload} controls={performanceControls} sourceHeading={source === 'all' ? 'Backtesting' : null} dateControls={<>{filters.session && <div className="fx-dashboard-selected-session"><span>{chosen ? sessionName(chosen) : 'Phiên đang chọn'}</span><button type="button" aria-label="Bỏ chọn phiên Performance" onClick={() => setPerformanceFilters({ ...filters, session: '' })}>×</button></div>}{period === 'custom' && <div className="fx-dashboard-date-controls"><label>Từ ngày (UTC)<input type="date" value={filters.from} onChange={event => setPerformanceFilters({ ...filters, from: event.target.value })} /></label><label>Đến ngày (UTC)<input type="date" value={filters.to} onChange={event => setPerformanceFilters({ ...filters, to: event.target.value })} /></label></div>}</>} /> : <section className="fx-dashboard-results"><div className="fx-dashboard-section-head"><h2>Performance</h2><div className="fx-dashboard-performance-filters">{performanceControls}</div></div><PropAnalytics workspace={workspace} query={query} embedded /></section>}
    {source === 'all' && <section className="fx-dashboard-prop-section" aria-label="Prop Firm Performance"><h3>Prop Firm</h3><PropAnalytics workspace={workspace} query={query} embedded /></section>}
    <section className="fx-dashboard-recent" data-testid="dashboard-recent" aria-label="Recent Sessions">
      <div className="fx-dashboard-section-head"><h2>Recent Sessions</h2></div>
      <div className="fx-dashboard-recent-toolbar"><label className="fx-dashboard-search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4 4" /></svg><input type="search" aria-label="Tìm phiên gần đây" placeholder="Tìm tên phiên, symbol…" value={search} onChange={event => changeRecent('search', event.target.value, setSearch)} /></label><div className="fx-dashboard-list-filters">
        <button className="fx-dashboard-filter-toggle" type="button" aria-label={filtersOpen ? 'Ẩn bộ lọc phiên' : 'Hiện bộ lọc phiên'} aria-expanded={filtersOpen} onClick={() => { if (filtersOpen) clearFilters(); setFiltersOpen(!filtersOpen) }}>{filtersOpen ? '×' : <FilterIcon kind="filter" />}</button>
        {filtersOpen && <><FxSelect label="Assets" value={asset} onChange={value => changeRecent('asset', value, setAsset)} searchable placeholder="Tìm asset…" options={[{ value: '', label: 'Assets' }, ...[...new Set(catalog.items.map(item => item.instrument_id).filter(Boolean))].sort().map(value => ({ value, label: value }))]} /><FxSelect label="Strategy" value={strategy} onChange={value => changeRecent('strategy', value, setStrategy)} searchable placeholder="Tìm strategy…" disabled={detailState.loading} options={[{ value: '', label: 'Strategy' }, ...[...new Set(Object.values(details).map(value => value.strategy).filter(Boolean))].map(value => ({ value, label: value })), ...(Object.values(details).some(value => value.strategy === null) ? [{ value: 'unassigned', label: 'Chưa gắn strategy' }] : [])]} /><FxSelect label="Trạng thái phiên" value={status} onChange={value => changeRecent('status', value, setStatus)} options={[['active', 'Đang hoạt động'], ['all', 'Tất cả'], ['archived', 'Đã lưu trữ']].map(([value, label]) => ({ value, label }))} /></>}
        <FxSelect label="Sắp xếp phiên" value={sort} icon="sort" onChange={value => changeRecent('sort', value, setSort)} options={[{ value: 'newest', label: 'Newest to oldest' }, { value: 'oldest', label: 'Oldest to newest' }, { value: 'last', label: 'Last updated' }, { value: 'profit', label: 'Most profit' }]} />
      </div></div>
      {sort === 'profit' && detailState.loading && <p role="status">Đang đọc lợi nhuận phiên…</p>}
      {(filtersOpen || sort === 'profit') && detailState.failed && <p role="status">Một số phiên chưa đọc được kết quả; bộ lọc Strategy và lợi nhuận chưa đầy đủ.</p>}
      {sort === 'profit' && (currencies.size > 1 || currencies.has(null)) && <p role="status">Tiền tệ khác nhau hoặc chưa rõ; giữ thứ tự tạo phiên để tránh so sánh lợi nhuận sai.</p>}
      {ready && visible.length ? <><div className="fx-dashboard-session-list">{visible.map(item => <article className={`fx-dashboard-session-row${filters.session === item.record_id ? ' is-selected' : ''}`} key={item.record_id} data-session-id={item.record_id}>
        {canResumeSession(item) ? <a className="fx-dashboard-play" href={href(item, { select: null, surface: 'workspace' })} onClick={() => rememberSession(workspace, item.record_id)} aria-label={`Tiếp tục ${sessionName(item)}`} title="Tiếp tục replay"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 9 6-9 6Z" fill="currentColor" /></svg></a> : <span className="fx-dashboard-session-symbol" aria-hidden="true"><ActionIcon kind="backtest" /></span>}
        <div className="fx-dashboard-session-info"><h3><a href={href(item)}>{sessionName(item)}</a></h3><p>{sessionContext(item)}</p><small>Cập nhật {updatedLabel(item)} · UTC</small></div><span className={`fx-dashboard-session-status${item.archived ? ' is-archived' : ''}`}>{statusLabel(item)}{item.dataset_available !== true && <small>Dataset chưa sẵn sàng</small>}</span>
        <div className="fx-dashboard-row-actions"><button type="button" className="fx-dashboard-result-button" aria-pressed={filters.session === item.record_id} onClick={() => { setSource('backtest'); updateDashboardQuery({ dashboard_source: '' }); setPerformanceFilters({ ...filters, session: item.record_id }) }}>Kết quả{filters.session === item.record_id && <span aria-hidden="true"> ✓</span>}</button><details name="dashboard-session-actions" className="fx-dashboard-session-menu" onKeyDown={event => { if (event.key === 'Escape') { event.currentTarget.open = false; event.currentTarget.querySelector('summary').focus() } }} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false }}><summary aria-label={`Thao tác ${sessionName(item)}`} title="Thao tác phiên">⋯</summary><div className="fx-dashboard-menu-items"><a href={href(item, { manage: 'rename', archived: item.archived ? '1' : null })}>Đổi tên</a><a href={href(item, { manage: 'duplicate', archived: item.archived ? '1' : null })}>Tạo bản sao</a><a href={href(item, { manage: 'archive', archived: item.archived ? '1' : null })}>{item.archived ? 'Khôi phục phiên' : 'Lưu trữ phiên'}</a></div></details></div>
      </article>)}</div>{pages > 1 && <div className="fx-dashboard-pagination"><div><button type="button" disabled={currentPage === 1} onClick={() => paginate(currentPage - 1)} aria-label="Trang phiên trước">‹</button><span aria-label={`Trang ${currentPage} trên ${pages}`}>{currentPage} / {pages}</span><button type="button" disabled={currentPage === pages} onClick={() => paginate(currentPage + 1)} aria-label="Trang phiên sau">›</button></div></div>}</> : <div className="fx-dashboard-catalog-status" role={catalog.status === 'error' ? 'alert' : 'status'}>{catalog.status === 'loading' ? 'Đang tải danh sách phiên…' : detailState.loading && strategy ? 'Đang đọc Strategy của các phiên…' : catalog.status === 'error' ? <><p>Chưa tải được danh sách: {catalog.error}</p></> : catalog.items.length ? <>Không có phiên khớp bộ lọc.<button type="button" onClick={clearFilters}>Xóa bộ lọc danh sách</button></> : 'Chưa có phiên. Tạo backtest đầu tiên ở phía trên.'}</div>}
    </section>
  </>
}
