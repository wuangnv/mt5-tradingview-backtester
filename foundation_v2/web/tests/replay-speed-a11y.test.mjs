import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const testsDir = dirname(fileURLToPath(import.meta.url))
const sourceDir = resolve(testsDir, '..', 'src')

test('replay speed select exposes its accessible name on the native control', async () => {
  const source = await readFile(resolve(sourceDir, 'ReplayWorkspace.jsx'), 'utf8')

  assert.match(
    source,
    /<select aria-label="Tốc độ replay" value=\{speed\}/,
    'the native replay speed select must expose its own accessible name',
  )
})
