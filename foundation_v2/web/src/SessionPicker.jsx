import React, { useEffect, useMemo, useRef, useState } from 'react'
import AnalyticsWorkspace, { analyticsViewResult, buildAnalyticsModel } from './AnalyticsWorkspace.jsx'
import SessionPerformance from './SessionPerformance.jsx'
import FxSelect, { FilterIcon } from './FxSelect.jsx'
import useReadRefresh from './useReadRefresh.js'
import { dashboardMoney, readDashboardAnalytics } from './dashboardModel.js'
import { buildWorkspaceHref } from './workspaceContext.js'
import { defaultSession, duplicateSession, fetchReplaySessions, readLastSession, rememberSession, sessionAnalyticsQuery, sessionNavigationHref, updateSessionMetadata } from './sessionCatalog.js'
import './session-picker.css'
import './session-performance.css'

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

function createdLabel(item) {
  return Number.isFinite(Date.parse(item?.created_at_utc)) ? new Intl.DateTimeFormat('vi-VN', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(item.created_at_utc)) : 'Chưa rõ ngày tạo'
}

function SessionSelect({ selected, catalog, onSelect, disabled, balance }) {
  const options = [...catalog.items].sort((a, b) => Number(Boolean(a.archived)) - Number(Boolean(b.archived)))
  const item = catalog.items.find((entry) => entry.record_id === selected)
  return <div className="fxr-session-control">
    <span className="fxs-select-label">Chọn phiên</span>
    <FxSelect className="is-rich" label="Chọn phiên replay" value={selected} onChange={onSelect} disabled={disabled || catalog.status !== 'ready'} searchable placeholder="Tìm phiên, asset…" triggerContent={item ? <><strong>{item.name || item.record_id}</strong><small>{unknownValue(item.instrument_id)} · {timeframeLabel(item)}</small><small>Số dư từ lệnh đóng: {balance}</small><small>Tạo {createdLabel(item)} · UTC</small></> : null} options={[
      { value: '', label: 'Chọn phiên replay' },
      ...(selected && !item ? [{ value: selected, label: selected, detail: 'Không có trong danh mục' }] : []),
      ...options.map(entry => ({ value: entry.record_id, label: entry.name || entry.record_id, detail: `${unknownValue(entry.instrument_id)} · ${timeframeLabel(entry)}${entry.archived ? ' · Đã lưu trữ' : ''}` })),
    ]} />
  </div>
}

export default function SessionPicker({ kind = 'replay', workspace = 'tenant-a', query = new URLSearchParams() }) {
  const explicit = query.get('session') || query.get('replay_session') || ''
  const managementIntent = ['rename', 'duplicate', 'archive'].includes(query.get('manage')) ? query.get('manage') : null
  const managementRef = useRef(null)
  const [catalog, setCatalog] = useState({ status: 'loading', items: [], error: null })
  const [reloadToken, setReloadToken] = useState(0)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState({ name: '', description: '' })
  const [pending, setPending] = useState('')
  const [notice, setNotice] = useState(null)
  const [needsRefresh, setNeedsRefresh] = useState(false)
  const [performanceState, setPerformance] = useState({ status: 'loading', payload: null, error: null })
  const selected = defaultSession(catalog.items, explicit, readLastSession(workspace))
  const item = catalog.items.find((entry) => entry.record_id === selected)
  const performanceScope = `${workspace}:${item?.record_id}:${item?.revision}:${reloadToken}`
  const performance = performanceState.scope === performanceScope ? performanceState : { status: 'loading', payload: null, error: null }
  const performanceModel = useMemo(() => performance.payload?.analytics_available === true ? buildAnalyticsModel(analyticsViewResult(performance.payload)) : null, [performance.payload])
  const selectedQuery = useMemo(() => item ? sessionAnalyticsQuery(new URLSearchParams(window.location.search), item, { summary: kind === 'replay' }) : query, [item, kind, query])
  const newHref = buildWorkspaceHref('replay', workspace, query, { surface: 'workspace', fresh: '1', session: null, dataset: null, cursor: null, cutoff: null, playbook: null, playbook_revision: null })
  useReadRefresh(() => setReloadToken(value => value + 1), !pending)

  useEffect(() => {
    const controller = new AbortController()
    setCatalog(current => current.status === 'ready' ? { ...current, refreshing: true, error: null } : { status: 'loading', items: [], error: null })
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
    if (!item || explicit) return
    const url = new URL(window.location.href)
    url.searchParams.set('session', item.record_id)
    if (item.dataset_id) url.searchParams.set('dataset', item.dataset_id)
    window.history.replaceState({}, '', url)
  }, [workspace, item])

  useEffect(() => {
    if (kind !== 'replay' || !item) return
    const controller = new AbortController()
    setPerformance({ scope: performanceScope, status: 'loading', payload: null, error: null })
    readDashboardAnalytics(workspace, item.record_id, controller.signal).then(payload => {
      if (!controller.signal.aborted) setPerformance({ scope: performanceScope, status: payload.analytics_available && !payload.blocked_by_data?.length ? 'ready' : 'blocked', payload, error: null })
    }).catch(error => {
      if (!controller.signal.aborted) setPerformance({ scope: performanceScope, status: 'error', payload: null, error: error.message })
    })
    return () => controller.abort()
  }, [workspace, kind, item?.record_id, item?.revision, reloadToken])

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
    window.location.assign(sessionNavigationHref(kind, workspace, query, target, { archived: target?.archived ? '1' : null }))
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
        setNotice({ error: true, text: uncertain ? 'Chưa xác định thao tác đã được lưu hay chưa. Đang đối chiếu danh mục; kiểm tra nội dung trước khi thử lại.' : `Không lưu được phiên: ${error.message}` })
        if (uncertain) setReloadToken(value => value + 1)
      }
    } finally { setPending('') }
  }

  const routeHref = (view, overrides = {}) => sessionNavigationHref(view, workspace, query, item, overrides)
  const available = catalog.status === 'ready' && Boolean(item)
  const actionDisabled = Boolean(pending) || needsRefresh || !available

  return <section className={`wm-page fx-session-picker fxr-integrated-sessions fxr-${kind}-picker ${kind === 'replay' ? 'fxs-page' : ''}`} aria-label={kind === 'trade' ? 'Trades theo phiên' : kind === 'analytics' ? 'Analytics theo phiên' : 'Sessions'} data-testid={`${kind}-session-picker`}>
    <h1 className="sr-only">{kind === 'trade' ? 'Trades' : kind === 'analytics' ? 'Analytics' : 'Sessions'}</h1>
    <div className="fxr-session-toolbar">
      <SessionSelect selected={selected} catalog={catalog} onSelect={navigate} disabled={Boolean(pending)} balance={performance.status === 'ready' ? dashboardMoney(performanceModel?.endingBalance, performanceModel?.result?.account_currency) : '—'} />
      <div className="fxr-session-actions">
        {kind === 'replay' && <><a className="fxr-button fxr-button-primary" href={newHref}>＋ Phiên mới</a>{available && <><FxSelect label="Mở Analytics" value="session" options={[{ value: 'session', label: 'Analytics phiên' }, { value: 'prop', label: 'Prop Firm' }]} onChange={value => window.location.assign(value === 'prop' ? buildWorkspaceHref('analytics', workspace, query, { area: 'testing', section: 'analytics', analytics_source: 'prop', select: '1' }) : routeHref('analytics'))} triggerContent="Analytics" /><button className="fxr-button fxr-button-secondary fxs-settings" type="button" disabled={actionDisabled} onClick={() => { setDraft({ name: item.name || '', description: item.description || '' }); setEditing(true) }}>Cài đặt phiên</button><button className="fxr-button fxr-button-secondary fxs-archive" type="button" ref={managementIntent === 'archive' ? managementRef : undefined} disabled={actionDisabled} onClick={() => mutate('archive', { archived: !item.archived })}>{pending === 'archive' ? 'Đang lưu…' : item.archived ? 'Khôi phục phiên' : 'Lưu trữ phiên'}</button></>}</>}
      </div>
    </div>
    {catalog.status !== 'ready' && <p className={`fxr-session-catalog-status is-${catalog.status}`} role={catalog.status === 'error' ? 'alert' : 'status'} data-testid="session-catalog-status">{catalog.status === 'loading' ? 'Đang tải danh mục phiên…' : `Không tải được danh mục: ${catalog.error}. Sẽ kiểm tra lại khi quay về ứng dụng.`}</p>}
    {notice && <p className={`fxr-session-notice ${notice.error ? 'is-error' : ''}`} role={notice.error ? 'alert' : 'status'}>{notice.text}</p>}
    {available && <>
      {managementIntent && kind === 'replay' && <p className="fxr-session-notice" role="status">{managementIntent === 'rename' ? 'Sửa tên hoặc mô tả rồi lưu thay đổi.' : managementIntent === 'duplicate' ? 'Kiểm tra phiên và cutoff trước khi bấm Tạo bản sao tại cutoff.' : 'Kiểm tra phiên trước khi bấm Lưu trữ hoặc Khôi phục. Dữ liệu và lịch sử vẫn được giữ.'}</p>}
      {item.archived && <p className="fxr-session-notice" role="status">Phiên đã lưu trữ. Báo cáo vẫn đọc được; khôi phục để tiếp tục replay hoặc tạo bản sao.</p>}
      {kind === 'replay' && <div className="fxr-session-cards">
        <article className="fxr-session-card fxr-session-summary-card">
          <div className="fxs-summary-heading"><h2>{item.name || item.record_id}</h2>{kind === 'replay' && <div className="fxs-balance"><span>Số dư từ lệnh đóng</span><strong>{performance.status === 'ready' ? dashboardMoney(performanceModel?.endingBalance, performanceModel?.result?.account_currency) : '—'}</strong></div>}</div>
          <p>{unknownValue(item.instrument_id)} · {timeframeLabel(item)} · {unknownValue(item.status)}</p>
          <p className="fxs-session-range">Tạo {createdLabel(item)} · UTC{Number.isInteger(item.row_count) && Number.isInteger(item.cursor_index) && <span className="fxs-remaining">{Math.max(0, item.row_count - item.cursor_index - 1).toLocaleString('vi-VN')} nến còn lại</span>}</p>
          <div className="fxr-session-links">
            {!item.archived && item.dataset_available && <a className="fxr-button fxr-button-primary" href={routeHref('replay', { select: null, surface: 'workspace' })}>Tiếp tục trên chart →</a>}
          </div>
          {item.dataset_available !== true && <p>{item.dataset_available === false ? 'Dataset không khả dụng. Khôi phục dữ liệu nguồn trước khi mở chart.' : 'Chưa rõ dataset. Kiểm tra dữ liệu nguồn trước khi mở chart.'}</p>}
        </article>
        <article className="fxr-session-card fxr-description-card">
          <div className="fxs-description-heading"><h2>Mô tả</h2>{!editing && <button className="fxs-edit-description" aria-label="Sửa tên và mô tả" type="button" disabled={actionDisabled} onClick={() => { setDraft({ name: item.name || '', description: item.description || '' }); setEditing(true) }}><FilterIcon kind="edit" /></button>}</div>
          {editing ? <form className="fxr-session-edit" onSubmit={(event) => { event.preventDefault(); mutate('save', draft) }}>
            <label>Tên phiên<input autoFocus value={draft.name} maxLength={160} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} disabled={Boolean(pending)} /></label>
            <label>Mô tả<textarea aria-label="Mô tả" value={draft.description} maxLength={2000} rows={4} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} disabled={Boolean(pending)} /></label>
            <div className="fxr-session-links"><button type="submit" className="fxr-button fxr-button-primary" disabled={actionDisabled}>{pending === 'save' ? 'Đang lưu…' : 'Lưu thay đổi'}</button><button type="button" className="fxr-button fxr-button-secondary" onClick={() => setEditing(false)} disabled={Boolean(pending)}>Hủy sửa</button></div>
          </form> : <p className="fxr-session-description">{item.description || 'Chưa thêm mô tả.'}</p>}
          {managementIntent === 'duplicate' && <div className="fxr-session-lifecycle">
            <button className="fxr-button fxr-button-secondary" type="button" ref={managementIntent === 'duplicate' ? managementRef : undefined} disabled={actionDisabled || item.archived || !item.dataset_available} onClick={() => mutate('duplicate')}>{pending === 'duplicate' ? 'Đang tạo…' : 'Tạo bản sao tại cutoff'}</button>
          </div>}
        </article>
      </div>}
      {kind !== 'replay' && <div className="fxr-session-links fxr-ledger-context"><span>{item.name || item.record_id} · {unknownValue(item.instrument_id)} · {timeframeLabel(item)}</span><a href={routeHref('replay')}>Thông tin phiên</a>{!item.archived && item.dataset_available && <a href={routeHref('replay', { select: null, surface: 'workspace' })}>Mở chart</a>}</div>}
      <div className="fxr-session-report">{kind === 'replay' ? <>{performance.status === 'loading' && <p role="status">Đang tải kết quả phiên…</p>}{performance.status === 'error' && <p role="alert">Không tải được kết quả: {performance.error}. Sẽ kiểm tra lại khi quay về ứng dụng.</p>}{performance.status === 'blocked' && performance.payload?.blocked_by_data?.some(reason => reason !== 'replay_execution_not_initialized') && <p role="status" data-testid="session-performance-blocked">Kết quả chưa đủ dữ liệu để hiển thị.</p>}{['ready', 'blocked'].includes(performance.status) && <SessionPerformance key={`${workspace}:${item.record_id}:${item.revision}:${reloadToken}`} model={performanceModel} payload={performance.payload} item={item} href={routeHref} />}</> : <AnalyticsWorkspace key={`${workspace}:${item.record_id}:${item.revision}`} workspace={workspace} query={selectedQuery} ledgerOnly={kind === 'trade'} sessionName={item.name || item.record_id} embedded />}</div>
    </>}
    {catalog.status === 'ready' && !item && <div className="fxr-empty-state"><h2>{selected ? 'Không tìm thấy phiên trong workspace này' : 'Chọn một phiên để bắt đầu'}</h2><p>{selected ? 'Kiểm tra workspace hoặc chọn phiên khác từ danh mục. Không có dữ liệu performance thay thế.' : 'Mở phiên đã lưu để xem chart, trade ledger và analytics; hoặc tạo phiên mới từ dataset local.'}</p><a className="fxr-button fxr-button-primary" href={newHref}>Tạo phiên mới</a></div>}
  </section>
}

export { datasetAvailabilityLabel, fetchReplaySessions, sessionOptionLabel, timeframeLabel }
