import { readJson, workspaceHeaders } from './researchDataApi.js'

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
