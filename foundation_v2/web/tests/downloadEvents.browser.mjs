import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'

const origin = process.env.TW_UI_ORIGIN || 'http://127.0.0.1:5180'
assert.equal(new URL(origin).hostname, '127.0.0.1')
const output = new URL('../../evidence/client-navigation-20261009/', import.meta.url)
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ headless: true })
const report = { scope: 'Actual DataDesk React consumer + SSE parser with labeled in-browser stream/API fixtures; no provider/DB/broker calls', pageErrors: [] }
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  page.setDefaultTimeout(8000)
  page.on('pageerror', error => report.pageErrors.push(error.message))
  const workspace = 'download-stream-fixture'
  const job = { job_id: 'sse-fixture', instrument_id: 'EUR/USD', provider: 'QuantDataManager', download_engine: 'QuantDataManager', status: 'running', stage: 'downloading', progress_scope: 'phase', progress_percent: 12, from_date: '2026-10-01', to_date: '2026-10-07', supports_pause: false, supports_cancel: false }
  let downloads = 0
  await page.addInitScript(() => {
    const nativeFetch = window.fetch
    window.__streamFixture = { opens: 0, active: 0, workspace: null }
    window.fetch = (input, options) => {
      if (String(input) !== '/api/v2/events') return nativeFetch(input, options)
      const fixture = window.__streamFixture
      fixture.opens++; fixture.active++; fixture.workspace = options.headers['X-Workspace-Id']
      let controller
      const body = new ReadableStream({ start(value) { controller = value }, cancel() { fixture.active = 0 } })
      fixture.push = data => controller.enqueue(new TextEncoder().encode(`event: snapshot\ndata: ${JSON.stringify(data)}\n\n`))
      fixture.end = () => controller.close()
      options.signal.addEventListener('abort', () => { fixture.active = 0; try { controller.error(new DOMException('Aborted', 'AbortError')) } catch {} }, { once: true })
      return Promise.resolve(new Response(body, { headers: { 'Content-Type': 'text/event-stream' } }))
    }
  })
  await page.route('**/api/**', route => {
    const request = route.request()
    assert.equal(request.method(), 'GET')
    const path = new URL(request.url()).pathname
    if (path.endsWith('/data/datasets')) return route.fulfill({ json: { items: [], catalog_items: [{ instrument_id: 'EUR/USD', provider: 'QuantDataManager', download_engine: 'QuantDataManager', asset_class: 'fx', available_from_date: '2003-05-05' }], catalog_state: { status: 'cached', configured: false } } })
    if (path.endsWith('/data/downloads')) { downloads++; return route.fulfill({ json: { available: true, items: [{ ...job, progress_percent: downloads === 1 ? 12 : 65 }], supports_pause: false, supports_cancel: false } }) }
    return route.fulfill({ json: { items: [] } })
  })
  await page.goto(`${origin}/?workspace=${workspace}&view=market-data&area=testing&section=market-data`)
  await page.getByRole('button', { name: 'Trạng thái tải', exact: true }).click()
  await page.getByRole('option', { name: 'Đang tải', exact: true }).click()
  const bar = page.locator('.data-library-progress').getByRole('progressbar')
  await bar.waitFor()
  assert.equal(await bar.getAttribute('aria-valuenow'), '12')
  await page.waitForFunction(() => Boolean(window.__streamFixture.push))
  await page.evaluate(data => window.__streamFixture.push(data), { schema_version: 'workspace-events-v1', workspace_id: workspace, downloads: { qdm: { jobs: [{ ...job, progress_percent: 47 }] }, dukascopy: { jobs: [] } } })
  await page.waitForFunction(() => document.querySelector('.data-library-progress [role="progressbar"]')?.getAttribute('aria-valuenow') === '47')
  await page.waitForTimeout(2200) // Observe beyond the old active-job polling interval.
  assert.equal(downloads, 1, 'A healthy stream suppresses repeated progress GETs')
  const recovery = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/data/downloads'))
  await page.evaluate(() => window.__streamFixture.end())
  await recovery
  await page.waitForFunction(() => document.querySelector('.data-library-progress [role="progressbar"]')?.getAttribute('aria-valuenow') === '65')
  await page.locator('.fx-subnav a[href*="view=overview"]').click()
  await page.waitForURL(url => url.searchParams.get('view') === 'overview')
  await page.waitForFunction(() => window.__streamFixture.active === 0)
  assert.deepEqual(report.pageErrors, [])
  report.status = 'pass'; report.downloadGets = downloads; report.healthyProgress = 47; report.fallbackProgress = 65; report.unmountedStreamClosed = true
  await context.close()
} catch (error) { report.status = 'fail'; report.error = error.stack; throw error }
finally {
  await writeFile(new URL('download-events.json', output), JSON.stringify(report, null, 2))
  await browser.close()
  console.log(JSON.stringify(report))
}
