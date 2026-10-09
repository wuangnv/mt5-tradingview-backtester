import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { chromium } from '../../../web/node_modules/playwright/index.mjs'

const out = new URL('.', import.meta.url)
const origin = 'http://127.0.0.1:5180'
const results = [], errors = [], attemptedWrites = [], forwardedWrites = []
const browser = await chromium.launch()
try {
  for (const theme of ['dark', 'light']) for (const width of [1710, 360]) {
    const context = await browser.newContext({ viewport: { width, height: 987 }, hasTouch: width === 360 })
    await context.addInitScript(theme => { localStorage.setItem('tw-theme', theme); localStorage.setItem('tw-language', 'vi') }, theme)
    await context.route('**/*', route => {
      const request = route.request(), url = new URL(request.url())
      if (url.origin !== origin) return route.abort()
      if (request.method() === 'POST' && url.pathname === '/api/v2/data/csv/preview') {
        attemptedWrites.push({ theme, width, url: request.url(), disposition: 'fixture fulfilled; never forwarded' })
        return route.fulfill({ json: { preview: { row_count: 2, unique_row_count: 2, quality: { disposition: 'review', gaps: [] }, available_range: {} } } })
      }
      if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) { attemptedWrites.push({ url: request.url(), disposition: 'aborted' }); return route.abort() }
      return route.continue()
    })
    const page = await context.newPage()
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(`${origin}/?workspace=tenant-a&area=testing&view=market-data`)
    await page.getByRole('button', { name: 'Nhập CSV', exact: true }).click()
    await page.getByTestId('data-desk-file-input').setInputFiles({ name: 'alignment-fixture.csv', mimeType: 'text/csv', buffer: Buffer.from('time,open,high,low,close\n1704067200,1,2,1,2\n1704070800,2,3,2,3\n') })
    await page.getByTestId('data-desk-preview-button').click()
    const label = page.locator('.rd-import-review-check')
    await label.waitFor()
    const geometry = await label.evaluate(e => {
      const mark = e.querySelector('input'), b = mark.getBoundingClientRect(), row = e.getBoundingClientRect()
      const textNode = [...e.childNodes].find(n => n.nodeType === Node.TEXT_NODE && n.textContent.trim())
      const range = document.createRange(); range.selectNodeContents(textNode)
      const text = range.getClientRects()[0]
      return { margin: getComputedStyle(mark).margin, gap: text.x - b.right, firstLineCenterDelta: b.y + b.height / 2 - text.y - text.height / 2, labelHeight: row.height, markTop: b.y - row.y }
    })
    assert.equal(geometry.margin, '0px'); assert.equal(geometry.gap, 8)
    assert.ok(Math.abs(geometry.firstLineCenterDelta) < 1)
    results.push({ theme, width, geometry, forwardedWrites: [] })
    await page.locator('.data-library-dialog').screenshot({ path: new URL(`csv-review-${theme}-${width}.png`, out).pathname.replace(/^\/(\w:)/, '$1') })
    await page.goto(`${origin}/?workspace=tenant-a&area=testing&view=journal&session=fixture-alignment`)
    const journal = await page.locator('.ja-filter-toggle').evaluate(e => {
      const mark = e.querySelector('input'), b = mark.getBoundingClientRect(), row = e.getBoundingClientRect()
      const range = document.createRange(); range.selectNodeContents([...e.childNodes].find(n => n !== mark && n.textContent.trim()))
      const text = range.getBoundingClientRect()
      return { margin: getComputedStyle(mark).margin, gap: text.x - b.right, centerDelta: b.y + b.height / 2 - row.y - row.height / 2 }
    })
    assert.equal(journal.margin, '0px'); assert.equal(journal.gap, 8); assert.ok(Math.abs(journal.centerDelta) < 1)
    results.push({ theme, width, journal })
    await context.close()
  }
  assert.equal(attemptedWrites.length, 4); assert.deepEqual(errors, [])
  await fs.writeFile(new URL('conditional-review.json', out), JSON.stringify({ scope: 'CSV review fixture POST is intercepted, never forwarded; Journal is local read-only', results, attemptedWrites, forwardedWrites, errors }, null, 2))
  console.log('8 conditional CSV/Journal geometry checks PASS; 0 forwarded writes')
} finally { await browser.close() }
