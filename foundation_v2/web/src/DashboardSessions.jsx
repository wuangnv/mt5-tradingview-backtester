import React, { useEffect, useState } from 'react'
import { buildWorkspaceHref } from './workspaceContext.js'
import { canResumeSession, fetchReplaySessions, readLastSession, recentSessions, rememberSession, sessionNavigationHref } from './sessionCatalog.js'
import DashboardPerformance from './DashboardPerformance.jsx'

const statusLabel = item => item.archived ? 'Đã lưu trữ' : ({ paused: 'Tạm dừng', completed: 'Hoàn thành', running: 'Đang chạy', ready: 'Sẵn sàng' }[item.status] || 'Chưa rõ trạng thái')
const sessionName = item => item.name || `Phiên ${item.record_id.slice(0, 8)}`
const sessionContext = item => `${item.instrument_id || 'Chưa rõ symbol'} · ${item.timeframe || 'Chưa rõ timeframe'} · ${Number.isInteger(item.cursor_index) ? `nến #${item.cursor_index}` : 'Chưa rõ vị trí nến'}`

export default function DashboardSessions({ workspace, query }) {
  const [catalog, setCatalog] = useState({ status: 'loading', items: [], error: null })
  const [reload, setReload] = useState(0)
  const [selectedId, setSelectedId] = useState(query.get('dashboard_session') || '')
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
  const sorted = recentSessions(catalog.items)
  const last = catalog.items.find(item => item.record_id === readLastSession(workspace) && canResumeSession(item))
  const defaultSession = last || sorted.find(canResumeSession)
  const selected = catalog.items.find(item => item.record_id === selectedId) || (!selectedId ? defaultSession : null)
  const ready = catalog.status === 'ready'
  const href = (item, overrides = {}) => sessionNavigationHref('replay', workspace, query, item, { manage: null, ...overrides })
  const chartHref = item => href(item, { select: null, surface: 'workspace' })
  const analyticsHref = item => sessionNavigationHref('analytics', workspace, query, item, { select: null, surface: 'workspace', mode: null })
  const sessionsHref = buildWorkspaceHref('replay', workspace, query, { select: '1', surface: null, session: null, dataset: null, cursor: null, cutoff: null, manage: null })
  const choose = item => rememberSession(workspace, item.record_id)
  const selectSession = id => {
    setSelectedId(id)
    const url = new URL(window.location.href)
    if (id) url.searchParams.set('dashboard_session', id)
    else url.searchParams.delete('dashboard_session')
    window.history.replaceState(null, '', url)
  }
  return <>
    <div className="fx-dashboard-toolbar"><h1>Dashboard</h1><div className="fx-dashboard-toolbar-actions">
      <label className="fx-dashboard-scope"><span>Phiên</span><select aria-label="Phiên kết quả" value={selected?.record_id || selectedId} disabled={!ready || !catalog.items.length} onChange={event => selectSession(event.target.value)}>
        {!selected && <option value={selectedId}>{selectedId ? 'Phiên đã chọn không còn trong danh mục' : 'Chưa có phiên'}</option>}
        {recentSessions(catalog.items, { archived: true }).map(item => <option key={item.record_id} value={item.record_id}>{sessionName(item)}{item.archived ? ' · đã lưu trữ' : ''}</option>)}
      </select></label>
      <button className="fx-dashboard-refresh" type="button" onClick={() => setReload(value => value + 1)} disabled={catalog.status === 'loading'} aria-label="Làm mới Dashboard" title="Làm mới Dashboard"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5" /><path d="M6.1 7a7 7 0 0 1 11.5-1L20 9M4 15l2.4 3A7 7 0 0 0 17.9 17" /></svg></button>
      <a className="fx-dashboard-continue" href={sessionsHref}>Tạo phiên <span aria-hidden="true">+</span></a>
    </div></div>
    <section className="fx-dashboard-resume" data-testid="dashboard-resume" aria-label="Tiếp tục phiên replay" aria-busy={!ready && catalog.status === 'loading'}>
      {selected && ready ? <><div className="fx-dashboard-resume-copy"><strong>{sessionName(selected)}</strong><span>{sessionContext(selected)} · {statusLabel(selected)}</span>{selected.description && <details className="fx-dashboard-session-description"><summary>Mô tả phiên</summary><p>{selected.description}</p></details>}</div><div className="fx-dashboard-resume-actions">{canResumeSession(selected) ? <a className="fx-dashboard-text-link" href={chartHref(selected)} onClick={() => choose(selected)}>Tiếp tục replay <span aria-hidden="true">→</span></a> : <a className="fx-dashboard-text-link" href={href(selected)}>Kiểm tra phiên</a>}</div></> : <div role={catalog.status === 'error' ? 'alert' : 'status'}><strong>{catalog.status === 'loading' ? 'Đang tải phiên của bạn…' : catalog.status === 'error' ? 'Chưa đọc được danh mục phiên' : selectedId ? 'Phiên đã chọn không còn trong danh mục.' : catalog.items.length ? 'Chưa có phiên có thể tiếp tục' : 'Bắt đầu phiên replay đầu tiên'}</strong>{catalog.status === 'error' && <p>{catalog.error}</p>}{selectedId && ready && <button className="fx-dashboard-filter" type="button" onClick={() => selectSession('')}>Chọn phiên gần nhất</button>}{catalog.status === 'error' && <button className="fx-dashboard-filter" type="button" onClick={() => setReload(value => value + 1)}>Thử lại danh mục</button>}</div>}
    </section>
    <DashboardPerformance workspace={workspace} session={ready ? selected : null} reload={reload} analyticsHref={selected ? analyticsHref(selected) : sessionsHref} />
    <section className="fx-dashboard-recent" data-testid="dashboard-recent" aria-label="Phiên gần đây">
      <div className="fx-dashboard-section-head"><h2>Phiên gần đây</h2><a className="fx-dashboard-text-link" href={sessionsHref}>Xem tất cả phiên <span aria-hidden="true">↗</span></a></div>
      {ready && sorted.length ? <div className="fx-dashboard-session-list">{sorted.slice(0, 3).map(item => <article className="fx-dashboard-session-row" key={item.record_id} data-session-id={item.record_id}>
        <div className="fx-dashboard-session-info"><h3><a href={href(item)} onClick={() => choose(item)}>{sessionName(item)}</a></h3><p>{sessionContext(item)}</p></div><span className="fx-dashboard-session-status">{statusLabel(item)}{item.dataset_available !== true ? ' · Dataset chưa sẵn sàng' : ''}</span>
        <div className="fx-dashboard-row-actions"><button type="button" className="fx-dashboard-text-link" onClick={() => selectSession(item.record_id)}>Kết quả</button>{canResumeSession(item) && <a className="fx-dashboard-text-link" href={chartHref(item)} onClick={() => choose(item)}>Tiếp tục <span aria-hidden="true">→</span></a>}</div>
      </article>)}</div> : <p className="fx-dashboard-catalog-status">{catalog.status === 'loading' ? 'Đang tải danh sách phiên…' : catalog.status === 'error' ? 'Danh sách chưa khả dụng.' : 'Chưa có phiên đang hoạt động.'}</p>}
    </section>
    <nav className="fx-dashboard-secondary-actions" aria-label="Công cụ luyện tập"><a className="fx-dashboard-text-link" href={buildWorkspaceHref('testing', workspace, query)}>Prop firm session <span aria-hidden="true">↗</span></a><a className="fx-dashboard-text-link" href={buildWorkspaceHref('learn', workspace, query)}>Bài học <span aria-hidden="true">↗</span></a></nav>
  </>
}
