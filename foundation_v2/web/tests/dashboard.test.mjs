import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const testsDir = dirname(fileURLToPath(import.meta.url))
const sourcePath = resolve(testsDir, '..', 'src', 'main.jsx')

test('dashboard exposes the three FXReplay-style entry cards', async () => {
  const source = await readFile(sourcePath, 'utf8')

  assert.match(source, /title: 'Backtesting session'/)
  assert.match(source, /title: 'Prop firm session'/)
  assert.match(source, /title: 'Tutorials'/)
  assert.match(source, /routeHref\('replay'(?:,|\))/,
    'backtesting card opens the replay selector')
  assert.match(source, /routeHref\('testing'\)/, 'prop firm card opens the prop challenge route')
  assert.match(source, /routeHref\('learn'\)/, 'tutorials card opens Education')
  assert.doesNotMatch(source, /fx-session-banner|fx-work-queue|fx-context-panel|queueItems/, 'dashboard no longer renders the previous session summary')
})
