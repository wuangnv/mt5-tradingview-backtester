import { chromium } from '../../../web/node_modules/playwright/index.mjs'
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
const blocked = [], errors = []
await context.route('**/*', route => {
  const request = route.request(), url = new URL(request.url())
  if (!['127.0.0.1', 'localhost'].includes(url.hostname) || !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
    blocked.push(url.href)
    return route.abort()
  }
  if (url.pathname === '/api/v2/data/market-assets') return route.fulfill({ json: {
    status: 'ready', source: 'Explicit QA fixture', items: [{ enabled: true, symbol: 'QA', dataset_id: 'qa', first_timestamp: 0, last_timestamp: 60, row_count: 1, status: 'ready', metadata: { group: 'Forex' } }],
  } })
  return route.continue()
})
const page = await context.newPage()
page.on('pageerror', error => errors.push(error.message))
try {
  await page.goto('http://127.0.0.1:5180/?workspace=tenant-a&view=data')
  const pager = page.locator('.market-assets .fxa-pagination')
  await pager.waitFor()
  const geometry = await pager.evaluate(element => ({
    display: getComputedStyle(element).display,
    height: element.getBoundingClientRect().height,
    selectWidth: element.querySelector('.fx-select').getBoundingClientRect().width,
    width: element.getBoundingClientRect().width,
  }))
  assert.equal(geometry.display, 'flex')
  assert.equal(geometry.height, 56)
  assert.ok(geometry.selectWidth < 80)
  assert.deepEqual(errors, [])
  assert.deepEqual(blocked, [])
  await writeFile(new URL('./datadesk-style.json', import.meta.url), JSON.stringify({ geometry, errors, blocked, fixture: 'explicit intercepted catalog; canonical view=data without area opt-in' }, null, 2))
  console.log(geometry)
} finally { await browser.close() }
