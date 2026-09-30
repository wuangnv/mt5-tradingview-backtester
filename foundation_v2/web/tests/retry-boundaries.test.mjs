import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(process.cwd(), 'src')
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8')

test('Data Desk catalog has explicit retry and stale-response fencing', () => {
  const source = read('DataDeskWorkspace.jsx')
  const css = read('research-data.css')
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
  assert.match(source, /catalogRetryToken/)
  assert.match(source, /jobRetryToken/)
  assert.match(source, /catalogRequestSeq/)
  assert.match(source, /jobRequestSeq/)
  assert.match(source, /data-testid="research-catalog-retry"/)
  assert.match(source, /data-testid="research-job-retry"/)
  assert.match(source, /requestSeq !== jobRequestSeq\.current/)
  assert.match(source, /error\.name !== 'AbortError' && requestSeq === jobRequestSeq\.current/)
  assert.match(css, /\.rs-inline-button:focus-visible/)
})
