import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const testsDir = dirname(fileURLToPath(import.meta.url))
const sourceDir = resolve(testsDir, '..', 'src')

test('session picker is shared across Sessions, Trades and Analytics without inventing a catalog', async () => {
  const picker = await readFile(resolve(sourceDir, 'SessionPicker.jsx'), 'utf8')
  const main = await readFile(resolve(sourceDir, 'main.jsx'), 'utf8')

  assert.match(picker, /Select session/, 'picker uses the compact FXReplay-style title')
  assert.match(picker, /New backtesting session/, 'picker exposes a new-session option')
  assert.match(picker, /tw:replay:last:/, 'picker can resume the last local session')
  assert.match(picker, /surface: 'workspace'/, 'opening a session returns to the existing workspace surface')
  assert.match(picker, /fresh: '1'/, 'new session bypasses the persisted last-session resume')
  assert.match(main, /SessionPicker kind="replay"/, 'Sessions uses the shared picker')
  assert.match(main, /SessionPicker kind="trade"/, 'Trades uses the shared picker')
  assert.match(main, /SessionPicker kind="analytics"/, 'Analytics uses the shared picker')
  assert.match(main, /query\.get\('surface'\) !== 'workspace'/, 'legacy data surfaces remain available through an explicit deep link')

  const replay = await readFile(resolve(sourceDir, 'ReplayWorkspace.jsx'), 'utf8')
  assert.match(replay, /query\.get\('fresh'\) === '1'/, 'Replay honors an explicit fresh-session start')
})
