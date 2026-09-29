import assert from 'node:assert/strict'
import test from 'node:test'

import { importLocalCsv, previewLocalCsv } from '../src/dataDeskApi.js'

const payload = {
  csv_text: 'time,open,high,low,close\n1,1,2,1,1.5\n2,1.5,2,1,1.6\n',
  source: { source_id: 'local', provider: 'local-csv', instrument_mapping: { EURUSDm: 'EURUSDm' }, license_use: 'test', retrieved_at_utc: '2026-09-29T00:00:00Z', export_settings: 'test' },
  instrument: { instrument_id: 'EURUSDm' },
  timeframe_seconds: 3600,
  holdout_policy: { mode: 'none' },
}

test('Data Desk CSV helpers send browser text and workspace scope', async () => {
  const originalFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options })
    return { ok: true, json: async () => ({ preview: { quality: { disposition: 'pass' } } }) }
  }
  try {
    await previewLocalCsv('tenant-a', payload)
    await importLocalCsv('tenant-a', payload)
  } finally {
    globalThis.fetch = originalFetch
  }

  assert.equal(calls.length, 2)
  assert.equal(calls[0].url, '/api/v2/data/csv/preview')
  assert.equal(calls[1].url, '/api/v2/data/csv/import')
  for (const call of calls) {
    assert.equal(call.options.method, 'POST')
    assert.equal(call.options.headers['X-Workspace-Id'], 'tenant-a')
    assert.equal(call.options.headers['Content-Type'], 'application/json')
    assert.deepEqual(JSON.parse(call.options.body), payload)
  }
})

