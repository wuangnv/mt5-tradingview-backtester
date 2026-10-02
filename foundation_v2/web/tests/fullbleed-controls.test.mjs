import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const testsDir = dirname(fileURLToPath(import.meta.url))
const sourcePath = resolve(testsDir, '..', 'src', 'FxReplayShell.jsx')

test('chart header delegates commands to the replay workspace', async () => {
  const source = await readFile(sourcePath, 'utf8')
  const header = source.slice(source.indexOf('function ShellTopbar'), source.indexOf('function ShellHelp'))
  assert.doesNotMatch(source, /SHELL_SKELETON_MODE|CHART_SHELL_UNAVAILABLE_TITLE/, 'retired shell scaffold cannot gate the integrated chart')
  assert.match(header, /Quay lại Sessions/, 'chart has a route back to session management')
  assert.doesNotMatch(header, /aria-label="(?:Tiến nhanh|Thêm chart|Order flow|Undo|Redo)"/, 'shell does not duplicate unavailable chart commands')
})
