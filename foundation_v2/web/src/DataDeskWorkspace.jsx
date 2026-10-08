import React, { useEffect, useId, useMemo, useRef, useState } from 'react'
import {
  datasetRange,
  formatNumber,
  formatUtc,
  holdoutLabel,
  qualityLabel,
  datasetWarnings,
} from './researchDataApi.js'
import { fetchOfflineLibrary, refreshInstrumentCatalog, importLocalCsv, previewLocalCsv, fetchDownloads, startDownload, updateDownload } from './dataDeskApi.js'
import './research-data.css'
import { useTestingLocale } from './testingLocale.jsx'
import { buildWorkspaceHref } from './workspaceContext.js'
import FxSelect, { FilterIcon } from './FxSelect.jsx'
import TestingIcon from './TestingIcon.jsx'
import DataLibraryActions from './DataLibraryActions.jsx'
import PaginationFooter from './PaginationFooter.jsx'
import { CATEGORIES, categoryOf, categoryLabel, filterLibrary, libraryRows, sourceOf, canDownloadAsset, defaultDownloadDates, downloadRangeError } from './dataLibraryModel.js'
import './data-library.css'

const CSV_LIMIT_BYTES = 10 * 1024 * 1024
const MAX_GET_RETRIES = 3

const DEFAULT_IMPORT_FORM = {
  sourceId: 'local-csv-upload',
  provider: 'local-csv',
  licenseUse: 'user-supplied-local',
  instrumentId: 'EURUSDm',
  assetClass: 'fx',
  baseCcy: 'EUR',
  quoteCcy: 'USD',
  accountCcy: 'USD',
  tickSize: '0.00001',
  pipSize: '0.0001',
  contractSize: '100000',
  quantityMin: '0.01',
  quantityStep: '0.01',
  effectiveFromUtc: '1970-01-01T00:00:00Z',
  timeframeSeconds: '3600',
}

function QualityBadge({ dataset }) {
  const { t } = useTestingLocale()
  const disposition = dataset?.quality?.disposition
  const quality = disposition === 'pass' ? 'Đạt kiểm tra cơ bản' : disposition === 'review' ? 'Cần kiểm tra chất lượng' : qualityLabel(dataset)
  const tone = disposition === 'pass' || quality === 'Đã xác minh' ? 'is-good' : quality === 'Fixture / QA only' ? 'is-muted' : 'is-warn'
  return <span className={`rd-badge ${tone}`}>{t(quality)}</span>
}

function DatasetDetails({ dataset, workspace, query }) {
  const { t, fmt, locale } = useTestingLocale()
  if (!dataset) {
    return (
      <div className="rd-empty-callout" data-testid="data-desk-empty-selection">
        Chọn một dataset để xem provenance, range và các cảnh báo trước khi mở Research.
      </div>
    )
  }
  const range = datasetRange(dataset)
  const warnings = datasetWarnings(dataset)
  const source = dataset.source || {}
  return (
    <section className="rd-detail" aria-label="Chi tiết dataset" data-testid="dataset-details">
      <div className="rd-panel-head">
        <div>
          <h2>Provenance và QA</h2>
        </div>
        <a className="rd-context-link" href={buildWorkspaceHref('research', workspace, query, { dataset: dataset.dataset_id, session:null, cursor:null, cutoff:null })}>{t('Mở trong Research')} →</a>
      </div>
      <dl className="rd-detail-grid">
        <div><dt>Dataset</dt><dd><strong>{dataset.dataset_id}</strong></dd></div>
        <div><dt>{t('Nguồn dữ liệu')}</dt><dd>{source.provider || dataset.provider_id || '—'}</dd></div>
        <div><dt>Instrument / TF</dt><dd>{dataset.instrument_id || 'N/A'} · {dataset.timeframe || 'N/A'}</dd></div>
        <div><dt>{t('Số nến')}</dt><dd>{fmt(dataset.row_count, '', 0)}</dd></div>
        <div><dt>Range UTC</dt><dd>{t(formatUtc(range.start, locale))} → {t(formatUtc(range.end, locale))}</dd></div>
        <div><dt>License</dt><dd>{source.license_use || 'Chưa xác minh'}</dd></div>
        <div><dt>Quality</dt><dd><QualityBadge dataset={dataset} /></dd></div>
        {Array.isArray(dataset.quality?.gaps) && <div><dt>{t('Khoảng trống dữ liệu')}</dt><dd>{fmt(dataset.quality.gaps.length,'',0)}</dd></div>}
        {dataset.quality?.coverage && <div><dt>{t('Nến chưa có ở đầu/cuối khoảng chọn')}</dt><dd>{fmt(dataset.quality.coverage.leading_missing_intervals + dataset.quality.coverage.trailing_missing_intervals,'',0)}</dd></div>}
        {dataset.quality?.duplicates != null && <div><dt>{t('Nến trùng')}</dt><dd>{fmt(dataset.quality.duplicates,'',0)}</dd></div>}
        <div><dt>Holdout</dt><dd><span className={`rd-badge ${dataset.holdout_access ? 'is-good' : 'is-warn'}`}>{holdoutLabel(dataset)}</span></dd></div>
        <div><dt>Artifact hash</dt><dd><code>{dataset.artifact_sha256 || 'Chưa có hash'}</code></dd></div>
        <div><dt>Retrieved</dt><dd>{formatUtc(source.retrieved_at_utc)}</dd></div>
        <div><dt>Transform</dt><dd>{dataset.transform_version || 'Chưa xác định'}</dd></div>
        <div><dt>Instrument spec</dt><dd>{dataset.instrument_spec ? 'Có' : 'Chưa có'}</dd></div>
      </dl>
      {warnings.length > 0 && (
        <div className="rd-warning-block" role="note" data-testid="dataset-warnings">
          <strong>Cần biết trước khi chạy</strong>
          <ul>{warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
        </div>
      )}
    </section>
  )
}

function importQualityTone(disposition) {
  if (disposition === 'pass') return 'is-good'
  if (disposition === 'missing_data') return 'is-muted'
  return 'is-warn'
}

function LocalCsvQualityReport({ preview }) {
  const quality = preview?.quality || {}
  const range = preview?.available_range || {}
  const gaps = Array.isArray(quality.gaps) ? quality.gaps : []
  const disposition = quality.disposition || 'unknown'
  const label = disposition === 'pass' ? 'Đạt kiểm tra cơ bản' : disposition === 'review' ? 'Cần review trước khi research' : disposition === 'missing_data' ? 'Không có dữ liệu' : 'Chưa xác định'
  return (
    <section className="rd-import-report" aria-label="Báo cáo chất lượng CSV" data-testid="data-desk-quality-report">
      <div className="rd-import-report-head">
        <div><h3>Chất lượng CSV</h3></div>
        <span className={`rd-badge ${importQualityTone(disposition)}`}>{label}</span>
      </div>
      <dl className="rd-import-facts">
        <div><dt>Rows</dt><dd>{formatNumber(preview?.row_count, 0)}</dd></div>
        <div><dt>Unique timestamps</dt><dd>{formatNumber(preview?.unique_row_count, 0)}</dd></div>
        <div><dt>Range UTC</dt><dd>{formatUtc(range.from_utc)} → {formatUtc(range.to_utc)}</dd></div>
        <div><dt>Duplicates</dt><dd>{formatNumber(quality.duplicates, 0)}</dd></div>
        <div><dt>Out of order</dt><dd>{formatNumber(quality.out_of_order, 0)}</dd></div>
        <div><dt>Gaps / overlap</dt><dd>{formatNumber(gaps.length, 0)} / {formatNumber(quality.overlapping_intervals, 0)}</dd></div>
      </dl>
      <div className="rd-import-hashes">
        <div><span>Dataset ID</span><code>{preview?.dataset_id || 'Chưa có'}</code></div>
        <div><span>Raw SHA-256</span><code>{preview?.raw_sha256 || 'Chưa có'}</code></div>
        <div><span>Normalized SHA-256</span><code>{preview?.normalized_sha256 || 'Chưa có'}</code></div>
      </div>
      {disposition !== 'pass' && (
        <p className="rd-import-inline-warning" role="note">
          Dataset có thể được lưu để điều tra, nhưng Research sẽ giữ trạng thái blocked/review cho tới khi quality được xử lý.
        </p>
      )}
    </section>
  )
}

function DataLibraryDialog({ title, busy = false, onClose, compact = false, children }) {
  const { t } = useTestingLocale()
  const id = useId(), dialog = useRef(null), opener = useRef(document.activeElement)
  useEffect(() => {
    const element = dialog.current
    element.showModal()
    element.querySelector('input')?.focus()
    return () => {
      element.close()
      if (opener.current?.isConnected) opener.current.focus({ preventScroll:true })
    }
  }, [])
  const close = () => { if (!busy) onClose() }
  return <dialog ref={dialog} className={`data-library-dialog${compact ? ' is-compact' : ''}`} aria-labelledby={id} aria-busy={busy} onCancel={event => { event.preventDefault(); close() }} onClick={event => {
    if (event.target !== dialog.current) return
    const bounds = dialog.current.getBoundingClientRect()
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) close()
  }}>
    <header className="data-library-dialog-header"><h2 id={id}>{t(title)}</h2><button type="button" className="rd-button" aria-label={t('Đóng')} disabled={busy} onClick={close}>×</button></header>
    <div className="data-library-dialog-body">{children}</div>
  </dialog>
}

const DOWNLOAD_STATUS = { queued:'Đang chờ tải', running:'Đang tải', paused:'Tạm dừng', failed:'Tải thất bại', completed:'Đã lưu vào kho', cancelled:'Đã huỷ tải' }
const DOWNLOAD_ERRORS = { source_rate_limited:'Dukascopy đang giới hạn yêu cầu. Có thể tiếp tục sau thời gian chờ.', source_unavailable:'Không kết nối được Dukascopy. Tiến độ đã tải được giữ lại.', invalid_source_data:'Dữ liệu nguồn không hợp lệ; chưa lưu vào kho.', empty_range:'Không có dữ liệu trong khoảng ngày đã chọn.', worker_unavailable:'Bộ tải dữ liệu chưa sẵn sàng.', download_interrupted:'Tải bị gián đoạn. Có thể tiếp tục từ tiến độ đã lưu.', quality_rejected:'Dữ liệu chưa đạt kiểm tra chất lượng; chưa lưu vào kho.', download_busy:'Đang có một lượt tải khác. Hãy chờ hoặc huỷ lượt đó.', invalid_date_range:'Chọn khoảng ngày hợp lệ.', instrument_not_supported:'Tài sản này chưa hỗ trợ tải.', download_cooldown:'Chưa hết thời gian chờ. Hãy thử lại sau.', download_cancelled:'Lượt tải đã huỷ. Hãy bắt đầu lượt tải mới.', download_not_found:'Không tìm thấy lượt tải này.' }
const downloadErrorMessage = error => DOWNLOAD_ERRORS[typeof error === 'string' ? error : error?.payload?.detail?.code || error?.payload?.detail || error?.message] || 'Không xử lý được lượt tải. Hãy thử lại.'

function DownloadForm({ asset, earliestDate, workspace, signal, onStarted, onBusyChange }) {
  const { t } = useTestingLocale()
  const [dates, setDates] = useState(() => {
    const dates = defaultDownloadDates()
    return {...dates,from_date:earliestDate && earliestDate > dates.from_date ? earliestDate : dates.from_date}
  })
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const rangeError = downloadRangeError(dates.from_date, dates.to_date) || (earliestDate && dates.from_date < earliestDate ? 'Ngày bắt đầu nằm trước lịch sử có sẵn.' : '')
  useEffect(() => { onBusyChange(busy) }, [busy, onBusyChange])
  const submit = async event => {
    event.preventDefault()
    if (rangeError || busy) return
    setBusy(true); setError('')
    try {
      await startDownload(workspace, { instrument_id:asset.instrument_id, ...dates }, signal)
      if (!signal.aborted) onStarted()
    } catch (error) { if (!signal.aborted) setError(downloadErrorMessage(error)) }
    finally { if (!signal.aborted) setBusy(false) }
  }
  return <form className="data-library-download-form" onSubmit={submit}>
    <div><strong>{asset.instrument_id}</strong><p className="data-library-muted">M1 · Bid · UTC</p><p className="data-library-muted">{t('Giá lịch sử; spread và quy cách giao dịch được cấu hình riêng.')}</p></div>
    <div className="data-library-download-dates"><label className="rd-field"><span>{t('Từ ngày (UTC)')}</span><input type="date" required min={earliestDate || undefined} max={dates.to_date} value={dates.from_date} disabled={busy} onChange={event => { setDates(current => ({...current,from_date:event.target.value})); setError('') }} /></label><label className="rd-field"><span>{t('Đến ngày (UTC)')}</span><input type="date" required min={dates.from_date} max={defaultDownloadDates().to_date} value={dates.to_date} disabled={busy} onChange={event => { setDates(current => ({...current,to_date:event.target.value})); setError('') }} /></label></div>
    <p className="data-library-muted">{t('Bao gồm cả ngày kết thúc · Tối đa 366 ngày mỗi lượt.')}</p>
    {rangeError && <p role="status">{t(rangeError)}</p>}
    {error && <p className="rd-message is-error" role="alert">{t(error)}</p>}
    <div className="data-library-download-submit"><button type="submit" className="rd-button is-primary" disabled={busy || Boolean(rangeError)}>{t(busy ? 'Đang bắt đầu…' : 'Tải về')}</button></div>
  </form>
}

function LocalCsvImport({ workspace, onImported, onBusyChange, asset }) {
  const { t } = useTestingLocale()
  const [form, setForm] = useState(() => {
    if (!asset) return DEFAULT_IMPORT_FORM
    const spec = asset.instrument_spec || {}, source = asset.source || {}
    return { ...DEFAULT_IMPORT_FORM, instrumentId:asset.instrument_id, assetClass:categoryOf(asset) || 'fx',
      timeframeSeconds:String(asset.timeframe_seconds || 3600), sourceId:source.source_id || DEFAULT_IMPORT_FORM.sourceId,
      provider:sourceOf(asset), licenseUse:source.license_use || DEFAULT_IMPORT_FORM.licenseUse,
      ...Object.fromEntries([['baseCcy','base_ccy'],['quoteCcy','quote_ccy'],['accountCcy','account_ccy'],['tickSize','tick_size'],['pipSize','pip_size'],['contractSize','contract_size'],['quantityMin','quantity_min'],['quantityStep','quantity_step'],['effectiveFromUtc','effective_from_utc']].filter(([,key]) => spec[key] != null).map(([key,specKey]) => [key,String(spec[specKey])])) }
  })
  const [retrievedAtUtc, setRetrievedAtUtc] = useState(() => new Date().toISOString())
  const [upload, setUpload] = useState({ status: 'idle', file: null, csvText: '', payload: null, preview: null, error: null, imported: null })
  const reviewAccepted = upload.preview?.quality?.disposition !== 'review' || upload.acceptReview
  const previewReady = upload.status === 'previewed' && upload.preview && upload.payload
  const canImport = Boolean(previewReady && upload.preview.quality?.disposition !== 'missing_data' && reviewAccepted)
  const busy = upload.status === 'reading' || upload.status === 'previewing' || upload.status === 'importing'
  useEffect(() => { onBusyChange(busy) }, [busy, onBusyChange])

  function invalidatePreview(next = {}) {
    setUpload((current) => ({
      ...current,
      ...next,
      status: current.file ? 'stale' : 'idle',
      csvText: '',
      payload: null,
      preview: null,
      imported: null,
      error: null,
      acceptReview: false,
    }))
  }

  function updateForm(event) {
    const { name, value } = event.target
    setForm((current) => ({ ...current, [name]: value }))
    invalidatePreview()
  }

  function handleFile(event) {
    const file = event.target.files?.[0] || null
    setRetrievedAtUtc(new Date().toISOString())
    if (!file) {
      setUpload({ status: 'idle', file: null, csvText: '', payload: null, preview: null, error: null, imported: null })
      return
    }
    if (file.size === 0) {
      setUpload({ status: 'error', file, csvText: '', payload: null, preview: null, error: 'File trống; hãy chọn một CSV có header và ít nhất hai nến.', imported: null })
      return
    }
    if (file.size > CSV_LIMIT_BYTES) {
      setUpload({ status: 'error', file, csvText: '', payload: null, preview: null, error: 'File vượt giới hạn 10 MiB của local import.', imported: null })
      return
    }
    setUpload({ status: 'selected', file, csvText: '', payload: null, preview: null, error: null, imported: null, acceptReview: false })
  }

  function buildPayload(csvText) {
    const instrumentId = form.instrumentId.trim()
    return {
      csv_text: csvText,
      source: {
        source_id: form.sourceId.trim(),
        provider: form.provider.trim(),
        instrument_mapping: { [instrumentId]: instrumentId },
        license_use: form.licenseUse.trim(),
        retrieved_at_utc: retrievedAtUtc,
        export_settings: 'browser-file-text-v1',
      },
      instrument: {
        instrument_id: instrumentId,
        asset_class: form.assetClass,
        base_ccy: form.baseCcy.trim().toUpperCase(),
        quote_ccy: form.quoteCcy.trim().toUpperCase(),
        account_ccy: form.accountCcy.trim().toUpperCase(),
        tick_size: form.tickSize.trim(),
        pip_size: form.pipSize.trim(),
        contract_size: form.contractSize.trim(),
        quantity_min: form.quantityMin.trim(),
        quantity_step: form.quantityStep.trim(),
        effective_from_utc: form.effectiveFromUtc.trim(),
        effective_to_utc: '',
      },
      timeframe_seconds: Number(form.timeframeSeconds),
      holdout_policy: { mode: 'none' },
    }
  }

  async function previewFile() {
    if (!upload.file) return
    setUpload((current) => ({ ...current, status: 'reading', error: null, imported: null }))
    try {
      const csvText = await upload.file.text()
      if (!csvText.trim()) throw new Error('File không có nội dung CSV.')
      const payload = buildPayload(csvText)
      setUpload((current) => ({ ...current, status: 'previewing', csvText, payload, error: null }))
      const result = await previewLocalCsv(workspace, payload)
      setUpload((current) => ({ ...current, status: 'previewed', csvText, payload, preview: result.preview, error: null, imported: null, acceptReview: false }))
    } catch (error) {
      setUpload((current) => ({ ...current, status: 'error', error: String(error.message || error), preview: null, payload: null, csvText: '' }))
    }
  }

  async function importFile() {
    if (!canImport) return
    setUpload((current) => ({ ...current, status: 'importing', error: null }))
    try {
      const result = await importLocalCsv(workspace, upload.payload)
      setUpload((current) => ({ ...current, status: 'imported', imported: result.dataset, error: null }))
      onImported(result.dataset)
    } catch (error) {
      setUpload((current) => ({ ...current, status: 'error', error: String(error.message || error) }))
    }
  }

  return (
    <section className="rd-import-panel" aria-labelledby="data-desk-import-title" data-testid="data-desk-import">
      <div className="rd-panel-head">
        <div><h2 id="data-desk-import-title">{t('Thêm dữ liệu từ CSV')}</h2><p>{t('Cột bắt buộc: time, open, high, low, close. Thời gian dùng Unix giây hoặc ISO có múi giờ; volume là tuỳ chọn.')}</p></div>
      </div>
      <div className="rd-import-grid">
        <fieldset className="rd-import-form" disabled={busy}>
          <label className="rd-field is-wide"><span>{t('File CSV')}</span><input type="file" accept=".csv,text/csv" onChange={handleFile} data-testid="data-desk-file-input" /></label>
          <div className="rd-import-fields">
            <label className="rd-field"><span>{t('Mã sản phẩm')}</span><input name="instrumentId" value={form.instrumentId} onChange={updateForm} /></label>
            <label className="rd-field"><span>{t('Danh mục')}</span><select name="assetClass" value={form.assetClass} onChange={updateForm}>{CATEGORIES.map(([value,label]) => <option key={value} value={value}>{t(label)}</option>)}</select></label>
            <label className="rd-field"><span>{t('Khung thời gian (giây)')}</span><input name="timeframeSeconds" inputMode="numeric" value={form.timeframeSeconds} onChange={updateForm} /></label>
          </div>
          <details className="rd-import-advanced">
            <summary>Provenance và instrument spec</summary>
            <div className="rd-import-fields">
              <label className="rd-field"><span>Source ID</span><input name="sourceId" value={form.sourceId} onChange={updateForm} /></label>
              <label className="rd-field"><span>Provider label</span><input name="provider" value={form.provider} onChange={updateForm} /></label>
              <label className="rd-field"><span>License/use</span><input name="licenseUse" value={form.licenseUse} onChange={updateForm} /></label>
              <label className="rd-field"><span>Base currency</span><input name="baseCcy" value={form.baseCcy} onChange={updateForm} /></label>
              <label className="rd-field"><span>Quote currency</span><input name="quoteCcy" value={form.quoteCcy} onChange={updateForm} /></label>
              <label className="rd-field"><span>Account currency</span><input name="accountCcy" value={form.accountCcy} onChange={updateForm} /></label>
              <label className="rd-field"><span>Tick size</span><input name="tickSize" value={form.tickSize} onChange={updateForm} /></label>
              <label className="rd-field"><span>Pip size</span><input name="pipSize" value={form.pipSize} onChange={updateForm} /></label>
              <label className="rd-field"><span>Contract size</span><input name="contractSize" value={form.contractSize} onChange={updateForm} /></label>
              <label className="rd-field"><span>Quantity min</span><input name="quantityMin" value={form.quantityMin} onChange={updateForm} /></label>
              <label className="rd-field"><span>Quantity step</span><input name="quantityStep" value={form.quantityStep} onChange={updateForm} /></label>
              <label className="rd-field"><span>Effective from UTC</span><input name="effectiveFromUtc" value={form.effectiveFromUtc} onChange={updateForm} /></label>
            </div>
          </details>
          <div className="rd-import-actions">
            <button type="button" className="rd-button is-primary" onClick={previewFile} disabled={!upload.file || busy} data-testid="data-desk-preview-button">{t(busy && upload.status !== 'importing' ? 'Đang kiểm tra…' : 'Kiểm tra dữ liệu')}</button>
            <button type="button" className="rd-button" onClick={importFile} disabled={!canImport || busy} data-testid="data-desk-import-button">{t(upload.status === 'importing' ? 'Đang lưu…' : 'Lưu vào kho')}</button>
          </div>
          {upload.file && <p className="rd-import-file-state" data-testid="data-desk-file-state">{upload.file.name} · {(upload.file.size / 1024).toFixed(1)} KiB · {upload.status === 'stale' ? 'Preview cũ; cần chạy lại' : upload.status === 'imported' ? 'Đã import' : 'Chưa gửi lên server'}</p>}
          {upload.preview?.quality?.disposition === 'review' && (
            <label className="rd-import-review-check"><input type="checkbox" checked={Boolean(upload.acceptReview)} onChange={(event) => setUpload((current) => ({ ...current, acceptReview: event.target.checked }))} /> Tôi hiểu dataset đang cần review và chỉ muốn lưu để kiểm tra.</label>
          )}
          {upload.imported && <p className="rd-import-success" role="status" data-testid="data-desk-import-success">Đã thêm dataset <code>{upload.imported.dataset_id}</code> vào catalog workspace.</p>}
        </fieldset>
        <div className="rd-import-report-column">
          {!upload.preview && upload.status === 'idle' && <div className="rd-import-empty" data-testid="data-desk-preview-empty"><strong>Chưa có preview</strong><span>Chọn file CSV, kiểm tra quality, rồi mới quyết định import.</span></div>}
          {!upload.preview && upload.status === 'selected' && <div className="rd-import-empty"><strong>Sẵn sàng kiểm tra</strong><span>File chỉ nằm trong trình duyệt cho tới khi bạn bấm Preview.</span></div>}
          {!upload.preview && upload.status === 'stale' && <div className="rd-import-empty is-warn"><strong>Preview đã cũ</strong><span>Thông tin file hoặc instrument đã đổi; chạy Preview lại trước khi import.</span></div>}
          {upload.status === 'reading' && <div className="rd-import-empty" role="status">Đang đọc file local…</div>}
          {upload.status === 'previewing' && <div className="rd-import-empty" role="status">Đang tạo quality report…</div>}
          {upload.error && <div className="rd-message is-error" role="alert" data-testid="data-desk-import-error">Không xử lý được CSV: {upload.error}</div>}
          {upload.preview && <LocalCsvQualityReport preview={upload.preview} />}
        </div>
      </div>
    </section>
  )
}

export default function DataDeskWorkspace({ workspace = 'tenant-a', query = new URLSearchParams(window.location.search), preview }) {
  const { t, fmt, locale } = useTestingLocale()
  const requestedDataset = query.get('dataset') || ''
  const [state, setState] = useState({ status: 'loading', datasets: [], instruments:[], error: null })
  const [selectedId, setSelectedId] = useState(requestedDataset)
  const [providerFilter, setProviderFilter] = useState('all')
  const [categoryFilter, setCategoryFilter] = useState('all'), [sort, setSort] = useState('asset-asc'), [filtersOpen, setFiltersOpen] = useState(false)
  const [search, setSearch] = useState(''), [page, setPage] = useState(1), [pageSize, setPageSize] = useState(25)
  const [detailsOpen, setDetailsOpen] = useState(Boolean(requestedDataset)), [importAsset, setImportAsset] = useState(null)
  const [catalogRevision, setCatalogRevision] = useState(0)
  const [catalogRetryCount, setCatalogRetryCount] = useState(0)
  const [csvOpen, setCsvOpen] = useState(false), [csvBusy, setCsvBusy] = useState(false)
  const [catalogBusy, setCatalogBusy] = useState(false), [catalogRefreshError, setCatalogRefreshError] = useState(false)
  const [downloadAsset, setDownloadAsset] = useState(null), [downloadBusy, setDownloadBusy] = useState(false)
  const [downloads, setDownloads] = useState({items:[],available:false,receivedAt:0})
  const [downloadRevision, setDownloadRevision] = useState(0), [downloadError, setDownloadError] = useState(''), [pollError,setPollError] = useState('')
  const [jobAction, setJobAction] = useState(''), [clockNow, setClockNow] = useState(Date.now)
  const downloadController = useMemo(() => new AbortController(), [workspace, preview])
  const completedJobs = useRef(new Set())
  const catalogRequestSeq = useRef(0)
  const catalogRetryCountRef = useRef(0)

  useEffect(() => {
    catalogRetryCountRef.current = 0
    setCatalogRetryCount(0)
  }, [workspace])

  useEffect(() => {
    setDownloadAsset(null); setDownloadBusy(false); setDownloadError(''); setPollError(''); setJobAction('')
    setDownloads({items:[],available:false,receivedAt:0})
    completedJobs.current = new Set()
    return () => downloadController.abort()
  }, [downloadController])

  useEffect(() => {
    if (preview) return
    const controller = new AbortController(), scopeSignal = downloadController.signal
    let timer, disposed = false
    const poll = async () => {
      try {
        const payload = await fetchDownloads(workspace, controller.signal)
        if (disposed || scopeSignal.aborted) return
        setDownloads({...payload,receivedAt:Date.now()}); setClockNow(Date.now()); setPollError('')
        const newlyCompleted = payload.items.filter(job => job.status === 'completed' && !completedJobs.current.has(job.job_id))
        if (newlyCompleted.length) {
          newlyCompleted.forEach(job => completedJobs.current.add(job.job_id))
          setCatalogRevision(current => current + 1)
        }
        if (payload.items.some(job => ['queued','running'].includes(job.status))) timer = setTimeout(poll,2000)
      } catch (error) {
        if (!disposed && !scopeSignal.aborted && error.name !== 'AbortError') setPollError('Không đọc được tiến độ tải. Thử lại để xem trạng thái hiện tại.')
      }
    }
    poll()
    return () => { disposed = true; controller.abort(); clearTimeout(timer) }
  }, [workspace,preview,downloadRevision,downloadController])

  useEffect(() => {
    if (!downloads.items.some(job => job.retry_after_seconds > 0)) return
    const timer = setInterval(() => setClockNow(Date.now()),1000)
    return () => clearInterval(timer)
  }, [downloads])

  const activeDownload = downloads.items.some(job => ['queued','running'].includes(job.status))
  const changeDownload = async (job, action) => {
    if (jobAction) return
    const signal = downloadController.signal
    setJobAction(job.job_id); setDownloadError('')
    try { await updateDownload(workspace,job.job_id,action,signal); if (!signal.aborted) setDownloadRevision(current => current + 1) }
    catch (error) { if (!signal.aborted) setDownloadError(downloadErrorMessage(error)) }
    finally { if (!signal.aborted) setJobAction('') }
  }

  useEffect(() => {
    if (preview) {
      setState({ status:'ready', datasets:preview.datasets, instruments:preview.instruments || [], error:null })
      setSelectedId(current => current || preview.datasets[0]?.dataset_id || '')
      return
    }
    const controller = new AbortController()
    const requestSeq = ++catalogRequestSeq.current
    setCatalogBusy(false)
    setCatalogRefreshError(false)
    setState((current) => ({ ...current, status: 'loading', error: null }))
    fetchOfflineLibrary(workspace, controller.signal)
      .then(async payload => {
        if (requestSeq !== catalogRequestSeq.current || controller.signal.aborted) return
        // Only bootstrap an empty configured catalog. Cached/stale reads never poll the provider.
        if (payload.catalog?.status === 'empty' && payload.catalog.configured && !payload.catalog.error) {
          try { payload = { ...payload, ...await refreshInstrumentCatalog(workspace, controller.signal) } }
          catch (error) { if (error.name === 'AbortError') return; setCatalogRefreshError(true) }
        }
        const { datasets, instruments, catalog, download } = payload
        if (requestSeq !== catalogRequestSeq.current) return
        setState({ status: 'ready', datasets, instruments, catalog, download, error: null })
        catalogRetryCountRef.current = 0
        setCatalogRetryCount(0)
        setSelectedId((current) => current || datasets[0]?.dataset_id || '')
      })
      .catch((error) => {
        if (error.name !== 'AbortError' && requestSeq === catalogRequestSeq.current) {
          setState({ status: 'error', datasets: [], instruments:[], error: String(error.message || error) })
        }
      })
    return () => controller.abort()
  }, [catalogRevision, workspace, preview])

  const retryCatalog = () => {
    if (catalogRetryCountRef.current >= MAX_GET_RETRIES || state.status === 'loading') return
    catalogRetryCountRef.current += 1
    setCatalogRetryCount(catalogRetryCountRef.current)
    setCatalogRevision((current) => current + 1)
  }

  const catalogRetryExhausted = catalogRetryCount >= MAX_GET_RETRIES

  useEffect(() => {
    const catalog = state.catalog
    if (!catalog?.configured || catalog.refresh_available || !catalog.retry_after_seconds) return
    const timer = setTimeout(() => setState(current => ({ ...current, catalog:{ ...current.catalog, refresh_available:true, retry_after_seconds:0 } })), catalog.retry_after_seconds * 1000)
    return () => clearTimeout(timer)
  }, [state.catalog])

  const refreshCatalog = async () => {
    if (catalogBusy || !state.catalog?.refresh_available) return
    const requestSeq = catalogRequestSeq.current
    setCatalogBusy(true)
    setCatalogRefreshError(false)
    try {
      const payload = await refreshInstrumentCatalog(workspace)
      if (requestSeq === catalogRequestSeq.current) setState(current => ({ ...current, ...payload }))
    } catch { if (requestSeq === catalogRequestSeq.current) setCatalogRefreshError(true) }
    finally { if (requestSeq === catalogRequestSeq.current) setCatalogBusy(false) }
  }
  const catalogError = catalogRefreshError ? 'source_unavailable' : state.catalog?.error
  const catalogMessages = { rate_limited:'Dukascopy đang giới hạn yêu cầu. Hãy thử lại sau.', source_unavailable:'Không cập nhật được danh sách Dukascopy.', invalid_response:'Danh sách Dukascopy trả về không hợp lệ.', invalid_cache:'Bản lưu danh sách Dukascopy không hợp lệ.', cache_write_failed:'Không lưu được danh sách Dukascopy.' }
  const catalogMessage = catalogMessages[catalogError] || (state.catalog?.stale ? 'Danh sách Dukascopy đã cũ.' : '')

  const rows = useMemo(() => libraryRows(state.datasets, state.instruments), [state.datasets, state.instruments])
  const sources = [...new Set(rows.map(sourceOf))].sort()
  const filteredDatasets = useMemo(() => filterLibrary(rows,{category:categoryFilter,provider:providerFilter,search,sort}), [categoryFilter,providerFilter,search,sort,rows])
  const selected = state.datasets.find(item => item.dataset_id === selectedId) || null
  const pages = Math.max(1, Math.ceil(filteredDatasets.length / pageSize)), currentPage = Math.min(page, pages)
  const pageItems = filteredDatasets.slice((currentPage - 1) * pageSize, currentPage * pageSize)
  useEffect(() => setPage(1), [categoryFilter,providerFilter,search,sort,pageSize])

  const openCsv = (asset = null) => { setImportAsset(asset); setCsvBusy(false); setCsvOpen(true) }
  const openDetails = asset => { setSelectedId(asset.dataset_id); setDetailsOpen(true) }
  const openDownload = asset => { setDownloadBusy(false); setDetailsOpen(false); setDownloadAsset(asset) }
  const visibleDownloads = downloads.items.filter(job => ['queued', 'running', 'paused', 'failed'].includes(job.status))
  const eligibleDownload = asset => canDownloadAsset(asset,state.download,preview) && !activeDownload && !jobAction

  return (
    <section className="rd-shell wm-page data-library" data-testid="data-desk-root" aria-label={t('Market Data')}>
      <div className="data-library-toolbar">
        <label className="data-library-search"><TestingIcon kind="search" /><input type="search" aria-label={t('Tìm asset')} placeholder={t('Tìm asset…')} value={search} onChange={event => setSearch(event.target.value)} /></label>
        <div className="data-library-filters">
          <button type="button" className="fxa-button fxa-icon-button data-library-filter-toggle" aria-label={t(filtersOpen ? 'Ẩn bộ lọc dữ liệu' : 'Hiện bộ lọc dữ liệu')} aria-expanded={filtersOpen} onClick={() => { if (filtersOpen) { setCategoryFilter('all'); setProviderFilter('all') } setFiltersOpen(!filtersOpen) }}>{filtersOpen ? '×' : <FilterIcon kind="filter" />}</button>
          {filtersOpen && <><FxSelect label={t('Danh mục')} value={categoryFilter} onChange={setCategoryFilter} options={[{value:'all',label:'Tất cả danh mục'}, ...CATEGORIES.map(([value,label]) => ({value,label})), ...(rows.some(item => !categoryOf(item)) ? [{value:'',label:'Chưa phân loại'}] : [])]} /><FxSelect label={t('Nguồn dữ liệu')} value={providerFilter} onChange={setProviderFilter} options={[{value:'all',label:'Tất cả nguồn'}, ...sources.map(value => ({value,label:value,localize:false}))]} /></>}
          <FxSelect label={t('Sắp xếp dữ liệu')} value={sort} icon="sort" onChange={setSort} options={[{value:'asset-asc',label:'Tên A–Z'},{value:'asset-desc',label:'Tên Z–A'},{value:'downloaded',label:'Đã tải trước'},{value:'newest',label:'Mới lưu nhất'}]} />
          {state.catalog && <button type="button" className="fxa-button data-library-refresh" onClick={refreshCatalog} disabled={Boolean(preview) || state.status !== 'ready' || catalogBusy || !state.catalog.refresh_available} aria-busy={catalogBusy} title={state.catalog.retrieved_at_utc ? `${t('Danh sách cập nhật lúc')} ${formatUtc(state.catalog.retrieved_at_utc, locale)}` : t('Lấy danh sách tài sản Dukascopy')}><TestingIcon kind="history" />{t(catalogBusy ? 'Đang cập nhật…' : 'Cập nhật danh sách')}</button>}
          <button type="button" className="fxa-button data-library-import" disabled={Boolean(preview)} onClick={() => openCsv()}><TestingIcon kind="upload" />{t('Nhập CSV')}</button>
        </div>
      </div>

      {state.status === 'loading' && <div className="rd-message" role="status">{t('Đang đọc dữ liệu đã lưu…')}</div>}
      {state.status === 'ready' && catalogMessage && <p className="data-library-catalog-status" role="status">{t(catalogMessage)}{state.catalog?.status === 'cached' && ` ${t('Đang dùng bản đã lưu.')}`}</p>}
      {state.status === 'ready' && requestedDataset && !selected && <p className="data-library-catalog-status" role="status">{t('Dataset trong đường dẫn chưa có trong kho này. Hãy chọn dữ liệu khác.')}</p>}
      {state.status === 'error' && <div className="rd-message is-error" role="alert">{t('Không đọc được kho dữ liệu:')} {state.error} <button type="button" className="rd-inline-button" data-testid="data-desk-retry" onClick={retryCatalog} disabled={catalogRetryExhausted} aria-describedby={catalogRetryExhausted ? 'data-desk-retry-note' : undefined}>{t(catalogRetryExhausted ? 'Đã hết lượt thử' : 'Thử lại')}</button>{catalogRetryExhausted && <small id="data-desk-retry-note">{t('Kiểm tra nguồn dữ liệu trước khi thử lại.')}</small>}</div>}

      {(downloadError || pollError) && <p className="data-library-download-error" role="alert">{t(downloadError || pollError)} <button type="button" className="rd-inline-button" onClick={() => {setDownloadError(''); setDownloadRevision(current => current + 1)}}>{t('Thử lại')}</button></p>}
      {visibleDownloads.length > 0 && <section className="data-library-download-jobs" aria-label={t('Tiến độ tải dữ liệu')}>
        {visibleDownloads.map(job => {
          const retrySeconds = Math.max(0,Math.ceil((job.retry_after_seconds || 0) - (clockNow - downloads.receivedAt) / 1000))
          const active = ['queued','running'].includes(job.status)
          return <div key={job.job_id} className="data-library-download-job" data-testid={`download-job-${job.job_id}`}>
            <div className="data-library-job-heading"><strong>{job.instrument_id}</strong><span>{job.from_date} → {job.to_date}</span><span role="status">{t(DOWNLOAD_STATUS[job.status] || 'Chưa xác định')} · {fmt(job.completed_days,'',0)} / {fmt(job.total_days,'',0)} {t('ngày')}</span></div>
            {active && <progress aria-label={t('Tiến độ tải {asset}',{asset:job.instrument_id})} value={job.completed_days || 0} max={Math.max(1,job.total_days || 1)} />}
            {job.error && <p className="data-library-job-error">{t(downloadErrorMessage(job.error))}</p>}
            <div className="data-library-job-actions">{retrySeconds > 0 && <span>{t('Thử lại sau {seconds} giây',{seconds:retrySeconds})}</span>}
              {['paused','failed'].includes(job.status) && <button type="button" className="rd-button" disabled={!downloads.available || activeDownload || Boolean(jobAction) || retrySeconds > 0} onClick={() => changeDownload(job,'resume')}>{t('Tiếp tục tải')}</button>}
              {['queued','running','paused','failed'].includes(job.status) && <button type="button" className="rd-button" disabled={Boolean(jobAction)} onClick={() => changeDownload(job,'cancel')}>{t('Huỷ tải')}</button>}
            </div>
          </div>
        })}
      </section>}

      {state.status === 'ready' && (
        <div className="data-library-grid">
          <section className="rd-panel" aria-label="Dataset catalog">
              <div className="rd-table-wrap" tabIndex={0} role="region" aria-label={t('Dữ liệu đã có')}>
                <table className="rd-table" data-testid="data-desk-dataset-table">
                  <thead><tr>{['Sản phẩm','Danh mục','Nguồn','Lịch sử UTC','Số nến','Chất lượng','Thao tác'].map(label => <th key={label} scope="col">{t(label)}</th>)}</tr></thead>
                  <tbody>
                    {pageItems.map((dataset) => {
                      const range = datasetRange(dataset)
                      const active = Boolean(dataset.dataset_id && dataset.dataset_id === selected?.dataset_id)
                      return (
                        <tr key={dataset.key} className={active ? 'is-selected' : ''}>
                          <td>{dataset.downloaded ? <button type="button" data-testid={`dataset-row-${dataset.dataset_id}`} aria-pressed={active} onClick={() => openDetails(dataset)}><strong>{dataset.instrument_id || '—'}</strong><small>{dataset.timeframe || '—'}</small></button> : <><strong>{dataset.instrument_id}</strong>{dataset.name && <small>{dataset.name}</small>}</>}</td>
                          <td>{t(categoryLabel(categoryOf(dataset)))}</td>
                          <td>{sourceOf(dataset)}</td>
                          <td>{dataset.downloaded ? <>{t(formatUtc(range.start, locale))}<small>→ {t(formatUtc(range.end, locale))}</small></> : '—'}</td>
                          <td>{fmt(dataset.row_count, '', 0)}</td>
                          <td>{dataset.downloaded ? <QualityBadge dataset={dataset} /> : <span className="data-library-muted">{t('Chưa tải')}</span>}</td>
                          <td><div className="data-library-row-actions"><button type="button" className="rd-button data-library-download" disabled={dataset.downloaded || !eligibleDownload(dataset)} onClick={() => openDownload(dataset)} title={t(dataset.downloaded ? 'Dữ liệu đã được lưu trong kho' : activeDownload ? 'Đang có một lượt tải khác.' : eligibleDownload(dataset) ? 'Tải lịch sử Dukascopy' : 'Nguồn chưa hỗ trợ tải trực tiếp trong ứng dụng')}><TestingIcon kind="download" />{t(dataset.downloaded ? 'Đã tải' : 'Tải về')}</button><DataLibraryActions asset={dataset} onDetails={openDetails} onImport={openCsv} onDownload={openDownload} canDownload={eligibleDownload(dataset)} disabled={Boolean(preview) || state.status !== 'ready'} /></div></td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            {!filteredDatasets.length && rows.length > 0 && <div className="rd-message is-empty" data-testid="data-desk-empty">{t('Không có dữ liệu phù hợp bộ lọc.')}</div>}
            <PaginationFooter label="Phân trang kho dữ liệu" page={currentPage} pages={pages} onPageChange={setPage} pageSize={pageSize} onPageSizeChange={value => { setPageSize(value); setPage(1) }} sizes={[10,25,50,100]} />
          </section>

        </div>
      )}
      {csvOpen && <DataLibraryDialog title="Nhập CSV" busy={csvBusy} onClose={() => setCsvOpen(false)}><LocalCsvImport
        workspace={workspace}
        asset={importAsset}
        onBusyChange={setCsvBusy}
        onImported={(dataset) => {
          setCsvOpen(false)
          setSelectedId(dataset?.dataset_id || '')
          setSearch('')
          setProviderFilter('all')
          setCategoryFilter('all')
          setPage(1)
          setDetailsOpen(true)
          setCatalogRevision((current) => current + 1)
        }}
      /></DataLibraryDialog>}
      {downloadAsset && <DataLibraryDialog compact title="Tải dữ liệu lịch sử" busy={downloadBusy} onClose={() => setDownloadAsset(null)}><DownloadForm key={downloadAsset.key} asset={downloadAsset} earliestDate={state.download?.earliest_dates?.[downloadAsset.instrument_id]} workspace={workspace} signal={downloadController.signal} onBusyChange={setDownloadBusy} onStarted={() => { setDownloadAsset(null); setDownloadRevision(current => current + 1) }} /></DataLibraryDialog>}
      {detailsOpen && selected && !csvOpen && !downloadAsset && <DataLibraryDialog title="Chi tiết dữ liệu và chất lượng" onClose={() => setDetailsOpen(false)}><DatasetDetails dataset={selected} workspace={workspace} query={query} /></DataLibraryDialog>}
    </section>
  )
}
