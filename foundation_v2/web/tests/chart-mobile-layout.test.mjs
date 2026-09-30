import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const testsDir = dirname(fileURLToPath(import.meta.url))
const sourceDir = resolve(testsDir, '..', 'src')

test('loaded replay gets a compact mobile rail without enabling full-bleed mode', async () => {
  const shell = await readFile(resolve(sourceDir, 'FxReplayShell.jsx'), 'utf8')
  const css = await readFile(resolve(sourceDir, 'fx-shell-story.css'), 'utf8')

  assert.match(shell, /const chartWorkspace = !SHELL_SKELETON_MODE/, 'full-bleed remains explicitly gated by the skeleton flag')
  assert.match(shell, /const chartRoute = activeView === 'replay'[\s\S]*query\.get\('surface'\) === 'workspace'/, 'loaded replay is identified from the existing route contract')
  assert.match(shell, /chartRoute \? 'is-chart-route' : ''/, 'route hint is scoped to the shell class')
  assert.match(css, /\.fx-app\.fx-shell-story\.is-chart-route:not\(\.is-chart-workspace\)/, 'fallback does not override the dedicated full-bleed workspace')
  assert.match(css, /grid-template-columns: 74px minmax\(0, 1fr\)/, 'tablet chart fallback keeps the navigation rail reachable')
  assert.match(css, /@media \(max-width: 620px\)[\s\S]*grid-template-columns: 58px minmax\(0, 1fr\)/, 'phone chart fallback leaves a readable canvas')
  assert.match(css, /is-chart-route:not\(\.is-chart-workspace\) \.fx-rail-section-label[\s\S]*display: none/, 'compact rail labels are visually hidden while link labels remain semantic')
})
