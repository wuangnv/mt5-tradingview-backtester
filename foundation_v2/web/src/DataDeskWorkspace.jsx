import ProjectDateInput from './ProjectDateInput.jsx'
import { displayDate } from './dateFormat.js'
import React, { useEffect, useId, useMemo, useRef, useState } from 'react'
import {
  datasetRange,
  formatNumber,
  formatUtc,
  holdoutLabel,
  qualityLabel,
  datasetWarnings,
} from './researchDataApi.js'
import { fetchOfflineLibrary, refreshInstrumentCatalog, importLocalCsv, previewLocalCsv, fetchDownloads, startDownload, updateDownload, deleteLocalDataset } from './dataDeskApi.js'
import './research-data.css'
import { useTestingLocale } from './testingLocale.jsx'
import { buildWorkspaceHref } from './workspaceContext.js'
import FxSelect from './FxSelect.jsx'
import TestingIcon from './TestingIcon.jsx'
import DataLibraryActions from './DataLibraryActions.jsx'
import DataLibraryProgress from './DataLibraryProgress.jsx'
import { sampleDownloadMetrics, downloadRetrySeconds } from './dataLibraryDownloadMetrics.js'
import PaginationFooter from './PaginationFooter.jsx'
import { CATEGORIES, libraryDataType, categoryOf, categoryLabel, filterLibrary, libraryRows, sourceOf, downloadEngineOf, canDownloadAsset, defaultDownloadDates } from './dataLibraryModel.js'
import './data-library.css'
import './session-settings.css'

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
        <div><dt>{t('Nguồn dữ liệu')}</dt><dd>{sourceOf(dataset)}</dd></div>
        {downloadEngineOf(dataset) === 'QuantDataManager' && <div><dt>{t('Công cụ tải')}</dt><dd>QuantDataManager (QDM) · CLI</dd></div>}
        <div><dt>Instrument / TF</dt><dd>{dataset.instrument_id || 'N/A'} · {dataset.timeframe || 'N/A'}</dd></div>
        <div><dt>{t('Số nến')}</dt><dd>{fmt(dataset.row_count, '', 0)}</dd></div>
        <div><dt>Range UTC</dt><dd>{t(formatUtc(range.start, locale))} → {t(formatUtc(range.end, locale))}</dd></div>
        <div><dt>License</dt><dd>{source.license_use || 'Chưa xác minh'}</dd></div>
        <div><dt>Quality</dt><dd><QualityBadge dataset={dataset} /></dd></div>
        {Array.isArray(dataset.quality?.gaps) && <div><dt>{t('Khoảng trống dữ liệu')}</dt><dd>{fmt(dataset.quality.gap_count ?? dataset.quality.gaps.length,'',0)}</dd></div>}
        <div><dt>{t('Dung lượng')}</dt><dd>{formatDatasetSize(dataset.size_bytes, fmt)}</dd></div>
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

function DataLibraryDialog({ title, busy = false, onClose, compact = false, drawer = false, blockingStatus, children }) {
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
  useEffect(() => {
    if (drawer && busy) dialog.current?.focus()
    else if (drawer && document.activeElement === dialog.current) dialog.current?.querySelector('button:not(:disabled)')?.focus()
  },[drawer,busy])
  const close = () => { if (!busy) onClose() }
  return <dialog ref={dialog} tabIndex={drawer ? -1 : undefined} className={drawer ? 'fxs-settings-drawer data-library-catalog-drawer' : `data-library-dialog${compact ? ' is-compact' : ''}`} aria-labelledby={id} aria-busy={busy} onCancel={event => { event.preventDefault(); close() }} onKeyDown={event => {
    if (!drawer || event.key !== 'Tab') return
    const elements = [...event.currentTarget.querySelectorAll('button, input, [href], [tabindex]')].filter(element => !element.disabled && !element.closest('[inert]') && element.tabIndex >= 0 && element.getClientRects().length)
    const first = elements[0], last = elements[elements.length - 1]
    if (!first || (event.shiftKey && document.activeElement === first) || (!event.shiftKey && document.activeElement === last)) { event.preventDefault(); (event.shiftKey ? last : first)?.focus() }
  }} onClick={event => {
    if (event.target !== dialog.current) return
    const bounds = dialog.current.getBoundingClientRect()
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) close()
  }}>
    {drawer ? <><button type="button" className="fxs-drawer-close fx-chart-icon-button" aria-label={t('Đóng')} disabled={busy} onClick={close}>×</button><header><h2 id={id}>{t(title)}</h2></header></> : <header className="data-library-dialog-header"><h2 id={id}>{t(title)}</h2><button type="button" className="fx-chart-icon-button" aria-label={t('Đóng')} disabled={busy} onClick={close}>×</button></header>}
    <div className={drawer ? 'fxs-settings-panel' : 'data-library-dialog-body'} inert={drawer && busy}>{children}</div>
    {drawer && busy && blockingStatus}
  </dialog>
}

const DOWNLOAD_STATUS = { queued:'Đang chờ tải', running:'Đang tải', pausing:'Đang tạm dừng…', paused:'Đã tạm dừng', failed:'Tải thất bại', completed:'Đã lưu vào kho', cancelled:'Đã huỷ tải' }
const DOWNLOAD_ERRORS = { source_access_challenge:'Dukascopy yêu cầu xác minh truy cập. Bộ tải tự động chưa thể tiếp tục; dữ liệu đã tải được giữ lại.', source_rate_limited:'Dukascopy đang giới hạn yêu cầu. Có thể tiếp tục sau thời gian chờ.', source_unavailable:'Không kết nối được Dukascopy. Tiến độ đã tải được giữ lại.', invalid_source_data:'Dữ liệu nguồn không hợp lệ; chưa lưu vào kho.', empty_range:'Không có dữ liệu trong khoảng ngày đã chọn.', worker_unavailable:'Bộ tải dữ liệu chưa sẵn sàng.', download_interrupted:'Tải bị gián đoạn. Có thể tiếp tục từ tiến độ đã lưu.', quality_rejected:'Dữ liệu chưa đạt kiểm tra chất lượng; chưa lưu vào kho.', download_busy:'Đang có một lượt tải khác. Hãy chờ hoặc huỷ lượt đó.', invalid_date_range:'Chọn khoảng ngày hợp lệ.', instrument_not_supported:'Tài sản này chưa hỗ trợ tải.', download_cooldown:'Chưa hết thời gian chờ. Hãy thử lại sau.', download_cancelled:'Lượt tải đã huỷ. Hãy bắt đầu lượt tải mới.', download_not_found:'Không tìm thấy lượt tải này.' }
const downloadErrorMessage = error => {
  const code = typeof error === 'string' ? error : error?.payload?.detail?.code || error?.payload?.detail || error?.message
  return code === 'already_current' ? 'Dữ liệu đã cập nhật đến ngày mới nhất.' : QDM_ERRORS[code] || DOWNLOAD_ERRORS[code] || 'Không xử lý được lượt tải. Hãy thử lại.'
}
const QDM_ERRORS = { qdm_catalog_missing:'Không tìm thấy danh mục Dukascopy trong bộ cài QDM. Kiểm tra lại bộ cài.', qdm_catalog_invalid:'Danh mục trong bộ cài QDM không hợp lệ. Giữ danh sách đã đọc thành công trước đó.', qdm_busy:'QuantDataManager đang mở hoặc đang chạy lệnh khác. Đóng ứng dụng sau khi hoàn tất rồi thử lại.', qdm_not_configured:'Chưa cài QuantDataManager trong project.', qdm_license_required:'QuantDataManager cần license hợp lệ. Hãy kích hoạt trong ứng dụng QDM.', qdm_version_unsupported:'Bản QuantDataManager này chưa hỗ trợ định dạng xuất cần thiết.', qdm_command_failed:'Lệnh QuantDataManager không hoàn tất. Kiểm tra QDM trước khi thử lại.', qdm_symbol_mismatch:'Cấu hình tài sản trong QDM không khớp nguồn Dukascopy/M1.', qdm_control_unsupported:'QDM CLI chưa hỗ trợ tạm dừng hoặc huỷ an toàn giữa lệnh.' }

function formatDatasetSize(bytes, fmt) {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  const unit = bytes >= 1024 ** 3 ? 'GiB' : bytes >= 1024 ** 2 ? 'MiB' : bytes >= 1024 ? 'KiB' : 'B'
  const divisor = {GiB:1024 ** 3,MiB:1024 ** 2,KiB:1024,B:1}[unit]
  return `${fmt(bytes / divisor, '', unit === 'B' ? 0 : 1)} ${unit}`
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
              <label className="rd-field"><span>Effective from UTC</span><ProjectDateInput type="datetime-local" step="1" utc name="effectiveFromUtc" value={form.effectiveFromUtc} onChange={updateForm} /></label>
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
  const [catalogProvider, setCatalogProvider] = useState('all')
  const [categoryFilter, setCategoryFilter] = useState('all'), [sort, setSort] = useState('asset-asc'), [downloadFilter, setDownloadFilter] = useState('downloaded')
  const [search, setSearch] = useState(''), [page, setPage] = useState(1), [pageSize, setPageSize] = useState(25)
  const [detailsOpen, setDetailsOpen] = useState(Boolean(requestedDataset)), [importAsset, setImportAsset] = useState(null)
  const [catalogRevision, setCatalogRevision] = useState(0)
  const [catalogRetryCount, setCatalogRetryCount] = useState(0)
  const [csvOpen, setCsvOpen] = useState(false), [csvBusy, setCsvBusy] = useState(false)
  const [catalogBusy, setCatalogBusy] = useState(false), [catalogRefreshError, setCatalogRefreshError] = useState(false)
  const [catalogOpen, setCatalogOpen] = useState(false), [catalogElapsed, setCatalogElapsed] = useState(0), [catalogUpdated, setCatalogUpdated] = useState(false)
  const [startingAsset, setStartingAsset] = useState(''), [downloadProgressOpen, setDownloadProgressOpen] = useState(false)
  const [deleteAsset, setDeleteAsset] = useState(null), [deleteBusy, setDeleteBusy] = useState(false), [deleteError, setDeleteError] = useState('')
  const [downloads, setDownloads] = useState({items:[],available:false,receivedAt:0})
  const [downloadRevision, setDownloadRevision] = useState(0), [downloadError, setDownloadError] = useState(''), [pollError,setPollError] = useState('')
  const [jobAction, setJobAction] = useState(''), [clockNow, setClockNow] = useState(Date.now)
  const downloadController = useMemo(() => new AbortController(), [workspace, preview])
  const completedJobs = useRef(new Set())
  const downloadSamples = useRef(new Map())
  const catalogRequestSeq = useRef(0)
  const catalogRetryCountRef = useRef(0)

  useEffect(() => setCatalogProvider(providerFilter), [providerFilter, workspace])

  useEffect(() => {
    catalogRetryCountRef.current = 0
    setCatalogRetryCount(0)
  }, [workspace])

  useEffect(() => {
    setCatalogOpen(false); setCatalogUpdated(false); setCatalogBusy(false)
    setStartingAsset(''); setDownloadProgressOpen(false); setDownloadError(''); setPollError(''); setJobAction('')
    setDownloads({items:[],available:false,receivedAt:0})
    completedJobs.current = new Set()
    downloadSamples.current = new Map()
    setDeleteAsset(null); setDeleteBusy(false); setDeleteError('')
    return () => downloadController.abort()
  }, [downloadController])

  useEffect(() => {
    if (preview) return
    const controller = new AbortController(), scopeSignal = downloadController.signal
    let timer, disposed = false, failures = 0
    const poll = async () => {
      try {
        const payload = await fetchDownloads(workspace, controller.signal)
        if (disposed || scopeSignal.aborted) return
        const now = Date.now()
        const items = payload.items.map(job => {
          const { state: sample, metrics } = sampleDownloadMetrics(downloadSamples.current.get(job.job_id),job,now)
          downloadSamples.current.set(job.job_id,sample)
          return {...job,...metrics}
        })
        failures = 0
        setDownloads({...payload,items,receivedAt:now}); setClockNow(now); setPollError('')
        const newlyCompleted = payload.items.filter(job => job.status === 'completed' && !completedJobs.current.has(job.job_id))
        if (newlyCompleted.length) {
          newlyCompleted.forEach(job => completedJobs.current.add(job.job_id))
          setCatalogRevision(current => current + 1)
        }
        // Keep observing paused jobs and changes from other tabs/API restarts without retrying downloads.
        timer = setTimeout(poll,payload.items.some(job => ['queued','running','pausing'].includes(job.status)) ? 2000 : 15000)
      } catch (error) {
        if (!disposed && !scopeSignal.aborted && error.name !== 'AbortError') {
          setPollError('Không đọc được tiến độ tải. Thử lại để xem trạng thái hiện tại.')
          timer = setTimeout(poll,Math.min(30000,5000 * 2 ** failures++))
        }
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

  const activeDownload = downloads.items.some(job => ['queued','running','pausing'].includes(job.status))
  const changeDownload = async (job, action) => {
    if (jobAction) return
    const signal = downloadController.signal
    setJobAction(job.job_id); setDownloadError('')
    try {
      const updated = await updateDownload(workspace,job.job_id,action,signal)
      if (!signal.aborted) {
        setDownloads(current => ({...current,items:current.items.map(item => item.job_id === job.job_id ? updated : item)}))
        setDownloadRevision(current => current + 1)
      }
    }
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
    setCatalogRefreshError(false)
    setState((current) => ({ ...current, status: current.status === 'ready' ? 'ready' : 'loading', error: null }))
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
    if (preview || state.status !== 'ready' || catalogBusy || !catalogSourceSelected || !state.catalog?.refresh_available) return
    const requestSeq = catalogRequestSeq.current
    const controller = new AbortController(), scopeSignal = downloadController.signal
    const abort = () => controller.abort()
    if (scopeSignal.aborted) return
    scopeSignal.addEventListener('abort', abort, {once:true})
    const timeout = setTimeout(abort,45000)
    setCatalogBusy(true)
    setCatalogRefreshError(false)
    setCatalogUpdated(false)
    try {
      const payload = await refreshInstrumentCatalog(workspace,controller.signal)
      if (!scopeSignal.aborted) {
        if (requestSeq === catalogRequestSeq.current) setState(current => ({ ...current, ...payload }))
        else setCatalogRevision(current => current + 1)
        setCatalogUpdated(!payload.catalog?.error && payload.catalog?.status === 'cached')
      }
    } catch { if (!scopeSignal.aborted) setCatalogRefreshError(true) }
    finally { clearTimeout(timeout); scopeSignal.removeEventListener('abort',abort); if (!scopeSignal.aborted) setCatalogBusy(false) }
  }
  useEffect(() => {
    if (!catalogBusy) return
    const started=Date.now()
    setCatalogElapsed(0)
    const timer=setInterval(()=>setCatalogElapsed(Math.floor((Date.now()-started)/1000)),1000)
    return ()=>clearInterval(timer)
  },[catalogBusy])
  const catalogError = catalogRefreshError ? 'source_unavailable' : state.catalog?.error
  const catalogMessages = { ...QDM_ERRORS, rate_limited:'Dukascopy đang giới hạn yêu cầu. Hãy thử lại sau.', source_unavailable:'Không cập nhật được danh sách Dukascopy.', invalid_response:'Danh sách Dukascopy trả về không hợp lệ.', invalid_cache:'Bản lưu danh sách Dukascopy không hợp lệ.', cache_write_failed:'Không lưu được danh sách Dukascopy.' }
  const catalogMessage = catalogMessages[catalogError] || (state.catalog?.stale ? 'Danh sách Dukascopy đã cũ.' : '')

  const rows = useMemo(() => libraryRows(state.datasets, state.instruments, downloads.items), [state.datasets, state.instruments, downloads.items])
  const catalogSource = state.catalog ? sourceOf(state.catalog) : 'Dukascopy'
  const sources = [...new Set([...rows.map(sourceOf), ...(state.catalog ? [catalogSource] : [])])].sort()
  const sourceOptions = [{value:'all',label:'Tất cả nguồn'}, ...sources.map(value => ({value,label:value,localize:false}))]
  const catalogSourceSelected = catalogProvider === 'all' || catalogProvider === catalogSource
  const sourceRows = rows.filter(item => catalogProvider === 'all' || sourceOf(item) === catalogProvider)
  const sourceAssetCount = new Set(sourceRows.map(item => JSON.stringify([sourceOf(item),item.instrument_id]))).size
  const latestSourceSave = sourceRows.map(item => item.created_at_utc || item.source?.retrieved_at_utc).filter(value => Number.isFinite(Date.parse(value))).sort((a,b) => Date.parse(b)-Date.parse(a))[0]
  const filteredDatasets = useMemo(() => filterLibrary(rows,{category:categoryFilter,provider:providerFilter,downloadStatus:downloadFilter,search,sort}), [categoryFilter,providerFilter,downloadFilter,search,sort,rows])
  const selected = state.datasets.find(item => item.dataset_id === selectedId) || null
  const pages = Math.max(1, Math.ceil(filteredDatasets.length / pageSize)), currentPage = Math.min(page, pages)
  const pageItems = filteredDatasets.slice((currentPage - 1) * pageSize, currentPage * pageSize)
  useEffect(() => setPage(1), [categoryFilter,providerFilter,downloadFilter,search,sort,pageSize])
  const filtersApplied = categoryFilter !== 'all' || providerFilter !== 'all' || downloadFilter !== 'all' || Boolean(search)
  const clearFilters = () => { setCategoryFilter('all'); setProviderFilter('all'); setDownloadFilter('all'); setSearch(''); setPage(1) }

  const openCsv = (asset = null) => { setImportAsset(asset); setCsvBusy(false); setCsvOpen(true) }
  const openDetails = asset => { setSelectedId(asset.dataset_id); setDetailsOpen(true) }
  const openDownload = async asset => {
    if (!eligibleDownload(asset) || startingAsset) return
    const signal = downloadController.signal
    setStartingAsset(asset.instrument_id); setDetailsOpen(false); setDownloadError('')
    try {
      const job = await startDownload(workspace,{instrument_id:asset.instrument_id,...(asset.downloaded ? {dataset_id:asset.dataset_id} : {})},signal)
      if (!signal.aborted) {
        setDownloadFilter(current => current === 'not-downloaded' ? 'downloading' : current)
        downloadSamples.current.set(job.job_id,sampleDownloadMetrics(null,job,Date.now()).state)
        setDownloads(current => ({...current,items:[job,...current.items.filter(item => item.job_id !== job.job_id)],receivedAt:Date.now()}))
        setDownloadRevision(current => current + 1)
      }
    } catch(error) { if (!signal.aborted) setDownloadError(downloadErrorMessage(error)) }
    finally { if (!signal.aborted) setStartingAsset('') }
  }
  const visibleDownloads = downloads.items.filter(job => ['queued', 'running', 'pausing', 'paused', 'failed'].includes(job.status))
  useEffect(() => { if (!visibleDownloads.length) setDownloadProgressOpen(false) }, [downloads.items])
  const eligibleDownload = asset => state.download?.supports_full === true && canDownloadAsset(asset,state.download,preview) && !activeDownload && !jobAction && !deleteBusy && !startingAsset
  const jobForAsset = asset => asset.downloadJob
  const openDelete = asset => { setDetailsOpen(false); setDeleteError(''); setDeleteAsset(asset) }
  const removeDataset = async () => {
    if (!deleteAsset?.dataset_id || deleteBusy || preview) return
    const signal = downloadController.signal
    setDeleteBusy(true); setDeleteError('')
    try {
      await deleteLocalDataset(workspace,deleteAsset.dataset_id,signal)
      if (!signal.aborted) {
        setState(current => ({...current,datasets:current.datasets.filter(item => item.dataset_id !== deleteAsset.dataset_id)}))
        setSelectedId(current => current === deleteAsset.dataset_id ? '' : current)
        setDeleteAsset(null)
        setCatalogRevision(current => current + 1)
      }
    } catch (error) {
      if (!signal.aborted) setDeleteError(error.payload?.detail === 'dataset_in_use' ? 'Dữ liệu đang được một phiên hoặc lần nghiên cứu sử dụng.' : 'Không xoá được dữ liệu. Hãy thử lại.')
    } finally { if (!signal.aborted) setDeleteBusy(false) }
  }

  return (
    <section className="rd-shell wm-page data-library" data-testid="data-desk-root" aria-label={t('Market Data')}>
      <div className="data-library-toolbar">
        <label className="data-library-search"><TestingIcon kind="search" /><input type="search" aria-label={t('Tìm asset')} placeholder={t('Tìm asset…')} value={search} onChange={event => setSearch(event.target.value)} /></label>
        <div className="data-library-filters">
          <FxSelect label={t('Danh mục')} value={categoryFilter} onChange={setCategoryFilter} options={[{value:'all',label:'Tất cả danh mục'}, ...CATEGORIES.map(([value,label]) => ({value,label})), ...(rows.some(item => !categoryOf(item)) ? [{value:'',label:'Chưa phân loại'}] : [])]} />
          <FxSelect label={t('Nguồn dữ liệu')} value={providerFilter} onChange={setProviderFilter} options={sourceOptions} />
          <FxSelect className="data-library-status" label={t('Trạng thái tải')} value={downloadFilter} onChange={setDownloadFilter} options={[{value:'downloaded',label:'Đã tải'},{value:'downloading',label:'Đang tải'},{value:'not-downloaded',label:'Chưa tải'},{value:'all',label:'Tất cả trạng thái'}]} />
          <FxSelect className="data-library-sort" label={t('Sắp xếp dữ liệu')} value={sort} icon="sort" onChange={setSort} options={[{value:'asset-asc',label:'Tên A–Z'},{value:'asset-desc',label:'Tên Z–A'},{value:'newest',label:'Mới cập nhật'}]} />
          <button type="button" className="fxa-clear-filters" disabled={!filtersApplied} onClick={clearFilters}><TestingIcon kind="delete" />{t('Clear filters')}</button>
          {state.catalog && <button type="button" className="data-library-catalog-trigger" onClick={() => setCatalogOpen(true)} aria-haspopup="dialog" aria-expanded={catalogOpen}>{t('Danh mục tài sản')}</button>}
          <button type="button" className="fxa-button is-primary data-library-import" disabled={Boolean(preview)} onClick={() => openCsv()}><TestingIcon kind="upload" />{t('Nhập CSV')}</button>
        </div>
      </div>

      {state.status === 'loading' && <div className="rd-message" role="status">{t('Đang đọc dữ liệu đã lưu…')}</div>}
      {state.status === 'ready' && catalogMessage && <p className="data-library-catalog-status" role="status">{t(catalogMessage)}{state.catalog?.status === 'cached' && ` ${t('Đang dùng bản đã lưu.')}`}</p>}
      {state.status === 'ready' && requestedDataset && !selected && <p className="data-library-catalog-status" role="status">{t('Dataset trong đường dẫn chưa có trong kho này. Hãy chọn dữ liệu khác.')}</p>}
      {state.status === 'error' && <div className="rd-message is-error" role="alert">{t('Không đọc được kho dữ liệu:')} {state.error} <button type="button" className="rd-inline-button" data-testid="data-desk-retry" onClick={retryCatalog} disabled={catalogRetryExhausted} aria-describedby={catalogRetryExhausted ? 'data-desk-retry-note' : undefined}>{t(catalogRetryExhausted ? 'Đã hết lượt thử' : 'Thử lại')}</button>{catalogRetryExhausted && <small id="data-desk-retry-note">{t('Kiểm tra nguồn dữ liệu trước khi thử lại.')}</small>}</div>}

      {(downloadError || pollError) && <p className="data-library-download-error" role="alert">{t(downloadError || pollError)} <button type="button" className="rd-inline-button" onClick={() => {setDownloadError(''); setDownloadRevision(current => current + 1)}}>{t('Thử lại')}</button></p>}
      {downloadProgressOpen && <DataLibraryDialog compact title="Tiến độ tải dữ liệu" onClose={() => setDownloadProgressOpen(false)}><section className="data-library-download-jobs" aria-label={t('Tiến độ tải dữ liệu')}>
        {visibleDownloads.map(job => {
          const retrySeconds = downloadRetrySeconds(job,downloads.receivedAt,clockNow)
          const active = ['queued','running','pausing'].includes(job.status)
          return <div key={job.job_id} className="data-library-download-job" data-testid={`download-job-${job.job_id}`}>
            <div className="data-library-job-heading"><strong>{job.instrument_id}</strong><span>{displayDate(job.from_date)} → {displayDate(job.to_date)}</span><span role="status">{t(DOWNLOAD_STATUS[job.status] || 'Chưa xác định')} · {fmt(job.completed_days,'',0)} / {fmt(job.total_days,'',0)} {t('ngày')}</span></div>
            {active && <progress aria-label={t('Tiến độ tải {asset}',{asset:job.instrument_id})} value={job.progress_scope === 'phase' ? job.progress_percent ?? undefined : job.completed_days || 0} max={job.progress_scope === 'phase' ? 100 : Math.max(1,job.total_days || 1)} />}
            {job.error && <p className="data-library-job-error">{t(downloadErrorMessage(job.error))}</p>}
            <p className="data-library-muted">{t('Dung lượng đã tải')}: {formatDatasetSize(job.transferred_bytes,fmt)} · {t('Tổng dung lượng chưa xác định.')}</p>
            {job.stage === 'processing' && <p role="status">{t('Đang lưu dữ liệu…')}</p>}
            <div className="data-library-job-actions">{retrySeconds > 0 && <span>{t('Thử lại sau {seconds} giây',{seconds:retrySeconds})}</span>}
              {['paused','failed'].includes(job.status) && <button type="button" className="rd-button" disabled={!downloads.available || activeDownload || Boolean(jobAction) || retrySeconds > 0} onClick={() => changeDownload(job,'resume')}>{t('Tiếp tục tải')}</button>}
              {['queued','running','pausing'].includes(job.status) && <button type="button" className="rd-button" disabled={!downloads.supportsPause || Boolean(jobAction) || job.status === 'pausing'} onClick={() => changeDownload(job,'pause')}>{t(job.status === 'pausing' ? 'Đang tạm dừng…' : 'Tạm dừng')}</button>}
              {['queued','running','pausing','paused','failed'].includes(job.status) && <button type="button" className="rd-button" title={job.supports_cancel === false ? t(QDM_ERRORS.qdm_control_unsupported) : undefined} disabled={Boolean(jobAction) || !downloads.supportsCancel} onClick={() => changeDownload(job,'cancel')}>{t('Huỷ tải')}</button>}
            </div>
          </div>
        })}
      </section></DataLibraryDialog>}

      {state.status === 'ready' && (
        <div className="data-library-grid">
          <section className="rd-panel" aria-label="Dataset catalog">
              <div className="rd-table-wrap" tabIndex={0} role="region" aria-label={t('Dữ liệu đã có')}>
                <table className="rd-table" data-testid="data-desk-dataset-table">
                  <colgroup>{['asset','category','source','data','from','to','count','size','actions'].map(name => <col key={name} className={`data-library-column-${name}`} />)}</colgroup>
                  <thead><tr>{['Sản phẩm','Danh mục','Nguồn','Dữ liệu','Từ ngày (UTC)','Đến ngày (UTC)','Số nến','Dung lượng','Thao tác'].map(label => <th key={label} scope="col" title={label === 'Dung lượng' ? t('Dữ liệu replay; không gồm bản nguồn và cache tải.') : undefined}>{t(label)}</th>)}</tr></thead>
                  <tbody>
                    {pageItems.map((dataset) => {
                      const range = datasetRange(dataset)
                      const active = Boolean(dataset.dataset_id && dataset.dataset_id === selected?.dataset_id)
                      const job = jobForAsset(dataset)
                      const downloading = job && ['queued','running','pausing'].includes(job.status)
                      const retrySeconds = job ? downloadRetrySeconds(job,downloads.receivedAt,clockNow) : 0
                      const availableStart = downloadEngineOf(dataset) === (state.download?.download_engine || state.download?.provider || 'Dukascopy') ? state.download?.earliest_dates?.[dataset.instrument_id] : null
                      const dataType = libraryDataType(dataset, availableStart)
                      const fromDate = dataset.downloaded ? range.start : availableStart
                      const toDate = dataset.downloaded ? range.end : availableStart ? defaultDownloadDates().to_date : null
                      const dateTitle = value => dataset.downloaded ? value == null ? undefined : displayDate(value, { timeStyle: 'medium' }) : availableStart ? t('Phạm vi có thể tải theo metadata M1; chưa kiểm chứng độ phủ.') : undefined
                      return (
                        <tr key={dataset.key} className={active ? 'is-selected' : ''}>
                          <td>{dataset.downloaded ? <button type="button" data-testid={`dataset-row-${dataset.dataset_id}`} aria-pressed={active} onClick={() => openDetails(dataset)}><strong>{dataset.instrument_id || '—'}</strong></button> : <><strong>{dataset.instrument_id}</strong>{dataset.name && <small>{dataset.name}</small>}</>}</td>
                          <td>{t(categoryLabel(categoryOf(dataset)))}</td>
                          <td title={downloadEngineOf(dataset) === 'QuantDataManager' ? `${sourceOf(dataset)} · ${t('Công cụ tải')}: QuantDataManager (QDM) · CLI` : sourceOf(dataset)}>{sourceOf(dataset)}</td>
                          <td><span title={dataType.timeframe === 'M1' ? t('M1: mỗi nến tổng hợp giá trong 1 phút.') : undefined}>{dataType.timeframe}</span>{dataType.price && <small title={dataType.price === 'Bid' ? t('Bid: giá bên mua chào, chưa bao gồm giá Ask và spread thực tế.') : undefined}>{dataType.price}</small>}</td>
                          <td className="data-library-date" title={dateTitle(fromDate)}>{displayDate(fromDate)}</td>
                          <td className="data-library-date" title={dateTitle(toDate)}>{displayDate(toDate)}</td>
                          <td>{dataset.downloaded ? fmt(dataset.row_count, '', 0) : <span className="data-library-muted" title={t('Số nến chính xác chỉ xác định sau khi đọc dữ liệu nguồn.')}>—</span>}</td>
                          <td title={!dataset.downloaded ? t('Dung lượng replay chỉ xác định sau khi tải và xử lý.') : undefined}>{dataset.downloaded ? formatDatasetSize(dataset.size_bytes, fmt) : <span className="data-library-muted">—</span>}</td>
                          <td><div className="data-library-row-actions">{!job && <button type="button" className="rd-button data-library-download" disabled={dataset.downloaded || !eligibleDownload(dataset)} onClick={() => openDownload(dataset)} title={t(dataset.downloaded ? 'Dữ liệu đã được lưu trong kho' : activeDownload ? 'Đang có một lượt tải khác.' : eligibleDownload(dataset) ? 'Toàn bộ lịch sử có sẵn đến hết hôm qua (UTC).' : 'Nguồn chưa hỗ trợ tải trực tiếp trong ứng dụng')}><TestingIcon kind="download" />{t(startingAsset === dataset.instrument_id ? 'Đang bắt đầu…' : dataset.downloaded ? 'Đã tải' : 'Tải về')}</button>}{job ? <>
                            <DataLibraryProgress job={job} fmt={fmt} retrySeconds={retrySeconds} onClick={() => setDownloadProgressOpen(true)} />
                            <button type="button" className="fxa-button fxa-icon-button data-library-job-control" aria-label={t(downloading ? 'Tạm dừng' : 'Tiếp tục tải')} title={retrySeconds > 0 ? t(downloadErrorMessage(job.error || 'download_cooldown')) : t(downloading ? 'Tạm dừng' : 'Tiếp tục tải')} disabled={Boolean(jobAction) || (downloading ? !downloads.supportsPause || job.status === 'pausing' : activeDownload || !downloads.available || retrySeconds > 0)} onClick={() => changeDownload(job,downloading ? 'pause' : 'resume')}><TestingIcon kind={downloading ? 'pause' : 'play'} /></button>
                            <button type="button" className="fxa-button fxa-icon-button data-library-job-control" aria-label={t('Huỷ tải')} title={t(job.supports_cancel === false ? QDM_ERRORS.qdm_control_unsupported : 'Huỷ tải')} disabled={Boolean(jobAction) || job.supports_cancel === false} onClick={() => changeDownload(job,'cancel')}><TestingIcon kind="close" /></button>
                          </> : <DataLibraryActions asset={dataset} onDetails={openDetails} onUpdate={openDownload} onDelete={openDelete} canUpdate={dataset.downloaded && dataset.update_available === true && eligibleDownload(dataset)} disabled={Boolean(preview) || state.status !== 'ready' || activeDownload || Boolean(startingAsset)} />}</div></td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                {!filteredDatasets.length && rows.length > 0 && <p className="data-library-empty" role="status" data-testid="data-desk-empty">{t('Không có dữ liệu phù hợp bộ lọc.')}</p>}
              </div>
            <PaginationFooter label="Phân trang kho dữ liệu" page={currentPage} pages={pages} onPageChange={setPage} pageSize={pageSize} onPageSizeChange={value => { setPageSize(value); setPage(1) }} sizes={[10,25,50,100]} />
          </section>

        </div>
      )}
      {catalogOpen && <DataLibraryDialog drawer title="Danh mục tài sản" busy={catalogBusy} onClose={() => setCatalogOpen(false)} blockingStatus={<div className="data-library-update-overlay" role="status"><strong>{t('Đang cập nhật danh mục…')}</strong><progress aria-label={t('Đang cập nhật danh mục…')} /><span aria-live="off">{t('Đã chờ {seconds} giây',{seconds:catalogElapsed})}</span></div>}>
        <div className="data-library-catalog-source"><span>{t('Nguồn dữ liệu')}</span><FxSelect label="Nguồn dữ liệu" value={catalogProvider} onChange={setCatalogProvider} options={sourceOptions} disabled={catalogBusy} /></div>
        {catalogSourceSelected && state.catalog?.refresh_scope === 'installed_definitions' && <p className="data-library-catalog-status">{t('Đọc danh mục Dukascopy từ bộ cài QDM. Dùng chung cho Backtest và Prop firm.')}</p>}
        <dl className="data-library-catalog-facts">
          {catalogSourceSelected && downloadEngineOf(state.catalog) === 'QuantDataManager' && <div><dt>{t('Công cụ tải')}</dt><dd>QuantDataManager (QDM) · CLI</dd></div>}
          <div><dt>{t('Số tài sản')}</dt><dd>{fmt(sourceAssetCount, '', 0)}</dd></div>
          <div><dt>{t(catalogSourceSelected ? 'Cập nhật lần cuối (UTC)' : 'Lần lưu gần nhất (UTC)')}</dt><dd>{(catalogSourceSelected ? state.catalog?.retrieved_at_utc : latestSourceSave) ? formatUtc(catalogSourceSelected ? state.catalog.retrieved_at_utc : latestSourceSave, locale) : '—'}</dd></div>
        </dl>
        {catalogSourceSelected && (catalogMessage ? <p className="data-library-catalog-status" role="status">{t(catalogMessage)}</p> : catalogUpdated && <p className="data-library-catalog-status" role="status">{t('Đã cập nhật danh mục.')}</p>)}
        {catalogSourceSelected && !catalogBusy && state.catalog?.configured && !state.catalog.refresh_available && !catalogMessage && <p className="data-library-catalog-status" role="status">{t('Vui lòng chờ trước khi cập nhật lại.')}</p>}
        {!catalogSourceSelected && <p className="data-library-catalog-status">{t('Nguồn này dùng dữ liệu nhập từ CSV.')}</p>}
        <button type="button" className="fxs-settings-save fxa-button is-primary" onClick={refreshCatalog} disabled={Boolean(preview) || state.status !== 'ready' || catalogBusy || !catalogSourceSelected || !state.catalog?.refresh_available}>{t('Cập nhật danh mục')}</button>
      </DataLibraryDialog>}
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
          setDownloadFilter('all')
          setPage(1)
          setDetailsOpen(true)
          setCatalogRevision((current) => current + 1)
        }}
      /></DataLibraryDialog>}
      {deleteAsset && <DataLibraryDialog compact title="Xoá dữ liệu" busy={deleteBusy} onClose={() => setDeleteAsset(null)}><div className="data-library-delete-confirm"><strong>{deleteAsset.instrument_id} · {deleteAsset.timeframe}</strong><p>{t('Xoá bản dữ liệu đã lưu trên máy? Tài sản vẫn nằm trong danh mục để tải lại.')}</p>{deleteError && <p className="rd-message is-error" role="alert">{t(deleteError)}</p>}<div className="data-library-delete-actions"><button type="button" className="rd-button" disabled={deleteBusy} onClick={() => setDeleteAsset(null)}>{t('Hủy')}</button><button type="button" className="rd-button is-danger" disabled={deleteBusy} onClick={removeDataset}>{t(deleteBusy ? 'Đang xoá…' : 'Xoá')}</button></div></div></DataLibraryDialog>}
      {detailsOpen && selected && !csvOpen && <DataLibraryDialog title="Chi tiết dữ liệu và chất lượng" onClose={() => setDetailsOpen(false)}><DatasetDetails dataset={selected} workspace={workspace} query={query} /></DataLibraryDialog>}
    </section>
  )
}
