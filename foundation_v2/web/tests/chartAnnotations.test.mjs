import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CHART_ANNOTATION_LIMITS,
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
    return {
      ok: true,
      status: 200,
      async json() {
        if (url === '/api/v2/chart/annotations') return options.method === 'POST' ? { record_id: 'ann-1', revision: 1 } : { items: [{ record_id: 'ann-1' }] }
        return { record_id: 'ann-1', revision: 2 }
      },
    }
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
  const fetchImpl = async () => ({
    ok: false,
    status: 409,
    async json() { return { detail: 'revision_conflict' } },
  })
  await assert.rejects(
    createChartAnnotation('tenant-a', draft(), { fetchImpl }),
    (error) => error.message === 'revision_conflict' && error.status === 409,
  )
})
