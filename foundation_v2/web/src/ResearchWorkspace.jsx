import React, { useCallback, useEffect, useState } from 'react'
import { useFxReplayContext } from './FxReplayShell.jsx'
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
import './research-story.css'

const FLOW_STEPS = [
  { id: 'context', label: 'Context', note: 'Dataset và phạm vi' },
  { id: 'quality', label: 'Quality gate', note: 'Takeaway và cảnh báo' },
  { id: 'run', label: 'Run', note: 'Giả định nghiên cứu' },
  { id: 'checkpoint', label: 'Checkpoint', note: 'Tiến độ có bằng chứng' },
  { id: 'result', label: 'Result', note: 'Metrics và hành động tiếp' },
]

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

function qualityTone(dataset) {
  if (!dataset) return 'blocked'
  if (dataset.quality_status === 'verified' || dataset.quality?.status === 'verified') return 'ready'
  if (dataset.quality_status === 'fixture-only') return 'fixture'
  return 'review'
}

function qualityStory(dataset) {
  if (!dataset) return { tone: 'blocked', title: 'Chưa có dataset để ra quyết định', body: 'Mở Data Desk để chọn một dataset. Research không tự tạo dữ liệu và không dùng số 0 để lấp chỗ trống.', action: 'Chọn dataset trước khi cấu hình run' }
  const tone = qualityTone(dataset)
  const warnings = datasetWarnings(dataset)
  if (tone === 'ready' && warnings.length === 0) return { tone, title: 'Dataset đủ điều kiện cho run local', body: 'Provenance và instrument metadata đã có. Bạn có thể cấu hình run; holdout vẫn giữ theo policy hiện tại.', action: 'Kiểm tra giả định rồi tạo run' }
  if (tone === 'fixture') return { tone, title: 'Dataset chỉ dành cho fixture / QA', body: 'Dữ liệu này hữu ích để kiểm tra workflow và UI. Không dùng kết quả của nó làm bằng chứng production hoặc OOS.', action: 'Chạy để kiểm tra pipeline, sau đó đổi sang dataset đã xác minh' }
  return { tone: 'review', title: 'Có thể chạy local, nhưng provenance còn thiếu', body: 'Run vẫn giữ được tính trung thực, nhưng các cảnh báo bên dưới giới hạn cách diễn giải kết quả.', action: warnings.length ? `Đọc ${warnings.length} cảnh báo trước khi chạy` : 'Đọc provenance trước khi chạy' }
}

function Sparkline({ points }) {
  if (!Array.isArray(points) || points.length < 2) return <div className="rs-empty-inline">Chưa có đủ điểm để vẽ đường vốn.</div>
  const values = points.map((point) => Number(point.closed_trade_balance ?? point.value ?? point.balance)).filter(Number.isFinite)
  if (values.length < 2) return <div className="rs-empty-inline">Đường vốn chưa có giá trị hợp lệ.</div>
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const coords = values.map((value, index) => `${(index / (values.length - 1)) * 100},${96 - ((value - min) / span) * 76}`).join(' ')
  return <figure className="rs-equity-figure"><svg className="rs-spark" viewBox="0 0 100 120" preserveAspectRatio="none" role="img" aria-label="Đường vốn research"><polyline points={coords} /><text x="2" y="14">{formatNumber(max)}</text><text x="2" y="113">{formatNumber(min)}</text></svg><figcaption>Đường vốn đóng lệnh · từ result backend</figcaption></figure>
}

function FlowStepper({ selected, job, result }) {
  const current = result ? 'result' : job && ['queued', 'running'].includes(job.status) ? 'checkpoint' : job ? 'result' : selected ? 'run' : 'context'
  return <ol className="rs-stepper" aria-label="Research flow" data-testid="research-flow-stepper">{FLOW_STEPS.map((step, index) => { const currentIndex = FLOW_STEPS.findIndex((item) => item.id === current); const stepIndex = FLOW_STEPS.findIndex((item) => item.id === step.id); const state = stepIndex < currentIndex || (step.id === 'context' && selected) || (step.id === 'quality' && selected) ? 'done' : step.id === current ? 'active' : ''; return <li className={`rs-step ${state}`} key={step.id} data-step={step.id}><span className="rs-step-index">{state === 'done' ? '✓' : String(index + 1).padStart(2, '0')}</span><span><strong>{step.label}</strong><small>{step.note}</small></span></li> })}</ol>
}

function DatasetContext({ dataset, workspace, fallbackDatasetId = '', fallbackKind = 'none' }) {
  const datasetId = dataset?.dataset_id || fallbackDatasetId
  if (!datasetId) return <section className="rs-section rs-context-section" aria-label="Research data context" data-testid="research-data-context"><div className="rs-section-head"><div><span className="rs-eyebrow">01 / CONTEXT</span><h2>Chọn dataset để bắt đầu</h2><p>Research cần một phạm vi dữ liệu cụ thể trước khi có thể nói về kết quả.</p></div><a className="rs-link" href={`/?view=data&workspace=${encodeURIComponent(workspace)}`}>Mở Data Desk →</a></div><div className="rs-empty-state"><span className="rs-state-mark">—</span><span><strong>Chưa có dữ liệu đầu vào</strong><small>Không hiển thị placeholder metrics và không tự suy ra provenance.</small></span></div></section>
  if (!dataset && fallbackKind === 'job') return <section className="rs-section rs-context-section" aria-label="Research job data context" data-testid="research-data-context"><div className="rs-section-head"><div><span className="rs-eyebrow">01 / CONTEXT</span><h2>Dataset đã khóa theo job</h2><p>Catalog hiện không cần tải để mở lại một job đã có.</p></div><a className="rs-link" href={`/?view=data&workspace=${encodeURIComponent(workspace)}&dataset=${encodeURIComponent(datasetId)}`}>Mở Data Desk →</a></div><dl className="rs-facts rs-facts-compact"><div><dt>Dataset</dt><dd><code>{datasetId}</code></dd></div><div><dt>Provenance</dt><dd>Đọc từ research job</dd></div><div><dt>Holdout</dt><dd>Chưa suy ra khi thiếu catalog</dd></div></dl></section>
  if (!dataset && fallbackKind === 'query') return <section className="rs-section rs-context-section" aria-label="Research dataset context" data-testid="research-data-context"><div className="rs-section-head"><div><span className="rs-eyebrow">01 / CONTEXT</span><h2>Dataset chưa được xác nhận trong catalog</h2><p>Deep link giữ nguyên dataset id, nhưng không tự đổi sang dataset khác khi catalog không có bản ghi khớp.</p></div><a className="rs-link" href={`/?view=data&workspace=${encodeURIComponent(workspace)}`}>Mở Data Desk →</a></div><dl className="rs-facts rs-facts-compact"><div><dt>Requested dataset</dt><dd><code>{datasetId}</code></dd></div><div><dt>Provenance</dt><dd>Chưa xác nhận</dd></div><div><dt>Next</dt><dd>Chọn dataset từ Data Desk</dd></div></dl></section>
  const range = datasetRange(dataset)
  return <section className="rs-section rs-context-section" aria-label="Research data context" data-testid="research-data-context"><div className="rs-section-head"><div><span className="rs-eyebrow">01 / CONTEXT</span><h2>{dataset.dataset_id}</h2><p>Phạm vi cố định cho run này. Đổi dataset sẽ xóa deep link job hiện tại.</p></div><a className="rs-link" href={`/?view=data&workspace=${encodeURIComponent(workspace)}&dataset=${encodeURIComponent(dataset.dataset_id)}`}>Mở Data Desk →</a></div><div className="rs-context-line"><strong>{dataset.instrument_id || 'Instrument chưa xác định'} · {dataset.timeframe || 'TF chưa xác định'}</strong><span>{formatNumber(dataset.row_count, 0)} rows · {formatUtc(range.start)} → {formatUtc(range.end)}</span></div><dl className="rs-facts"><div><dt>Quality</dt><dd><span className={`rs-pill is-${qualityTone(dataset)}`}>{qualityLabel(dataset)}</span></dd></div><div><dt>Holdout</dt><dd>{holdoutLabel(dataset)}</dd></div><div><dt>Provider</dt><dd>{dataset.provider_id || dataset.source?.provider || 'Chưa xác định'}</dd></div><div><dt>Artifact SHA</dt><dd><code>{dataset.artifact_sha256 || 'Chưa có hash'}</code></dd></div></dl><details className="rs-disclosure"><summary>Provenance và giới hạn dữ liệu</summary><div className="rs-disclosure-body"><p>Research chỉ đọc metadata catalog và kết quả job. Không mở holdout, không kết nối broker, không coi fixture là bằng chứng production.</p>{dataset.instrument_spec && <pre>{JSON.stringify(dataset.instrument_spec, null, 2)}</pre>}</div></details></section>
}

function QualityTakeaway({ dataset }) {
  const story = qualityStory(dataset)
  const warnings = datasetWarnings(dataset)
  return <section className={`rs-section rs-takeaway is-${story.tone}`} aria-label="Research data quality takeaway" data-testid="research-quality-takeaway"><div className="rs-section-head"><div><span className="rs-eyebrow">02 / QUALITY GATE</span><h2>{story.title}</h2><p>{story.body}</p></div><span className="rs-takeaway-marker" aria-hidden="true">{story.tone === 'ready' ? 'OK' : story.tone === 'fixture' ? 'QA' : story.tone === 'blocked' ? '—' : '!'}</span></div><div className="rs-takeaway-row"><strong>Next decision</strong><span>{story.action}</span><span className="rs-warning-count">{warnings.length ? `${warnings.length} cảnh báo` : 'Không có cảnh báo'}</span></div>{warnings.length > 0 && <details className="rs-disclosure" data-testid="research-data-warnings"><summary>Xem cảnh báo ảnh hưởng cách diễn giải</summary><ul className="rs-warning-list">{warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></details>}</section>
}

export default function ResearchWorkspace({ workspace = 'tenant-a', query = new URLSearchParams(window.location.search) }) {
  const requestedJob = query.get('job') || ''
  const requestedDataset = query.get('dataset') || ''
  const { updateMarketContext } = useFxReplayContext()
  const [catalog, setCatalog] = useState({ status: 'loading', datasets: [], engines: [], error: null })
  const [selectedId, setSelectedId] = useState(requestedDataset)
  const [form, setForm] = useState({ startingBalance: '10000', strategyVersion: 'close-delta-v1' })
  const [jobState, setJobState] = useState({ status: requestedJob ? 'loading' : 'idle', job: null, checkpoint: null, error: null })
  const [pending, setPending] = useState('')

  useEffect(() => {
    if (requestedJob) { setCatalog({ status: 'ready', datasets: [], engines: [], error: null }); return undefined }
    const controller = new AbortController()
    Promise.all([fetchDatasets(workspace, controller.signal), fetchResearchEngines(workspace, controller.signal)]).then(([datasets, engines]) => { setCatalog({ status: 'ready', datasets, engines: engines?.items || [], error: null }); setSelectedId((current) => current || datasets[0]?.dataset_id || '') }).catch((error) => { if (error.name !== 'AbortError') setCatalog({ status: 'error', datasets: [], engines: [], error: String(error.message || error) }) })
    return () => controller.abort()
  }, [requestedJob, workspace])

  const selected = catalog.datasets.find((dataset) => dataset.dataset_id === selectedId) || (!requestedDataset ? catalog.datasets[0] : null)
  useEffect(() => { if (selected) updateMarketContext({ instrument: String(selected.instrument_id || selected.dataset_id || ''), timeframe: String(selected.timeframe || 'TF chưa rõ'), dataStatus: String(selected.quality_status || 'unverified') }) }, [selected, updateMarketContext])

  const refreshJob = useCallback(async (jobId, signal) => { const job = await getResearchJob(workspace, jobId, signal); let checkpoint = null; if (job.status === 'queued' || job.status === 'running') checkpoint = await getResearchCheckpoint(workspace, jobId, signal); setJobState({ status: 'ready', job, checkpoint, error: null }); return job }, [workspace])
  const pollJobId = requestedJob || jobState.job?.job_id || ''
  useEffect(() => {
    if (!pollJobId) return undefined
    const controller = new AbortController(); let timer
    const poll = async () => { try { const job = await refreshJob(pollJobId, controller.signal); if (!['queued', 'running'].includes(job.status)) return; timer = window.setTimeout(poll, 1500) } catch (error) { if (error.name !== 'AbortError') setJobState({ status: 'error', job: null, checkpoint: null, error: String(error.message || error) }) } }
    poll(); return () => { controller.abort(); if (timer) window.clearTimeout(timer) }
  }, [refreshJob, pollJobId])

  const runResearch = async (event) => {
    event.preventDefault()
    if (!selected) { setJobState({ status: 'error', job: null, checkpoint: null, error: 'Cần chọn dataset trước khi tạo research run.' }); return }
    const startingBalance = Number(form.startingBalance)
    if (!Number.isFinite(startingBalance) || startingBalance <= 0) { setJobState({ status: 'error', job: null, checkpoint: null, error: 'Starting balance phải là số dương.' }); return }
    setPending('create'); setJobState({ status: 'loading', job: null, checkpoint: null, error: null })
    try { const job = await createResearchJob(workspace, { dataset_id: selected.dataset_id, strategy_version: form.strategyVersion, starting_balance: startingBalance }); setQuery({ view: 'research', workspace, dataset: selected.dataset_id, job: job.job_id }); setJobState({ status: 'ready', job, checkpoint: null, error: null }) } catch (error) { setJobState({ status: 'error', job: null, checkpoint: null, error: String(error.message || error) }) } finally { setPending('') }
  }

  const cancel = async () => {
    if (!jobState.job?.job_id) return
    setPending('cancel')
    try { const job = await cancelResearchJob(workspace, jobState.job.job_id); setJobState((current) => ({ ...current, status: 'ready', job, error: null })) } catch (error) { setJobState((current) => ({ ...current, status: 'error', error: String(error.message || error) })) } finally { setPending('') }
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
  const learnParams = new URLSearchParams({ view: 'learn', workspace, from: 'research' }); if (job?.job_id || requestedJob) learnParams.set('job', job?.job_id || requestedJob); if (contextDatasetId) learnParams.set('dataset', contextDatasetId)
  const learnHref = `/?${learnParams.toString()}`
  const analyticsHref = `/?view=analytics&workspace=${encodeURIComponent(workspace)}${job?.job_id ? `&job=${encodeURIComponent(job.job_id)}` : ''}`
  const replayHref = `/?view=replay&workspace=${encodeURIComponent(workspace)}${contextDatasetId ? `&dataset=${encodeURIComponent(contextDatasetId)}` : ''}`

  return <main className="rs-shell" data-testid="research-root">
    <header className="rs-topbar"><div><span className="rs-eyebrow">TRADING WORKSPACE / RESEARCH</span><h1>Research theo bằng chứng</h1><p>Context → quality gate → run → checkpoint → result. Mỗi bước giữ nguyên phạm vi dữ liệu và trạng thái thật.</p></div><div className="rs-top-actions"><span className="rs-safety"><strong>RESEARCH / SIMULATION</strong><small>Broker locked · không gửi lệnh</small></span><a className="rs-link" href={`/?view=data&workspace=${encodeURIComponent(workspace)}${contextDatasetId ? `&dataset=${encodeURIComponent(contextDatasetId)}` : ''}`}>Data Desk →</a></div></header>
    <div className="rs-statusbar" aria-label="Trạng thái Research"><span>Workspace <strong>{workspace}</strong></span><span>Job <code>{job?.job_id || requestedJob || 'Chưa tạo'}</code></span><span className={`rs-status ${statusClass(job?.status)}`} data-testid="research-status">{job ? statusLabel(job.status) : catalog.status === 'loading' ? 'Đang tải catalog' : 'Chưa chạy'}</span><span>Engine <strong>{engine?.available ? 'nautilus sẵn sàng' : 'reference / chưa xác minh'}</strong></span></div>
    <FlowStepper selected={selected || Boolean(contextDatasetId)} job={job} result={result} />
    {catalog.status === 'loading' && <div className="rs-message" role="status">Đang đọc dataset và research engines…</div>}
    {catalog.status === 'error' && <div className="rs-message is-error" role="alert">Không đọc được catalog: {catalog.error}</div>}
    {jobState.status === 'error' && <div className="rs-message is-error" role="alert">Research không hoàn tất: {jobState.error}</div>}
    <div className="rs-layout"><div className="rs-primary-column"><DatasetContext dataset={selected} workspace={workspace} fallbackDatasetId={contextDatasetId} fallbackKind={job?.dataset_id ? 'job' : requestedDataset ? 'query' : 'none'} /><QualityTakeaway dataset={selected} />{catalog.status === 'ready' && <section className="rs-section rs-run-section" aria-label="Tạo research run" data-testid="research-run-form"><div className="rs-section-head"><div><span className="rs-eyebrow">03 / RUN CONFIG</span><h2>Cố định giả định</h2><p>Chỉ gửi dataset, strategy contract và starting balance đến local research backend.</p></div></div>{catalog.datasets.length === 0 ? <div className="rs-empty-state"><span className="rs-state-mark">i</span><span><strong>Đang mở lại job hiện tại</strong><small>Muốn tạo run mới, mở Data Desk để chọn một dataset khác.</small></span></div> : <form className="rs-run-form" onSubmit={runResearch}><label className="rs-field rs-field-wide"><span>Dataset</span><select aria-label="Research dataset" value={selected?.dataset_id || ''} onChange={(event) => { setSelectedId(event.target.value); setQuery({ dataset: event.target.value, job: null }) }}><option value="" disabled>Chọn dataset</option>{catalog.datasets.map((dataset) => <option key={dataset.dataset_id} value={dataset.dataset_id}>{dataset.dataset_id} · {dataset.instrument_id || 'instrument?'}</option>)}</select><small>Dataset là anchor của provenance và không tự đổi theo catalog.</small></label><label className="rs-field"><span>Starting balance</span><input aria-label="Starting balance" inputMode="decimal" value={form.startingBalance} onChange={(event) => setForm((current) => ({ ...current, startingBalance: event.target.value }))} /><small>Đơn vị theo contract engine.</small></label><label className="rs-field"><span>Strategy contract</span><select aria-label="Strategy version" value={form.strategyVersion} onChange={(event) => setForm((current) => ({ ...current, strategyVersion: event.target.value }))}><option value="close-delta-v1">close-delta-v1</option></select><small>Chỉ engine đã được backend công bố.</small></label><button className="rs-button is-primary" type="submit" data-testid="research-run-submit" disabled={pending === 'create' || Boolean(active) || !selected}>{pending === 'create' ? 'Đang tạo…' : active ? 'Run đang chạy…' : 'Tạo research run'}</button></form>}{selected && <div className="rs-run-guard"><strong>Guard trước khi chạy</strong><span>{qualityLabel(selected)} · {holdoutLabel(selected)} · {selected.instrument_spec ? 'instrument cost metadata có sẵn' : 'instrument spec chưa xác định'}.</span></div>}</section>}{job && <section className="rs-section rs-checkpoint-section" aria-label="Research job" data-testid="research-job-panel"><div className="rs-section-head"><div><span className="rs-eyebrow">04 / CHECKPOINT</span><h2>{active ? 'Run đang tạo bằng chứng' : 'Run đã có trạng thái cuối'}</h2><p>Backend là authority; checkpoint chỉ mô tả tiến độ, không biến thành kết quả giả.</p></div>{active && <button className="rs-button is-danger" type="button" data-testid="research-cancel" onClick={cancel} disabled={pending === 'cancel'}>{pending === 'cancel' ? 'Đang hủy…' : 'Hủy run'}</button>}</div><div className="rs-job-strip"><div><span>Status</span><strong className={statusClass(job.status)}>{statusLabel(job.status)}</strong></div><div><span>Dataset</span><code>{job.dataset_id}</code></div><div><span>Attempt</span><strong>{job.attempt_no ?? 'Chưa có'}</strong></div><div><span>Cập nhật</span><strong>{formatUtc(job.updated_at_utc)}</strong></div></div>{active && <div className="rs-checkpoint-body">{progress !== null ? <div className="rs-progress-wrap"><div className="rs-progress-label"><span>Tiến độ backend</span><strong>{formatNumber(progress, 0)}%</strong></div><div className="rs-progress" aria-label={`Tiến độ ${formatNumber(progress, 0)}%`}><span style={{ width: `${progress}%` }} /></div></div> : <div className="rs-message">Backend chưa cung cấp phần trăm tiến độ; run vẫn đang hoạt động.</div>}{jobState.checkpoint && <div className="rs-checkpoint-note" data-testid="research-checkpoint"><strong>Checkpoint:</strong> {jobState.checkpoint.checkpoint?.phase || jobState.checkpoint.phase || 'đang cập nhật'} · attempt {jobState.checkpoint.checkpoint?.attempt_no || jobState.checkpoint.attempt_no || 'N/A'}</div>}</div>}{errors.length > 0 && <div className="rs-message is-error">Backend error: {errors.join(', ')}</div>}</section>}</div><aside className="rs-secondary-column">{result ? <section className="rs-result-section" aria-label="Research result" data-testid="research-result"><div className="rs-section-head"><div><span className="rs-eyebrow">05 / RESULT</span><h2>Kết quả có provenance</h2><p>Đọc takeaway trước, mở số liệu chi tiết sau.</p></div><span className="rs-pill is-ready">Completed</span></div><div className="rs-result-takeaway"><strong>{result.trade_count === 0 ? 'Chưa có trade để kết luận' : `Đã đóng ${formatNumber(result.trade_count, 0)} trade`}</strong><span>{metrics.net_pnl === null || metrics.net_pnl === undefined ? 'Net P/L chưa có dữ liệu' : `Net P/L ${formatNumber(metrics.net_pnl)}`}. Không suy diễn từ metric bị thiếu.</span></div><div className="rs-result-grid"><div><span>Trades</span><strong>{formatNumber(result.trade_count, 0)}</strong></div><div><span>Net P/L</span><strong>{formatNumber(metrics.net_pnl)}</strong></div><div><span>Win rate</span><strong>{metrics.win_rate_pct === null || metrics.win_rate_pct === undefined ? 'N/A' : `${formatNumber(metrics.win_rate_pct)}%`}</strong></div><div><span>Max DD</span><strong>{formatNumber(metrics.closed_trade_balance_max_drawdown)}</strong></div></div><Sparkline points={curve} /><details className="rs-disclosure rs-provenance"><summary>Result provenance</summary><dl className="rs-provenance-grid"><div><dt>Dataset SHA</dt><dd><code>{result.dataset_sha256 || 'Chưa có hash'}</code></dd></div><div><dt>Metrics schema</dt><dd><code>{result.metrics_schema_version || 'Chưa xác định'}</code></dd></div><div><dt>Job</dt><dd><code>{result.job_id}</code></dd></div></dl></details><div className="rs-next-action" data-testid="research-next-actions"><span className="rs-eyebrow">NEXT ACTION</span><strong>Đưa kết quả về vòng lặp trading</strong><p>Result chỉ có giá trị khi bạn biết bước review tiếp theo.</p><div className="rs-action-list"><a href={replayHref}>Mở lại Practice ↗</a><a href={analyticsHref}>Xem Analytics ↗</a><a href={learnHref}>Ôn glossary ↗</a></div></div></section> : job && ['failed', 'canceled'].includes(job.status) ? <section className="rs-result-section rs-result-terminal" data-testid="research-terminal-result"><div className="rs-section-head"><div><span className="rs-eyebrow">05 / RESULT</span><h2>{statusLabel(job.status)} — chưa có result</h2><p>Backend đã kết thúc run nhưng không phát hành metrics. Không dựng kết quả thay thế.</p></div><span className="rs-pill is-warn">{statusLabel(job.status)}</span></div><div className="rs-empty-state"><span className="rs-state-mark">!</span><span><strong>{job.error_code || 'Không có error code'}</strong><small>Giữ nguyên trạng thái terminal và mở lại workflow khi đã xác định nguyên nhân.</small></span></div><div className="rs-action-list"><a href={learnHref}>Học &amp; thuật ngữ</a><a href={replayHref}>Mở Practice</a></div></section> : !job ? <section className="rs-result-section rs-result-placeholder" aria-label="Research result placeholder"><div className="rs-section-head"><div><span className="rs-eyebrow">05 / RESULT</span><h2>Kết quả sẽ xuất hiện ở đây</h2><p>Không có run thì không hiển thị số giả.</p></div></div><div className="rs-empty-state"><span className="rs-state-mark">○</span><span><strong>Chưa có result</strong><small>Hoàn tất context và run config ở cột bên trái trước.</small></span></div><div className="rs-action-list"><a href={learnHref}>Học &amp; thuật ngữ</a></div></section> : null}</aside></div>
  </main>
}

export { checkpointProgress, qualityStory, qualityTone, statusLabel }
