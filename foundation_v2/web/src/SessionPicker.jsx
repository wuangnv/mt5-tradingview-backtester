import React, { useEffect, useMemo, useRef, useState } from 'react'
import AnalyticsWorkspace from './AnalyticsWorkspace.jsx'
import { buildWorkspaceHref } from './workspaceContext.js'
import { duplicateSession, fetchReplaySessions, readLastSession, rememberSession, sessionAnalyticsQuery, sessionNavigationHref, updateSessionMetadata } from './sessionCatalog.js'
import './session-picker.css'

function unknownValue(value, fallback = 'Chưa rõ') {
  return value === null || value === undefined || String(value).trim() === '' ? fallback : String(value)
}

function datasetAvailabilityLabel(value) {
  return value === true ? 'Dataset sẵn sàng' : value === false ? 'Dataset không khả dụng' : 'Chưa rõ dataset'
}

function timeframeLabel(item) {
  if (item?.timeframe) return item.timeframe
  return Number.isFinite(item?.timeframe_seconds) && item.timeframe_seconds > 0 ? `${item.timeframe_seconds}s` : 'Chưa rõ khung thời gian'
}

function sessionOptionLabel(item) {
  return `${item.name || item.record_id} · ${unknownValue(item.instrument_id)} ${timeframeLabel(item)}${item.archived ? ' · Đã lưu trữ' : ''}`
}

function SessionSelect({ kind, selected, catalog, showArchived, onSelect, disabled }) {
  const options = catalog.items.filter((item) => showArchived || !item.archived || item.record_id === selected)
  const item = catalog.items.find((entry) => entry.record_id === selected)
  return <div className="fxr-session-control is-compact">
    <label htmlFor={`fxr-${kind}-session-select`}>Chọn phiên replay</label>
    <div className="fxr-session-select-card">
      <select id={`fxr-${kind}-session-select`} aria-label="Chọn phiên replay" value={selected} onChange={(event) => onSelect(event.target.value)} disabled={disabled || catalog.status !== 'ready'}>
        <option value="">Chọn phiên replay</option>
        {selected && !item && <option value={selected}>{selected} · Không có trong danh mục</option>}
        {options.map((entry) => <option key={entry.record_id} value={entry.record_id}>{sessionOptionLabel(entry)}</option>)}
      </select>
    </div>
  </div>
}

export default function SessionPicker({ kind = 'replay', workspace = 'tenant-a', query = new URLSearchParams() }) {
  const selected = query.get('session') || query.get('replay_session') || readLastSession(workspace)
  const managementIntent = ['rename', 'duplicate', 'archive'].includes(query.get('manage')) ? query.get('manage') : null
  const managementRef = useRef(null)
  const [catalog, setCatalog] = useState({ status: 'loading', items: [], error: null })
  const [reloadToken, setReloadToken] = useState(0)
  const [showArchived, setShowArchived] = useState(query.get('archived') === '1')
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState({ name: '', description: '' })
  const [pending, setPending] = useState('')
  const [notice, setNotice] = useState(null)
  const [needsRefresh, setNeedsRefresh] = useState(false)
  const item = catalog.items.find((entry) => entry.record_id === selected)
  const selectedQuery = useMemo(() => item ? sessionAnalyticsQuery(query, item, { summary: kind === 'replay' }) : query, [item, kind, query])
  const newHref = buildWorkspaceHref('replay', workspace, query, { surface: 'workspace', fresh: '1', session: null, dataset: null, cursor: null, cutoff: null, playbook: null, playbook_revision: null })

  useEffect(() => {
    const controller = new AbortController()
    setCatalog({ status: 'loading', items: [], error: null })
    fetchReplaySessions(workspace, controller.signal).then((items) => {
      if (controller.signal.aborted) return
      setCatalog({ status: 'ready', items, error: null })
      setNeedsRefresh(false)
    }).catch((error) => {
      if (!controller.signal.aborted) setCatalog({ status: 'error', items: [], error: error.message })
    })
    return () => controller.abort()
  }, [workspace, reloadToken])

  useEffect(() => {
    if (item) rememberSession(workspace, item.record_id)
  }, [workspace, item])

  useEffect(() => {
    if (!item || !managementIntent || kind !== 'replay') return
    if (managementIntent === 'rename') {
      setDraft({ name: item.name || '', description: item.description || '' })
      setEditing(true)
    } else managementRef.current?.focus()
  }, [item?.record_id, managementIntent, kind])

  const navigate = (id, record = null) => {
    rememberSession(workspace, id)
    const target = record || catalog.items.find((entry) => entry.record_id === id)
    window.location.assign(sessionNavigationHref(kind, workspace, query, target, { archived: showArchived ? '1' : null }))
  }

  const mutate = async (action, changes) => {
    if (!item || pending || needsRefresh) return
    setPending(action)
    setNotice(null)
    try {
      const record = action === 'duplicate' ? await duplicateSession(workspace, item) : await updateSessionMetadata(workspace, item, changes)
      if (action === 'duplicate') {
        if (typeof record.record_id !== 'string' || !record.record_id) throw new Error('Phản hồi tạo bản sao thiếu session id.')
        navigate(record.record_id, { record_id: record.record_id, dataset_id: record.payload?.dataset_id || item.dataset_id })
      } else {
        setEditing(false)
        setNotice({ error: false, text: action === 'save' ? 'Đã lưu tên và mô tả phiên.' : changes.archived ? 'Đã lưu trữ phiên. Dữ liệu và lịch sử vẫn được giữ.' : 'Đã khôi phục phiên.' })
        setReloadToken((value) => value + 1)
      }
    } catch (error) {
      if (error.status === 409) {
        setNotice({ error: true, text: 'Phiên đã thay đổi ở nơi khác. Đã tải lại revision mới; nội dung bạn đang sửa vẫn được giữ. Kiểm tra trước khi lưu lại.' })
        setReloadToken((value) => value + 1)
      } else {
        const uncertain = !error.status || error.status >= 500
        setNeedsRefresh(uncertain)
        setNotice({ error: true, text: uncertain ? 'Chưa xác định thao tác đã được lưu hay chưa. Tải lại danh mục và kiểm tra trước khi thử lại.' : `Không lưu được phiên: ${error.message}` })
      }
    } finally { setPending('') }
  }

  const routeHref = (view, overrides = {}) => sessionNavigationHref(view, workspace, query, item, overrides)
  const available = catalog.status === 'ready' && Boolean(item)
  const actionDisabled = Boolean(pending) || needsRefresh || !available

  return <section className={`wm-page fx-session-picker fxr-integrated-sessions fxr-${kind}-picker`} aria-label={kind === 'trade' ? 'Trades theo phiên' : kind === 'analytics' ? 'Analytics theo phiên' : 'Sessions'} data-testid={`${kind}-session-picker`}>
    <header className="wm-page-header fxr-page-header"><h1>{kind === 'trade' ? 'Trades' : kind === 'analytics' ? 'Analytics' : 'Sessions'}</h1><a className="fxr-button fxr-button-primary" href={newHref}>＋ Phiên mới</a></header>
    <div className="fxr-session-toolbar">
      <SessionSelect kind={kind} selected={selected} catalog={catalog} showArchived={showArchived} onSelect={navigate} disabled={Boolean(pending)} />
      <div className="fxr-session-actions">
        <button className="fxr-button fxr-button-secondary" type="button" disabled={Boolean(pending) || catalog.status === 'loading'} onClick={() => setReloadToken((value) => value + 1)}>Tải lại</button>
        <label className="fxr-archive-toggle"><input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} />Hiện phiên đã lưu trữ</label>
      </div>
    </div>
    <p className={`fxr-session-catalog-status is-${catalog.status}`} role={catalog.status === 'error' ? 'alert' : 'status'} data-testid="session-catalog-status">
      {catalog.status === 'loading' ? 'Đang tải danh mục phiên…' : catalog.status === 'error' ? `Không tải được danh mục: ${catalog.error}. Chọn Tải lại để thử lại.` : `${catalog.items.filter((entry) => !entry.archived).length} phiên đang hoạt động · ${catalog.items.filter((entry) => entry.archived).length} phiên đã lưu trữ`}
    </p>
    {notice && <p className={`fxr-session-notice ${notice.error ? 'is-error' : ''}`} role={notice.error ? 'alert' : 'status'}>{notice.text}</p>}
    {available && <>
      {managementIntent && kind === 'replay' && <p className="fxr-session-notice" role="status">{managementIntent === 'rename' ? 'Sửa tên hoặc mô tả rồi lưu thay đổi.' : managementIntent === 'duplicate' ? 'Kiểm tra phiên và cutoff trước khi bấm Tạo bản sao tại cutoff.' : 'Kiểm tra phiên trước khi bấm Lưu trữ hoặc Khôi phục. Dữ liệu và lịch sử vẫn được giữ.'}</p>}
      {item.archived && <p className="fxr-session-notice" role="status">Phiên đã lưu trữ. Báo cáo vẫn đọc được; khôi phục để tiếp tục replay hoặc tạo bản sao.</p>}
      {kind === 'replay' && <div className="fxr-session-cards">
        <article className="fxr-session-card fxr-session-summary-card">
          <h2>{item.name || item.record_id}</h2>
          <p>{unknownValue(item.instrument_id)} · {timeframeLabel(item)} · {unknownValue(item.status)}</p>
          <details className="fxr-session-provenance"><summary>Nguồn dữ liệu · nến #{item.cursor_index} · revision {item.revision}</summary><dl className="fxr-session-facts">
            <div><dt>Session ID</dt><dd>{item.record_id}</dd></div>
            <div><dt>Dataset</dt><dd>{unknownValue(item.dataset_id)} · {datasetAvailabilityLabel(item.dataset_available)}</dd></div>
            <div><dt>Cutoff</dt><dd>Nến #{item.cursor_index} · revision {item.revision}</dd></div>
            <div><dt>Phiên gốc</dt><dd>{item.parent_session_id || 'Phiên độc lập'}</dd></div>
          </dl></details>
          <div className="fxr-session-links">
            {!item.archived && item.dataset_available && <a className="fxr-button fxr-button-primary" href={routeHref('replay', { select: null, surface: 'workspace' })}>Tiếp tục trên chart →</a>}
            <a className="fxr-button fxr-button-secondary" href={routeHref('trade')}>Xem Trades</a>
            <a className="fxr-button fxr-button-secondary" href={routeHref('analytics')}>Xem Analytics</a>
          </div>
          {item.dataset_available !== true && <p>{item.dataset_available === false ? 'Dataset không khả dụng. Khôi phục dữ liệu nguồn trước khi mở chart.' : 'Chưa rõ dataset. Tải lại danh mục để kiểm tra trước khi mở chart.'}</p>}
        </article>
        <article className="fxr-session-card fxr-description-card">
          <h2>Thông tin phiên</h2>
          {editing ? <form className="fxr-session-edit" onSubmit={(event) => { event.preventDefault(); mutate('save', draft) }}>
            <label>Tên phiên<input autoFocus value={draft.name} maxLength={160} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} disabled={Boolean(pending)} /></label>
            <label>Mô tả<textarea aria-label="Mô tả" value={draft.description} maxLength={2000} rows={4} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} disabled={Boolean(pending)} /></label>
            <div className="fxr-session-links"><button type="submit" className="fxr-button fxr-button-primary" disabled={actionDisabled}>{pending === 'save' ? 'Đang lưu…' : 'Lưu thay đổi'}</button><button type="button" className="fxr-button fxr-button-secondary" onClick={() => setEditing(false)} disabled={Boolean(pending)}>Hủy sửa</button></div>
          </form> : <><p className="fxr-session-description">{item.description || 'Chưa thêm mô tả.'}</p><button className="fxr-button fxr-button-secondary" type="button" disabled={actionDisabled} onClick={() => { setDraft({ name: item.name || '', description: item.description || '' }); setEditing(true) }}>Sửa tên và mô tả</button></>}
          <div className="fxr-session-lifecycle">
            <button className="fxr-button fxr-button-secondary" type="button" ref={managementIntent === 'duplicate' ? managementRef : undefined} disabled={actionDisabled || item.archived || !item.dataset_available} onClick={() => mutate('duplicate')}>{pending === 'duplicate' ? 'Đang tạo…' : 'Tạo bản sao tại cutoff'}</button>
            <button className="fxr-text-button" type="button" ref={managementIntent === 'archive' ? managementRef : undefined} disabled={actionDisabled} onClick={() => mutate('archive', { archived: !item.archived })}>{pending === 'archive' ? 'Đang lưu…' : item.archived ? 'Khôi phục phiên' : 'Lưu trữ phiên'}</button>
          </div>
          <small>Bản sao giữ lineage tại cutoff hiện tại. Lưu trữ không xóa dữ liệu.</small>
        </article>
      </div>}
      {kind !== 'replay' && <div className="fxr-session-links fxr-ledger-context"><span>{item.name || item.record_id} · {unknownValue(item.instrument_id)} · {timeframeLabel(item)}</span><a href={routeHref('replay')}>Thông tin phiên</a>{!item.archived && item.dataset_available && <a href={routeHref('replay', { select: null, surface: 'workspace' })}>Mở chart</a>}</div>}
      <div className="fxr-session-report"><AnalyticsWorkspace key={`${workspace}:${item.record_id}:${item.revision}:${reloadToken}`} workspace={workspace} query={selectedQuery} ledgerOnly={kind === 'trade'} summaryOnly={kind === 'replay'} embedded /></div>
    </>}
    {catalog.status === 'ready' && !item && <div className="fxr-empty-state"><h2>{selected ? 'Không tìm thấy phiên trong workspace này' : 'Chọn một phiên để bắt đầu'}</h2><p>{selected ? 'Kiểm tra workspace hoặc chọn phiên khác từ danh mục. Không có dữ liệu performance thay thế.' : 'Mở phiên đã lưu để xem chart, trade ledger và analytics; hoặc tạo phiên mới từ dataset local.'}</p><a className="fxr-button fxr-button-primary" href={newHref}>Tạo phiên mới</a></div>}
  </section>
}

export { datasetAvailabilityLabel, fetchReplaySessions, sessionOptionLabel, timeframeLabel }
