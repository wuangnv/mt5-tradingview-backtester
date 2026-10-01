import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  datasetRange,
  fetchDatasets,
  fetchProviders,
  formatNumber,
  formatUtc,
  holdoutLabel,
  qualityLabel,
  datasetWarnings,
} from './researchDataApi.js'
import { importLocalCsv, previewLocalCsv } from './dataDeskApi.js'
import './research-data.css'

const CSV_LIMIT_BYTES = 10 * 1024 * 1024
const MAX_GET_RETRIES = 3

const DEFAULT_IMPORT_FORM = {
  sourceId: 'local-csv-upload',
  provider: 'local-csv',
  licenseUse: 'user-supplied-local',
  instrumentId: 'EURUSDm',
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

function queryHref(view, workspace, params = {}) {
  const next = new URLSearchParams({ view, workspace })
  Object.entries(params).forEach(([key, value]) => {
    if (value !== null && value !== undefined && value !== '') next.set(key, String(value))
  })
  return `/?${next.toString()}`
}

function QualityBadge({ dataset }) {
  const quality = qualityLabel(dataset)
  const tone = quality === 'Đã xác minh' ? 'is-good' : quality === 'Fixture / QA only' ? 'is-muted' : 'is-warn'
  return <span className={`rd-badge ${tone}`}>{quality}</span>
}

function DatasetDetails({ dataset, workspace }) {
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
          <p>Đây là bằng chứng metadata hiện có; không suy ra dữ liệu thiếu thành số 0.</p>
        </div>
        <a className="rd-context-link" href={queryHref('research', workspace, { dataset: dataset.dataset_id })}>Mở trong Research →</a>
      </div>
      <dl className="rd-detail-grid">
        <div><dt>Dataset</dt><dd><strong>{dataset.dataset_id}</strong></dd></div>
        <div><dt>Provider</dt><dd>{dataset.provider_id || source.provider || 'Chưa xác định'}</dd></div>
        <div><dt>Instrument / TF</dt><dd>{dataset.instrument_id || 'N/A'} · {dataset.timeframe || 'N/A'}</dd></div>
        <div><dt>Số nến</dt><dd>{formatNumber(dataset.row_count, 0)}</dd></div>
        <div><dt>Range UTC</dt><dd>{formatUtc(range.start)} → {formatUtc(range.end)}</dd></div>
        <div><dt>License</dt><dd>{source.license_use || 'Chưa xác minh'}</dd></div>
        <div><dt>Quality</dt><dd><QualityBadge dataset={dataset} /></dd></div>
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
        <div><span className="rd-import-kicker">PREVIEW / QUALITY</span><h3>Quality report</h3></div>
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

function LocalCsvImport({ workspace, onImported }) {
  const [form, setForm] = useState(DEFAULT_IMPORT_FORM)
  const [retrievedAtUtc, setRetrievedAtUtc] = useState(() => new Date().toISOString())
  const [upload, setUpload] = useState({ status: 'idle', file: null, csvText: '', payload: null, preview: null, error: null, imported: null })
  const reviewAccepted = upload.preview?.quality?.disposition !== 'review' || upload.acceptReview
  const previewReady = upload.status === 'previewed' && upload.preview && upload.payload
  const canImport = Boolean(previewReady && upload.preview.quality?.disposition !== 'missing_data' && reviewAccepted)
  const busy = upload.status === 'reading' || upload.status === 'previewing' || upload.status === 'importing'

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
        asset_class: 'fx',
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
        <div><span className="rd-import-kicker">LOCAL DATA / NO PROVIDER</span><h2 id="data-desk-import-title">Preview hoặc import CSV</h2><p>File được đọc bằng browser; server chỉ nhận nội dung sau khi bạn bấm Preview. Không gửi đường dẫn file.</p></div>
        <span className="rd-badge is-muted">BROKER LOCKED</span>
      </div>
      <div className="rd-import-grid">
        <div className="rd-import-form">
          <label className="rd-field is-wide"><span>CSV file</span><input type="file" accept=".csv,text/csv" onChange={handleFile} data-testid="data-desk-file-input" /></label>
          <div className="rd-import-fields">
            <label className="rd-field"><span>Instrument ID</span><input name="instrumentId" value={form.instrumentId} onChange={updateForm} /></label>
            <label className="rd-field"><span>Timeframe seconds</span><input name="timeframeSeconds" inputMode="numeric" value={form.timeframeSeconds} onChange={updateForm} /></label>
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
            <button type="button" className="rd-button is-primary" onClick={previewFile} disabled={!upload.file || busy} data-testid="data-desk-preview-button">{busy && upload.status !== 'importing' ? 'Đang kiểm tra…' : 'Preview quality'}</button>
            <button type="button" className="rd-button" onClick={importFile} disabled={!canImport || busy} data-testid="data-desk-import-button">{upload.status === 'importing' ? 'Đang import…' : 'Import dataset'}</button>
          </div>
          {upload.file && <p className="rd-import-file-state" data-testid="data-desk-file-state">{upload.file.name} · {(upload.file.size / 1024).toFixed(1)} KiB · {upload.status === 'stale' ? 'Preview cũ; cần chạy lại' : upload.status === 'imported' ? 'Đã import' : 'Chưa gửi lên server'}</p>}
          {upload.preview?.quality?.disposition === 'review' && (
            <label className="rd-import-review-check"><input type="checkbox" checked={Boolean(upload.acceptReview)} onChange={(event) => setUpload((current) => ({ ...current, acceptReview: event.target.checked }))} /> Tôi hiểu dataset đang cần review và chỉ muốn lưu để kiểm tra.</label>
          )}
          {upload.imported && <p className="rd-import-success" role="status" data-testid="data-desk-import-success">Đã thêm dataset <code>{upload.imported.dataset_id}</code> vào catalog workspace.</p>}
        </div>
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

export default function DataDeskWorkspace({ workspace = 'tenant-a', query = new URLSearchParams(window.location.search) }) {
  const requestedDataset = query.get('dataset') || ''
  const [state, setState] = useState({ status: 'loading', datasets: [], providers: [], error: null })
  const [selectedId, setSelectedId] = useState(requestedDataset)
  const [providerFilter, setProviderFilter] = useState('all')
  const [catalogRevision, setCatalogRevision] = useState(0)
  const [catalogRetryCount, setCatalogRetryCount] = useState(0)
  const catalogRequestSeq = useRef(0)
  const catalogRetryCountRef = useRef(0)

  useEffect(() => {
    catalogRetryCountRef.current = 0
    setCatalogRetryCount(0)
  }, [workspace])

  useEffect(() => {
    const controller = new AbortController()
    const requestSeq = ++catalogRequestSeq.current
    setState((current) => ({ ...current, status: 'loading', error: null }))
    Promise.all([fetchDatasets(workspace, controller.signal), fetchProviders(workspace, controller.signal)])
      .then(([datasets, providers]) => {
        if (requestSeq !== catalogRequestSeq.current) return
        setState({ status: 'ready', datasets, providers, error: null })
        catalogRetryCountRef.current = 0
        setCatalogRetryCount(0)
        setSelectedId((current) => current || datasets[0]?.dataset_id || '')
      })
      .catch((error) => {
        if (error.name !== 'AbortError' && requestSeq === catalogRequestSeq.current) {
          setState({ status: 'error', datasets: [], providers: [], error: String(error.message || error) })
        }
      })
    return () => controller.abort()
  }, [catalogRevision, workspace])

  const retryCatalog = () => {
    if (catalogRetryCountRef.current >= MAX_GET_RETRIES || state.status === 'loading') return
    catalogRetryCountRef.current += 1
    setCatalogRetryCount(catalogRetryCountRef.current)
    setCatalogRevision((current) => current + 1)
  }

  const catalogRetryExhausted = catalogRetryCount >= MAX_GET_RETRIES

  const providers = state.providers
  const filteredDatasets = useMemo(() => state.datasets.filter((item) => providerFilter === 'all' || item.provider_id === providerFilter), [providerFilter, state.datasets])
  const selected = state.datasets.find((item) => item.dataset_id === selectedId) || filteredDatasets[0] || null
  const holdoutAccess = state.datasets.some((item) => item.holdout_access === true)

  return (
    <main className="rd-shell" data-testid="data-desk-root">
      <header className="rd-topbar">
        <div>
          <div className="eyebrow">MT5 TRADING WORKSPACE / DATA DESK</div>
          <h1>Data Desk</h1>
          <p>Chọn dữ liệu có provenance rõ ràng trước khi replay hoặc chạy research.</p>
        </div>
        <div className="rd-actions">
          <a className="rd-context-link" href={queryHref('research', workspace, selected ? { dataset: selected.dataset_id } : {})}>Research</a>
          <a className="rd-context-link" href={queryHref('replay', workspace, selected ? { dataset: selected.dataset_id } : {})}>Replay</a>
          <div className="rd-safety"><strong>RESEARCH / SIMULATION</strong><span>Broker locked · holdout không mở</span></div>
        </div>
      </header>
      <div className="rd-statusbar" aria-label="Trạng thái Data Desk">
        <span>Workspace <strong>{workspace}</strong></span>
        <span>Datasets <strong>{state.datasets.length}</strong></span>
        <span>Providers <strong>{providers.length}</strong></span>
        <span className={holdoutAccess ? 'rd-status is-ready' : 'rd-status'}>{holdoutAccess ? 'Holdout được cấp' : 'Holdout khóa'}</span>
      </div>

      <LocalCsvImport
        workspace={workspace}
        onImported={(dataset) => {
          setSelectedId(dataset?.dataset_id || '')
          setCatalogRevision((current) => current + 1)
        }}
      />

      {state.status === 'loading' && <div className="rd-message" role="status">Đang đọc catalog và capability provider…</div>}
      {state.status === 'error' && <div className="rd-message is-error" role="alert">Không đọc được Data Desk: {state.error} <button type="button" className="rd-inline-button" data-testid="data-desk-retry" onClick={retryCatalog} disabled={catalogRetryExhausted} aria-describedby={catalogRetryExhausted ? 'data-desk-retry-note' : undefined}>{catalogRetryExhausted ? 'Đã hết lượt thử' : 'Thử lại'}</button>{catalogRetryExhausted && <>{' '}<small id="data-desk-retry-note">Đã thử lại {MAX_GET_RETRIES} lần. Kiểm tra backend trước khi tiếp tục.</small></>}</div>}

      {state.status === 'ready' && (
        <div className="rd-main-grid">
          <section className="rd-panel" aria-label="Dataset catalog">
            <div className="rd-panel-head">
              <div><h2>Dataset catalog</h2><p>Chỉ hiển thị dữ liệu thuộc workspace hiện tại.</p></div>
              <label className="rd-field" style={{ minWidth: 150 }}>
                <span>Provider</span>
                <select aria-label="Lọc provider" value={providerFilter} onChange={(event) => setProviderFilter(event.target.value)}>
                  <option value="all">Tất cả</option>
                  {providers.map((provider) => <option key={provider.provider_id} value={provider.provider_id}>{provider.provider_id}</option>)}
                </select>
              </label>
            </div>
            {filteredDatasets.length === 0 ? (
              <div className="rd-message is-empty" data-testid="data-desk-empty">Workspace chưa có dataset nào phù hợp. Không thể bắt đầu research từ dữ liệu trống.</div>
            ) : (
              <div className="rd-table-wrap">
                <table className="rd-table" data-testid="data-desk-dataset-table">
                  <thead><tr><th>Dataset</th><th>Instrument</th><th>Range</th><th>QA</th><th>Holdout</th><th>Rows</th></tr></thead>
                  <tbody>
                    {filteredDatasets.map((dataset) => {
                      const range = datasetRange(dataset)
                      const active = dataset.dataset_id === selected?.dataset_id
                      return (
                        <tr key={dataset.dataset_id} className={active ? 'is-selected' : ''}>
                          <td><button type="button" data-testid={`dataset-row-${dataset.dataset_id}`} onClick={() => setSelectedId(dataset.dataset_id)}><strong>{dataset.dataset_id}</strong><small>{dataset.provider_id || dataset.source?.provider || 'provider unknown'}</small></button></td>
                          <td>{dataset.instrument_id || 'N/A'}<small>{dataset.timeframe || 'TF unknown'}</small></td>
                          <td>{formatUtc(range.start)}<small>→ {formatUtc(range.end)}</small></td>
                          <td><QualityBadge dataset={dataset} /></td>
                          <td><span className={`rd-badge ${dataset.holdout_access ? 'is-good' : 'is-warn'}`}>{dataset.holdout_access ? 'Mở' : 'Khóa'}</span></td>
                          <td>{formatNumber(dataset.row_count, 0)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <DatasetDetails dataset={selected} workspace={workspace} />
          </section>

          <aside className="rd-panel" aria-label="Provider capabilities">
            <div className="rd-panel-head"><div><h2>Provider capabilities</h2><p>Capability khai báo không đồng nghĩa đã có quyền đọc history hoặc holdout.</p></div></div>
            {providers.length === 0 ? <div className="rd-message is-empty">Chưa có provider capability nào.</div> : (
              <div className="rd-provider-list">
                {providers.map((provider) => {
                  const capabilities = provider.capabilities || {}
                  const readiness = provider.readiness || {}
                  const available = Object.entries(capabilities).filter(([, value]) => value === true).map(([key]) => key)
                  const blocked = Object.entries(capabilities).filter(([, value]) => value !== true).map(([key]) => key)
                  const readinessLabel = readiness.production_ready ? 'Production đã xác minh' : 'Chưa đủ điều kiện production'
                  return (
                    <div className="rd-provider-row" key={provider.provider_id}>
                      <div>
                        <strong>{provider.provider_id}</strong>
                        <small>{available.length ? `Có: ${available.join(', ')}` : 'Không có capability đọc được khai báo'}</small>
                        <small className="rd-provider-readiness">{readiness.connection_mode || 'offline'} · entitlement: {readiness.entitlement_status || 'unverified'}</small>
                      </div>
                      <div className={`rd-provider-state ${readiness.production_ready ? 'is-ready' : 'is-blocked'}`}>
                        <span>{readinessLabel}</span>
                        <small>{readiness.network_access ? 'Network declared' : 'Offline / no network'}</small>
                      </div>
                      <div className={`rd-capability ${blocked.length ? 'is-blocked' : ''}`}>{blocked.length ? `Khóa: ${blocked.join(', ')}` : 'Đã khai báo'}</div>
                    </div>
                  )
                })}
              </div>
            )}
            <div className="rd-warning-block"><strong>Quy tắc an toàn</strong><ul><li>Local CSV import chỉ tạo artifact immutable trong workspace hiện tại.</li><li>Không mở holdout, không gọi provider ngoài và không gửi lệnh broker.</li><li>Dataset chưa verified vẫn phải gắn nhãn trước khi dùng.</li></ul></div>
          </aside>
        </div>
      )}
    </main>
  )
}
