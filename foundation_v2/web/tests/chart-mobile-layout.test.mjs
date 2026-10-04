import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const testsDir = dirname(fileURLToPath(import.meta.url))
const sourceDir = resolve(testsDir, '..', 'src')

test('new and resumed replay routes use the chart workspace layout', async () => {
  const shell = await readFile(resolve(sourceDir, 'FxReplayShell.jsx'), 'utf8')
  const css = await readFile(resolve(sourceDir, 'ChartWorkbench.css'), 'utf8')
  assert.match(shell, /const chartWorkspace = activeView === 'replay'/)
  assert.match(shell, /query.get\('select'\) !== '1'/, 'session management remains in the normal shell')
  assert.match(css, /is-panel-open[^{}]* \.replay-side/, 'branch and provenance remain reachable')
  assert.match(css, /@media \(max-width: 900px\)[\s\S]*grid-template-columns: minmax\(0, 1fr\)/)
})
