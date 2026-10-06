import assert from 'node:assert/strict'
import { chromium } from '../../../web/node_modules/playwright/index.mjs'
import { readFile, writeFile, readdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { ready, empty, missingCost, unavailable, locked } from './fixtures.mjs'

const out = 'foundation_v2/evidence/live-market-standard-20261007/independent/'
const source = 'foundation_v2/web/src/'
const names = (await readdir(source)).filter(name => /live|testing-copy|FxSelect|fx-select|testing-standard|TestingReadState|main.jsx|FxReplayShell/i.test(name))
const pins = () => Promise.all(names.map(async file => ({ file, sha256: createHash('sha256').update(await readFile(source + file)).digest('hex') })))
const report = { label: 'Synthetic intercepted local API states; no real feed or mutation evidence', cases: [], failures: [], blocked: [], errors: [], before: await pins() }
const browser = await chromium.launch({ headless: true, ignoreDefaultArgs: ['--hide-scrollbars'] })
async function setup(section = 'calendar') {
  const context = await browser.newContext({ viewport: { width: 1440, height: 987 } }), page = await context.newPage()
  await page.addInitScript(() => { localStorage.setItem('tw-theme', 'dark'); localStorage.setItem('tw-language', 'en') })
  await context.routeWebSocket('**/*', socket => socket.close())
  await context.route('**/*', route => {
    const req = route.request(), url = new URL(req.url())
    if (!['http://127.0.0.1:5180', 'http://127.0.0.1:8010'].includes(url.origin) || !['GET', 'HEAD', 'OPTIONS'].includes(req.method())) {
      report.blocked.push({ method: req.method(), url: req.url() }); return route.abort()
    }
    return route.continue()
  })
  page.on('pageerror', error => report.errors.push(String(error)))
  const state = { status: 200, payload: ready, hold: null, requests: [] }
  await context.route('**/api/v2/live/status', async route => {
    state.requests.push(route.request().headers()['x-workspace-id'])
    if (state.hold) await state.hold
    await route.fulfill({ status: state.status, contentType: 'application/json', body: JSON.stringify(state.payload) })
  })
  await page.clock.install({ time: new Date('2026-10-07T12:00:00Z') })
  const url = 'http://127.0.0.1:5180/?' + new URLSearchParams({ workspace: 'tenant-a', view: 'live', area: 'live', section })
  return { context, page, state, url }
}
async function run(name, fn) {
  const app = await setup(name.includes('trades') || name.includes('stale') ? 'trades' : 'calendar')
  try { await fn(app); report.cases.push({ name, pass: true, requests: app.state.requests }); await app.page.screenshot({ path: out + name + '.png' }) }
  catch (error) { report.failures.push({ name, error: String(error), content: await app.page.locator('.fx-content').innerText().catch(() => '') }); await app.page.screenshot({ path: out + name + '-failure.png' }) }
  finally { await app.context.close(); await writeFile(out + 'states-progress.json', JSON.stringify(report, null, 2)) }
}
try {
  await run('synthetic-loading-release', async ({ page, state, url }) => {
    let release; state.hold = new Promise(resolve => { release = resolve })
    await page.goto(url, { waitUntil: 'domcontentloaded' })
    await page.locator('.wm-skeleton[aria-busy=true]').waitFor()
    await page.screenshot({ path: out + 'synthetic-loading-held.png' })
    release(); await page.locator('.live-calendar-grid').waitFor()
    assert.equal(await page.locator('.wm-skeleton').count(), 0)
  })
  await run('synthetic-ready-calendar-net', async ({ page, url }) => {
    await page.goto(url); await page.locator('.live-calendar-grid').waitFor()
    assert.equal(await page.locator('.live-month-total strong').innerText(), '38 USD')
    const before = page.getByRole('button', { name: '2026-10-04 · 95 USD', exact: true }), after = page.getByRole('button', { name: '2026-10-05 · -57 USD', exact: true })
    assert.ok(await before.isVisible()); assert.ok(await after.isVisible())
    await after.click(); assert.match(await page.locator('.live-day-detail').innerText(), /qa-utc-after/)
    assert.match(await page.locator('.live-day-detail').innerText(), /qa-entry-cost/)
    assert.ok(!/qa-deposit/.test(await page.locator('.live-day-detail').innerText()))
  })
  await run('synthetic-ready-empty-calendar', async ({ page, state, url }) => { state.payload = empty; await page.goto(url); await page.locator('.live-calendar-grid').waitFor(); assert.equal(await page.locator('.live-month-total strong').innerText(), '0 USD') })
  for (const [name, payload] of [['unavailable', unavailable], ['locked', locked], ['malformed', []]]) await run('synthetic-' + name, async ({ page, state, url }) => {
    state.payload = payload; await page.goto(url); await page.locator('.live-calendar-grid').waitFor()
    assert.equal(await page.locator('.live-month-total strong').innerText(), '—')
    assert.equal(await page.getByTestId('live-broker-snapshot').count(), 0)
    const known = await page.locator('.live-calendar-cell strong').allTextContents(); assert.ok(known.every(text => text === '—' || text === ''))
  })
  await run('synthetic-missing-cost', async ({ page, state, url }) => { state.payload = missingCost; await page.goto(url); await page.locator('.live-calendar-grid').waitFor(); assert.equal(await page.locator('.live-month-total strong').innerText(), '—') })
  await run('synthetic-stale-error-denied', async ({ page, state, url }) => {
    await page.goto(url); await page.getByTestId('live-broker-snapshot').waitFor()
    assert.match(await page.getByTestId('live-broker-snapshot').innerText(), /qa-utc-before/)
    state.status = 500; state.payload = { detail: 'qa-interrupted' }; await page.clock.fastForward(5100)
    await page.getByTestId('live-status').filter({ hasText: 'Previous snapshot' }).waitFor()
    assert.match(await page.getByTestId('live-broker-snapshot').innerText(), /qa-utc-before/)
    state.status = 403; state.payload = { detail: 'qa-denied' }; await page.clock.fastForward(5100)
    await page.getByTestId('live-status').filter({ hasText: 'cannot read account data' }).waitFor()
    assert.equal(await page.getByTestId('live-broker-snapshot').count(), 0)
    assert.ok(!/qa-utc-before/.test(await page.locator('.fx-content').innerText()))
  })
  report.after = await pins(); report.sourceUnchanged = JSON.stringify(report.before) === JSON.stringify(report.after)
  assert.equal(report.failures.length, 0); assert.equal(report.errors.length, 0); assert.equal(report.blocked.length, 0); assert.ok(report.sourceUnchanged)
  report.pass = true
} catch (error) { report.failure = String(error); process.exitCode = 1 }
finally { await browser.close(); await writeFile(out + 'states-report.json', JSON.stringify(report, null, 2)); console.log(JSON.stringify({ pass: report.pass, cases: report.cases.length, failures: report.failures, errors: report.errors, blocked: report.blocked, sourceUnchanged: report.sourceUnchanged })) }
