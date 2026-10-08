import assert from 'node:assert/strict'
import { chromium } from '../../web/node_modules/playwright/index.mjs'
import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const out = new URL('./', import.meta.url)
const browser = await chromium.launch()
const report = { scope: 'Intercepted UI fixtures; no real API writes or CLI calls', cases: [] }
try {
  for (const width of [1710, 768, 360]) {
    const context = await browser.newContext({ viewport: {width, height:987} })
    await context.addInitScript(() => {localStorage.setItem('tw-language','vi'); localStorage.setItem('tw-theme','dark')})
    let jobs = [], saved = [], available = true, error = null, writes = []
    const asset = {instrument_id:'EUR/USD', provider:'QuantDataManager', provider_id:'qdm-catalog', asset_class:'fx'}
    const download = () => ({available, provider:'QuantDataManager', supports_full:true, supported_instruments:['EUR/USD'], earliest_dates:{'EUR/USD':'2003-05-05'}, supports_pause:false, supports_cancel:false})
    const catalog = () => ({provider:'QuantDataManager', configured:true, status:'cached', refresh_available:true, error})
    const job = {job_id:'fixture-qdm', provider:'QuantDataManager', instrument_id:'EUR/USD', status:'running', stage:'downloading', progress_scope:'phase', progress_percent:42, transferred_bytes:null, total_days:8557, completed_days:0, supports_pause:false, supports_cancel:false, from_date:'2003-05-05', to_date:'2026-10-07'}
    await context.route('**/api/**', route => {
      const path = new URL(route.request().url()).pathname
      if (route.request().method() !== 'GET') {
        writes.push(path)
        if (path.endsWith('/downloads/full')) {jobs = [job]; return route.fulfill({json:job, status:202})}
        if (path.endsWith('/catalog/refresh')) {available = true; error = null; return route.fulfill({json:{catalog_items:[asset], catalog_state:catalog(), download_state:download()}})}
        throw new Error(`Unexpected UI mutation ${path}`)
      }
      if (path.endsWith('/data/datasets')) return route.fulfill({json:{items:saved, catalog_items:[asset], catalog_state:catalog(), download_state:download()}})
      if (path.endsWith('/data/downloads')) return route.fulfill({json:{available, supports_pause:false, supports_cancel:false, items:jobs}})
      return route.fulfill({json:{items:[]}})
    })
    const page = await context.newPage(), errors = []
    page.on('pageerror', err => errors.push(String(err)))
    page.setDefaultTimeout(10000)
    const url = 'http://127.0.0.1:5180/?workspace=tenant-a&view=market-data&area=testing&section=market-data'
    await page.goto(url)
    const table = page.getByTestId('data-desk-dataset-table')
    await table.waitFor()
    await page.getByRole('button',{name:'Trạng thái tải',exact:true}).click()
    await page.getByRole('option',{name:'Chưa tải',exact:true}).click()
    await page.getByRole('button',{name:'Tải về',exact:true}).click()
    const progress = page.locator('.data-library-progress')
    await progress.waitFor()
    assert.equal(await table.locator('tbody tr td').nth(2).innerText(),'Dukascopy')
    assert.equal(await progress.locator('.data-library-progress-percent').innerText(),'42%')
    assert(!await progress.innerText().then(text => /MiB|GiB|Đang tải/.test(text)))
    assert.equal(await page.getByRole('button',{name:'Tạm dừng',exact:true}).isDisabled(),true)
    assert.equal(await page.getByRole('button',{name:'Huỷ tải',exact:true}).isDisabled(),true)
    await page.screenshot({path:fileURLToPath(new URL(`fixture-qdm-${width}.png`,out))})
    jobs = [{...job,stage:'processing',progress_percent:null}]
    await page.waitForFunction(() => document.querySelector('.data-library-progress-percent')?.textContent === '—')
    await progress.click()
    const dialog = page.getByRole('dialog')
    await dialog.waitFor()
    assert.equal(await dialog.getByRole('button',{name:'Huỷ tải',exact:true}).isDisabled(),true)
    await page.keyboard.press('Escape')
    saved = [{dataset_id:'fixture-qdm-saved',instrument_id:'EUR/USD',source:{provider:'QuantDataManager',export_settings:'{"price":"provider_default"}'},timeframe:'M1',row_count:1438,size_bytes:42000,asset_class:'fx'}]
    jobs = [{...job,status:'completed',dataset_id:'fixture-qdm-saved'}]
    await page.getByRole('button',{name:'Trạng thái tải',exact:true}).click()
    await page.getByRole('option',{name:'Đã tải',exact:true}).click()
    await page.getByRole('button',{name:'Đã tải',exact:true}).waitFor()
    assert.equal(await table.locator('tbody tr').count(),1)
    assert(!await table.locator('tbody').innerText().then(text => /Bid/.test(text)))
    await page.getByTestId('dataset-row-fixture-qdm-saved').click()
    const details=page.getByRole('dialog')
    assert.equal(await details.locator('dt').filter({hasText:'Nguồn dữ liệu'}).locator('..').locator('dd').innerText(),'Dukascopy')
    assert.equal(await details.locator('dt').filter({hasText:'Công cụ tải'}).locator('..').locator('dd').innerText(),'QuantDataManager (QDM) · CLI')
    await page.keyboard.press('Escape')
    jobs = []; saved = []; available = false; error = 'qdm_busy'
    await page.reload()
    await table.waitFor()
    await page.getByRole('button',{name:'Trạng thái tải',exact:true}).click()
    await page.getByRole('option',{name:'Chưa tải',exact:true}).click()
    assert.equal(await page.getByRole('button',{name:'Tải về',exact:true}).isDisabled(),true)
    await page.getByRole('button',{name:'Danh mục tài sản',exact:true}).click()
    await page.getByRole('button',{name:'Cập nhật danh mục',exact:true}).click()
    await page.getByText('Đã cập nhật danh mục.',{exact:true}).waitFor()
    await page.keyboard.press('Escape')
    assert.equal(await page.getByRole('button',{name:'Tải về',exact:true}).isEnabled(),true)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),false)
    assert.deepEqual(errors,[])
    assert.deepEqual(writes,['/api/v2/data/downloads/full','/api/v2/data/catalog/refresh'])
    report.cases.push({width,pass:true,checks:['download POST','phase progress','unknown bytes/speed/ETA','disabled pause/cancel','automatic completed reload','provider label','busy recovery via catalog refresh','no page overflow']})
    await context.close()
  }
  report.pass = true
} catch (error) {report.pass = false; report.error = String(error); process.exitCode = 1}
finally {await writeFile(new URL('progress-qa.json',out),JSON.stringify(report,null,2)); await browser.close(); console.log(JSON.stringify(report))}
