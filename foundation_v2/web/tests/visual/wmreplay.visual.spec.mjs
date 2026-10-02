import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'

const here = path.dirname(fileURLToPath(import.meta.url))
const workspace = path.resolve(here, '../../../../../..')
const { test, expect } = createRequire(path.join(workspace, 'tooling/ui-qa/package.json'))('@playwright/test')
const fixturePath = path.join(here, 'replay-fixture.json')
const fixtureBytes = await readFile(fixturePath)
const fixture = JSON.parse(fixtureBytes)
const origin = process.env.TW_VISUAL_ORIGIN || 'http://127.0.0.1:5180'
if (new URL(origin).hostname !== '127.0.0.1') throw new Error('Only isolated loopback app origins are allowed')
const candidate = process.env.TW_VISUAL_CANDIDATE === '1'
const candidateRoot = path.join(workspace, '.artifacts/wm-visual-comparison/candidate')
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
function sourceHash() {
  const root = path.resolve(here, '../../src'), hash = createHash('sha256')
  for (const name of readdirSync(root, { recursive: true }).filter(name => /\.(jsx?|css)$/.test(name)).sort()) hash.update(name).update(readFileSync(path.join(root, name)))
  return hash.digest('hex')
}
for (const view of ['overview', 'replay', 'trade', 'analytics']) test(`${view} explicit synthetic comparison fixture`, async ({ page, context, browser }, testInfo) => {
  const before = sourceHash(), unexpected = [], errors = [], captures = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(theme => { localStorage.setItem('tw-theme', theme); localStorage.setItem('tw-language', 'vi'); localStorage.setItem('tw-shell-rail-collapsed', 'false') }, testInfo.project.metadata.theme)
  await context.routeWebSocket('**/*', socket => socket.close())
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url())
    if (url.origin !== origin || !['GET','HEAD'].includes(request.method())) { unexpected.push(`${request.method()} ${url.href}`); return route.abort() }
    if (!url.pathname.startsWith('/api/')) return route.continue()
    if (request.headers()['x-workspace-id'] !== 'visual-fixture') { unexpected.push('Wrong fixture workspace'); return route.abort() }
    let body
    if (url.pathname === '/api/v2/overview') body = fixture.overview
    else if (url.pathname === '/api/v2/replay/sessions') body = fixture.catalog
    else if (url.pathname === `/api/v2/replay/sessions/${fixture.session}/analytics`) body = fixture.analytics
    else if (url.pathname === '/api/v2/journal') body = { items: [] }
    else { unexpected.push(url.pathname); return route.fulfill({ status: 404, json: { detail: 'fixture_route_not_implemented' } }) }
    return route.fulfill({ status: 200, json: body })
  })
  await page.goto(`${origin}/?workspace=visual-fixture&view=${view}&select=1&session=${fixture.session}`)
  if (view === 'overview') await expect(page.getByTestId('dashboard-data-state')).toContainText('Đã tổng hợp')
  else {
    await expect(page.getByTestId('session-catalog-status')).toContainText('1 phiên đang hoạt động')
    await expect(page.getByTestId('analytics-workspace')).toBeVisible()
    await expect(page.getByText('Đang tải kết quả…', { exact: true })).toHaveCount(0)
    await expect(page.getByRole('region', { name: 'Metrics chính' }).first()).toContainText('75')
  }
  await page.evaluate(() => document.fonts.ready)
  await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important;scroll-behavior:auto!important}' })
  const capture = async suffix => {
    const name = `${view}-${suffix}.png`
    if (candidate) {
      const destination = path.join(candidateRoot, testInfo.project.name)
      await mkdir(destination, { recursive: true })
      const first = await page.screenshot({ path: path.join(destination, name), animations: 'disabled', caret: 'hide', scale: 'css' })
      const duplicate = await page.screenshot({ path: path.join(destination, name.replace('.png', '-repeat.png')), animations: 'disabled', caret: 'hide', scale: 'css' })
      expect(sha(first), 'Candidate repeatability is separate from visual approval').toBe(sha(duplicate))
      captures.push({ name, sha256: sha(first) })
    } else await expect(page).toHaveScreenshot(name)
  }
  await page.locator('.fx-content').evaluate(element => { element.scrollTop = 0 })
  await capture('top')
  if (view === 'analytics') { await page.getByRole('region', { name: 'Metrics chính' }).scrollIntoViewIfNeeded(); await capture('metrics') }
  if (view === 'trade' || view === 'analytics') { await page.getByRole('heading', { name: '60 trade đóng', exact: true }).scrollIntoViewIfNeeded(); await capture('ledger') }
  expect(errors).toEqual([])
  expect(unexpected).toEqual([])
  expect(sourceHash(), 'Source must remain unchanged during each capture').toBe(before)
  const receipt = { status: candidate ? 'CANDIDATE_NOT_APPROVED' : 'MATCHED_APPROVED_BASELINE', sourceHash: before, fixtureSha256: sha(fixtureBytes), project: testInfo.project.name, viewport: testInfo.project.use.viewport, browser: browser.version(), locale: 'vi-VN', timezone: 'UTC', scope: fixture.scope, captures }
  await testInfo.attach('visual-provenance', { body: JSON.stringify(receipt, null, 2), contentType: 'application/json' })
  if (candidate) await writeFile(path.join(candidateRoot, testInfo.project.name, `${view}.json`), JSON.stringify(receipt, null, 2))
})
