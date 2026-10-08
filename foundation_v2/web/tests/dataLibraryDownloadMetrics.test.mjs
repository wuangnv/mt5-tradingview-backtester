import test from 'node:test'
import assert from 'node:assert/strict'
import { sampleDownloadMetrics, downloadEtaDuration } from '../src/dataLibraryDownloadMetrics.js'

const job = { status:'running', stage:'downloading', total_days:100, completed_days:10, transferred_bytes:1000 }
const start = () => sampleDownloadMetrics(null,job,0).state
test('rolling throughput estimates remaining days without using cached bytes or inventing total size', () => {
  const result = sampleDownloadMetrics(start(), {...job,completed_days:15,transferred_bytes:3000,cached_bytes:999999},10000)
  assert.equal(result.metrics.bytes_per_second,200)
  assert.equal(result.metrics.estimated_seconds_remaining,170)
  assert.equal(sampleDownloadMetrics(start(),{...job,completed_days:12},10000).metrics.estimated_seconds_remaining,null)
})
test('warmup and a measured zero speed remain distinct', () => {
  assert.equal(sampleDownloadMetrics(null,job,0).metrics.bytes_per_second,null)
  assert.equal(sampleDownloadMetrics(start(),job,2000).metrics.bytes_per_second,0)
  assert.equal(sampleDownloadMetrics(start(),{...job,completed_days:14},8000).metrics.estimated_seconds_remaining,null)
})
test('pause, resume, processing, rollback and long polling gaps reset the baseline', () => {
  for (const changed of [{...job,status:'paused'}, {...job,status:'failed'}, {...job,stage:'processing'}, {...job,completed_days:9}, {...job,transferred_bytes:900}, {...job,total_days:101}]) {
    const paused = sampleDownloadMetrics(start(),changed,10000)
    assert.equal(paused.metrics.estimated_seconds_remaining,null)
    assert.equal(paused.metrics.bytes_per_second,null)
    assert.equal(sampleDownloadMetrics(paused.state,job,12000).metrics.estimated_seconds_remaining,null)
  }
  assert.equal(sampleDownloadMetrics(start(),{...job,completed_days:20},12000).metrics.estimated_seconds_remaining,null)
})
test('ETA expires when day throughput stalls and never predicts the saving stage', () => {
  let state = start()
  state = sampleDownloadMetrics(state,{...job,completed_days:15},10000).state
  state = sampleDownloadMetrics(state,{...job,completed_days:15},20000).state
  assert.equal(sampleDownloadMetrics(state,{...job,completed_days:15},28000).metrics.estimated_seconds_remaining,null)
  assert.equal(sampleDownloadMetrics(state,{...job,completed_days:100},30000).metrics.estimated_seconds_remaining,null)
})
test('ETA uses rounded durations and unknown states have no invented time', () => {
  assert.equal(downloadEtaDuration(null),null)
  assert.equal(downloadEtaDuration(0),null)
  assert.deepEqual(downloadEtaDuration(59),{count:59,unit:'duration.second'})
  assert.deepEqual(downloadEtaDuration(70),{count:2,unit:'duration.minute'})
  assert.deepEqual(downloadEtaDuration(3700),{count:2,unit:'duration.hour'})
  assert.deepEqual(downloadEtaDuration(90000),{count:2,unit:'duration.day'})
})
