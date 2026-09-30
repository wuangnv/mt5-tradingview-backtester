import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const testsDir = dirname(fileURLToPath(import.meta.url))
const sourcePath = resolve(testsDir, '..', 'src', 'FxReplayShell.jsx')

test('latent full-bleed chart controls stay truthful until replay handlers exist', async () => {
  const source = await readFile(sourcePath, 'utf8')
  assert.match(source, /const chartWorkspace = !SHELL_SKELETON_MODE/, 'full-bleed remains gated behind the existing skeleton flag')

  const labels = [
    'Tiến nhanh',
    'Thêm chart',
    'Khung thời gian',
    'Indicators',
    'Order flow',
    'Analytics',
    'Undo',
    'Redo',
    'Fullscreen',
  ]

  for (const label of labels) {
    const line = source.split(/\r?\n/).find((candidate) => candidate.includes(`aria-label="${label}"`))
    assert.ok(line, `chart control ${label} remains present for the future shell contract`)
    assert.match(line, /\sdisabled(?:\s|>|\})/, `${label} must be disabled while the shell has no handler`)
    assert.doesNotMatch(line, /onClick=/, `${label} must not imply a handler that is not wired to replay state`)
    assert.match(line, /CHART_SHELL_UNAVAILABLE_TITLE/, `${label} must expose an unavailable-state title`)
  }
})
