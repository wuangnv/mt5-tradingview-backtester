import assert from 'node:assert/strict'
import test from 'node:test'

import { fetchOfflineLibrary, importLocalCsv, previewLocalCsv, fetchDownloads, startDownload, updateDownload } from '../src/dataDeskApi.js'

const payload = {
  csv_text: 'time,open,high,low,close\n1,1,2,1,1.5\n2,1.5,2,1,1.6\n',
  source: { source_id: 'local', provider: 'local-csv', instrument_mapping: { EURUSDm: 'EURUSDm' }, license_use: 'test', retrieved_at_utc: '2026-09-29T00:00:00Z', export_settings: 'test' },
  instrument: { instrument_id: 'EURUSDm' },
  timeframe_seconds: 3600,
  holdout_policy: { mode: 'none' },
}

test('library reads optional catalog metadata through the existing scoped endpoint', async () => {
  const originalFetch = globalThis.fetch, calls = [], controller = new AbortController()
  globalThis.fetch = async (url, options) => { calls.push({url,options}); return {ok:true,json:async () => ({items:[{dataset_id:'saved'}],catalog_items:[{instrument_id:'not-yet-saved'}]})} }
  try {
    assert.deepEqual(await fetchOfflineLibrary('tenant-b',controller.signal), {datasets:[{dataset_id:'saved'}],instruments:[{instrument_id:'not-yet-saved'}],catalog:null,download:null})
    assert.equal(calls[0].url,'/api/v2/data/datasets')
    assert.equal(calls[0].options.headers['X-Workspace-Id'],'tenant-b')
    assert.equal(calls[0].options.signal,controller.signal)
    globalThis.fetch = async () => ({ok:true,json:async () => ({items:[]})})
    assert.deepEqual(await fetchOfflineLibrary('tenant-b'),{datasets:[],instruments:[],catalog:null,download:null})
  } finally { globalThis.fetch = originalFetch }
})

test('download operations preserve workspace, dates and abort scope', async () => {
  const originalFetch = globalThis.fetch, calls = [], controller = new AbortController()
  const dates = {instrument_id:'EUR/USD',from_date:'2026-09-01',to_date:'2026-09-30'}
  globalThis.fetch = async (url,options) => { calls.push({url,options}); return {ok:true,json:async () => ({items:[{job_id:'job-a',status:'paused'}],available:true})} }
  try {
    assert.deepEqual(await fetchDownloads('tenant-b',controller.signal),{items:[{job_id:'job-a',status:'paused'}],available:true,supportsPause:false})
    await startDownload('tenant-b',dates,controller.signal)
    await updateDownload('tenant-b','job/a','resume',controller.signal)
    await updateDownload('tenant-b','job/a','cancel',controller.signal)
    await assert.rejects(() => updateDownload('tenant-b','job/a','delete'),/Invalid download action/)
    assert.equal(calls.length,4)
    assert.equal(calls[0].url,'/api/v2/data/downloads')
    assert.deepEqual(JSON.parse(calls[1].options.body),dates)
    assert.equal(calls[2].url,'/api/v2/data/downloads/job%2Fa/resume')
    assert.equal(calls[3].url,'/api/v2/data/downloads/job%2Fa/cancel')
    for (const {options} of calls) {
      assert.equal(options.headers['X-Workspace-Id'],'tenant-b')
      assert.equal(options.signal,controller.signal)
    }
    assert.equal(calls[1].options.method,'POST')
    globalThis.fetch = async () => ({ok:false,status:429,json:async () => ({detail:'source_rate_limited'})})
    await assert.rejects(() => startDownload('tenant-b',dates),error => error.status === 429 && error.payload.detail === 'source_rate_limited')
  } finally { globalThis.fetch = originalFetch }
})

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

