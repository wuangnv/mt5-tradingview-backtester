import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(process.cwd(), 'src')
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8')

test('Data Desk catalog has explicit retry and stale-response fencing', () => {
  const source = read('DataDeskWorkspace.jsx')
  const css = read('research-data.css')
  assert.match(source, /MAX_GET_RETRIES\s*=\s*3/)
  assert.match(source, /catalogRetryCount/)
  assert.match(source, /catalogRetryExhausted/)
  assert.match(source, /aria-describedby=\{catalogRetryExhausted \? 'data-desk-retry-note' : undefined\}/)
  assert.match(source, /Kiểm tra nguồn dữ liệu trước khi thử lại\./)
  assert.match(source, /if \(catalogRetryCountRef\.current >= MAX_GET_RETRIES \|\| state\.status === 'loading'\) return/)
  assert.match(source, /useRef/)
  assert.match(source, /catalogRequestSeq/)
  assert.match(source, /new AbortController\(\)/)
  assert.match(source, /data-testid="data-desk-retry"/)
  assert.match(source, /requestSeq !== catalogRequestSeq\.current/)
  assert.match(source, /error\.name !== 'AbortError' && requestSeq === catalogRequestSeq\.current/)
  assert.match(css, /\.rd-inline-button:focus-visible/)
  assert.match(css, /@media \(max-width: 460px\)[\s\S]*\.rd-panel-head,[\s\S]*\.rd-import-report-head[\s\S]*display: grid/)
})

test('Research catalog and job reads expose retry and reject stale responses', () => {
  const source = read('ResearchWorkspace.jsx')
  const css = read('research-story.css')
  assert.match(source, /GET_RETRY_DELAYS_MS = \[250, 750\]/)
  assert.match(source, /readWithBoundedRetry\(\(signal\) => fetchDatasets\(workspace, signal\)/)
  assert.match(source, /readWithBoundedRetry\(\(signal\) => fetchResearchEngines\(workspace, signal\)/)
  assert.match(source, /readWithBoundedRetry\(\(retrySignal\) => getResearchJob\(workspace, jobId, retrySignal\)/)
  assert.match(source, /readWithBoundedRetry\(\(retrySignal\) => getResearchCheckpoint\(workspace, jobId, retrySignal\)/)
  assert.match(source, /catalogRetryToken/)
  assert.match(source, /jobRetryToken/)
  assert.match(source, /catalogRequestSeq/)
  assert.match(source, /jobRequestSeq/)
  assert.match(source, /data-testid="research-catalog-retry"/)
  assert.match(source, /data-testid="research-job-retry"/)
  assert.match(source, /requestSeq !== jobRequestSeq\.current/)
  assert.match(source, /error\.name !== 'AbortError' && requestSeq === jobRequestSeq\.current/)
  assert.match(source, /const canRetryJobRead = Boolean\(pollJobId\)/)
  assert.match(source, /canRetryJobRead \? <button[\s\S]*research-job-retry/)
  assert.match(css, /\.rs-inline-button:focus-visible/)
})

test('Research bounded GET retry recovers from one transient 503 and does not retry 404', async () => {
  const source = read('ResearchWorkspace.jsx')
  const start = source.indexOf('const GET_RETRY_DELAYS_MS')
  const end = source.indexOf('\nfunction qualityTone', start)
  assert.ok(start >= 0 && end > start, 'retry helper block must remain directly testable')
  const helpers = new Function(`${source.slice(start, end)}; return { isRetryableGetError, readWithBoundedRetry }`)()

  let attempts = 0
  const payload = await helpers.readWithBoundedRetry(async () => {
    attempts += 1
    if (attempts === 1) {
      const error = new Error('HTTP 503')
      error.status = 503
      throw error
    }
    return { items: ['fixture-dataset'] }
  }, undefined, [0])
  assert.deepEqual(payload, { items: ['fixture-dataset'] })
  assert.equal(attempts, 2, 'a transient 503 should receive one bounded retry')
  assert.equal(helpers.isRetryableGetError({ status: 404 }), false)
  assert.equal(helpers.isRetryableGetError({ status: 503 }), true)
})
