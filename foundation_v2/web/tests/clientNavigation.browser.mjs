import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'

const origin = process.env.TW_UI_ORIGIN || 'http://127.0.0.1:5180'
assert.equal(new URL(origin).hostname, '127.0.0.1')
const output = process.env.TW_NAVIGATION_OUTPUT ? new URL(`file:///${process.env.TW_NAVIGATION_OUTPUT.replaceAll('\\', '/').replace(/\/$/, '')}/`) : new URL('../../evidence/frontend-system-design-implementation-20261009/navigation/', import.meta.url)
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ headless: true })
const report = { scope: 'Actual local React UI with labeled API empty/error fixtures; no user DB/provider/broker requests', cases: [], pageErrors: [] }
try {
  for (const width of [1710, 1440, 768]) {
    for (const theme of ['dark', 'light']) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: theme === 'light' ? 'reduce' : 'no-preference' })
    await context.addInitScript(value => localStorage.setItem('tw-theme', value), theme)
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
        apiCalls.push({ path: url.pathname, query: url.search, workspace: request.headers()['x-workspace-id'] })
        const payload = url.pathname === '/api/v2/replay/trades' ? { schema_version: 'replay-trades-page-v1', status: 'ready', snapshot_key: 'labeled-empty-ledger-v1', ledger: [], sources: [], excluded: [], scope: { session_ids: [] }, facets: { assets: [], tags: [], strategies: [], years: [], types: [] }, pagination: { page: 1, page_size: 10, returned_count: 0, filtered_count: 0, page_count: 0 } }
          : url.pathname === '/api/v2/replay/sessions' ? { items: [] }
          : url.pathname === '/api/v2/data/datasets' ? { items: [], catalog_items: [], catalog_state: null }
          : url.pathname === '/api/v2/data/downloads' ? { items: [], available: false }
          : { detail: 'labeled_navigation_fixture_unavailable' }
        return route.fulfill({ status: 'items' in payload || 'schema_version' in payload ? 200 : 503, contentType: 'application/json', body: JSON.stringify(payload) })
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
    await clickView('analytics')
    const geometry = await page.evaluate(() => {
      const parent = document.querySelector('.fx-subnav-link.is-active'), nested = document.querySelector('.fx-subsubnav')
      return { parentBottom: parent.getBoundingClientRect().bottom, nestedBottom: nested.getBoundingClientRect().bottom, parentLine: getComputedStyle(parent, '::after').height, nestedLine: getComputedStyle(nested, '::after').height }
    })
    assert.ok(Math.abs(geometry.parentBottom - geometry.nestedBottom) <= .5, `Orange baselines align: ${JSON.stringify(geometry)}`)
    assert.equal(geometry.parentLine, '2px'); assert.equal(geometry.nestedLine, '2px')
    const clientNavigate = href => page.evaluate(href => {
      const link = document.createElement('a'); link.href = href; document.body.append(link); link.click(); link.remove()
    }, href)
    await clientNavigate('/?workspace=nav-fixture-a&view=analytics&area=testing&section=analytics&ui_reference=1')
    await page.locator('.wm-component-reference').first().waitFor()
    await page.evaluate(() => {
      window.__contentOracle = document.querySelector('.fx-content').firstElementChild
      const content = document.querySelector('.fx-content'); content.scrollTop = 160
      window.__scrollOracle = content.scrollTop
    })
    await clientNavigate('/?workspace=nav-fixture-a&view=analytics&area=testing&section=analytics&ui_reference=1&analytics_tab=drawdown&side=buy')
    await page.waitForURL(url => url.searchParams.get('side') === 'buy')
    assert.equal(await page.evaluate(() => window.__contentOracle === document.querySelector('.fx-content').firstElementChild), true, 'Filter edits preserve mounted page')
    assert.equal(await page.evaluate(() => document.querySelector('.fx-content').scrollTop), await page.evaluate(() => window.__scrollOracle), 'Filter edits preserve content scroll')
    await page.goBack(); await page.waitForURL(url => !url.searchParams.has('side'))
    assert.equal(await page.evaluate(() => window.__contentOracle === document.querySelector('.fx-content').firstElementChild), true, 'Back to filters preserves mounted page')
    await page.goForward(); await page.waitForURL(url => url.searchParams.get('side') === 'buy')
    await page.screenshot({ path: new URL(`analytics-lines-${width}-${theme}.png`, output).pathname.replace(/^\/(\w:)/, '$1') })
    await clientNavigate('/?workspace=nav-fixture-a&view=analytics&area=testing&section=analytics&ui_reference=1&session=other-resource')
    await page.waitForFunction(() => window.__contentOracle !== document.querySelector('.fx-content').firstElementChild)
    assert.equal(await page.evaluate(() => document.querySelector('.fx-content').scrollTop), 0, 'New resource resets content scroll')
    await clientNavigate('/?workspace=nav-fixture-a&view=trade&area=testing&section=trades&sessions=all')
    await page.locator('[data-testid="aggregate-trades"]').waitFor()
    await page.evaluate(() => { window.__ledgerOracle = document.querySelector('[data-testid="aggregate-trades"]') })
    const filteredPage = page.waitForResponse(response => {
      const url = new URL(response.url()); return url.pathname === '/api/v2/replay/trades' && url.searchParams.get('side') === 'buy'
    })
    await clientNavigate('/?workspace=nav-fixture-a&view=trade&area=testing&section=trades&sessions=all&side=buy&analytics_tag=news')
    await filteredPage
    assert.equal(await page.evaluate(() => window.__ledgerOracle === document.querySelector('[data-testid="aggregate-trades"]')), true, 'Ledger filter changes retain page')
    const backPage = page.waitForResponse(response => {
      const url = new URL(response.url()); return url.pathname === '/api/v2/replay/trades' && !url.searchParams.has('side')
    })
    await page.goBack(); await backPage
    await page.waitForURL(url => !url.searchParams.has('side'))
    assert.equal(await page.evaluate(() => window.__ledgerOracle === document.querySelector('[data-testid="aggregate-trades"]')), true, 'Ledger Back resets URL-owned filters without remount')
    await clickView('settings')
    // A workspace switch must remount readers while preserving application chrome.
    const switchedCatalog = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v2/dashboard/sessions' && response.request().headers()['x-workspace-id'] === 'nav-fixture-b')
    await page.evaluate(() => {
      const link = document.createElement('a'); link.href = '/?workspace=nav-fixture-b&view=overview&area=testing&section=dashboard'; link.id = 'navigation-fixture-link'; link.textContent = 'fixture'; document.body.append(link); link.click(); link.remove()
    })
    await page.waitForURL(url => url.searchParams.get('workspace') === 'nav-fixture-b')
    await page.waitForFunction(() => document.querySelector('.dashboard-sessions') || document.querySelector('.fx-dashboard'))
    assert.equal(await persistent(), true)
    await switchedCatalog
    assert.ok(apiCalls.some(call => call.workspace === 'nav-fixture-b' && call.path === '/api/v2/dashboard/sessions'))
    assert.equal(documents, 1, 'Client navigation causes no new document requests')
    await page.screenshot({ path: new URL(`shell-${width}-${theme}.png`, output).pathname.replace(/^\/(\w:)/, '$1') })
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
    report.cases.push({ width, theme, geometry, filterPagePreserved: true, resourceReset: true, clientDocuments: 1, shellPreserved: true, history: 'back-forward', chartFullBleed: 'error route and return', deepLinkReload: true, workspaces: ['nav-fixture-a', 'nav-fixture-b'], apiCalls })
    await context.close()
    }
  }
  assert.deepEqual(report.pageErrors, [])
  report.status = 'pass'
} catch (error) { report.status = 'fail'; report.error = error.stack; throw error }
finally {
  await writeFile(new URL('receipt.json', output), JSON.stringify(report, null, 2))
  await browser.close()
  console.log(JSON.stringify({ status: report.status, cases: report.cases.length, pageErrors: report.pageErrors, evidence: output.href }))
}
