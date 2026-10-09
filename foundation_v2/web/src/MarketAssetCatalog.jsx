import { scopedMutation } from './scopedMutation.js'
import ProjectDateInput from './ProjectDateInput.jsx'
import { formatDataSize } from './dataDisplay.js'
import { useTestingLocale } from './testingLocale.jsx'
import { useEffect, useState } from 'react'
import { readJson, workspaceHeaders, formatUtc as formatMarketUtc } from './researchDataApi.js'
import { buildWorkspaceHref } from './workspaceContext.js'
import './market-sync.css'
import FxSelect from './FxSelect.jsx'
import PaginationFooter from './PaginationFooter.jsx'
import TestingReadState, { TestingSkeleton } from './TestingReadState.jsx'
import TestingIcon from './TestingIcon.jsx'
import { useWorkspaceMetadataQuery } from './WorkspaceQueryProvider.jsx'
import { catalogEventRevision, invalidateScopeMetadata, metadataOptions } from './workspaceQuery.js'
import { subscribeWorkspaceEvents } from './workspaceEvents.js'


export default function MarketAssetCatalog({ workspace, query, showHeading = true, preview }) {
  const formatUtc = value => formatMarketUtc(value, locale)

  const { t, locale, fmt, statusLabel } = useTestingLocale()

  const [visibleTab, setVisibleTab] = useState(() => document.visibilityState !== 'hidden')
  const [streamReady, setStreamReady] = useState(false)
  const catalogRead = useWorkspaceMetadataQuery('market-assets', { workspace, enabled: !preview && visibleTab })
  const state = preview || (catalogRead.denied ? { status: 'denied', items: [] }
    : catalogRead.data ? { ...catalogRead.data, stale: Boolean(catalogRead.error) }
      : { status: catalogRead.error ? 'error' : 'loading', items: [] })
  const [search, setSearch] = useState(''), [group, setGroup] = useState('all')
  const [all, setAll] = useState(false), [pending, setPending] = useState(false), [error, setError] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [page, setPage] = useState(1), [pageSize, setPageSize] = useState(25)
  useEffect(() => {
    if (preview || catalogRead.denied) return
    const controller = new AbortController()
    let revision = null
    setStreamReady(false)
    const unsubscribe = subscribeWorkspaceEvents(workspace, ({ event, data }) => {
      if (event === 'snapshot') {
        setStreamReady(true)
        const next = catalogEventRevision(data)
        if (next !== revision) { revision = next; void invalidateScopeMetadata(catalogRead.scope, ['market-assets']) }
      } else if (event === 'connection') {
        setStreamReady(data.state === 'connected')
        if (data.state === 'denied') catalogRead.scope.deny()
      } else if (event === 'error' || event === 'resync') {
        setStreamReady(false)
        if ([401, 403].includes(data.status)) catalogRead.scope.deny()
      }
    }, { signal: controller.signal })
    const visibility = () => {
      const visible = document.visibilityState !== 'hidden'
      setVisibleTab(visible)
      if (visible) void invalidateScopeMetadata(catalogRead.scope, ['market-assets'])
    }
    document.addEventListener('visibilitychange', visibility)
    return () => { unsubscribe(); controller.abort(); document.removeEventListener('visibilitychange', visibility) }
  }, [workspace, preview, catalogRead.scope, catalogRead.denied])
  useEffect(() => {
    if (preview || catalogRead.denied || !visibleTab) return
    // MT5 catalog work is not included in the SSE download projection yet.
    if (streamReady && !state.running && !state.queued) return
    const timer = setInterval(() => void invalidateScopeMetadata(catalogRead.scope, ['market-assets']), 15000)
    return () => clearInterval(timer)
  }, [preview, catalogRead.denied, catalogRead.scope, visibleTab, streamReady, state.running, state.queued])
  const update = async symbol => {
    if (preview) return
    setPending(true); setError('')
    try {
      const response = await scopedMutation('/api/v2/data/market-assets/update', workspace, {
        method: 'POST', headers: workspaceHeaders(workspace, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({ symbol, from_date: fromDate || null }),
      })
      const payload = await readJson(response)
      catalogRead.scope.client.setQueryData(metadataOptions(catalogRead.scope, 'market-assets').queryKey, payload)
      await invalidateScopeMetadata(catalogRead.scope, ['market-assets'])
    } catch (error) {
      if ([401, 403].includes(error.status)) catalogRead.scope.deny()
      setError(t("Không cập nhật được: {error}", { error: error.message }))
    }
    finally { setPending(false) }
  }
  const items = state.items || []
  const visible = items.filter(item => (all || item.enabled) && (group === 'all' || item.metadata?.group === group)
    && `${item.symbol} ${item.metadata?.description || ''}`.toLowerCase().includes(search.toLowerCase()))
  const groups = [...new Set(items.map(item => item.metadata?.group).filter(Boolean))].sort()
  const pages = Math.max(1, Math.ceil(visible.length / pageSize)), currentPage = Math.min(page, pages)
  const pageItems = visible.slice((currentPage - 1) * pageSize, currentPage * pageSize)
  useEffect(() => setPage(1), [search, group, all, pageSize, workspace])
  return <section className="market-assets" aria-label={t("Kho dữ liệu Testing")} data-testid="market-assets">
    {!showHeading && <h1 className="sr-only">{t('Market Data')}</h1>}
    <div className="market-sync-heading">{showHeading && <h2>{t("Market Data")}</h2>}{items.length > 0 && <span>{t('Đã tải {count} sản phẩm', { count: fmt(items.filter(item => item.dataset_id).length, '', 0) })}</span>}</div>
    {state.running && <span role="status">{t("Đang tải")}{state.running}</span>}
    {state.connection_error && <TestingReadState message={t('MT5 chưa sẵn sàng ({error}). Kho đã tải vẫn dùng được.', { error: state.connection_error })} />}
    {state.tick_sync_error && <TestingReadState message={t('Tick đang chờ tải bù: {error}.', { error: state.tick_sync_error })} />}
    {state.status === 'loading' && <TestingSkeleton label={t("Đang đọc kho Testing…")} />}
    {state.status === 'unavailable' && <p>{t("Chưa cấu hình nguồn lịch sử tự cập nhật.")}</p>}
    {state.status === 'denied' && <TestingReadState error message={t('Không có quyền đọc kho dữ liệu trong workspace này.')} />}
    {!catalogRead.denied && (error || catalogRead.error) && <TestingReadState error message={t(error || 'Không đọc được kho assets; trạng thái tải có thể đã cũ.')} onRetry={() => { setError(''); void catalogRead.refetch() }} />}
    <div className="market-sync-filters">
      <label className="market-sync-search"><TestingIcon kind="search" /><input type="search" aria-label={t("Tìm asset")} placeholder={t("Tìm asset…")} value={search} onChange={event => setSearch(event.target.value)} /></label>
      <FxSelect label={t("Nhóm asset")} value={group} onChange={setGroup} options={[{ value: 'all', label: 'Tất cả nhóm' }, ...groups.map(value => ({ value, label: value, localize: false }))]} />
      <label>{t("Tải từ ngày")}<ProjectDateInput type="date" aria-label={t("Ngày bắt đầu tải lịch sử")} value={fromDate} onChange={event => setFromDate(event.target.value)} /></label>
      <label><input type="checkbox" checked={all} onChange={event => setAll(event.target.checked)} />{t("Hiện toàn bộ danh mục broker")}</label>
      <button type="button" className="fxr-button fxr-button-primary market-sync-update" onClick={() => update(null)} disabled={Boolean(preview) || pending || !items.length || Boolean(state.queued) || Boolean(state.running)}><TestingIcon kind="download" />{t("Cập nhật dữ liệu")}</button>
    </div>
    {items.length > 0 && <div className="market-sync-table" tabIndex={0} role="region" aria-label={t("Danh mục lịch sử broker")}><table><thead><tr><th>{t("Asset / sản phẩm")}</th><th>{t("Nguồn")}</th><th>{t("Lịch sử UTC")}</th><th>{t("Trạng thái")}</th><th><span className="sr-only">{t("Thao tác")}</span></th></tr></thead><tbody>{pageItems.map(item => <tr key={item.symbol}>
      <td><strong>{item.symbol}</strong><small>{item.metadata?.group || '—'}</small></td><td>{state.source}</td>
      <td>{item.dataset_id ? <>{formatUtc(item.first_timestamp)}<small>{t('đến {date} · {count} nến', { date: formatUtc(item.last_timestamp), count: fmt(item.row_count, '', 0) })}</small></> : t("Chưa có dữ liệu")}{item.ticks && <small>{t("Tick Bid/Ask:")} {fmt(item.ticks.row_count, '', 0)} · {formatDataSize(item.ticks.bytes,fmt)} {t("nén ·")} {item.ticks.unavailable_days} {t("ngày broker trả rỗng")}</small>}</td>
      <td><span className={`market-sync-status is-${item.status}`}>{statusLabel('market_asset', item.status)}</span>{item.dataset_id && <small>{item.quality === 'review' ? t("Có khoảng gián đoạn cần kiểm tra") : t("Kiểm tra cơ bản; phí lịch sử chưa xác minh")}</small>}{item.error && <small>{item.error}</small>}</td>
      <td><div className="market-sync-row-actions">{item.dataset_id && !preview && <a className="fxr-button fxr-button-secondary" href={buildWorkspaceHref('replay', workspace, query, { area: 'testing', section: 'sessions', session: null, cursor: null, cutoff: null, dataset: item.dataset_id, select: null, fresh: '1', surface: 'workspace' })}>{t("Luyện tập")}</a>}
        {!preview && item.ticks?.start_index != null && <a className="fxr-button fxr-button-secondary" href={buildWorkspaceHref('replay', workspace, query, { area: 'testing', section: 'sessions', session: null, cursor: null, cutoff: null, dataset: item.dataset_id, start: item.ticks.start_index, select: null, fresh: '1', surface: 'workspace' })}>{t("Luyện tick")}</a>}
        <button type="button" className="fxr-button fxr-button-secondary" disabled={Boolean(preview) || pending || ['queued', 'syncing'].includes(item.status)} onClick={() => update(item.symbol)}><TestingIcon kind="download" />{item.dataset_id ? t("Tải bổ sung") : t("Tải lịch sử")}</button></div></td>
    </tr>)}</tbody></table>{!visible.length && <p>{t("Không có asset phù hợp bộ lọc.")}</p>}</div>}
    {items.length > 0 && <PaginationFooter label="Phân trang kho dữ liệu" page={currentPage} pages={pages} onPageChange={setPage} pageSize={pageSize} onPageSizeChange={value => { setPageSize(value); setPage(1) }} />}
    {state.status === 'ready' && !items.length && <TestingReadState message="Kho dữ liệu chưa có sản phẩm." />}
    {!preview && <details className="market-sync-note"><summary>{t('Thông tin dữ liệu')}</summary><p>{t("Mặc định tải")} {state.seed_days || 90} {t("ngày; có thể chọn ngày xa hơn trong 5 năm, tùy lịch sử broker. Chỉ số, cổ phiếu và crypto ở nguồn này là CFD. Session cũ giữ nguyên dataset. Dukascopy chưa bật do quyền lưu kho chưa rõ; futures CME chưa cấu hình.")}</p></details>}
  </section>
}
