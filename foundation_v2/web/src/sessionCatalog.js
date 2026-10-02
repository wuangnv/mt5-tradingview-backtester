import { buildWorkspaceHref } from './workspaceContext.js'

export function normalizeSessionCatalog(payload) {
  if (!Array.isArray(payload?.items) || payload.items.some((item) => !item || typeof item.record_id !== 'string' || !item.record_id || !Number.isInteger(item.revision) || item.revision < 1)) {
    throw new Error('Danh mục phiên không đúng định dạng.')
  }
  return payload.items
}

async function request(path, workspace, options = {}) {
  const response = await fetch(path, { ...options, headers: { 'X-Workspace-Id': workspace, ...(options.body ? { 'Content-Type': 'application/json' } : {}) } })
  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    const error = new Error(typeof payload?.detail === 'string' ? payload.detail : `HTTP ${response.status}`)
    error.status = response.status
    throw error
  }
  if (!payload || typeof payload !== 'object') throw new Error('Phản hồi phiên không đúng định dạng.')
  return payload
}

export async function fetchReplaySessions(workspace, signal) {
  return normalizeSessionCatalog(await request('/api/v2/replay/sessions', workspace, { signal }))
}

export function updateSessionMetadata(workspace, session, changes) {
  return request(`/api/v2/replay/sessions/${encodeURIComponent(session.record_id)}`, workspace, {
    method: 'PATCH', body: JSON.stringify({ ...changes, expected_revision: session.revision }),
  })
}

export function duplicateSession(workspace, session) {
  return request(`/api/v2/replay/sessions/${encodeURIComponent(session.record_id)}/branch`, workspace, {
    method: 'POST', body: JSON.stringify({ expected_revision: session.revision, cursor_index: session.cursor_index }),
  })
}

export function sessionNavigationHref(kind, workspace, query, item, overrides = {}) {
  return buildWorkspaceHref(kind, workspace, query, {
    select: '1', session: item?.record_id || null, dataset: item?.dataset_id || null,
    cursor: null, cutoff: null, playbook: null, playbook_revision: null, mode: 'Practice', ...overrides,
  })
}

export function sessionAnalyticsQuery(query, item, { summary = false } = {}) {
  const next = new URLSearchParams(query)
  const sameSession = (next.get('session') || next.get('replay_session')) === item.record_id
  for (const key of ['job', 'job_id', 'replay_session']) next.delete(key)
  // Keep explicit same-session drilldown context while switching sessions starts a new scope.
  if (!sameSession || summary) for (const key of ['trade', 'trade_id', 'cursor', 'cutoff', 'cursor_index', 'decision_cutoff']) next.delete(key)
  if (summary) for (const key of ['side', 'outcome', 'from', 'to', 'from_close_utc', 'to_close_utc']) next.delete(key)
  next.set('session', item.record_id)
  if (item.dataset_id) next.set('dataset', item.dataset_id)
  else next.delete('dataset')
  return next
}
