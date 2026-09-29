/**
 * Stable URL context for the chart/replay workbench.
 *
 * Route-specific query values (job, trade, attempt, from, ...) belong to the
 * destination. These keys are the cross-workspace context that must survive a
 * navigation so a user can leave Practice and return to the same evidence.
 */
export const WORKSPACE_CONTEXT_KEYS = Object.freeze([
  'workspace',
  'session',
  'dataset',
  'cursor',
  'cutoff',
  'mode',
])

function asSearchParams(queryLike) {
  if (queryLike instanceof URLSearchParams) return new URLSearchParams(queryLike)
  if (queryLike instanceof URL) return new URLSearchParams(queryLike.search)
  if (typeof queryLike === 'string') return new URLSearchParams(queryLike.replace(/^\?/, ''))
  if (queryLike && typeof queryLike === 'object') {
    if (typeof queryLike.search === 'string') return new URLSearchParams(queryLike.search.replace(/^\?/, ''))
    return new URLSearchParams(queryLike)
  }
  return new URLSearchParams()
}

function firstValue(params, names) {
  for (const name of names) {
    const value = params.get(name)
    if (value !== null && value !== '') return value
  }
  return ''
}

function normalizedCursor(value) {
  if (value === null || value === undefined || value === '') return ''
  const numeric = Number(value)
  return Number.isInteger(numeric) && numeric >= 0 ? String(numeric) : ''
}

function normalizedCutoff(value) {
  if (value === null || value === undefined || value === '') return ''
  const text = String(value).trim()
  // Cutoff may be an API timestamp or a short opaque bar/token identifier.
  // Reject whitespace/control characters so a copied deep link cannot carry
  // an accidental multi-value query fragment.
  return /^[A-Za-z0-9_.:+-]+$/.test(text) ? text : ''
}

/**
 * Read the canonical context while accepting aliases emitted by older routes.
 * The returned object is display/state data, not an authority for broker or
 * holdout access.
 */
export function readWorkspaceContext(queryLike) {
  const params = asSearchParams(queryLike)
  const cursor = normalizedCursor(firstValue(params, ['cursor', 'cursor_index']))
  const cutoff = normalizedCutoff(firstValue(params, ['cutoff', 'decision_cutoff']))
  return {
    workspaceId: firstValue(params, ['workspace']),
    sessionId: firstValue(params, ['session', 'replay_session']),
    datasetId: firstValue(params, ['dataset', 'dataset_id']),
    cursorIndex: cursor === '' ? null : Number(cursor),
    decisionCutoff: cutoff,
    mode: firstValue(params, ['mode']),
  }
}

/**
 * Build a route while carrying only the shared workspace context plus explicit
 * destination parameters. `null` deletes a context key; `undefined` keeps the
 * value from the source query. This makes it safe for a destination to clear a
 * stale session when starting a new dataset without losing workspace identity.
 */
export function buildWorkspaceHref(view, workspace, queryLike, overrides = {}) {
  const source = asSearchParams(queryLike)
  const context = readWorkspaceContext(source)
  const params = new URLSearchParams()
  const workspaceId = overrides.workspace ?? workspace ?? context.workspaceId ?? 'tenant-a'
  params.set('workspace', String(workspaceId))
  if (view) params.set('view', String(view))

  const values = {
    session: context.sessionId,
    dataset: context.datasetId,
    cursor: context.cursorIndex === null ? '' : String(context.cursorIndex),
    cutoff: context.decisionCutoff,
    mode: context.mode,
  }
  for (const key of ['session', 'dataset', 'cursor', 'cutoff', 'mode']) {
    const hasOverride = Object.prototype.hasOwnProperty.call(overrides, key)
    const value = hasOverride && overrides[key] !== undefined ? overrides[key] : values[key]
    if (value === null || value === undefined || value === '') continue
    if (key === 'cursor' && normalizedCursor(value) === '') continue
    params.set(key, key === 'cursor' ? normalizedCursor(value) : String(value))
  }

  // Keep destination-specific values explicit. Do not copy arbitrary source
  // parameters: job/trade/attempt are meaningful only when a route opts in.
  for (const [key, value] of Object.entries(overrides)) {
    if (WORKSPACE_CONTEXT_KEYS.includes(key) || key === 'workspace' || key === 'view') continue
    if (value === null || value === undefined || value === '') continue
    params.set(key, String(value))
  }
  return `/?${params.toString()}`
}
