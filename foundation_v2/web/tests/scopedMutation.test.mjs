import test from 'node:test'
import assert from 'node:assert/strict'
import { scopedMutation, CommandOutcomeUnknownError } from '../src/scopedMutation.js'

const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })
const pending = id => json({ detail: 'command_pending', command_id: id, status_url: `/api/v2/commands/${id}` }, 504)
const receipt = (id, workspace, extra = {}) => ({ contract_version: 'api-command-v1', command_id: id, workspace_id: workspace,
  status: 'completed', result_status: 201, result_body: { created: true }, result_headers: {}, ...extra })

test('duplicate inflight mutations submit once; known completed intentions get a new key', async () => {
  const calls = []
  let release
  const wait = new Promise(resolve => { release = resolve })
  const transport = async (path, options) => { calls.push(options); await wait; return json({ ok: true }) }
  const a = scopedMutation('/api/v2/playbooks', 'dedup', { method: 'POST', body: '{}' }, { fetchImpl: transport })
  const b = scopedMutation('/api/v2/playbooks', 'dedup', { method: 'POST', body: '{}' }, { fetchImpl: transport })
  await new Promise(resolve => setTimeout(resolve, 25)); release()
  assert.deepEqual(await (await a).json(), { ok: true }); assert.equal((await b).status, 200)
  assert.equal(calls.length, 1)
  await scopedMutation('/api/v2/playbooks', 'dedup', { method: 'POST', body: '{}' }, { fetchImpl: transport })
  assert.notEqual(calls[0].headers['Idempotency-Key'], calls[1].headers['Idempotency-Key'])
})

test('pending reconciles only GET and restores CSV status, text and headers', async () => {
  const calls = []
  const transport = async (path, options) => { calls.push([path, options]); return options.method === 'POST' ? pending('csv-command')
    : json(receipt('csv-command', 'csv', { result_status: 200, result_text: 'giá,ghi chú\n1.2,đã tải', result_body: null,
      result_headers: { 'content-type': 'text/csv', 'content-disposition': 'attachment; filename=report.csv' } })) }
  const response = await scopedMutation('/api/v2/report', 'csv', { method: 'POST' }, { fetchImpl: transport, pollMs: 1 })
  assert.equal(await response.text(), 'giá,ghi chú\n1.2,đã tải')
  assert.equal(response.headers.get('content-type'), 'text/csv')
  assert.deepEqual(calls.map(([, options]) => options.method), ['POST', 'GET'])
  assert.equal(calls[1][1].headers['X-Workspace-Id'], 'csv')
})

test('foreign receipts and ambiguous terminal writes stay unresolved without another POST', async () => {
  for (const [workspace, result] of [['foreign', receipt('scope-command', 'other')],
    ['ambiguous', receipt('scope-command', 'ambiguous', { status: 'failed', result_status: 503, result_body: { detail: 'command_outcome_unknown' } })]]) {
    const methods = []
    const transport = async (_, options) => { methods.push(options.method); return options.method === 'POST' ? pending('scope-command') : json(result) }
    for (let i = 0; i < 2; i++) await assert.rejects(scopedMutation('/api/v2/write', workspace, { method: 'POST' }, { fetchImpl: transport }), CommandOutcomeUnknownError)
    assert.deepEqual(methods, ['POST', 'GET', 'GET'])
  }
})

test('lost response is not retried automatically; manual retry preserves its idempotency key', async () => {
  const keys = []
  const transport = async (_, options) => { keys.push(options.headers['Idempotency-Key']); if (keys.length === 1) throw new TypeError('connection lost'); return json({ ok: true }) }
  await assert.rejects(scopedMutation('/api/v2/write', 'network', { method: 'POST' }, { fetchImpl: transport }), CommandOutcomeUnknownError)
  assert.equal(keys.length, 1)
  await scopedMutation('/api/v2/write', 'network', { method: 'POST' }, { fetchImpl: transport })
  assert.equal(keys[0], keys[1])
})

test('receipt timeout does not repeat POST; pre-aborted caller performs no request', async () => {
  const methods = []
  const transport = async (_, options) => { methods.push(options.method); return options.method === 'POST' ? pending('timeout-command')
    : json(receipt('timeout-command', 'timeout', { status: 'running', result_status: null })) }
  await assert.rejects(scopedMutation('/api/v2/write', 'timeout', { method: 'POST' }, { fetchImpl: transport, timeoutMs: 20, pollMs: 5 }), CommandOutcomeUnknownError)
  assert.equal(methods.filter(method => method === 'POST').length, 1)
  const controller = new AbortController(); controller.abort()
  await assert.rejects(scopedMutation('/api/v2/write', 'abort', { method: 'POST', signal: controller.signal }, { fetchImpl: transport }), { name: 'AbortError' })
})

test('storage retains bounded hashed receipts without payloads and restores them after module reload', async () => {
  const saved = new Map()
  globalThis.sessionStorage = { getItem: key => saved.get(key), setItem: (key, value) => saved.set(key, value), removeItem: key => saved.delete(key) }
  try {
    const transport = async (_, options) => options.method === 'POST' ? pending('storage-command')
      : json(receipt('storage-command', 'storage', { status: 'running', result_status: null }))
    await assert.rejects(scopedMutation('/api/v2/write', 'storage', { method: 'POST', body: 'private-financial-payload' },
      { fetchImpl: transport, timeoutMs: 10, pollMs: 5 }), CommandOutcomeUnknownError)
    const snapshot = saved.get('tw:commands:v1:storage')
    assert.ok(snapshot); assert.equal(snapshot.includes('private-financial-payload'), false)
    const reloaded = await import(`../src/scopedMutation.js?storage=${Date.now()}`)
    const calls = []
    const response = await reloaded.scopedMutation('/api/v2/write', 'storage', { method: 'POST', body: 'private-financial-payload' }, {
      fetchImpl: async (_, options) => { calls.push(options.method); return json(receipt('storage-command', 'storage')) } })
    assert.equal(response.status, 201); assert.deepEqual(calls, ['GET']); assert.equal(saved.size, 0)
  } finally { delete globalThis.sessionStorage }
})
