import { scopedMutation } from './scopedMutation.js'
import { readJson, workspaceHeaders } from './researchDataApi.js'
import { scopedRead } from './scopedRead.js'

export function mergeDownloadEvent(items, event, workspace) {
  if (event?.schema_version !== 'workspace-events-v1' || event.workspace_id !== workspace) return null
  const sources = [event.downloads?.qdm?.jobs, event.downloads?.dukascopy?.jobs]
  if (sources.some(jobs => !Array.isArray(jobs))) return null
  const incoming = sources.flat()
  if (incoming.some(job => !job || typeof job.job_id !== 'string' || typeof job.status !== 'string')) return null
  const merged = new Map(items.map(job => [job.job_id, job]))
  // Stream snapshots are bounded; retain older history from the full GET.
  for (const job of incoming) merged.set(job.job_id, job)
  return [...merged.values()]
}

export async function fetchOfflineLibrary(workspace, signal) {
  const response = await scopedRead('/api/v2/data/datasets', workspace, signal)
  const payload = await readJson(response)
  return { datasets:Array.isArray(payload.items) ? payload.items : [], instruments:Array.isArray(payload.catalog_items) ? payload.catalog_items : [], catalog:payload.catalog_state || null, download:payload.download_state || null }
}

export async function refreshInstrumentCatalog(workspace, signal) {
  const response = await scopedMutation('/api/v2/data/catalog/refresh', workspace, { method:'POST', headers:workspaceHeaders(workspace), signal })
  const payload = await readJson(response)
  return { instruments:Array.isArray(payload.catalog_items) ? payload.catalog_items : [], catalog:payload.catalog_state || null, ...(payload.download_state ? {download:payload.download_state} : {}) }
}

async function postCsv(workspace, route, payload) {
  const response = await scopedMutation(route, workspace, {
    method: 'POST',
    headers: workspaceHeaders(workspace, { 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload),
  })
  return readJson(response)
}

export function previewLocalCsv(workspace, payload) {
  return postCsv(workspace, '/api/v2/data/csv/preview', payload)
}

export function importLocalCsv(workspace, payload) {
  return postCsv(workspace, '/api/v2/data/csv/import', payload)
}

export async function fetchDownloads(workspace, signal) {
  const response = await scopedRead('/api/v2/data/downloads', workspace, signal)
  const payload = await readJson(response)
  return { items:Array.isArray(payload.items) ? payload.items : [], available:Boolean(payload.available), supportsPause:payload.supports_pause === true, supportsCancel:payload.supports_cancel !== false }
}

export async function startDownload(workspace, payload, signal) {
  const response = await scopedMutation('/api/v2/data/downloads/full', workspace, { method:'POST', headers:workspaceHeaders(workspace, { 'Content-Type':'application/json' }), body:JSON.stringify(payload), signal })
  return readJson(response)
}

export async function deleteLocalDataset(workspace, datasetId, signal) {
  const response = await scopedMutation(`/api/v2/data/datasets/${encodeURIComponent(datasetId)}`, workspace, { method:'DELETE', headers:workspaceHeaders(workspace), signal })
  return readJson(response)
}

export async function updateDownload(workspace, jobId, action, signal) {
  if (!['resume','pause','cancel'].includes(action)) throw new Error('Invalid download action')
  const response = await scopedMutation(`/api/v2/data/downloads/${encodeURIComponent(jobId)}/${action}`, workspace, { method:'POST', headers:workspaceHeaders(workspace), signal })
  return readJson(response)
}
