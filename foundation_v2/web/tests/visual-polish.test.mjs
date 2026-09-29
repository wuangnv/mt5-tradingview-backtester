import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const testsDir = dirname(fileURLToPath(import.meta.url))
const sourceDir = resolve(testsDir, '..', 'src')

test('visual polish stays scoped to the mounted trading app', async () => {
  const entryCss = await readFile(resolve(sourceDir, 'styles.css'), 'utf8')
  const polishCss = await readFile(resolve(sourceDir, 'visual-polish.css'), 'utf8')

  assert.match(entryCss, /@import ["']\.\/visual-polish\.css["'];?/, 'visual polish is part of the app stylesheet')
  assert.match(polishCss, /\.fx-app\s*\{/, 'base polish is scoped to the app')
  assert.match(polishCss, /\.fx-app\s*:where\(a, button, input, select, textarea, \[role='button'\]\[tabindex\]\):focus-visible/, 'all keyboard controls have a visible focus ring')
  assert.match(polishCss, /prefers-reduced-motion: reduce/, 'motion is disabled for users who request reduced motion')
  assert.match(polishCss, /prefers-contrast: more/, 'high contrast preference has an explicit visual treatment')
  assert.doesNotMatch(polishCss, /(^|\n)\s*(body|html|button|a)\s*\{/, 'polish does not leak unscoped global rules')
})
