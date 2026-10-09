import test from 'node:test'
import assert from 'node:assert/strict'
import {
  deleteChartAnnotation,
  drawingIsVisibleAt,
  CHART_ANNOTATION_LIMITS,
  buildReplayAnnotationDraft,
  createChartAnnotation,
  listChartAnnotations,
  normalizeAnnotationDraft,
  reviseChartAnnotation,
} from '../src/chartAnnotations.js'

const draft = (overrides = {}) => ({
  annotation_type: 'zone',
  instrument_id: 'EURUSD',
  timeframe: 'H1',
  cutoff_timestamp: 1_700_000_180,
  anchors: [
    { timestamp: 1_700_000_120, price: '1.10125' },
    { timestamp: 1_700_000_180, price: 1.1035 },
  ],
  source: 'replay',
  ...overrides,
})

test('normalizes chart annotations to safe time/price anchors', () => {
  const normalized = normalizeAnnotationDraft(draft({ label: 'London range' }))
  assert.deepEqual(normalized, {
    annotation_type: 'zone',
    instrument_id: 'EURUSD',
    timeframe: 'H1',
    cutoff_timestamp: 1_700_000_180,
    anchors: [
      { timestamp: 1_700_000_120, price: 1.10125 },
      { timestamp: 1_700_000_180, price: 1.1035 },
    ],
    source: 'replay',
    run_id: null,
    rule_version: null,
    label: 'London range',
  })
  assert.equal(CHART_ANNOTATION_LIMITS.maxAnchors, 8)
})

test('builds one local horizontal-line draft from a chart anchor', () => {
  const draft = buildReplayAnnotationDraft({
    instrumentId: 'EURUSD',
    timeframe: 'M1',
    cutoffTimestamp: 1_700_000_180,
    anchor: { timestamp: 1_700_000_120, price: 1.10125 },
    label: 'Click anchor',
  })
  assert.deepEqual(draft, {
    annotation_type: 'horizontal-line',
    instrument_id: 'EURUSD',
    timeframe: 'M1',
    cutoff_timestamp: 1_700_000_180,
    anchors: [{ timestamp: 1_700_000_120, price: 1.10125 }],
    source: 'replay',
    run_id: null,
    rule_version: null,
    label: 'Click anchor',
  })
  assert.throws(() => buildReplayAnnotationDraft({
    instrumentId: 'EURUSD',
    timeframe: 'M1',
    cutoffTimestamp: 1_700_000_180,
    anchor: { timestamp: 1_700_000_181, price: 1.10125 },
  }), /exceeds replay cutoff/)
})

test('rejects future anchors, malformed numbers, unknown fields and oversized payloads', () => {
  assert.throws(() => normalizeAnnotationDraft(draft({ anchors: [{ timestamp: 1_700_000_181, price: 1.1 }] })), /exceeds replay cutoff/)
  assert.throws(() => normalizeAnnotationDraft(draft({ anchors: [{ timestamp: 1_700_000_120, price: 'not-a-price' }] })), /must be finite/)
  assert.throws(() => normalizeAnnotationDraft(draft({ cutoff_timestamp: '' })), /safe integer/)
  assert.throws(() => normalizeAnnotationDraft(draft({ anchors: [{ timestamp: '', price: 1.1 }] })), /safe integer/)
  assert.throws(() => normalizeAnnotationDraft({ ...draft(), future_field: true }), /future_field is not supported/)
  assert.throws(() => normalizeAnnotationDraft(draft({ anchors: Array.from({ length: 9 }, (_, i) => ({ timestamp: 1_700_000_120, price: i })) })), /1-8 items/)
})

test('create/list/revise use workspace-scoped annotation endpoints and revision guards', async () => {
  const calls = []
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options })
    return Response.json(url === '/api/v2/chart/annotations'
      ? options.method === 'POST' ? { record_id: 'ann-1', revision: 1 } : { items: [{ record_id: 'ann-1' }] }
      : { record_id: 'ann-1', revision: 2 })
  }

  await createChartAnnotation('tenant-a', draft(), { fetchImpl })
  const listed = await listChartAnnotations('tenant-a', { fetchImpl })
  await reviseChartAnnotation('tenant-a', 'ann-1', 1, draft({ label: 'updated' }), { fetchImpl })

  assert.equal(calls[0].url, '/api/v2/chart/annotations')
  assert.equal(calls[0].options.headers['X-Workspace-Id'], 'tenant-a')
  assert.equal(JSON.parse(calls[0].options.body).anchors[1].timestamp, 1_700_000_180)
  assert.deepEqual(listed, [{ record_id: 'ann-1' }])
  assert.equal(calls[2].url, '/api/v2/chart/annotations/ann-1/revisions')
  assert.equal(JSON.parse(calls[2].options.body).expected_revision, 1)
})

test('surfaces API errors without turning them into successful drafts', async () => {
  const fetchImpl = async () => Response.json({ detail: 'revision_conflict' }, { status: 409 })
  await assert.rejects(
    createChartAnnotation('tenant-a', draft(), { fetchImpl }),
    (error) => error.message === 'revision_conflict' && error.status === 409,
  )
})

test('drawing visibility requires matching replay scope, known candle anchors and causal creation cutoff', () => {
  const payload = normalizeAnnotationDraft(draft({ run_id: 'session-a' }))
  const scope = { sessionId: 'session-a', instrument: 'EURUSD', timeframe: 'H1', cutoff: 1_700_000_180, timestamps: new Set([1_700_000_120, 1_700_000_180]) }
  assert.equal(drawingIsVisibleAt({ payload }, scope), true)
  assert.equal(drawingIsVisibleAt({ payload }, { ...scope, sessionId: 'session-b' }), false)
  assert.equal(drawingIsVisibleAt({ payload }, { ...scope, cutoff: 1_700_000_179 }), false)
  assert.equal(drawingIsVisibleAt({ payload }, { ...scope, timeframe: 'M1' }), false)
  assert.equal(drawingIsVisibleAt({ payload, deleted: true }, scope), false)
  assert.equal(drawingIsVisibleAt({ payload: { ...payload, cutoff_timestamp: 1_700_000_181 } }, scope), false)
  assert.equal(drawingIsVisibleAt({ payload: { ...payload, anchors: [{ timestamp: 1_700_000_110, price: 1.1 }] } }, scope), false)
})

test('annotation delete preserves workspace and revision and exposes conflict or missing record errors', async () => {
  let request
  const fetchImpl = async (url, options) => { request = { url, options }; return Response.json({ deleted: true, revision: 3 }) }
  assert.deepEqual(await deleteChartAnnotation('tenant-a', 'a b', 2, { fetchImpl }), { deleted: true, revision: 3 })
  assert.equal(request.url, '/api/v2/chart/annotations/a%20b/delete')
  assert.equal(request.options.headers['X-Workspace-Id'], 'tenant-a')
  assert.deepEqual(JSON.parse(request.options.body), { expected_revision: 2 })
  for (const status of [404, 409]) await assert.rejects(deleteChartAnnotation('tenant-a', 'ann', 2, { fetchImpl: async () => Response.json({ detail: 'annotation failure' }, { status }) }), error => error.status === status)
})
