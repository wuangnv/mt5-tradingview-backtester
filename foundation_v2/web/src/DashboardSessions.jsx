import React, { useEffect, useState } from 'react'
import { buildWorkspaceHref } from './workspaceContext.js'
import { canResumeSession, fetchReplaySessions, readLastSession, recentSessions, rememberSession, sessionNavigationHref } from './sessionCatalog.js'

const statusLabel = item => item.archived ? 'Đã lưu trữ' : ({ paused: 'Tạm dừng', completed: 'Hoàn thành', running: 'Đang chạy', ready: 'Sẵn sàng' }[item.status] || 'Chưa rõ trạng thái')
const sessionName = item => item.name || `Phiên ${item.record_id.slice(0, 8)}`
const sessionContext = item => `${item.instrument_id || 'Chưa rõ symbol'} · ${item.timeframe || 'Chưa rõ timeframe'} · ${Number.isInteger(item.cursor_index) ? `nến #${item.cursor_index}` : 'Chưa rõ vị trí nến'}`

export default function DashboardSessions({ workspace, query, quickActions }) {
  const [catalog, setCatalog] = useState({ status: 'loading', items: [], error: null })
  const [reload, setReload] = useState(0)
  const [search, setSearch] = useState('')
  const [archived, setArchived] = useState(false)
  const [sort, setSort] = useState('newest')
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
  const resume = last || sorted.find(canResumeSession)
  const matches = recentSessions(catalog.items, { search, archived, sort })
  const ready = catalog.status === 'ready'
  const href = (item, overrides = {}) => sessionNavigationHref('replay', workspace, query, item, { manage: null, ...overrides })
  const chartHref = item => href(item, { select: null, surface: 'workspace' })
  const sessionsHref = buildWorkspaceHref('replay', workspace, query, { select: '1', surface: null, session: null, dataset: null, cursor: null, cutoff: null, manage: null })
  const choose = item => rememberSession(workspace, item.record_id)

  return <>
    <section className="fx-dashboard-resume" data-testid="dashboard-resume" aria-label="Tiếp tục phiên replay" aria-busy={catalog.status === 'loading'}>
      <div className="fx-dashboard-resume-head"><span className="fx-eyebrow">{resume && ready ? last ? 'PHIÊN ĐÃ MỞ GẦN NHẤT' : 'PHIÊN CẬP NHẬT GẦN NHẤT' : 'PHIÊN REPLAY'}</span><button className="fx-dashboard-refresh" type="button" onClick={() => setReload(value => value + 1)} disabled={catalog.status === 'loading'} aria-label="Làm mới danh mục phiên" title="Làm mới danh mục phiên"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5" /><path d="M6.1 7a7 7 0 0 1 11.5-1L20 9M4 15l2.4 3A7 7 0 0 0 17.9 17" /></svg></button></div>
      {resume && ready ? <><div><h1>{sessionName(resume)}</h1><p>{sessionContext(resume)} · {statusLabel(resume)}</p>{resume.description && <p className="fx-dashboard-session-description">{resume.description}</p>}<div className="fx-dashboard-resume-actions"><a className="fx-dashboard-continue" href={chartHref(resume)} onClick={() => choose(resume)}>Tiếp tục replay <span aria-hidden="true">→</span></a><a className="fx-dashboard-text-link" href={sessionNavigationHref('analytics', workspace, query, resume, { select: null, surface: 'workspace', mode: null })} onClick={() => choose(resume)}>Xem kết quả phiên</a></div></div></> : <div><h1>{catalog.status === 'loading' ? 'Đang tải phiên của bạn…' : catalog.status === 'error' ? 'Chưa đọc được danh mục phiên' : catalog.items.length ? 'Chưa có phiên có thể tiếp tục' : 'Bắt đầu phiên replay đầu tiên'}</h1><p>{catalog.status === 'loading' ? 'Đang kiểm tra phiên đã lưu và dữ liệu nguồn.' : catalog.status === 'error' ? `Không tải được danh mục: ${catalog.error}` : catalog.items.length ? 'Phiên đã lưu trữ hoặc dataset chưa sẵn sàng. Mở Sessions để kiểm tra.' : 'Chọn dataset và tạo phiên để bắt đầu luyện tập.'}</p>{catalog.status === 'error' ? <button className="fx-dashboard-filter" type="button" onClick={() => setReload(value => value + 1)}>Thử lại danh mục</button> : ready && <a className="fx-dashboard-text-link" href={sessionsHref}>Mở Sessions</a>}</div>}
    </section>
    {quickActions}
    <section className="fx-dashboard-recent" data-testid="dashboard-recent" aria-label="Phiên gần đây">
      <div className="fx-dashboard-section-head"><h2>Phiên gần đây</h2><a className="fx-dashboard-text-link" href={sessionsHref}>Xem tất cả phiên <span aria-hidden="true">↗</span></a></div>
      {ready && (catalog.items.length > 5 || catalog.items.some(item => item.archived)) && <div className="fx-dashboard-catalog-controls"><label><span>Tìm phiên</span><input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Tên phiên, symbol hoặc timeframe" /></label><label><span>Sắp xếp</span><select value={sort} onChange={event => setSort(event.target.value)}><option value="newest">Cập nhật mới nhất</option><option value="oldest">Cập nhật cũ nhất</option></select></label><label className="fx-dashboard-archive"><input type="checkbox" checked={archived} onChange={event => setArchived(event.target.checked)} />Hiện phiên đã lưu trữ</label></div>}
      <p className="fx-dashboard-catalog-status" role={catalog.status === 'error' ? 'alert' : 'status'}>{catalog.status === 'loading' ? 'Đang tải danh sách phiên…' : catalog.status === 'error' ? 'Danh sách chưa khả dụng. Thử lại danh mục ở trên.' : matches.length ? `Hiển thị ${Math.min(matches.length, 5)}/${matches.length} phiên · sắp theo thời điểm cập nhật` : search || archived ? 'Không có phiên phù hợp bộ lọc.' : 'Chưa có phiên đang hoạt động.'}</p>
      {ready && <div className="fx-dashboard-session-list">{matches.slice(0, 5).map(item => <article className="fx-dashboard-session-row" key={item.record_id} data-session-id={item.record_id}>
        <div className="fx-dashboard-session-info"><h3><a href={href(item)} onClick={() => choose(item)}>{sessionName(item)}</a></h3><p>{sessionContext(item)}</p>{item.description && <p className="fx-dashboard-session-description">{item.description}</p>}<span className="fx-dashboard-session-status">{statusLabel(item)}{item.dataset_available !== true ? ' · Dataset chưa sẵn sàng' : ''}</span></div>
        <div className="fx-dashboard-row-actions">{canResumeSession(item) ? <a className="fx-dashboard-text-link" href={chartHref(item)} onClick={() => choose(item)}>Tiếp tục <span aria-hidden="true">→</span></a> : <a className="fx-dashboard-text-link" href={href(item)}>Xem phiên</a>}
          <details className="fx-dashboard-session-menu" onToggle={event => { if (event.currentTarget.open) event.currentTarget.querySelector('div')?.scrollIntoView({ block: 'nearest', inline: 'nearest' }) }} onKeyDown={event => { if (event.key === 'Escape') { event.currentTarget.open = false; event.currentTarget.querySelector('summary').focus() } }}><summary aria-label={`Quản lý ${sessionName(item)}`}><svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" /></svg></summary><div><a href={href(item, { manage: 'rename' })}>Đổi tên và mô tả</a>{canResumeSession(item) && <a href={href(item, { manage: 'duplicate' })}>Tạo bản sao…</a>}<a href={href(item, { manage: 'archive', archived: item.archived ? '1' : null })}>{item.archived ? 'Khôi phục phiên…' : 'Lưu trữ phiên…'}</a></div></details>
        </div>
      </article>)}</div>}
    </section>
  </>
}
