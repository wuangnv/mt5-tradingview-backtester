import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(process.cwd(), 'src')
const source = fs.readFileSync(path.join(root, 'PlaybookWorkspace.jsx'), 'utf8')
const api = fs.readFileSync(path.join(root, 'playbookApi.js'), 'utf8')
const css = fs.readFileSync(path.join(root, 'playbook-story.css'), 'utf8')

test('playbook UI is an explicit read-only version and lineage surface', () => {
  assert.match(source, /READ ONLY/)
  assert.match(source, /Version lineage/i)
  assert.match(source, /RevisionDiff/)
  assert.match(source, /data-testid="playbook-diff"/)
  assert.match(api, /fetchPlaybookRevisions/)
  assert.match(api, /\/api\/v2\/playbooks/)
  assert.doesNotMatch(source, /onClick=.*freeze|onClick=.*fork|OrderSend|submitLive/i)
})

test('playbook view preserves backend authority and exposes safe metadata', () => {
  assert.match(source, /record\.record_id/)
  assert.match(source, /record\.revision/)
  assert.match(source, /parent_playbook_id/)
  assert.match(source, /execution_capability/)
  assert.match(source, /payload gốc vẫn thuộc backend record/)
  assert.match(api, /X-Workspace-Id/)
  assert.match(api, /encodeURIComponent\(playbookId\)/)
})

test('playbook diff is deterministic and responsive', () => {
  assert.match(api, /stableStringify/)
  assert.match(api, /leafPaths/)
  assert.match(css, /grid-template-columns:minmax\(150px/)
  assert.match(css, /@media \(max-width: 900px\)/)
  assert.match(css, /@media \(max-width: 560px\)/)
  assert.match(css, /prefers-reduced-motion/)
  assert.doesNotMatch(css, /gradient\(|glassmorphism/i)
})

