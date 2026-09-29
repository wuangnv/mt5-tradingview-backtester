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
})

test('research story styles provide stable geometry and responsive states', async () => {
  const css = await readFile(stylePath, 'utf8')
  assert.match(css, /\.rs-stepper\s*\{[^}]*grid-template-columns: repeat\(5/)
  assert.match(css, /\.rs-layout\s*\{[^}]*grid-template-columns: minmax\(0, 1\.25fr\)/)
  assert.match(css, /@media \(max-width: 1080px\)/)
  assert.match(css, /@media \(max-width: 520px\)/)
  assert.match(css, /prefers-reduced-motion: reduce/)
})
