import { scopedMutation } from './scopedMutation.js'
/**
 * Playbook catalog and manual draft helpers.
 *
 * The Playbook backend owns revisions and lineage.
 * Quick session creation can add a needs-definition draft. Freeze, fork and
 * automated execution remain separate capabilities.
 */

function requestHeaders(workspace) {
  return { 'X-Workspace-Id': workspace }
}

async function readJson(response) {
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(String(payload.detail || `HTTP ${response.status}`))
    error.status = response.status
    throw error
  }
  return payload
}

export async function fetchPlaybooks(workspace, signal) {
  const response = await fetch('/api/v2/playbooks', {
    headers: requestHeaders(workspace),
    signal,
  })
  const payload = await readJson(response)
  return Array.isArray(payload?.items) ? payload.items : []
}

export async function createPlaybookDraft(workspace, name) {
  return readJson(await scopedMutation('/api/v2/playbooks', workspace, {
    method: 'POST', headers: { ...requestHeaders(workspace), 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, status: 'draft', execution_capability: 'needs-definition', rules: {} }),
  }))
}

export async function fetchPlaybookRevisions(workspace, playbookId, signal) {
  if (!playbookId) return []
  const response = await fetch(`/api/v2/playbooks/${encodeURIComponent(playbookId)}/revisions`, {
    headers: requestHeaders(workspace),
    signal,
  })
  const payload = await readJson(response)
  return Array.isArray(payload?.items) ? payload.items : []
}

function isObject(value) {
  return value !== null && typeof value === 'object'
}

function sortedObject(value) {
  if (Array.isArray(value)) return value.map(sortedObject)
  if (!isObject(value)) return value
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortedObject(value[key])]))
}

export function stableStringify(value) {
  return JSON.stringify(sortedObject(value))
}

function leafPaths(value, prefix = '') {
  if (!isObject(value) || (Array.isArray(value) && value.length === 0)) return [prefix || '$']
  const entries = Array.isArray(value)
    ? value.map((child, index) => [String(index), child])
    : Object.entries(value)
  if (entries.length === 0) return [prefix || '$']
  return entries.flatMap(([key, child]) => leafPaths(child, prefix ? `${prefix}.${key}` : key))
}

function valueAtPath(value, path) {
  if (path === '$') return value
  return path.split('.').reduce((current, key) => (current == null ? undefined : current[key]), value)
}

function displayValue(value) {
  if (value === undefined) return '—'
  if (typeof value === 'string') return value
  if (value === null) return 'null'
  return stableStringify(value)
}

/**
 * Return a small deterministic leaf-level diff for the human review surface.
 * Values remain structured in the returned object; the UI decides how much
 * to display, keeping raw payload JSON out of the normal workflow.
 */
export function diffPayloads(leftPayload = {}, rightPayload = {}) {
  const paths = [...new Set([...leafPaths(leftPayload), ...leafPaths(rightPayload)])].sort()
  return paths
    .map((path) => {
      const left = valueAtPath(leftPayload, path)
      const right = valueAtPath(rightPayload, path)
      return {
        path,
        left,
        right,
        leftDisplay: displayValue(left),
        rightDisplay: displayValue(right),
        changed: stableStringify(left) !== stableStringify(right),
      }
    })
    .filter((item) => item.changed)
}

