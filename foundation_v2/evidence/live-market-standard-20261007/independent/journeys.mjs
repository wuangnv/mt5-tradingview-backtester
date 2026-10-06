import assert from 'node:assert/strict'
import { chromium } from '../../../web/node_modules/playwright/index.mjs'
import { readFile, writeFile, readdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
const out = 'foundation_v2/evidence/live-market-standard-20261007/independent/'
const source = 'foundation_v2/web/src/'
const files = (await readdir(source)).filter(name => /live|MarketAssetCatalog|market-sync|DemoPreview|demoFixtures|FxReplayShell|TestingIcon|testing-copy|testing-standard|FxSelect|fx-select|main.jsx/i.test(name))
const pins = () => Promise.all(files.map(async file => ({ file, sha256: createHash('sha256').update(await readFile(source + file)).digest('hex') })))
const report = { scope: 'Independent demo presentation journeys, no writes/provider/broker action', before: await pins(), cases: [], failures: [], errors: [], blocked: [] }
const browser = await chromium.launch({ headless: true, ignoreDefaultArgs: ['--hide-scrollbars'] })
async function choose(page, label, option) {
  await page.getByRole('button', { name: label, exact: true }).click()
  await page.getByRole('option').filter({ hasText: new RegExp('^' + option.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?:✓)?$') }).click()
}
async function preview(page, button, name) {
  await button.click(); const dialog = page.getByRole('dialog')
  await dialog.waitFor(); assert.match(await dialog.innerText(), /Interface preview/)
  assert.match(await dialog.innerText(), /Changes are not saved and no connection is made/)
  await page.screenshot({ path: out + name + '-dialog.png' })
  await page.keyboard.press('Escape'); assert.equal(await page.getByRole('dialog').count(), 0)
  assert.ok(await button.evaluate(e => e === document.activeElement), 'Escape restores opener focus')
}
async function run(route, theme, width, fn) {
  if (process.env.MARKET_ONLY && route !== 'market-data') return
  const name = `demo-${route}-${theme}-en-${width}-journey`, context = await browser.newContext({ viewport: { width, height: 987 } }), page = await context.newPage()
  await page.addInitScript(theme => { localStorage.setItem('tw-theme', theme); localStorage.setItem('tw-language', 'en') }, theme)
  await context.routeWebSocket('**/*', socket => socket.close())
  await context.route('**/*', route => { const req = route.request(), u = new URL(req.url()); if (!['http://127.0.0.1:5180', 'http://127.0.0.1:8010'].includes(u.origin) || !['GET', 'HEAD', 'OPTIONS'].includes(req.method())) { report.blocked.push({ name, url: req.url(), method: req.method() }); return route.abort() } return route.continue() })
  page.on('pageerror', error => report.errors.push({ name, error: String(error) }))
  try {
    await page.goto('http://127.0.0.1:5180/?' + new URLSearchParams({ workspace: 'tenant-a', view: route === 'market-data' ? 'market-data' : 'live', area: route === 'market-data' ? 'testing' : 'live', section: route, demo: '1' }))
    await page.waitForLoadState('networkidle'); await fn(page, name)
    await page.screenshot({ path: out + name + '.png' }); report.cases.push({ name, pass: true })
  } catch (error) { report.failures.push({ name, error: String(error), content: await page.locator('.fx-content').innerText() }); await page.screenshot({ path: out + name + '-failure.png' }) }
  finally { await context.close(); await writeFile(out + 'journeys-progress.json', JSON.stringify(report, null, 2)) }
}
try {
  for (const [theme, width] of [['dark', 1440], ['light', 360]]) {
    await run('trades', theme, width, async (page, name) => {
      const snapshot = page.getByTestId('live-broker-snapshot'), count = async () => Number((await snapshot.locator('h2').innerText()).split('·').at(-1).trim())
      assert.equal(await count(), 60)
      await choose(page, 'Rows per page', '10'); await page.getByRole('button', { name: 'Next page', exact: true }).click()
      assert.match(await snapshot.locator('.fxa-pagination').innerText(), /2\s*\/\s*6/)
      await page.getByRole('button', { name: 'Basic', exact: true }).click()
      await choose(page, 'Assets', 'EURUSD'); await page.getByRole('button', { name: 'Apply', exact: true }).click()
      assert.equal(await count(), 20); assert.match(await snapshot.locator('.fxa-pagination').innerText(), /1\s*\/\s*2/)
      await page.getByRole('button', { name: 'Next page', exact: true }).click()
      await choose(page, 'Assets', 'GBPUSD'); await page.getByRole('button', { name: 'Apply', exact: true }).click()
      assert.equal(await count(), 20); assert.match(await snapshot.locator('.fxa-pagination').innerText(), /1\s*\/\s*2/)
      await choose(page, 'Assets', 'EURUSD'); await page.getByRole('button', { name: 'Clear filters', exact: true }).click()
      assert.equal(await count(), 60); await page.getByRole('button', { name: 'Apply', exact: true }).click(); assert.equal(await count(), 60)
      await page.getByRole('searchbox', { name: 'Search symbol or ticket', exact: true }).fill('demo-60'); assert.equal(await count(), 1)
      await preview(page, page.getByRole('button', { name: 'Add trade', exact: true }), name + '-add-trade')
    })
    await run('trading-accounts', theme, width, async (page, name) => {
      for (const provider of ['MetaTrader', 'Alpaca', 'cTrader']) await preview(page, page.getByRole('button', { name: provider, exact: true }), name + '-' + provider)
      await preview(page, page.getByRole('button', { name: /^Manual/ }), name + '-manual')
      await preview(page, page.getByRole('button', { name: 'Upload file', exact: true }), name + '-upload')
      await page.locator('.fx-subsubnav').getByRole('link', { name: 'Transactions', exact: true }).click()
      await page.getByTestId('live-broker-snapshot').waitFor()
      const query = new URL(page.url()).searchParams
      assert.equal(query.get('workspace'), 'tenant-a'); assert.equal(query.get('demo'), '1'); assert.equal(query.get('account_tab'), 'transactions')
      assert.match(await page.getByTestId('live-broker-snapshot').innerText(), /demo-deposit/)
      assert.match(await page.getByTestId('live-broker-snapshot').innerText(), /10,000 USD/)
      await page.locator('.fx-subsubnav').getByRole('link', { name: 'Connect', exact: true }).click()
      await page.getByRole('searchbox', { name: 'Search accounts', exact: true }).fill('nonexistent')
      await page.getByRole('heading', { name: 'No matching accounts', exact: true }).waitFor()
      await page.getByRole('searchbox', { name: 'Search accounts', exact: true }).fill(''); await page.getByTestId('live-broker-snapshot').waitFor()
    })
    await run('notes', theme, width, async (page, name) => { await preview(page, page.getByRole('button', { name: 'New note', exact: true }), name); await choose(page, 'Group by', 'Tags'); await page.getByRole('searchbox', { name: 'Search notes', exact: true }).fill('review'); assert.ok(await page.getByRole('heading', { name: 'No notes yet', exact: true }).isVisible()) })
    await run('market-data', theme, width, async page => {
      const table = page.locator('.market-sync-table'), rows = table.locator('tbody tr')
      assert.equal(await rows.count(), 12); await choose(page, 'Rows per page', '10'); assert.equal(await rows.count(), 10)
      await page.getByRole('button', { name: 'Next page', exact: true }).click(); assert.equal(await rows.count(), 2)
      await choose(page, 'Asset group', 'Metals'); assert.equal(await rows.count(), 2)
      assert.match(await page.locator('.fxa-pagination').innerText(), /1\s*\/\s*1/)
      await page.getByRole('searchbox', { name: 'Search assets', exact: true }).fill('XAU'); assert.equal(await rows.count(), 1)
      await page.getByRole('searchbox', { name: 'Search assets', exact: true }).fill('no-such-asset'); assert.equal(await rows.count(), 0)
      assert.match(await table.innerText(), /No assets match the filters/)
    })
  }
  report.after = await pins(); report.sourceUnchanged = JSON.stringify(report.before) === JSON.stringify(report.after)
  assert.equal(report.failures.length, 0); assert.equal(report.errors.length, 0); assert.equal(report.blocked.length, 0); assert.ok(report.sourceUnchanged); report.pass = true
} catch (error) { report.failure = String(error); process.exitCode = 1 }
finally { await browser.close(); await writeFile(out + 'journeys-report.json', JSON.stringify(report, null, 2)); console.log(JSON.stringify({ pass: report.pass, cases: report.cases.length, failures: report.failures.map(({ name, error }) => ({ name, error })), errors: report.errors, blocked: report.blocked, sourceUnchanged: report.sourceUnchanged })) }
