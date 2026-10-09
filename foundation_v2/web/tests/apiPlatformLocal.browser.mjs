import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'

const origin = process.env.TW_UI_ORIGIN || 'http://127.0.0.1:5180'
assert.equal(new URL(origin).hostname, '127.0.0.1')
const output = new URL('../../evidence/api-platform-implementation-20261009/', import.meta.url)
const browser = await chromium.launch({ headless: true })
const report = { scope: 'Actual local post-cutover UI; read-only user data; no provider refresh/download or new session', errors: [], mutations: [], views: [] }
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
  page.on('pageerror', error => report.errors.push(error.message))
  await page.route('**/*', route => {
    const request = route.request(), url = new URL(request.url())
    if (url.origin !== origin) return route.abort()
    if (url.pathname.startsWith('/api/') && request.method() !== 'GET') {
      report.mutations.push({ method: request.method(), path: url.pathname }); return route.abort()
    }
    return route.continue()
  })
  await page.goto(`${origin}/?workspace=tenant-a&view=overview&area=testing&section=dashboard`)
  await page.locator('.fx-rail').waitFor()
  await page.locator('.fx-dashboard-quick-action.is-primary').waitFor()
  await page.evaluate(() => { window.__localShell = { shell: document.querySelector('[data-testid="fxreplay-shell"]'), rail: document.querySelector('.fx-rail'), header: document.querySelector('.fx-topbar') } })
  await page.locator('.fx-dashboard-quick-action.is-primary').click()
  const dialog = page.locator('.quick-session-dialog')
  await dialog.waitFor()
  await dialog.locator('.dataset-asset-select .fx-select-trigger').click()
  await page.getByRole('option').filter({ hasText: 'EUR/USD' }).first().waitFor()
  await page.getByRole('option').filter({ hasText: 'XAU/USD' }).first().waitFor()
  await page.keyboard.press('Escape')
  await dialog.locator('.quick-session-close').click()
  for (const view of ['market-data', 'settings', 'overview']) {
    await page.locator(`.fx-subnav a[href*="view=${view}"], .fx-rail a[href*="view=${view}"]`).first().click()
    await page.waitForURL(url => url.searchParams.get('view') === view)
    await page.locator('.fx-content .wm-page, .fx-dashboard').first().waitFor()
    assert.equal(await page.evaluate(() => window.__localShell.shell === document.querySelector('[data-testid="fxreplay-shell"]')
      && window.__localShell.rail === document.querySelector('.fx-rail') && window.__localShell.header === document.querySelector('.fx-topbar')), true)
    report.views.push(view)
  }
  assert.deepEqual(report.errors, [])
  assert.deepEqual(report.mutations, [])
  report.result = 'PASS'
  await page.screenshot({ path: new URL('local-dashboard.png', output).pathname.replace(/^\/(\w:)/, '$1') })
} finally {
  await writeFile(new URL('local-ui.json', output), JSON.stringify(report, null, 2))
  await browser.close()
}
console.log(JSON.stringify(report))
