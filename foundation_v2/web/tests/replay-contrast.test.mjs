import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const testsDir = dirname(fileURLToPath(import.meta.url))
const cssPath = resolve(testsDir, '..', 'src', 'ReplayWorkspace.css')

test('replay contrast keeps light shell and dark chart surfaces separate', async () => {
  const css = await readFile(cssPath, 'utf8')

  assert.match(css, /data-theme='light'[\s\S]*?\.bar-readout strong[\s\S]*?color: #1d2930/, 'light-shell OHLC values use readable ink')
  assert.match(css, /data-theme='light'[\s\S]*?\.cutoff-readout > strong[\s\S]*?color: #1d2930/, 'light-shell cutoff timestamp uses readable ink')
  assert.match(css, /data-theme='light'[\s\S]*?\.session-facts dd[\s\S]*?color: #1d2930/, 'light-shell session facts use readable ink')
  assert.match(css, /data-theme='light'[\s\S]*?\.chart-symbol-strip > strong[\s\S]*?color: #d6dee2/, 'chart symbol remains light on the dark canvas')
  assert.match(css, /data-theme='light'[\s\S]*?\.chart-symbol-ohlc[\s\S]*?color: #7f8b94/, 'chart OHLC metadata has a chart-local token')
  assert.match(css, /\.unsupported-tools button:disabled span[\s\S]*?color: #aeb8be/, 'disabled explanation text stays readable')
  assert.match(css, /data-theme='light'[\s\S]*?\.replay-evidence-strip > span:last-child[\s\S]*?color: #704609/, 'light-shell evidence accent has sufficient contrast')
  assert.match(css, /data-theme='light'[\s\S]*?\.story-label[\s\S]*?color: #47535b/, 'light-shell story labels use readable muted ink')
  assert.match(css, /data-theme='light'[\s\S]*?\.replay-side p[\s\S]*?color: #47535b/, 'light-shell explanatory copy uses readable muted ink')
  assert.match(css, /data-theme='light'[\s\S]*?\.mode-pill[\s\S]*?color: #704609 !important/, 'light-shell mode badge keeps its semantic accent with readable text')
  assert.match(css, /data-theme='light'[\s\S]*?\.chart-tool-rail button[\s\S]*?color: #b0b1b4/, 'light-theme chart tools retain contrast on the dark canvas')
})
