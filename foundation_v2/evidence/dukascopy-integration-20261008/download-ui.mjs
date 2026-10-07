import assert from 'node:assert/strict'
import { chromium } from '../../web/node_modules/playwright/index.mjs'
import { fileURLToPath } from 'node:url'
import { writeFile } from 'node:fs/promises'

const origin = 'http://127.0.0.1:5180', href = `${origin}/?workspace=tenant-a&view=market-data&area=testing&section=market-data`
const report = { scope:'Mocked download API; no historical downloads or product writes',cases:[],errors:[] }
const browser = await chromium.launch({headless:true})
const job = { job_id:'qa-job',instrument_id:'EUR/USD',from_date:'2026-09-01',to_date:'2026-09-02',status:'paused',completed_days:1,total_days:2,error:'source_rate_limited',dataset_id:null,retry_after_seconds:0 }
try {
  for (const [width,theme,language] of [[1710,'dark','vi'],[390,'dark','vi'],[1710,'light','en'],[390,'light','en']]) {
    const result = {width,theme,language}, context = await browser.newContext({viewport:{width,height:987}})
    report.cases.push(result)
    let jobs = [], complete = false, datasetReads = 0, downloadReads = 0, failStart = false, actionError = false
    const writes = []
    await context.addInitScript(({theme,language}) => {localStorage.setItem('tw-theme',theme); localStorage.setItem('tw-language',language)}, {theme,language})
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url()), path = url.pathname
      if (!['http://127.0.0.1:5180','http://127.0.0.1:8010'].includes(url.origin)) return route.abort()
      if (path === '/api/v2/data/datasets') {
        datasetReads++
        return route.fulfill({json:{items:complete ? [{dataset_id:'qa-dataset',instrument_id:'EUR/USD',provider_id:'dukascopy',asset_class:'fx',timeframe:'1m',row_count:2,source:{provider:'dukascopy'},quality:{disposition:'review',gaps:[{from_utc:'2026-09-01T00:01:00Z',to_utc:'2026-09-01T00:05:00Z'}],duplicates:0}}] : [],catalog_items:[{instrument_id:'EUR/USD',name:'Euro vs US Dollar',provider_id:'dukascopy',asset_class:'fx'},{instrument_id:'UNKNOWN',provider_id:'other',asset_class:'stock'}],catalog_state:{status:'cached',configured:true,refresh_available:true,stale:false},download_state:{available:true,supported_instruments:['EUR/USD'],earliest_dates:{'EUR/USD':'2003-05-05'}}}})
      }
      if (path === '/api/v2/data/downloads' && request.method() === 'GET') { downloadReads++; return route.fulfill({json:{items:jobs,available:true}}) }
      if (path === '/api/v2/data/downloads' && request.method() === 'POST') {
        writes.push({workspace:request.headers()['x-workspace-id'],body:request.postDataJSON()})
        if (failStart) return route.fulfill({status:409,json:{detail:'download_busy'}})
        jobs = [{...job,...request.postDataJSON(),status:'running',error:null,completed_days:0}]
        return route.fulfill({status:202,json:{job:jobs[0]}})
      }
      if (path.endsWith('/resume')) {
        if (actionError) return route.fulfill({status:409,json:{detail:'download_cooldown'}})
        jobs = [{...jobs[0],status:'running',error:null}]
        return route.fulfill({status:202,json:{job:jobs[0]}})
      }
      if (path.endsWith('/cancel')) {jobs = [{...jobs[0],status:'cancelled',error:null}]; return route.fulfill({json:{job:jobs[0]}})}
      if (!['GET','HEAD'].includes(request.method())) return route.abort()
      return route.continue()
    })
    const page = await context.newPage()
    page.on('pageerror',error => report.errors.push(String(error)))
    try {
      await page.goto(href)
      const root = page.getByTestId('data-desk-root'), row = root.getByRole('row').filter({hasText:'Euro vs US Dollar'}), download = row.locator('.data-library-download')
      await download.waitFor()
      assert.equal(await download.isEnabled(),true)
      assert.equal(await root.getByRole('row').filter({hasText:'UNKNOWN'}).locator('.data-library-download').isDisabled(),true)
      await download.click()
      const dialog = page.locator('dialog[open]'), dates = dialog.locator('input[type=date]')
      await dialog.waitFor()
      assert.equal(await dates.count(),2)
      await dates.nth(0).fill('2026-09-01'); await dates.nth(1).fill('2026-09-02')
      const submit = dialog.locator('button[type=submit]')
      failStart = true; await submit.click()
      await dialog.getByRole('alert').waitFor()
      assert.match(await dialog.getByRole('alert').innerText(),language === 'vi' ? /Đang có một lượt tải khác/ : /Another download/)
      failStart = false; await submit.click()
      await dialog.waitFor({state:'hidden'})
      await page.locator('[data-testid="download-job-qa-job"] progress').waitFor()
      assert.equal(await download.isDisabled(),true)
      assert.deepEqual(writes.at(-1),{workspace:'tenant-a',body:{instrument_id:'EUR/USD',from_date:'2026-09-01',to_date:'2026-09-02'}})
      jobs = [{...jobs[0],status:'completed',completed_days:2,dataset_id:'qa-dataset'}]; complete = true
      await page.locator('[data-testid="dataset-row-qa-dataset"]').waitFor()
      const beforeReads = downloadReads, beforeCatalog = datasetReads
      await page.waitForTimeout(2400)
      assert.equal(downloadReads,beforeReads,'no idle download polling')
      assert.equal(datasetReads,beforeCatalog,'completed job reloads dataset once')
      assert.equal(await root.locator('.data-library-download').first().isDisabled(),true)
      assert.match(await root.locator('.rd-badge').first().innerText(),language === 'vi' ? /Cần kiểm tra chất lượng/ : /Quality review required/)
      await page.locator('[data-testid="dataset-row-qa-dataset"]').click()
      await page.locator('dialog[open]').waitFor()
      const gaps = page.locator('dialog[open] dl > div').filter({has:page.locator('dt',{hasText:language === 'vi' ? 'Khoảng trống dữ liệu' : 'Data gaps'})})
      assert.equal(await gaps.locator('dd').innerText(),'1')
      await page.keyboard.press('Escape'); await dialog.waitFor({state:'hidden'})
      await root.locator('.data-library-more').first().click()
      const another = page.getByRole('menuitem',{name:language === 'vi' ? 'Tải khoảng khác' : 'Download another range'})
      await another.click(); await dialog.waitFor()
      assert.match(await dialog.innerText(),/M1 · Bid · UTC/)
      const bounds = await dialog.boundingBox(); assert(bounds.x >= 0 && bounds.x+bounds.width <= width+1)
      await page.screenshot({path:fileURLToPath(new URL(`download-${theme}-${language}-${width}.png`,import.meta.url)),fullPage:true})
      await page.keyboard.press('Escape'); await dialog.waitFor({state:'hidden'})
      jobs = [{...job}]; complete = false
      await page.reload()
      const status = page.locator('[data-testid="download-job-qa-job"]')
      const resume = status.getByRole('button',{name:language === 'vi' ? 'Tiếp tục tải' : 'Resume download'})
      await resume.waitFor()
      assert.equal(await resume.isEnabled(),true)
      actionError = true; await resume.click()
      await root.getByRole('alert').waitFor()
      assert.match(await root.getByRole('alert').innerText(),language === 'vi' ? /Chưa hết thời gian chờ/ : /waiting period/)
      actionError = false; await resume.click()
      await status.locator('progress').waitFor()
      await status.getByRole('button',{name:language === 'vi' ? 'Huỷ tải' : 'Cancel download'}).click()
      await status.locator('progress').waitFor({state:'hidden'})
      assert.match(await status.innerText(),language === 'vi' ? /Đã huỷ tải/ : /Download cancelled/)
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth+1)
      assert.equal(overflow,false)
      result.pass = true; result.requests = {datasetReads,downloadReads}
    } catch (error) {result.pass = false; result.error=String(error)}
    finally {await context.close()}
  }
} finally {await browser.close()}
await writeFile(new URL('download-ui-report.json',import.meta.url),JSON.stringify(report,null,2))
console.log(JSON.stringify(report))
if (report.errors.length || report.cases.some(item => !item.pass)) process.exitCode=1
