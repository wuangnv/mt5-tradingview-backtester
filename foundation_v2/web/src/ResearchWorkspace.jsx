import React, { useCallback, useEffect, useMemo, useState } from 'react'
import DataDeskWorkspace from './DataDeskWorkspace.jsx'
import {
  cancelResearchJob,
  createResearchJob,
  datasetRange,
  datasetWarnings,
  fetchDatasets,
  fetchResearchEngines,
  formatNumber,
  formatUtc,
  getResearchCheckpoint,
  getResearchJob,
  holdoutLabel,
  qualityLabel,
} from './researchDataApi.js'
import './research-data.css'

function setQuery(params) {
  const url = new URL(window.location.href)
  Object.entries(params).forEach(([key, value]) => {
    if (value === null || value === undefined || value === '') url.searchParams.delete(key)
    else url.searchParams.set(key, String(value))
  })
  window.history.replaceState(null, '', url)
}

function statusLabel(status) {
  return ({ queued: 'Đang chờ', running: 'Đang chạy', completed: 'Hoàn tất', failed: 'Thất bại', canceled: 'Đã hủy' })[status] || status || 'Chưa có trạng thái'
}

function statusClass(status) {
  return status === 'completed' ? 'is-good' : status === 'failed' || status === 'canceled' ? 'is-warn' : ''
}

function checkpointProgress(checkpoint) {
  const progress = checkpoint?.progress || checkpoint?.checkpoint?.progress || {}
  const candidates = [progress.percent, progress.progress_pct, progress.progress_percent, progress.fraction]
  const value = candidates.find((item) => Number.isFinite(Number(item)))
  if (value === undefined) return null
  const numeric = Number(value)
  return numeric <= 1 ? Math.max(0, Math.min(100, numeric * 100)) : Math.max(0, Math.min(100, numeric))
}

function Sparkline({ points }) {
  if (!Array.isArray(points) || points.length < 2) return <div className="rd-empty-callout">Chưa có đường vốn để hiển thị.</div>
  const values = points.map((point) => Number(point.closed_trade_balance ?? point.value ?? point.balance)).filter(Number.isFinite)
  if (values.length < 2) return <div className="rd-empty-callout">Đường vốn chưa có giá trị hợp lệ.</div>
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const coords = values.map((value, index) => `${(index / (values.length - 1)) * 100},${96 - ((value - min) / span) * 76}`).join(' ')
  return <svg className="rd-spark" viewBox="0 0 100 120" preserveAspectRatio="none" aria-label="Đường vốn research"><polyline points={coords} /><text x="2" y="14">{formatNumber(max)}</text><text x="2" y="113">{formatNumber(min)}</text></svg>
}

function DatasetContext({ dataset, workspace, fallbackDatasetId = '' }) {
  if (!dataset && fallbackDatasetId) {
    return (
      <section className="rd-panel" aria-label="Research job data context" data-testid="research-data-context">
        <div className="rd-panel-head"><div><h2>Dữ liệu gắn với job</h2><p>Job đã khóa dataset từ lúc tạo; catalog không được thay thế bằng dữ liệu khác.</p></div><a className="rd-context-link" href={`/?view=data&workspace=${encodeURIComponent(workspace)}&dataset=${encodeURIComponent(fallbackDatasetId)}`}>Mở Data Desk →</a></div>
        <dl className="rd-detail-grid"><div><dt>Dataset</dt><dd><strong>{fallbackDatasetId}</strong></dd></div><div><dt>Provenance</dt><dd>Đọc từ research job</dd></div><div><dt>Holdout</dt><dd>Không suy ra từ job</dd></div></dl>
      </section>
    )
  }
  if (!dataset) return <div className="rd-empty-callout">Chưa có dataset. Mở <a className="rd-context-link" href={`/?view=data&workspace=${encodeURIComponent(workspace)}`}>Data Desk</a> để chọn dữ liệu.</div>
  const range = datasetRange(dataset)
  const warnings = datasetWarnings(dataset)
  return (
    <section className="rd-panel" aria-label="Research data context" data-testid="research-data-context">
      <div className="rd-panel-head"><div><h2>Dữ liệu đầu vào</h2><p>Research chỉ chạy trên dataset đã chọn; kiểm tra các cảnh báo trước khi tạo run.</p></div><a className="rd-context-link" href={`/?view=data&workspace=${encodeURIComponent(workspace)}&dataset=${encodeURIComponent(dataset.dataset_id)}`}>Mở Data Desk →</a></div>
      <dl className="rd-detail-grid">
        <div><dt>Dataset</dt><dd><strong>{dataset.dataset_id}</strong></dd></div>
        <div><dt>Instrument / TF</dt><dd>{dataset.instrument_id || 'N/A'} · {dataset.timeframe || 'N/A'}</dd></div>
        <div><dt>Rows</dt><dd>{formatNumber(dataset.row_count, 0)}</dd></div>
        <div><dt>Range UTC</dt><dd>{formatUtc(range.start)} → {formatUtc(range.end)}</dd></div>
        <div><dt>Quality</dt><dd>{qualityLabel(dataset)}</dd></div>
        <div><dt>Holdout</dt><dd>{holdoutLabel(dataset)}</dd></div>
        <div><dt>Provider</dt><dd>{dataset.provider_id || dataset.source?.provider || 'Chưa xác định'}</dd></div>
        <div><dt>Artifact SHA</dt><dd><code>{dataset.artifact_sha256 || 'Chưa có hash'}</code></dd></div>
      </dl>
      {warnings.length > 0 && <div className="rd-warning-block" data-testid="research-data-warnings"><strong>Warnings không chặn run cơ bản</strong><ul>{warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></div>}
    </section>
  )
}

export default function ResearchWorkspace({ workspace = 'tenant-a', query = new URLSearchParams(window.location.search) }) {
  const requestedJob = query.get('job') || ''
  const requestedDataset = query.get('dataset') || ''
  const [catalog, setCatalog] = useState({ status: 'loading', datasets: [], engines: [], error: null })
  const [selectedId, setSelectedId] = useState(requestedDataset)
  const [form, setForm] = useState({ startingBalance: '10000', strategyVersion: 'close-delta-v1' })
  const [jobState, setJobState] = useState({ status: requestedJob ? 'loading' : 'idle', job: null, checkpoint: null, error: null })
  const [pending, setPending] = useState('')

  useEffect(() => {
    // A deep link to an existing job only needs the job endpoint. Avoid an
    // unrelated catalog request so a result link remains usable when the
    // catalog provider is unavailable or the job is already archived.
    if (requestedJob) {
      setCatalog({ status: 'ready', datasets: [], engines: [], error: null })
      return undefined
    }
    const controller = new AbortController()
    Promise.all([fetchDatasets(workspace, controller.signal), fetchResearchEngines(workspace, controller.signal)])
      .then(([datasets, engines]) => {
        setCatalog({ status: 'ready', datasets, engines: engines?.items || [], error: null })
        setSelectedId((current) => current || datasets[0]?.dataset_id || '')
      })
      .catch((error) => {
        if (error.name !== 'AbortError') setCatalog({ status: 'error', datasets: [], engines: [], error: String(error.message || error) })
      })
    return () => controller.abort()
  }, [requestedJob, workspace])

  const selected = catalog.datasets.find((dataset) => dataset.dataset_id === selectedId) || catalog.datasets[0] || null

  const refreshJob = useCallback(async (jobId, signal) => {
    const job = await getResearchJob(workspace, jobId, signal)
    let checkpoint = null
    if (job.status === 'queued' || job.status === 'running') checkpoint = await getResearchCheckpoint(workspace, jobId, signal)
    setJobState({ status: 'ready', job, checkpoint, error: null })
    return job
  }, [workspace])

  useEffect(() => {
    if (!requestedJob) return undefined
    const controller = new AbortController()
    let timer
    const poll = async () => {
      try {
        const job = await refreshJob(requestedJob, controller.signal)
        if (!['queued', 'running'].includes(job.status)) return
        timer = window.setTimeout(poll, 1500)
      } catch (error) {
        if (error.name !== 'AbortError') setJobState({ status: 'error', job: null, checkpoint: null, error: String(error.message || error) })
      }
    }
    poll()
    return () => { controller.abort(); if (timer) window.clearTimeout(timer) }
  }, [refreshJob, requestedJob])

  const runResearch = async (event) => {
    event.preventDefault()
    if (!selected) {
      setJobState({ status: 'error', job: null, checkpoint: null, error: 'Cần chọn dataset trước khi tạo research run.' })
      return
    }
    const startingBalance = Number(form.startingBalance)
    if (!Number.isFinite(startingBalance) || startingBalance <= 0) {
      setJobState({ status: 'error', job: null, checkpoint: null, error: 'Starting balance phải là số dương.' })
      return
    }
    setPending('create')
    setJobState({ status: 'loading', job: null, checkpoint: null, error: null })
    try {
      const job = await createResearchJob(workspace, { dataset_id: selected.dataset_id, strategy_version: form.strategyVersion, starting_balance: startingBalance })
      setQuery({ view: 'research', workspace, dataset: selected.dataset_id, job: job.job_id })
      setJobState({ status: 'ready', job, checkpoint: null, error: null })
    } catch (error) {
      setJobState({ status: 'error', job: null, checkpoint: null, error: String(error.message || error) })
    } finally { setPending('') }
  }

  const cancel = async () => {
    if (!jobState.job?.job_id) return
    setPending('cancel')
    try {
      const job = await cancelResearchJob(workspace, jobState.job.job_id)
      setJobState((current) => ({ ...current, status: 'ready', job, error: null }))
    } catch (error) {
      setJobState((current) => ({ ...current, status: 'error', error: String(error.message || error) }))
    } finally { setPending('') }
  }

  const job = jobState.job
  const result = job?.result
  const contextDatasetId = selected?.dataset_id || job?.dataset_id || requestedDataset
  const progress = checkpointProgress(jobState.checkpoint)
  const active = job && ['queued', 'running'].includes(job.status)
  const errors = job?.error_code ? [job.error_code] : []
  const metrics = result?.metrics || {}
  const curve = metrics.closed_trade_balance_curve || metrics.equity_curve || []
  const engine = catalog.engines.find((item) => item.id === 'nautilus')
  const learnParams = new URLSearchParams({ view: 'learn', workspace, from: 'research' })
  if (job?.job_id || requestedJob) learnParams.set('job', job?.job_id || requestedJob)
  if (contextDatasetId) learnParams.set('dataset', contextDatasetId)
  const learnHref = `/?${learnParams.toString()}`

  return (
    <main className="rd-shell" data-testid="research-root">
      <header className="rd-topbar">
        <div><div className="eyebrow">MT5 TRADING WORKSPACE / RESEARCH</div><h1>Research</h1><p>Chọn dataset → cố định giả định → tạo run → theo dõi bằng chứng.</p></div>
        <div className="rd-actions"><a className="rd-context-link" href={`/?view=data&workspace=${encodeURIComponent(workspace)}${contextDatasetId ? `&dataset=${encodeURIComponent(contextDatasetId)}` : ''}`}>Data Desk</a><a className="rd-context-link" href={`/?view=replay&workspace=${encodeURIComponent(workspace)}${contextDatasetId ? `&dataset=${encodeURIComponent(contextDatasetId)}` : ''}`}>Replay</a><a className="rd-context-link" href={learnHref}>Học & thuật ngữ</a><div className="rd-safety"><strong>RESEARCH / SIMULATION</strong><span>Broker locked · không gửi lệnh</span></div></div>
      </header>
      <div className="rd-statusbar" aria-label="Trạng thái Research"><span>Workspace <strong>{workspace}</strong></span><span>Job <code>{job?.job_id || requestedJob || 'Chưa tạo'}</code></span><span className={`rd-status ${statusClass(job?.status)}`} data-testid="research-status">{job ? statusLabel(job.status) : catalog.status === 'loading' ? 'Đang tải catalog' : 'Chưa chạy'}</span><span>Engine <strong>{engine?.available ? 'nautilus sẵn sàng' : 'reference / chưa xác minh'}</strong></span></div>

      {catalog.status === 'loading' && <div className="rd-message" role="status">Đang đọc dataset và research engines…</div>}
      {catalog.status === 'error' && <div className="rd-message is-error" role="alert">Không đọc được catalog: {catalog.error}</div>}
      {jobState.status === 'error' && <div className="rd-message is-error" role="alert">Research không hoàn tất: {jobState.error}</div>}

      {catalog.status === 'ready' && (
        <div className="rd-main-grid">
          <div>
            <DatasetContext dataset={selected} workspace={workspace} fallbackDatasetId={contextDatasetId} />
            <section className="rd-panel" aria-label="Tạo research run" data-testid="research-run-form">
              <div className="rd-panel-head"><div><h2>Tạo run</h2><p>Run cơ bản chỉ dùng dataset và strategy contract hiện có; không mở broker.</p></div></div>
              {catalog.datasets.length === 0 ? <div className="rd-empty-callout">{requestedJob ? 'Đang xem lại job hiện tại. Muốn tạo run mới, mở Data Desk để chọn dataset.' : 'Không có dataset trong workspace. Mở Data Desk để kiểm tra catalog; không thể tạo run.'}</div> : (
                <form className="rd-toolbar" onSubmit={runResearch}>
                  <label className="rd-field is-wide"><span>Dataset</span><select aria-label="Research dataset" value={selected?.dataset_id || ''} onChange={(event) => { setSelectedId(event.target.value); setQuery({ dataset: event.target.value, job: null }) }}><option value="" disabled>Chọn dataset</option>{catalog.datasets.map((dataset) => <option key={dataset.dataset_id} value={dataset.dataset_id}>{dataset.dataset_id} · {dataset.instrument_id || 'instrument?'}</option>)}</select></label>
                  <label className="rd-field"><span>Starting balance</span><input aria-label="Starting balance" inputMode="decimal" value={form.startingBalance} onChange={(event) => setForm((current) => ({ ...current, startingBalance: event.target.value }))} /></label>
                  <label className="rd-field"><span>Strategy</span><select aria-label="Strategy version" value={form.strategyVersion} onChange={(event) => setForm((current) => ({ ...current, strategyVersion: event.target.value }))}><option value="close-delta-v1">close-delta-v1</option></select></label>
                  <button className="rd-button is-primary" type="submit" data-testid="research-run-submit" disabled={pending === 'create' || Boolean(active) || !selected}>{pending === 'create' ? 'Đang tạo…' : active ? 'Run đang chạy…' : 'Tạo research run'}</button>
                </form>
              )}
              {selected && <div className="rd-run-warning"><strong>Trước khi chạy</strong><span>{qualityLabel(selected)} · {holdoutLabel(selected)} · cost model {selected.instrument_spec ? 'có metadata để kiểm tra' : 'chưa xác định'}.</span></div>}
            </section>
            {job && (
              <section className="rd-panel" aria-label="Research job" data-testid="research-job-panel">
                <div className="rd-panel-head"><div><h2>Run status</h2><p>Trạng thái lấy trực tiếp từ backend; checkpoint chỉ là bằng chứng tiến độ.</p></div>{active && <button className="rd-button is-danger" type="button" data-testid="research-cancel" onClick={cancel} disabled={pending === 'cancel'}>{pending === 'cancel' ? 'Đang hủy…' : 'Hủy run'}</button>}</div>
                <div className="rd-job-strip"><div><span>Status</span><strong className={statusClass(job.status)}>{statusLabel(job.status)}</strong></div><div><span>Dataset</span><code>{job.dataset_id}</code></div><div><span>Revision</span><strong>{job.attempt_no ?? 'Chưa có'}</strong></div><div><span>Cập nhật</span><strong>{formatUtc(job.updated_at_utc)}</strong></div></div>
                {active && <>{progress !== null ? <div className="rd-progress" aria-label={`Tiến độ ${formatNumber(progress, 0)}%`}><span style={{ width: `${progress}%` }} /></div> : <div className="rd-message">Backend chưa cung cấp phần trăm tiến độ; run vẫn đang hoạt động.</div>}{jobState.checkpoint && <div className="rd-checkpoint" data-testid="research-checkpoint"><strong>Checkpoint:</strong> {jobState.checkpoint.checkpoint?.phase || jobState.checkpoint.phase || 'đang cập nhật'} · attempt {jobState.checkpoint.checkpoint?.attempt_no || jobState.checkpoint.attempt_no || 'N/A'}</div>}</>}
                {errors.length > 0 && <div className="rd-message is-error">Backend error: {errors.join(', ')}</div>}
              </section>
            )}
          </div>
          <aside>
            {result && (
              <section className="rd-result" aria-label="Research result" data-testid="research-result">
                <div className="rd-panel-head"><div><h2>Kết quả research</h2><p>Chỉ hiển thị sau khi backend trả trạng thái completed.</p></div><span className="rd-badge is-good">Completed</span></div>
                <div className="rd-result-grid"><div><span>Trades</span><strong>{formatNumber(result.trade_count, 0)}</strong></div><div><span>Net P/L</span><strong>{formatNumber(metrics.net_pnl)}</strong></div><div><span>Win rate</span><strong>{metrics.win_rate_pct === null || metrics.win_rate_pct === undefined ? 'N/A' : `${formatNumber(metrics.win_rate_pct)}%`}</strong></div><div><span>Max DD</span><strong>{formatNumber(metrics.closed_trade_balance_max_drawdown)}</strong></div></div>
                <Sparkline points={curve} />
                <div className="rd-provenance"><h3>Result provenance</h3><dl className="rd-provenance-grid"><div><span>Dataset SHA</span><code>{result.dataset_sha256 || 'Chưa có hash'}</code></div><div><span>Metrics schema</span><code>{result.metrics_schema_version || 'Chưa xác định'}</code></div><div><span>Job</span><code>{result.job_id}</code></div></dl></div>
              </section>
            )}
            {!result && !job && <div className="rd-empty-callout">Chưa có run. Chọn dataset và tạo một run để bắt đầu; kết quả không được giả lập trong UI.</div>}
          </aside>
        </div>
      )}
    </main>
  )
}

export { DataDeskWorkspace }
