import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const testsDir = dirname(fileURLToPath(import.meta.url))
const sourceDir = resolve(testsDir, '..', 'src')

test('shell exposes truthful EN/VI and theme controls with persisted preference contracts', async () => {
  const source = await readFile(resolve(sourceDir, 'FxReplayShell.jsx'), 'utf8')
  const css = await readFile(resolve(sourceDir, 'fx-shell-preferences.css'), 'utf8')

  assert.match(source, /LANGUAGE_STORAGE_KEY\s*=\s*['"]tw-language['"]/, 'language preference key is stable')
  assert.match(source, /THEME_STORAGE_KEY\s*=\s*['"]tw-theme['"]/, 'theme preference key is stable')
  assert.match(source, /data-testid="language-toggle"/, 'language control is discoverable')
  assert.match(source, /data-testid="theme-toggle"/, 'theme control is discoverable')
  assert.match(source, /localStorage\.setItem\(LANGUAGE_STORAGE_KEY/, 'language selection persists')
  assert.match(source, /localStorage\.setItem\(THEME_STORAGE_KEY/, 'theme selection persists')
  assert.match(source, /document\.documentElement[\s\S]*setAttribute\('lang', language\)/, 'document locale follows shell locale')
  assert.match(source, /data-theme=\{theme\}/, 'theme state is exposed to scoped CSS')
  assert.match(source, /Switch language to Vietnamese/, 'EN shell copy exists')
  assert.match(source, /Chuyển ngôn ngữ sang English/, 'VI shell copy exists')
  assert.match(css, /\.fx-app\[data-theme='light'\]/, 'light theme is scoped to the mounted app')
  assert.match(css, /prefers-reduced-motion/, 'preference transitions respect reduced motion')
})
