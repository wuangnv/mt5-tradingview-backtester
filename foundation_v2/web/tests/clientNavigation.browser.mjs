import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'

const origin = process.env.TW_UI_ORIGIN || 'http://127.0.0.1:5180'
assert.equal(new URL(origin).hostname, '127.0.0.1')
const output = new URL('../../evidence/client-navigation-20261009/', import.meta.url)
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ headless: true })
const report = { scope: 'Actual local React UI with labeled API empty/error fixtures; no user DB/provider/broker requests', cases: [], pageErrors: [] }
try {
  for (const width of [1440, 768]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' })
    const page = await context.newPage()
    let documents = 0
    const apiCalls = []
    page.on('pageerror', error => report.pageErrors.push(error.message))
    page.on('request', request => { if (request.isNavigationRequest() && request.frame() === page.mainFrame()) documents++ })
    await page.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url())
      if (url.origin !== origin) return route.abort()
      if (url.pathname.startsWith('/api/')) {
        assert.equal(request.method(), 'GET', 'Navigation cannot perform mutations')
        apiCalls.push({ path: url.pathname, workspace: request.headers()['x-workspace-id'] })
        const payload = url.pathname === '/api/v2/replay/sessions' ? { items: [] }
          : url.pathname === '/api/v2/data/datasets' ? { items: [], catalog_items: [], catalog_state: null }
          : url.pathname === '/api/v2/data/downloads' ? { items: [], available: false }
          : { detail: 'labeled_navigation_fixture_unavailable' }
        return route.fulfill({ status: 'items' in payload ? 200 : 503, contentType: 'application/json', body: JSON.stringify(payload) })
      }
      return route.continue()
    })
    await page.goto(`${origin}/?workspace=nav-fixture-a&view=overview&area=testing&section=dashboard`)
    await page.locator('.fx-rail').waitFor()
    await page.evaluate(() => { window.__navigationOracle = { document, shell: document.querySelector('[data-testid="fxreplay-shell"]'), topbar: document.querySelector('.fx-topbar'), rail: document.querySelector('.fx-rail') } })
    const persistent = () => page.evaluate(() => {
      const oracle = window.__navigationOracle
      return oracle.document === document && oracle.shell === document.querySelector('[data-testid="fxreplay-shell"]') && oracle.topbar === document.querySelector('.fx-topbar') && oracle.rail === document.querySelector('.fx-rail')
    })
    const clickView = async view => {
      await page.locator(`.fx-subnav a[href*="view=${view}"], .fx-rail a[href*="view=${view}"]`).first().click()
      await page.waitForURL(url => url.searchParams.get('view') === view)
      await page.locator('.fx-content .wm-page').first().waitFor()
      assert.equal(await persistent(), true, `Shell identity retained at ${view}`)
    }
    await clickView('market-data')
    await page.goBack(); await page.waitForURL(url => url.searchParams.get('view') === 'overview')
    assert.equal(await persistent(), true)
    await page.goForward(); await page.waitForURL(url => url.searchParams.get('view') === 'market-data')
    assert.equal(await persistent(), true)
    await clickView('settings')
    // A workspace switch must remount readers while preserving application chrome.
    const switchedCatalog = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v2/replay/sessions' && response.request().headers()['x-workspace-id'] === 'nav-fixture-b')
    await page.evaluate(() => {
      const link = document.createElement('a'); link.href = '/?workspace=nav-fixture-b&view=overview&area=testing&section=dashboard'; link.id = 'navigation-fixture-link'; link.textContent = 'fixture'; document.body.append(link); link.click(); link.remove()
    })
    await page.waitForURL(url => url.searchParams.get('workspace') === 'nav-fixture-b')
    await page.waitForFunction(() => document.querySelector('.dashboard-sessions') || document.querySelector('.fx-dashboard'))
    assert.equal(await persistent(), true)
    await switchedCatalog
    assert.ok(apiCalls.some(call => call.workspace === 'nav-fixture-b' && call.path === '/api/v2/replay/sessions'))
    assert.equal(documents, 1, 'Client navigation causes no new document requests')
    await page.screenshot({ path: new URL(`shell-${width}.png`, output).pathname.replace(/^\/(\w:)/, '$1') })
    await page.evaluate(() => {
      const link = document.createElement('a'); link.href = '/?workspace=nav-fixture-b&view=replay&session=unavailable-fixture&dataset=d&surface=workspace&cursor=12'; document.body.append(link); link.click(); link.remove()
    })
    await page.locator('.is-chart-workspace').waitFor()
    assert.equal(await page.locator('.fx-rail').count(), 0, 'Full-bleed chart hides the rail')
    assert.equal(await page.evaluate(() => window.__navigationOracle.shell === document.querySelector('[data-testid="fxreplay-shell"]')), true)
    await page.getByRole('link', { name: 'Quay lại Sessions' }).click()
    await page.waitForURL(url => url.searchParams.get('select') === '1')
    await page.locator('.fx-rail').waitFor()
    assert.equal(documents, 1)
    await page.reload()
    await page.locator('.fx-rail').waitFor()
    assert.equal(new URL(page.url()).searchParams.get('workspace'), 'nav-fixture-b')
    assert.equal(new URL(page.url()).searchParams.get('session'), 'unavailable-fixture')
    report.cases.push({ width, clientDocuments: 1, shellPreserved: true, history: 'back-forward', chartFullBleed: 'error route and return', deepLinkReload: true, workspaces: ['nav-fixture-a', 'nav-fixture-b'], apiCalls })
    await context.close()
  }
  assert.deepEqual(report.pageErrors, [])
  report.status = 'pass'
} catch (error) { report.status = 'fail'; report.error = error.stack; throw error }
finally {
  await writeFile(new URL('receipt.json', output), JSON.stringify(report, null, 2))
  await browser.close()
  console.log(JSON.stringify({ status: report.status, cases: report.cases.length, pageErrors: report.pageErrors, evidence: output.href }))
}
