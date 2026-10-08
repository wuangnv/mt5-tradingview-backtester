import { displayDate } from './dateFormat.js'
export async function readJson(response) {
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    const detail = payload?.detail || `HTTP ${response.status}`
    const error = new Error(String(detail))
    error.status = response.status
    error.payload = payload
    throw error
  }
  return payload
}

export function workspaceHeaders(workspace, extra = {}) {
  return { 'X-Workspace-Id': workspace, ...extra }
}

export async function fetchDatasets(workspace, signal) {
  const response = await fetch('/api/v2/data/datasets', {
    headers: workspaceHeaders(workspace),
    signal,
  })
  const payload = await readJson(response)
  return Array.isArray(payload?.items) ? payload.items : []
}

export async function fetchProviders(workspace, signal) {
  const response = await fetch('/api/v2/data/providers', {
    headers: workspaceHeaders(workspace),
    signal,
  })
  const payload = await readJson(response)
  return Array.isArray(payload?.items) ? payload.items : []
}

export async function fetchResearchEngines(workspace, signal) {
  const response = await fetch('/api/v2/research/engines', {
    headers: workspaceHeaders(workspace),
    signal,
  })
  return readJson(response)
}

export async function createResearchJob(workspace, body) {
  const response = await fetch('/api/v2/research/jobs', {
    method: 'POST',
    headers: workspaceHeaders(workspace, { 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  })
  return readJson(response)
}

export async function getResearchJob(workspace, jobId, signal) {
  const response = await fetch(`/api/v2/research/jobs/${encodeURIComponent(jobId)}`, {
    headers: workspaceHeaders(workspace),
    signal,
  })
  return readJson(response)
}

export async function getResearchCheckpoint(workspace, jobId, signal) {
  const response = await fetch(`/api/v2/research/jobs/${encodeURIComponent(jobId)}/checkpoint`, {
    headers: workspaceHeaders(workspace),
    signal,
  })
  if (response.status === 404) return null
  return readJson(response)
}

export async function cancelResearchJob(workspace, jobId) {
  const response = await fetch(`/api/v2/research/jobs/${encodeURIComponent(jobId)}/cancel`, {
    method: 'POST',
    headers: workspaceHeaders(workspace),
  })
  return readJson(response)
}

export function formatUnknown(value, fallback = 'Chưa xác minh') {
  if (value === null || value === undefined || value === '' || Number.isNaN(Number(value))) return fallback
  return String(value)
}

export function formatNumber(value, digits = 2, fallback = 'Chưa có dữ liệu') {
  if (value === null || value === undefined || value === '' || !Number.isFinite(Number(value))) return fallback
  return new Intl.NumberFormat('vi-VN', { maximumFractionDigits: digits }).format(Number(value))
}

export function formatUtc(value, locale = 'vi-VN') {
  if (value === null || value === undefined || value === '') return 'Chưa có dữ liệu'
  const raw = Number(value)
  const date = Number.isFinite(raw)
    ? new Date(raw > 10_000_000_000 ? raw : raw * 1000)
    : new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return displayDate(date, { timeStyle: 'short' })
}

export function qualityLabel(dataset) {
  const status = dataset?.quality_status || dataset?.quality?.status || dataset?.quality?.overall_status
  if (status === 'fixture-only') return 'Fixture / QA only'
  if (status === 'verified') return 'Đã xác minh'
  if (status === 'unverified') return 'Chưa xác minh'
  return 'Chưa có trạng thái QA'
}

export function holdoutLabel(dataset) {
  if (dataset?.holdout_access === true) return 'Có quyền holdout'
  const mode = dataset?.holdout_policy?.mode
  if (mode && mode !== 'none') return `Holdout: ${mode}`
  return 'Holdout khóa'
}

export function datasetRange(dataset) {
  const range = dataset?.available_range || {}
  const start = range.from_utc ?? range.start_utc ?? dataset?.first_timestamp
  const end = range.to_utc ?? range.end_utc ?? dataset?.last_timestamp
  return { start, end }
}

export function datasetWarnings(dataset) {
  if (!dataset) return ['Chưa chọn dataset.']
  const warnings = []
  if (dataset.quality_status !== 'verified' && dataset.quality?.status !== 'verified') warnings.push('Dataset chưa được xác minh cho production.')
  if (dataset.holdout_access !== true && (dataset.holdout_policy?.mode || 'none') !== 'none') warnings.push('Holdout đang bị khóa; không dùng cho quyết định OOS.')
  if (dataset.holdout_access !== true && (dataset.holdout_policy?.mode || 'none') === 'none') warnings.push('Không có quyền holdout trong workspace này.')
  if (!dataset.artifact_sha256) warnings.push('Thiếu hash artifact; provenance chưa đầy đủ.')
  if (!dataset.instrument_spec) warnings.push('Thiếu instrument spec; cost/risk preview có thể chưa tính được.')
  return warnings
}
