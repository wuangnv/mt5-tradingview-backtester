import React, { useEffect, useState } from 'react'
import { buildWorkspaceHref } from './workspaceContext.js'
import { canResumeSession, fetchReplaySessions, recentSessions, rememberSession, sessionNavigationHref } from './sessionCatalog.js'
import { dashboardFilters, dashboardRecentSessions, dashboardPeriod, dashboardPeriodRange, updateDashboardQuery } from './dashboardModel.js'
import DashboardPerformance from './DashboardPerformance.jsx'

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
  const [sort, setSort] = useState(query.get('dashboard_sort') === 'oldest' ? 'oldest' : 'newest')
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
  const matching = dashboardRecentSessions(catalog.items, { search, status, sort })
  const pages = Math.max(1, Math.ceil(matching.length / 6))
  const currentPage = Math.min(page, pages)
  const visible = matching.slice((currentPage - 1) * 6, currentPage * 6)
  const ready = catalog.status === 'ready'
  const href = (item, overrides = {}) => sessionNavigationHref('replay', workspace, query, item, { manage: null, ...overrides })
  const sessionsHref = buildWorkspaceHref('replay', workspace, query, { select: '1', session: null, dataset: null, cursor: null, cutoff: null })
  const newHref = buildWorkspaceHref('replay', workspace, query, { fresh: '1', surface: 'workspace', session: null, dataset: null, cursor: null, cutoff: null, playbook: null, playbook_revision: null, mode: 'Practice' })
  const chosen = catalog.items.find(item => item.record_id === filters.session)
  const paginate = next => { setPage(next); updateDashboardQuery({ dashboard_page: next === 1 ? '' : String(next) }) }
  return <>
    <h1 className="sr-only">Dashboard</h1>
    <nav className="fx-dashboard-quick-actions" aria-label="Bắt đầu luyện tập">
      <a className="fx-dashboard-quick-action is-primary" href={newHref}><ActionIcon kind="backtest" /><span><strong>Backtesting session</strong><small>Tạo phiên backtest</small></span><span className="fx-dashboard-action-arrow" aria-hidden="true">↗</span></a>
      <a className="fx-dashboard-quick-action" href={buildWorkspaceHref('testing', workspace, query)}><ActionIcon kind="prop" /><span><strong>Prop firm session</strong><small>Bắt đầu challenge mô phỏng</small></span><span className="fx-dashboard-action-arrow" aria-hidden="true">↗</span></a>
      <a className="fx-dashboard-quick-action" href={buildWorkspaceHref('learn', workspace, query)}><ActionIcon kind="learn" /><span><strong>Tutorials</strong><small>Học và luyện tập</small></span><span className="fx-dashboard-action-arrow" aria-hidden="true">↗</span></a>
    </nav>
    <DashboardPerformance workspace={workspace} filters={filters} reload={reload} analyticsHref={chosen ? sessionNavigationHref('analytics', workspace, query, chosen, { select: null, surface: 'workspace', mode: null }) : null} controls={<>
      <select aria-label="Phạm vi Performance" value={filters.session} onChange={event => setPerformanceFilters({ ...filters, session: event.target.value })} disabled={!ready}>
        <button type="button" inert><selectedcontent /></button><option value="">Tất cả phiên backtest</option>
        {filters.session && !chosen && <option value={filters.session}>Phiên không còn trong danh mục</option>}
        {recentSessions(catalog.items, { archived: true }).map(item => <option key={item.record_id} value={item.record_id}>{sessionName(item)}{item.archived ? ' · lưu trữ' : ''}</option>)}
      </select>
      <select aria-label="Thời gian Performance" value={period} onChange={event => changePeriod(event.target.value)}><button type="button" inert><selectedcontent /></button><option value="lifetime">Toàn bộ thời gian</option><option value="30d">30 ngày gần nhất</option><option value="90d">90 ngày gần nhất</option><option value="custom">Khoảng tùy chọn</option></select>
    </>} dateControls={period === 'custom' && <div className="fx-dashboard-date-controls"><label>Từ ngày (UTC)<input type="date" value={filters.from} onChange={event => setPerformanceFilters({ ...filters, from: event.target.value })} /></label><label>Đến ngày (UTC)<input type="date" value={filters.to} onChange={event => setPerformanceFilters({ ...filters, to: event.target.value })} /></label></div>} />
    <section className="fx-dashboard-recent" data-testid="dashboard-recent" aria-label="Recent Sessions">
      <div className="fx-dashboard-section-head"><h2>Recent Sessions</h2><a className="fx-dashboard-text-link" href={sessionsHref}>Xem tất cả <span aria-hidden="true">↗</span></a></div>
      <div className="fx-dashboard-recent-toolbar"><label className="fx-dashboard-search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4 4" /></svg><input type="search" aria-label="Tìm phiên gần đây" placeholder="Tìm tên phiên, symbol…" value={search} onChange={event => changeRecent('search', event.target.value, setSearch)} /></label><div className="fx-dashboard-list-filters">
        <select aria-label="Lọc trạng thái phiên" value={status} onChange={event => changeRecent('status', event.target.value, setStatus)}><button type="button" inert><selectedcontent /></button><option value="active">Chưa lưu trữ</option><option value="all">Tất cả trạng thái</option><option value="paused">Tạm dừng</option><option value="running">Đang chạy</option><option value="ready">Sẵn sàng</option><option value="completed">Hoàn thành</option><option value="archived">Đã lưu trữ</option></select>
        <select aria-label="Sắp xếp phiên" value={sort} onChange={event => changeRecent('sort', event.target.value, setSort)}><button type="button" inert><selectedcontent /></button><option value="newest">Mới nhất trước</option><option value="oldest">Cũ nhất trước</option></select>
      </div></div>
      {ready && visible.length ? <><div className="fx-dashboard-session-list">{visible.map(item => <article className={`fx-dashboard-session-row${filters.session === item.record_id ? ' is-selected' : ''}`} key={item.record_id} data-session-id={item.record_id}>
        {canResumeSession(item) ? <a className="fx-dashboard-play" href={href(item, { select: null, surface: 'workspace' })} onClick={() => rememberSession(workspace, item.record_id)} aria-label={`Tiếp tục ${sessionName(item)}`} title="Tiếp tục replay"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 9 6-9 6Z" fill="currentColor" /></svg></a> : <span className="fx-dashboard-session-symbol" aria-hidden="true"><ActionIcon kind="backtest" /></span>}
        <div className="fx-dashboard-session-info"><h3><a href={href(item)}>{sessionName(item)}</a></h3><p>{sessionContext(item)}</p><small>Cập nhật {updatedLabel(item)} · UTC</small></div><span className={`fx-dashboard-session-status${item.archived ? ' is-archived' : ''}`}>{statusLabel(item)}{item.dataset_available !== true && <small>Dataset chưa sẵn sàng</small>}</span>
        <div className="fx-dashboard-row-actions"><button type="button" className="fx-dashboard-result-button" aria-pressed={filters.session === item.record_id} onClick={() => setPerformanceFilters({ ...filters, session: item.record_id })}>Kết quả{filters.session === item.record_id && <span aria-hidden="true"> ✓</span>}</button><details name="dashboard-session-actions" className="fx-dashboard-session-menu" onKeyDown={event => { if (event.key === 'Escape') { event.currentTarget.open = false; event.currentTarget.querySelector('summary').focus() } }} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false }}><summary aria-label={`Thao tác ${sessionName(item)}`} title="Thao tác phiên">⋯</summary><div className="fx-dashboard-menu-items"><a href={href(item, { manage: 'rename', archived: item.archived ? '1' : null })}>Đổi tên</a><a href={href(item, { manage: 'duplicate', archived: item.archived ? '1' : null })}>Tạo bản sao</a><a href={href(item, { manage: 'archive', archived: item.archived ? '1' : null })}>{item.archived ? 'Khôi phục phiên' : 'Lưu trữ phiên'}</a></div></details></div>
      </article>)}</div><div className="fx-dashboard-pagination"><span>{(currentPage - 1) * 6 + 1}–{Math.min(currentPage * 6, matching.length)} / {matching.length} phiên</span><div><button type="button" disabled={currentPage === 1} onClick={() => paginate(currentPage - 1)} aria-label="Trang phiên trước">←</button><span>{currentPage} / {pages}</span><button type="button" disabled={currentPage === pages} onClick={() => paginate(currentPage + 1)} aria-label="Trang phiên sau">→</button></div></div></> : <div className="fx-dashboard-catalog-status" role={catalog.status === 'error' ? 'alert' : 'status'}>{catalog.status === 'loading' ? 'Đang tải danh sách phiên…' : catalog.status === 'error' ? <><p>Chưa tải được danh sách: {catalog.error}</p></> : catalog.items.length ? <>Không có phiên khớp bộ lọc.<button type="button" onClick={() => { setSearch(''); setStatus('active'); setPage(1); updateDashboardQuery({ dashboard_search: '', dashboard_status: '', dashboard_page: '' }) }}>Xóa bộ lọc danh sách</button></> : 'Chưa có phiên. Tạo backtest đầu tiên ở phía trên.'}</div>}
    </section>
  </>
}
