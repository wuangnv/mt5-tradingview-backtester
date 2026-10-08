import assert from 'node:assert/strict'
import { chromium } from '../../web/node_modules/playwright/index.mjs'
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

// Payload captured by the real API test in a disposable database; UI mutations remain fixtures.
const payload = JSON.parse(await readFile(new URL('../../.runtime/qdm-catalog-qa.json', import.meta.url),'utf8'))
assert.equal(payload.catalog_items.length,725)
const browser = await chromium.launch()
const report = {scope:'Real catalog payload; intercepted UI API. No download commands from browser.',cases:[]}
try {
  for (const width of [1710,768,360]) {
    const context = await browser.newContext({viewport:{width,height:987}})
    await context.addInitScript(() => {localStorage.setItem('tw-language','vi');localStorage.setItem('tw-theme','dark')})
    let state = structuredClone(payload), failRefresh = false
    await context.route('**/api/**', route => {
      const path = new URL(route.request().url()).pathname
      if (path.endsWith('/data/catalog/refresh')) {
        state.catalog_state = {...payload.catalog_state, error:failRefresh ? 'qdm_catalog_invalid' : null, stale:failRefresh}
        state.download_state = {...payload.download_state, available:!failRefresh}
        return route.fulfill({json:state})
      }
      if (route.request().method() !== 'GET') throw new Error(`Unexpected mutation: ${path}`)
      if (path.endsWith('/data/datasets')) return route.fulfill({json:state})
      if (path.endsWith('/data/downloads')) return route.fulfill({json:{available:true,supports_pause:false,supports_cancel:false,items:[]}})
      return route.fulfill({json:{items:[]}})
    })
    const page = await context.newPage(), errors=[]
    page.on('pageerror',e=>errors.push(String(e)))
    page.setDefaultTimeout(10000)
    const url='http://127.0.0.1:5180/?workspace=tenant-a&view=market-data&area=testing&section=market-data'
    await page.goto(url+'&mode=backtest')
    const table=page.getByTestId('data-desk-dataset-table')
    await table.waitFor()
    await page.getByText('Không có dữ liệu phù hợp bộ lọc.',{exact:true}).waitFor()
    assert.equal(await page.getByRole('button',{name:'Trạng thái tải',exact:true}).innerText(),'Đã tải')
    const select = async (label,option) => {
      await page.getByRole('button',{name:label,exact:true}).click()
      await page.getByRole('option',{name:option,exact:true}).click()
    }
    await select('Trạng thái tải','Chưa tải')
    assert.equal(await table.locator('tbody tr').count(),25)
    const first=await table.locator('tbody tr').first().innerText()
    await page.getByRole('button',{name:'Trang sau',exact:true}).click()
    assert.notEqual(await table.locator('tbody tr').first().innerText(),first)
    if (width > 720) {
      await page.getByRole('button',{name:'Trang cuối',exact:true}).click()
      assert.equal(await table.locator('tbody tr').count(),25)
    } else {
      await page.getByRole('button',{name:'Trang sau',exact:true}).click()
      assert.equal(await page.getByRole('button',{name:'Trang 3',exact:true}).getAttribute('aria-current'),'page')
    }
    await select('Danh mục','Cổ phiếu')
    await page.getByRole('searchbox').fill('apple')
    await page.getByText('AAPLUSUSD',{exact:true}).waitFor()
    assert.equal(await table.locator('tbody tr').count(),1)
    assert.equal(await table.locator('tbody tr td').nth(1).innerText(),'Cổ phiếu')
    assert.equal(await table.locator('tbody tr td').nth(2).innerText(),'Dukascopy')
    assert.equal(await table.locator('tbody tr td').nth(4).innerText(),'26/01/2017')
    assert.equal(await table.locator('tbody tr td').nth(6).innerText(),'—')
    await select('Nguồn dữ liệu','Dukascopy')
    await page.getByRole('button',{name:'Danh mục tài sản',exact:true}).click()
    let dialog=page.getByRole('dialog')
    await dialog.waitFor()
    assert.equal(await dialog.getByRole('button',{name:'Nguồn dữ liệu',exact:true}).innerText(),'Dukascopy')
    assert.equal(await dialog.locator('dd').first().innerText(),'QuantDataManager (QDM) · CLI')
    assert.equal(await dialog.locator('dd').nth(1).innerText(),'725')
    await dialog.getByText('Đọc danh mục Dukascopy từ bộ cài QDM. Dùng chung cho Backtest và Prop firm.',{exact:true}).waitFor()
    await page.screenshot({path:fileURLToPath(new URL(`drawer-${width}.png`,import.meta.url))})
    failRefresh=true
    await dialog.getByRole('button',{name:'Cập nhật danh mục',exact:true}).click()
    await dialog.getByText('Danh mục trong bộ cài QDM không hợp lệ. Giữ danh sách đã đọc thành công trước đó.',{exact:true}).waitFor()
    await page.keyboard.press('Escape')
    assert.equal(await page.getByRole('button',{name:'Tải về',exact:true}).isDisabled(),true)
    assert.equal(await table.locator('tbody tr').count(),1)
    await page.getByRole('button',{name:'Danh mục tài sản',exact:true}).click()
    failRefresh=false
    await page.getByRole('dialog').getByRole('button',{name:'Cập nhật danh mục',exact:true}).click()
    await page.getByRole('dialog').getByText('Đã cập nhật danh mục.',{exact:true}).waitFor()
    await page.keyboard.press('Escape')
    assert.equal(await page.getByRole('button',{name:'Tải về',exact:true}).isEnabled(),true)
    await page.screenshot({path:fileURLToPath(new URL(`stock-${width}.png`,import.meta.url))})
    await page.goto(url+'&mode=prop')
    await table.waitFor()
    await select('Trạng thái tải','Chưa tải')
    await page.getByRole('button',{name:'Danh mục tài sản',exact:true}).click()
    assert.equal(await page.getByRole('dialog').locator('dd').nth(1).innerText(),'725')
    await page.keyboard.press('Escape')
    state={...state,catalog_items:[],catalog_state:{...state.catalog_state,status:'unavailable',error:'qdm_catalog_missing',configured:false,refresh_available:false},download_state:{available:false,supported_instruments:[]}}
    await page.reload()
    await page.getByText('Không tìm thấy danh mục Dukascopy trong bộ cài QDM. Kiểm tra lại bộ cài.',{exact:false}).waitFor()
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
    assert.deepEqual(errors,[])
    report.cases.push({width,pass:true,checks:['default downloaded/empty','725 asset pagination','stock category/name search','Dukascopy source/QDM engine/M1 metadata/unknown row count','drawer count and shared scope','invalid refresh retains list and blocks downloads','refresh recovery','mode URLs share catalog','missing installation/no page overflow']})
    await context.close()
  }
  report.pass=true
} catch(e) {report.pass=false;report.error=String(e);process.exitCode=1}
finally {await writeFile(new URL('qa.json',import.meta.url),JSON.stringify(report,null,2));await browser.close();console.log(JSON.stringify(report))}
