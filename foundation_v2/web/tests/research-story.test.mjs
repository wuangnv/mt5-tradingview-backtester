import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const sourcePath = path.join(here, '..', 'src', 'ResearchWorkspace.jsx')
const stylePath = path.join(here, '..', 'src', 'research-story.css')

test('research story keeps the evidence-first flow and truthful safety boundary', async () => {
  const source = await readFile(sourcePath, 'utf8')
  const flow = ['Context', 'Quality gate', 'Run', 'Checkpoint', 'Result']
  let previous = -1
  for (const label of flow) {
    const index = source.indexOf(`label: '${label}'`)
    assert.ok(index > previous, `${label} must follow the previous research step`)
    previous = index
  }
  assert.match(source, /Broker locked · không gửi lệnh/)
  assert.match(source, /Không mở holdout, không kết nối broker/)
  assert.match(source, /Không hiển thị placeholder metrics/)
  assert.match(source, /data-testid="research-quality-takeaway"/)
  assert.match(source, /data-testid="research-next-actions"/)
  assert.match(source, /getResearchCheckpoint\(workspace, jobId, signal\)/)
  assert.match(source, /cancelResearchJob\(workspace, jobState\.job\.job_id\)/)
  assert.match(source, /fallbackKind=\{job\?\.dataset_id \? 'job' : requestedDataset \? 'query' : 'none'\}/)
  assert.match(source, /Dataset chưa được xác nhận trong catalog/)
  assert.match(source, /research-terminal-result/)
  assert.match(source, /Không dựng kết quả thay thế/)
  assert.match(source, /const contextReady = Boolean\(selected \|\| job\?\.dataset_id\)/)
  assert.match(source, /data-flow-state=\{isTerminal \? 'terminal' : state \|\| 'pending'\}/)
  assert.match(source, /aria-current=\{step\.id === current \? 'step' : undefined\}/)
  assert.doesNotMatch(source, /selected \|\| Boolean\(contextDatasetId\)/)
  assert.doesNotMatch(source, /catalog\.datasets\[0\] \|\| null/)
})

test('research story styles provide stable geometry and responsive states', async () => {
  const css = await readFile(stylePath, 'utf8')
  assert.match(css, /\.rs-stepper\s*\{[^}]*grid-template-columns: repeat\(5/)
  assert.match(css, /\.rs-layout\s*\{[^}]*grid-template-columns: minmax\(0, 1\.25fr\)/)
  assert.match(css, /@media \(max-width: 1080px\)/)
  assert.match(css, /@media \(max-width: 520px\)/)
  assert.match(css, /prefers-reduced-motion: reduce/)
})
