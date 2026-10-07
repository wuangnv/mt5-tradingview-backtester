import { readJson, workspaceHeaders } from './researchDataApi.js'

export async function fetchOfflineLibrary(workspace, signal) {
  const response = await fetch('/api/v2/data/datasets', { headers:workspaceHeaders(workspace), signal })
  const payload = await readJson(response)
  return { datasets:Array.isArray(payload.items) ? payload.items : [], instruments:Array.isArray(payload.catalog_items) ? payload.catalog_items : [], catalog:payload.catalog_state || null }
}

export async function refreshInstrumentCatalog(workspace, signal) {
  const response = await fetch('/api/v2/data/catalog/refresh', { method:'POST', headers:workspaceHeaders(workspace), signal })
  const payload = await readJson(response)
  return { instruments:Array.isArray(payload.catalog_items) ? payload.catalog_items : [], catalog:payload.catalog_state || null }
}

async function postCsv(workspace, route, payload) {
  const response = await fetch(route, {
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
