/**
 * Causal chart-annotation client for the replay workbench.
 *
 * The renderer owns pixels; this module owns the small, typed boundary between
 * a chart gesture and the existing annotation API.  It deliberately accepts
 * only time/price anchors and a replay cutoff.  It cannot send an order, call a
 * broker, or write an annotation whose anchor is after the visible cutoff.
 */

export const ANNOTATION_TYPES = Object.freeze([
  'horizontal-line',
  'zone',
  'trendline',
  'text',
  'arrow',
  'entry',
  'sl',
  'tp',
])

const TYPE_SET = new Set(ANNOTATION_TYPES)
const MAX_ANCHORS = 8
const MAX_TEXT = 256
const MAX_ID = 128
const DRAFT_KEYS = new Set([
  'annotation_type',
  'instrument_id',
  'timeframe',
  'cutoff_timestamp',
  'anchors',
  'source',
  'run_id',
  'rule_version',
  'label',
])

function fail(message) {
  const error = new Error(message)
  error.name = 'ChartAnnotationError'
  throw error
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function boundedText(value, path, maxLength = MAX_ID) {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maxLength || /[\u0000-\u001f]/u.test(value)) {
    fail(`${path} must be a non-empty bounded string`)
  }
  return value
}

function optionalText(value, path, maxLength = MAX_ID) {
  if (value === null || value === undefined || value === '') return null
  return boundedText(value, path, maxLength)
}

function safeInteger(value, path, { minimum = 0 } = {}) {
  if (value === null || value === undefined || typeof value === 'boolean' || (typeof value === 'string' && value.trim() === '')) {
    fail(`${path} must be a safe integer >= ${minimum}`)
  }
  const number = typeof value === 'number' ? value : Number(value)
  if (!Number.isSafeInteger(number) || number < minimum) fail(`${path} must be a safe integer >= ${minimum}`)
  return number
}

function finiteNumber(value, path) {
  if (value === null || value === undefined || typeof value === 'boolean' || (typeof value === 'string' && value.trim() === '')) fail(`${path} must be finite`)
  const number = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(number)) fail(`${path} must be finite`)
  return number
}

function assertKnownKeys(value, path) {
  for (const key of Object.keys(value)) {
    if (!DRAFT_KEYS.has(key)) fail(`${path}.${key} is not supported`)
  }
}

function normalizeAnchor(value, index, cutoff) {
  if (!isRecord(value)) fail(`anchors[${index}] must be an object`)
  const timestamp = safeInteger(value.timestamp, `anchors[${index}].timestamp`)
  if (timestamp > cutoff) fail(`anchors[${index}].timestamp exceeds replay cutoff`)
  const price = finiteNumber(value.price, `anchors[${index}].price`)
  return { timestamp, price }
}

/**
 * Normalize one API-compatible annotation draft.
 *
 * Unknown fields are rejected instead of silently dropped.  This keeps a UI
 * update from appearing successful while losing a future field or session
 * binding that the server does not understand yet.
 */
export function normalizeAnnotationDraft(value) {
  if (!isRecord(value)) fail('annotation draft must be an object')
  assertKnownKeys(value, 'annotation')

  const annotationType = boundedText(value.annotation_type, 'annotation.annotation_type', 32)
  if (!TYPE_SET.has(annotationType)) fail(`annotation.annotation_type is unsupported: ${annotationType}`)
  const instrumentId = boundedText(value.instrument_id, 'annotation.instrument_id', 64)
  const timeframe = boundedText(value.timeframe, 'annotation.timeframe', 32)
  const cutoff = safeInteger(value.cutoff_timestamp, 'annotation.cutoff_timestamp')
  if (!Array.isArray(value.anchors) || value.anchors.length < 1 || value.anchors.length > MAX_ANCHORS) {
    fail(`annotation.anchors must contain 1-${MAX_ANCHORS} items`)
  }
  const source = boundedText(value.source, 'annotation.source', 64)
  return {
    annotation_type: annotationType,
    instrument_id: instrumentId,
    timeframe,
    cutoff_timestamp: cutoff,
    anchors: value.anchors.map((anchor, index) => normalizeAnchor(anchor, index, cutoff)),
    source,
    run_id: optionalText(value.run_id, 'annotation.run_id'),
    rule_version: optionalText(value.rule_version, 'annotation.rule_version'),
    label: optionalText(value.label, 'annotation.label', MAX_TEXT),
  }
}

/**
 * Build the smallest useful local draft from a real chart click.
 *
 * A single chart anchor can only describe a horizontal level at this point;
 * a zone/trendline needs a second gesture and remains deliberately out of
 * scope.  The draft is still normalized through the same cutoff and numeric
 * guards as a persisted annotation, but this helper does not write anything.
 */
export function buildReplayAnnotationDraft({
  instrumentId,
  timeframe,
  cutoffTimestamp,
  anchor,
  source = 'replay',
  label = null,
} = {}) {
  if (!isRecord(anchor)) fail('anchor must be an object')
  return normalizeAnnotationDraft({
    annotation_type: 'horizontal-line',
    instrument_id: instrumentId,
    timeframe,
    cutoff_timestamp: cutoffTimestamp,
    anchors: [{ timestamp: anchor.timestamp, price: anchor.price }],
    source,
    label,
  })
}

function workspaceHeader(workspace, extra = {}) {
  return {
    'X-Workspace-Id': boundedText(workspace, 'workspace', MAX_ID),
    ...extra,
  }
}

async function readResponse(response) {
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(String(payload?.detail || `HTTP ${response.status}`))
    error.status = response.status
    error.payload = payload
    throw error
  }
  return payload
}

function fetcher(fetchImpl) {
  const implementation = fetchImpl || globalThis.fetch
  if (typeof implementation !== 'function') fail('fetch is unavailable')
  return implementation
}

/** Create a persisted annotation through the local, broker-free API. */
export async function createChartAnnotation(workspace, draft, { fetchImpl } = {}) {
  const response = await fetcher(fetchImpl)('/api/v2/chart/annotations', {
    method: 'POST',
    headers: workspaceHeader(workspace, { 'Content-Type': 'application/json' }),
    body: JSON.stringify(normalizeAnnotationDraft(draft)),
  })
  return readResponse(response)
}

/** List only the current workspace's persisted annotations. */
export async function listChartAnnotations(workspace, { fetchImpl, signal } = {}) {
  const response = await fetcher(fetchImpl)('/api/v2/chart/annotations', {
    headers: workspaceHeader(workspace),
    signal,
  })
  const payload = await readResponse(response)
  return Array.isArray(payload?.items) ? payload.items : []
}

/** Revise an annotation while preserving its optimistic revision guard. */
export async function reviseChartAnnotation(workspace, recordId, expectedRevision, draft, { fetchImpl } = {}) {
  const id = boundedText(recordId, 'record_id')
  const revision = safeInteger(expectedRevision, 'expected_revision', { minimum: 1 })
  const response = await fetcher(fetchImpl)(`/api/v2/chart/annotations/${encodeURIComponent(id)}/revisions`, {
    method: 'POST',
    headers: workspaceHeader(workspace, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ expected_revision: revision, payload: normalizeAnnotationDraft(draft) }),
  })
  return readResponse(response)
}

export const CHART_ANNOTATION_LIMITS = Object.freeze({ maxAnchors: MAX_ANCHORS, maxLabelLength: MAX_TEXT })
