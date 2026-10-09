import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'

const out = '../evidence/qdm-progress-ui-20261009'
await mkdir(out, { recursive:true })
const url = 'http://127.0.0.1:5180/?workspace=tenant-a&view=market-data&area=testing&section=market-data'
const browser = await chromium.launch(), results = []
try {
  for (const width of [1710, 360]) for (const scenario of ['qdm-known', 'qdm-unknown', 'native']) {
    const engine = scenario === 'native' ? 'Dukascopy' : 'QuantDataManager'
    const job = { job_id:'fixture', instrument_id:'EUR/USD', provider:engine, download_engine:engine,
      status:'running', stage:'downloading', from_date:'2003-05-05', to_date:'2026-10-07',
      progress_scope:scenario === 'native' ? 'days' : 'phase', progress_percent:scenario === 'qdm-unknown' ? null : 12,
      transferred_bytes:scenario === 'qdm-unknown' ? null : 600000000, total_bytes:1000000000,
      bytes_per_second:48000000, estimated_seconds_remaining:600, completed_days:10, total_days:100,
      supports_pause:false, supports_cancel:false }
    const page = await browser.newPage({ viewport:{ width, height:987 } }), errors = []
    page.setDefaultTimeout(8000)
    page.on('pageerror', error => errors.push(error.message))
    await page.addInitScript(() => localStorage.setItem('tw-theme','dark'))
    await page.route('**/api/**', route => {
      assert.equal(route.request().method(), 'GET')
      const path = new URL(route.request().url()).pathname
      if (path.endsWith('/data/datasets')) return route.fulfill({ json:{ items:[], catalog_items:[{
        instrument_id:'EUR/USD', provider:engine, download_engine:engine, asset_class:'fx', available_from_date:'2003-05-05',
      }], catalog_state:{ status:'cached', configured:false } } })
      if (path.endsWith('/data/downloads')) return route.fulfill({ json:{ available:true, items:[job], supports_pause:false, supports_cancel:false } })
      return route.fulfill({ json:{ items:[] } })
    })
    await page.goto(url)
    await page.getByRole('button', { name:'Trạng thái tải', exact:true }).click()
    await page.getByRole('option', { name:'Đang tải', exact:true }).click()
    const control = page.locator('.data-library-progress')
    await control.waitFor()
    const bar = control.getByRole('progressbar')
    assert.equal(await bar.getAttribute('aria-valuenow'), scenario === 'qdm-unknown' ? null : '12')
    if (scenario === 'native') {
      assert.match(await control.innerText(), /0,6\/1 GB @ 48 MB\/s/)
      assert.match(await control.innerText(), /10 phút/)
    } else {
      assert.equal(await control.innerText(), '')
      assert.equal(await control.locator('.data-library-progress-meta').count(), 0)
      assert.doesNotMatch(await control.getAttribute('aria-label'), /MB|GB|Thời gian còn lại|—/)
      assert.doesNotMatch(await control.getAttribute('title'), /Dung lượng|tốc độ|thời gian còn lại/)
    }
    await control.click()
    const dialog = page.getByRole('dialog', { name:'Tiến độ tải dữ liệu', exact:true })
    await dialog.waitFor()
    const text = await dialog.innerText()
    if (scenario === 'native') assert.match(text, /Dung lượng đã tải/)
    else assert.doesNotMatch(text, /Dung lượng đã tải|Tổng dung lượng|\/ 100 ngày/)
    await dialog.getByRole('button', { name:'Đóng', exact:true }).click()
    if (scenario === 'qdm-unknown') await page.screenshot({ path:`${out}/qdm-${width}.png` })
    assert.deepEqual(errors, [])
    results.push({ width, scenario, pass:true })
    await page.close()
  }
  const page = await browser.newPage()
  await page.route('**/api/**', route => route.request().method() === 'GET' ? route.continue() : route.abort())
  await page.goto(url)
  const rows = page.getByTestId('data-desk-dataset-table').locator('tbody tr')
  await rows.first().waitFor()
  assert.match(await rows.first().locator('td').nth(7).innerText(), /(?:KB|MB|GB)/)
  results.push({ scope:'live saved dataset size', pass:true })
} finally {
  await browser.close()
  await writeFile(`${out}/report.json`, JSON.stringify(results, null, 2))
}
console.log(JSON.stringify(results))
