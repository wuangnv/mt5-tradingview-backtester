import { navigate } from './clientNavigation.js'
import { displayDate } from './dateFormat.js'
import { displayTimeframe } from './dataDisplay.js'
import TestingReadState, { TestingSkeleton } from './TestingReadState.jsx'
import { useTestingLocale } from './testingLocale.jsx'
import { useEffect, useMemo, useRef, useState } from 'react'
import AnalyticsWorkspace, { analyticsViewResult, buildAnalyticsModel } from './AnalyticsWorkspace.jsx'
import SessionPerformance from './SessionPerformance.jsx'
import { SessionActionDialog, SessionActions } from './SessionActions.jsx'
import SessionSettingsDrawer from './SessionSettingsDrawer.jsx'
import { SessionSummaryCard, SessionDescriptionCard } from './SessionDetails.jsx'
import FxSelect from './FxSelect.jsx'
import TestingIcon from './TestingIcon.jsx'
import useReadRefresh from './useReadRefresh.js'
import { readDashboardAnalytics, readDashboardDatasets, readDashboardReplayContext } from './dashboardModel.js'
import { buildWorkspaceHref } from './workspaceContext.js'
import { defaultSession, deleteSession, sessionMutationError, duplicateSession, fetchReplaySessions, readLastSession, rememberSession, sessionAnalyticsQuery, sessionNavigationHref, updateSessionMetadata } from './sessionCatalog.js'
import './session-picker.css'
import './session-performance.css'

function unknownValue(value, fallback = 'Chưa rõ') {
  return value === null || value === undefined || String(value).trim() === '' ? fallback : String(value)
}

function datasetAvailabilityLabel(value) {
  return value === true ? 'Dataset sẵn sàng' : value === false ? 'Dataset không khả dụng' : 'Chưa rõ dataset'
}

function timeframeLabel(item) {
  return displayTimeframe(item, 'Chưa rõ khung thời gian')
}

function sessionOptionLabel(item) {
  return `${item.name || item.record_id} · ${unknownValue(item.instrument_id)} ${timeframeLabel(item)}${item.archived ? ' · Đã lưu trữ' : ''}`
}

function createdLabel(item) {
  return Number.isFinite(Date.parse(item?.created_at_utc)) ? displayDate(new Date(item.created_at_utc)) : 'Chưa rõ ngày tạo'
}

export function SessionSelect({ selected, catalog, onSelect, disabled, balance }) {
  const createdLabel = item => Number.isFinite(Date.parse(item?.created_at_utc)) ? displayDate(new Date(item.created_at_utc)) : t('Chưa rõ ngày tạo')

  const { t, locale } = useTestingLocale()

  const options = [...catalog.items].sort((a, b) => Number(Boolean(a.archived)) - Number(Boolean(b.archived)))
  const item = catalog.items.find((entry) => entry.record_id === selected)
  return <div className="fxr-session-control">
    <span className="fxs-select-label">{t("Chọn phiên")}</span>
    <FxSelect className="is-rich" label={t("Chọn phiên replay")} value={selected} onChange={onSelect} disabled={disabled || catalog.status !== 'ready'} searchable placeholder={t("Tìm phiên, asset…")} triggerContent={item ? <><strong>{item.name || item.record_id}</strong><small>{unknownValue(item.instrument_id)} · {timeframeLabel(item)}</small><small>{t("Số dư từ lệnh đóng")}: {balance}</small><small>{t("Ngày tạo")}: {createdLabel(item)} {t("· UTC")}</small></> : null} options={[
      ...(selected && !item ? [{ value: selected, label: selected, disabled: true, detail: 'Không có trong danh mục' }] : []),
      ...options.map(entry => ({ value: entry.record_id, label: entry.name || entry.record_id, localize: false, detail: `${unknownValue(entry.instrument_id)} · ${timeframeLabel(entry)}${entry.archived ? ` · ${t('Đã lưu trữ')}` : ''}` })),
    ]} />
  </div>
}

export default function SessionPicker({ kind = 'replay', workspace = 'tenant-a', query = new URLSearchParams() }) {
  const dashboardMoney = (value, currency) => fmt(value, ` ${currency || t('Đơn vị tài khoản')}`)

  const { t, fmt } = useTestingLocale()

  const explicit = query.get('session') || query.get('replay_session') || ''
  const managementIntent = ['rename', 'duplicate'].includes(query.get('manage')) ? query.get('manage') : null
  const managementRef = useRef(null), uncertainDelete = useRef(null)
  const [catalog, setCatalog] = useState({ status: 'loading', items: [], error: null })
  const [reloadToken, setReloadToken] = useState(0)
  const [editing, setEditing] = useState(false)
  const [actionDialog, setActionDialog] = useState(null)
  const [datasets, setDatasets] = useState([])
  const [recordState, setRecord] = useState({ scope: '', record: null })
  const [pending, setPending] = useState('')
  const [notice, setNotice] = useState(null)
  const [needsRefresh, setNeedsRefresh] = useState(false)
  const [performanceState, setPerformance] = useState({ status: 'loading', payload: null, error: null })
  const selected = defaultSession(catalog.items, explicit, readLastSession(workspace))
  const item = catalog.items.find((entry) => entry.record_id === selected)
  const dataset = datasets.find(entry => entry.dataset_id === item?.dataset_id)
  const recordScope = `${workspace}:${item?.record_id}:${item?.revision}:${reloadToken}`
  const replayRecord = recordState.scope === recordScope ? recordState.record : null
  const performanceScope = `${workspace}:${item?.record_id}:${item?.revision}:${reloadToken}`
  const performance = performanceState.scope === performanceScope ? performanceState : { status: 'loading', payload: null, error: null }
  const performanceModel = useMemo(() => performance.payload?.analytics_available === true ? buildAnalyticsModel(analyticsViewResult(performance.payload)) : null, [performance.payload])
  const selectedQuery = useMemo(() => item ? sessionAnalyticsQuery(new URLSearchParams(window.location.search), item, { summary: kind === 'replay' }) : query, [item, kind, query])
  const newHref = buildWorkspaceHref('replay', workspace, query, { surface: 'workspace', fresh: '1', session: null, dataset: null, cursor: null, cutoff: null, playbook: null, playbook_revision: null })
  useReadRefresh(() => setReloadToken(value => value + 1), !pending)

  useEffect(() => {
    if (kind !== 'replay') return
    const controller = new AbortController()
    readDashboardDatasets(workspace, controller.signal).then(items => { if (!controller.signal.aborted) setDatasets(items) }).catch(() => { if (!controller.signal.aborted) setDatasets([]) })
    return () => controller.abort()
  }, [workspace, kind, reloadToken])

  useEffect(() => {
    if (kind !== 'replay' || !item) return
    const controller = new AbortController()
    readDashboardReplayContext(workspace, item, controller.signal).then(metadata => {
      if (!controller.signal.aborted) setRecord({ scope: recordScope, record: metadata })
    }).catch(() => {})
    return () => controller.abort()
  }, [workspace, kind, item?.record_id, item?.revision, reloadToken])

  useEffect(() => {
    const controller = new AbortController()
    setCatalog(current => current.status === 'ready' ? { ...current, refreshing: true, error: null } : { status: 'loading', items: [], error: null })
    fetchReplaySessions(workspace, controller.signal).then((items) => {
      if (controller.signal.aborted) return
      setCatalog({ status: 'ready', items, error: null })
      if (uncertainDelete.current && !items.some(item => item.record_id === uncertainDelete.current)) {
        if (readLastSession(workspace) === uncertainDelete.current) rememberSession(workspace, '')
        navigate(buildWorkspaceHref('replay', workspace, query, { select: '1', surface: null, session: null, replay_session: null, dataset: null, cursor: null, cutoff: null, manage: null }))
      }
      uncertainDelete.current = null
      setNeedsRefresh(false)
    }).catch((error) => {
      if (!controller.signal.aborted) setCatalog(current => ({ ...current, status: current.items.length ? 'stale' : 'error', refreshing: false, error: error.message }))
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
      setEditing(true)
    }
    else managementRef.current?.focus()
  }, [item?.record_id, managementIntent, kind])

  const navigate = (id, record = null) => {
    rememberSession(workspace, id)
    const target = record || catalog.items.find((entry) => entry.record_id === id)
    navigate(sessionNavigationHref(kind, workspace, query, target, { archived: target?.archived ? '1' : null }))
  }

  const mutate = async (action, changes) => {
    if (!item || pending || needsRefresh || !['save', 'duplicate', 'delete'].includes(action)) return false
    setPending(action)
    setNotice(null)
    try {
      const record = action === 'delete' ? await deleteSession(workspace, item, changes) : action === 'duplicate' ? await duplicateSession(workspace, item) : await updateSessionMetadata(workspace, item, changes)
      if (action === 'delete') {
        if (readLastSession(workspace) === item.record_id) rememberSession(workspace, '')
        navigate(buildWorkspaceHref('replay', workspace, query, { select: '1', surface: null, session: null, replay_session: null, dataset: null, cursor: null, cutoff: null, manage: null, trade: null, trade_id: null }))
      } else if (action === 'duplicate') {
        if (typeof record.record_id !== 'string' || !record.record_id) throw new Error('Phản hồi tạo bản sao thiếu session id.')
        navigate(record.record_id, { record_id: record.record_id, dataset_id: record.payload?.dataset_id || item.dataset_id })
      } else {
        setEditing(false)
        setActionDialog(null)
        setNotice({ error: false, text: 'Đã lưu thay đổi phiên.' })
        setReloadToken((value) => value + 1)
      }
    } catch (error) {
      if (error.message === 'replay_linked_to_prop_attempt' || error.message === 'session_delete_confirmation_mismatch') {
        setNotice({ error: true, text: sessionMutationError(error) })
      } else if (error.status === 409) {
        setNeedsRefresh(true)
        setNotice({ error: true, text: 'Phiên đã thay đổi ở nơi khác. Đã tải lại revision mới; nội dung bạn đang sửa vẫn được giữ. Kiểm tra trước khi lưu lại.' })
        setReloadToken((value) => value + 1)
      } else {
        const uncertain = !error.status || error.status >= 500
        if (action === 'delete' && (uncertain || error.status === 404)) uncertainDelete.current = item.record_id
        setNeedsRefresh(uncertain || error.status === 404)
        setNotice({ error: true, text: uncertain ? 'Chưa xác định thao tác đã được lưu hay chưa. Đang đối chiếu danh mục; kiểm tra nội dung trước khi thử lại.' : t("Không lưu được phiên: {error}", { error: error.message }) })
        if (uncertain || error.status === 404) setReloadToken(value => value + 1)
      }
      return false
    } finally { setPending('') }
  }

  const routeHref = (view, overrides = {}) => sessionNavigationHref(view, workspace, query, item, overrides)
  const available = catalog.status === 'ready' && Boolean(item)
  const actionDisabled = Boolean(pending) || needsRefresh || !available

  return <section className={`wm-page fx-session-picker fxr-integrated-sessions fxr-${kind}-picker ${kind === 'replay' ? 'fxs-page' : ''}`} aria-label={kind === 'trade' ? t("Trades theo phiên") : kind === 'analytics' ? t("Analytics theo phiên") : t("Sessions")} data-testid={`${kind}-session-picker`}>
    <h1 className="sr-only">{kind === 'trade' ? t("Trades") : kind === 'analytics' ? t("Analytics") : t("Sessions")}</h1>
    <div className="fxr-session-toolbar">
      <SessionSelect selected={selected} catalog={catalog} onSelect={navigate} disabled={Boolean(pending)} balance={performance.status === 'ready' ? dashboardMoney(performanceModel?.endingBalance, performanceModel?.result?.account_currency) : '—'} />
      <div className="fxr-session-actions">
        {kind === 'replay' && <><a className="fxr-button fxr-button-primary fxs-new-session" href={newHref}><TestingIcon kind="plus" size={16} />{t("＋ Phiên mới")}</a>{available && <><FxSelect className="fxs-analytics-button" label={t("Mở Analytics")} value="session" options={[{ value: 'session', label: 'Analytics phiên' }, { value: 'prop', label: 'Prop Firm' }]} onChange={value => navigate(value === 'prop' ? buildWorkspaceHref('analytics', workspace, query, { area: 'testing', section: 'analytics', analytics_source: 'prop', select: '1' }) : routeHref('analytics'))} triggerContent={t("Analytics")} /><button className="fxr-button fxr-button-secondary fxs-settings" type="button" disabled={actionDisabled} onClick={() => { setEditing(true) }}>{t("Cài đặt phiên")}</button><SessionActions text item={item} disabled={actionDisabled || Boolean(catalog.refreshing)} onAction={action => { setNotice(null); setActionDialog({ mode: action }) }} /></>}</>}
      </div>
    </div>
    {catalog.status === 'loading' && <TestingSkeleton label="Đang tải danh mục phiên…" />}
    {['error', 'stale'].includes(catalog.status) && <TestingReadState error={catalog.status === 'error'} message={t('Không tải được danh mục: {error}. Sẽ kiểm tra lại khi quay về ứng dụng.', { error: t(catalog.error) })} onRetry={() => setReloadToken(value => value + 1)} />}
    {notice && <p className={`fxr-session-notice ${notice.error ? 'is-error' : ''}`} role={notice.error ? 'alert' : 'status'}>{t(notice.text)}</p>}
    {available && <>
      {managementIntent && !(managementIntent === 'duplicate' && item.archived) && kind === 'replay' && <p className="fxr-session-notice" role="status">{managementIntent === 'rename' ? t("Sửa tên hoặc mô tả rồi lưu thay đổi.") : t("Kiểm tra phiên và cutoff trước khi bấm Tạo bản sao tại cutoff.")}</p>}
      {item.archived && <p className="fxr-session-notice" role="status">{t("Phiên đã lưu trữ trước đây. Báo cáo vẫn đọc được; không thể tiếp tục replay hoặc tạo bản sao.")}</p>}
      {kind === 'replay' && <div className="fxr-session-cards">
        <SessionSummaryCard item={item} dataset={dataset} payload={performance.payload} model={performanceModel} replayRecord={replayRecord} chartHref={routeHref('replay', { select: null, surface: 'workspace' })} />
        <SessionDescriptionCard item={item} pending={Boolean(pending)} disabled={actionDisabled} onSave={description => mutate('save', { description })}>
          {managementIntent === 'duplicate' && <div className="fxr-session-lifecycle"><button className="fxr-button fxr-button-secondary" type="button" ref={managementRef} disabled={actionDisabled || item.archived || !item.dataset_available} onClick={() => mutate('duplicate')}>{pending === 'duplicate' ? t("Đang tạo…") : t("Tạo bản sao tại cutoff")}</button></div>}
        </SessionDescriptionCard>
      </div>}
      {kind !== 'replay' && <div className="fxr-session-links fxr-ledger-context"><span>{item.name || item.record_id} · {unknownValue(item.instrument_id)} · {timeframeLabel(item)}</span><a href={routeHref('replay')}>{t("Thông tin phiên")}</a>{!item.archived && item.dataset_available && <a href={routeHref('replay', { select: null, surface: 'workspace' })}>{t("Mở chart")}</a>}</div>}
      <div className="fxr-session-report">{kind === 'replay' ? <>{performance.status === 'loading' && <TestingSkeleton label="Đang tải kết quả phiên…" />}{performance.status === 'error' && <TestingReadState error message={t('Không tải được kết quả:') + ' ' + t(performance.error)} onRetry={() => setReloadToken(value => value + 1)} />}{performance.status === 'blocked' && performance.payload?.blocked_by_data?.some(reason => reason !== 'replay_execution_not_initialized') && <p role="status" data-testid="session-performance-blocked">{t("Kết quả chưa đủ dữ liệu để hiển thị.")}</p>}{['ready', 'blocked'].includes(performance.status) && <SessionPerformance key={`${workspace}:${item.record_id}:${item.revision}:${reloadToken}`} model={performanceModel} payload={performance.payload} item={item} href={routeHref} />}</> : <AnalyticsWorkspace key={`${workspace}:${item.record_id}:${item.revision}`} workspace={workspace} query={selectedQuery} ledgerOnly={kind === 'trade'} sessionName={item.name || item.record_id} embedded />}</div>
    </>}
    {actionDialog && item && <SessionActionDialog key={actionDialog.mode + ':' + item.record_id} mode={actionDialog.mode} item={item} pending={Boolean(pending)} blocked={actionDisabled || Boolean(catalog.refreshing)} error={notice?.error ? notice.text : null} onClose={() => setActionDialog(null)} onSubmit={(action, entry, confirmation) => mutate(action, confirmation)} />}
    {editing && item && <SessionSettingsDrawer item={item} dataset={dataset} payload={performance.payload} model={performanceModel} replayRecord={replayRecord} workspace={workspace} pending={Boolean(pending)} blocked={actionDisabled} onClose={() => setEditing(false)} onSubmit={draft => mutate('save', draft)} error={notice?.error ? notice.text : null} />}
    {catalog.status === 'ready' && !item && <div className="fxr-empty-state"><h2>{selected ? t("Không tìm thấy phiên trong workspace này") : t("Chọn một phiên để bắt đầu")}</h2><p>{selected ? t("Kiểm tra workspace hoặc chọn phiên khác từ danh mục. Không có dữ liệu performance thay thế.") : t("Mở phiên đã lưu để xem chart, trade ledger và analytics; hoặc tạo phiên mới từ dataset local.")}</p><a className="fxr-button fxr-button-primary" href={newHref}>{t("Tạo phiên mới")}</a></div>}
  </section>
}

export { datasetAvailabilityLabel, fetchReplaySessions, sessionOptionLabel, timeframeLabel }
