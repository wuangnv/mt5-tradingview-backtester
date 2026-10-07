import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { chromium } from '../../web/node_modules/playwright/index.mjs'

const out = new URL('./', import.meta.url)
const session = '476f4b498e1a49ed9d48a75719f4d270'
const url = `http://127.0.0.1:5180/?workspace=tenant-a&view=replay&session=${session}&dataset=dataset-262639d819219431b8bbfd00a665d4fb7fde4c646a4fa0c5020608c1e1c3572d&mode=Practice&surface=workspace&cursor=500`
const report = { scope: 'Actual service GET, fixture activity POST, browser-local layout only', cases: [], errors: [], unexpected: [] }
const browser = await chromium.launch({ headless: true })
try {
  for (const [width, theme, language] of [[1710, 'dark', 'vi'], [1710, 'light', 'en'], [768, 'dark', 'vi'], [390, 'light', 'en'], [1300, 'dark', 'vi']]) {
    const context = await browser.newContext({ viewport: { width, height: 987 }, acceptDownloads: true })
    await context.addInitScript(({ theme, language }) => { if (!localStorage.getItem('tw-theme')) localStorage.setItem('tw-theme', theme); if (!localStorage.getItem('tw-language')) localStorage.setItem('tw-language', language) }, { theme, language })
    await context.routeWebSocket('**/*', socket => socket.close())
    await context.route('**/*', async route => {
      const request = route.request(), target = new URL(request.url())
      if (request.method() === 'POST' && target.pathname === `/api/v2/replay/sessions/${session}/activity`) {
        const event = request.postDataJSON()
        return route.fulfill({ status: 200, json: { schema_version: 'replay-activity-v1', session_id: session, event_id: event.event_id, accepted_seconds: (Date.parse(event.ended_at_utc) - Date.parse(event.started_at_utc)) / 1000, fixture: 'header-qa' } })
      }
      if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method()) || !['http://127.0.0.1:5180', 'http://127.0.0.1:8010'].includes(target.origin)) {
        if (request.url() !== 'http://www.google-analytics.com/analytics.js') report.unexpected.push({ method: request.method(), url: request.url() })
        return route.abort()
      }
      if (target.pathname.endsWith('charting_library.standalone.js')) {
        const response = await route.fetch()
        return route.fulfill({ response, body: await response.text() + ';window.TradingView.widget=new Proxy(window.TradingView.widget,{construct(Target,args){const item=new Target(...args);window.__qaWidget=item;window.__qaOptions=args[0];return item}});' })
      }
      return route.continue()
    })
    const page = await context.newPage()
    page.setDefaultTimeout(15000)
    page.on('pageerror', error => report.errors.push(String(error)))
    await page.goto(url)
    await page.locator('[data-chart-status=ready]').waitFor()
    const frame = page.frameLocator('.advanced-chart-host iframe')
    await page.getByTestId('chart-header-tail').waitFor()
    const vi = language === 'vi'
    const compact = () => page.getByTestId('chart-header-tail').evaluate(element => element.classList.contains('is-compact'))
    const openTool = async label => {
      if (await compact()) {
        await page.locator('.chart-header-overflow').click()
        await page.locator('#chart-header-menu').getByRole('button', { name: label, exact: true }).click()
      } else await frame.getByRole('button', { name: label, exact: true }).click()
    }
    const close = () => page.locator('.replay-side .replay-panel-close').click()
    const before = await page.evaluate(() => ({ rows: document.querySelector('[data-chart-status=ready]').dataset.visibleRowCount, cutoff: document.querySelector('[data-chart-status=ready]').dataset.cutoff }))
    const geometry = await page.getByTestId('chart-header-tail').evaluate(element => { const bounds = element.getBoundingClientRect(); return { right: bounds.right, top: bounds.top, height: bounds.height, viewport: innerWidth, overflow: document.documentElement.scrollWidth - innerWidth } })
    assert.equal(geometry.right, width); assert.equal(geometry.top, 0); assert.equal(geometry.overflow, 0)
    await page.screenshot({ path: fileURLToPath(new URL(`header-${theme}-${width}.png`, out)) })
    for (const [tool, label] of [['compare', vi ? 'So sánh mã' : 'Compare symbols'], ['layout', 'New Layout'], ['alerts', 'Alerts'], ['editor', 'Editor']]) {
      await openTool(label)
      const panel = page.getByTestId(`chart-preview-${tool}`)
      await panel.waitFor()
      assert.match(await panel.innerText(), vi ? /Giao diện mẫu/ : /UI preview/)
      assert.ok(await panel.locator('button:disabled').count())
      if (tool === 'layout') { await panel.locator('.chart-layout-choices button').last().click(); assert.equal(await panel.locator('.chart-layout-choices button').last().getAttribute('aria-pressed'), 'true') }
      if (tool === 'editor') await panel.getByRole('textbox').fill('// local preview only')
      await close()
      if (width <= 768) await page.waitForFunction(() => document.activeElement === document.querySelector('.chart-header-overflow'))
      else await page.waitForFunction(label => document.querySelector('.advanced-chart-host iframe').contentDocument.activeElement?.getAttribute('aria-label') === label, label)
    }
    // A desktop dock narrows the iframe; tools remain available in the overflow.
    if (width === 1300) {
      await openTool('New Layout')
      await page.waitForFunction(() => document.querySelector('.chart-header-tail').classList.contains('is-compact'))
      await page.locator('.chart-header-overflow').click()
      await page.locator('#chart-header-menu').getByRole('button', { name: 'Editor', exact: true }).click()
      await page.getByTestId('chart-preview-editor').waitFor()
      await close()
      await page.waitForFunction(() => document.querySelector('.advanced-chart-host iframe').contentDocument.activeElement?.getAttribute('aria-label') === 'Editor')
    }
    if (width === 1710 && theme === 'dark') {
      await frame.getByRole('button', { name: 'Lưu chart', exact: true }).click()
      assert.ok(await page.evaluate(() => Object.keys(localStorage).some(key => key.startsWith('tw:advanced-chart:v1:') && JSON.parse(localStorage.getItem(key)).length)))
      const download = page.waitForEvent('download')
      await frame.getByRole('button', { name: 'Chụp biểu đồ PNG', exact: true }).click()
      assert.match((await download).suggestedFilename(), /WMReplay.*\.png$/)
      await page.getByRole('button', { name: 'Toàn màn hình', exact: true }).click()
      await page.waitForFunction(() => Boolean(document.fullscreenElement))
      await page.getByRole('button', { name: 'Thoát toàn màn hình', exact: true }).click()
      await page.waitForFunction(() => !document.fullscreenElement)
      await page.reload(); await page.locator('[data-chart-status=ready]').waitFor()
    }
    const after = await page.evaluate(() => ({ rows: document.querySelector('[data-chart-status=ready]').dataset.visibleRowCount, cutoff: document.querySelector('[data-chart-status=ready]').dataset.cutoff }))
    assert.deepEqual(after, before)
    const native = await page.evaluate(() => new Promise(resolve => window.__qaWidget.save(layout => { const series = layout.charts[0].panes.flatMap(pane => pane.sources).find(source => source.type === 'MainSeries').state; resolve({ up: series.candleStyle.upColor, down: series.candleStyle.downColor, logo: window.__qaOptions.disabled_features.includes('widget_logo') }) })))
    assert.equal(native.up.toUpperCase(), '#26A69A'); assert.equal(native.down.toUpperCase(), '#EF5350'); assert.equal(native.logo, true)
    report.cases.push({ width, theme, language, geometry, panels: 4, native, cutoffPreserved: true, pass: true })
    await context.close()
  }
  assert.deepEqual(report.errors, []); assert.deepEqual(report.unexpected, [])
  report.pass = true
} catch (error) { report.pass = false; report.failure = String(error); throw error }
finally { await writeFile(new URL('report.json', out), JSON.stringify(report, null, 2)); await browser.close(); console.log(JSON.stringify(report)) }
