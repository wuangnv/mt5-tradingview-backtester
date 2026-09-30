import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(process.cwd(), 'src')
const source = fs.readFileSync(path.join(root, 'LiveWorkspace.jsx'), 'utf8')
const css = fs.readFileSync(path.join(root, 'live-workspace.css'), 'utf8')
const main = fs.readFileSync(path.join(root, 'main.jsx'), 'utf8')

test('live route is read-only and carries the workspace context', () => {
  assert.match(main, /activeView === 'live'/)
  assert.match(main, /<LiveWorkspace workspace=\{workspace\} query=\{query\} \/>/)
  assert.match(source, /X-Workspace-Id/)
  assert.match(source, /\/api\/v2\/live\/status/)
  assert.match(source, /Broker\/live execution vẫn bị khóa/)
  assert.doesNotMatch(source, /OrderSend|sendOrder|submitLive|\/api\/trade\/send/i)
})

test('live route has real loading, unavailable, denied, error and empty states', () => {
  for (const marker of ['live-status', 'live-permission', 'live-empty', 'live-retry', 'invalid_live_status_payload', 'LIVE_SECTIONS']) {
    assert.match(source, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  }
  assert.match(source, /response\.status === 404 \|\| response\.status === 501/)
  assert.match(source, /state\.status === 'denied'/)
  assert.match(source, /section === 'notes'/)
})

test('live route is responsive and reduced-motion aware without adding a dependency', () => {
  assert.match(css, /@media \(max-width: 760px\)/)
  assert.match(css, /@media \(max-width: 480px\)/)
  assert.match(css, /prefers-reduced-motion/)
  assert.doesNotMatch(css, /gradient\(|backdrop-filter|framer-motion/i)
})
