import assert from 'node:assert/strict'
import { chromium } from '../../web/node_modules/playwright/index.mjs'
import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const origin = 'http://127.0.0.1:5180'
const browser = await chromium.launch()
const report = { scope: 'Local UI with mixed-source fixtures; mutations intercepted, no provider requests.', cases: [], errors: [] }
const catalog = { configured:true, status:'cached', item_count:2, retrieved_at_utc:'2026-10-07T12:00:00Z', refresh_available:true, stale:false }
const instruments = ['EUR/USD','XAU/USD'].map(instrument_id => ({ instrument_id, provider:'Dukascopy', provider_id:'dukascopy-catalog', asset_class:'fx' }))
const datasets = [
  { dataset_id:'csv-v1', instrument_id:'CUSTOM', source:{provider:'local-csv'}, created_at_utc:'2026-10-06T08:00:00Z' },
  { dataset_id:'csv-v2', instrument_id:'CUSTOM', source:{provider:'local-csv'}, created_at_utc:'2026-10-08T09:00:00Z' },
  { dataset_id:'duka-v1', instrument_id:'EUR/USD', source:{provider:'Dukascopy'}, created_at_utc:'2026-10-06T10:00:00Z' },
].map(item => ({ ...item, timeframe:'M1', row_count:10, quality:{disposition:'pass'} }))

async function run(theme,width,lang='vi',empty=false) {
  const entry = {theme,width,lang,empty}; report.cases.push(entry)
  const context = await browser.newContext({ viewport:{width,height:987} })
  await context.addInitScript(({theme,lang}) => { localStorage.setItem('tw-theme',theme); localStorage.setItem('tw-language',lang) },{theme,lang})
  let posts=0, release
  await context.routeWebSocket('**/*',socket => socket.close())
  await context.route('**/*',async route => {
    const request=route.request(), url=new URL(request.url())
    if(url.origin!==origin || /^\/api\/v2\/(live|data\/(providers|market-assets))/.test(url.pathname)) return route.abort()
    if(url.pathname==='/api/v2/data/datasets') return route.fulfill({json:{items:empty?[]:datasets,catalog_items:empty?[]:instruments,catalog_state:{...catalog,item_count:empty?0:2}}})
    if(url.pathname==='/api/v2/data/downloads') return route.fulfill({json:{items:[],available:false}})
    if(url.pathname==='/api/v2/data/catalog/refresh' && request.method()==='POST') {
      posts++; await new Promise(resolve => release=resolve)
      return route.fulfill({json:{catalog_items:instruments,catalog_state:{...catalog,retrieved_at_utc:'2026-10-08T10:00:00Z'}}})
    }
    if(!['GET','HEAD','OPTIONS'].includes(request.method())) return route.abort()
    return route.continue()
  })
  const page=await context.newPage(); page.on('pageerror',error => report.errors.push(String(error)))
  const vi=lang==='vi', source=vi?'Nguồn dữ liệu':'Data source'
  const all=vi?'Tất cả nguồn':'All sources', title=vi?'Danh mục tài sản':'Asset catalog'
  const toolbar=page.locator('.data-library-toolbar'), drawer=page.getByRole('dialog',{name:title,exact:true})
  async function select(root,value) { await root.getByRole('button',{name:source,exact:true}).click(); await root.getByRole('option',{name:value,exact:true}).click() }
  try {
    await page.goto(`${origin}/?workspace=tenant-a&view=market-data&area=testing&section=market-data`)
    await toolbar.getByRole('button',{name:title,exact:true}).waitFor()
    await toolbar.getByRole('button',{name:vi?'Hiện bộ lọc dữ liệu':'Show data filters',exact:true}).click()
    if(!empty) await select(toolbar,'local-csv')
    await toolbar.getByRole('button',{name:title,exact:true}).click()
    await drawer.waitFor()
    const inside=drawer.getByRole('button',{name:source,exact:true}), outside=toolbar.getByRole('button',{name:source,exact:true})
    const count=drawer.locator('.data-library-catalog-facts dd').first()
    const refresh=drawer.getByRole('button',{name:vi?'Cập nhật danh mục':'Update catalog',exact:true})
    if(!empty) {
      assert.equal((await inside.innerText()).trim(),'local-csv')
      assert.equal((await count.innerText()).trim(),'1')
      await drawer.getByText(vi?'Lần lưu gần nhất (UTC)':'Last saved (UTC)',{exact:true}).waitFor()
      assert.match(await drawer.locator('.data-library-catalog-facts dd').nth(1).innerText(),/0?9:00/)
      assert.equal(await refresh.isDisabled(),true)
    }
    await inside.click()
    const popup=drawer.locator('.fx-select-menu'), bounds=await popup.boundingBox(), frame=await drawer.boundingBox()
    assert(bounds.x>=frame.x && bounds.x+bounds.width<=frame.x+frame.width && bounds.y+bounds.height<=987)
    await page.screenshot({path:fileURLToPath(new URL(`source-${theme}-${lang}-${width}${empty?'-empty':''}.png`,import.meta.url))})
    await page.keyboard.press('Escape'); assert.equal(await popup.count(),0); assert.equal(await drawer.isVisible(),true)
    await select(drawer,'Dukascopy')
    assert.equal((await count.innerText()).trim(),empty?'0':'2')
    assert.equal((await outside.innerText()).trim(),empty?all:'local-csv')
    assert.equal(await page.locator('.rd-table tbody tr').count(),empty?0:2)
    assert.equal(posts,0)
    if(!empty) {
      await drawer.getByRole('button',{name:vi?'Đóng':'Close',exact:true}).click()
      await toolbar.getByRole('button',{name:title,exact:true}).click()
      assert.equal((await inside.innerText()).trim(),'Dukascopy')
      await select(drawer,all); assert.equal((await count.innerText()).trim(),'3')
      assert.equal((await outside.innerText()).trim(),'local-csv')
      await drawer.getByRole('button',{name:vi?'Đóng':'Close',exact:true}).click()
      await select(toolbar,'Dukascopy')
      await toolbar.getByRole('button',{name:title,exact:true}).click()
      assert.equal((await inside.innerText()).trim(),'Dukascopy')
      await select(drawer,'local-csv')
      await drawer.getByRole('button',{name:vi?'Đóng':'Close',exact:true}).click()
      await toolbar.getByRole('button',{name:vi?'Ẩn bộ lọc dữ liệu':'Hide data filters',exact:true}).click()
      await toolbar.getByRole('button',{name:title,exact:true}).click()
      assert.equal((await inside.innerText()).trim(),all)
    }
    await refresh.click(); await drawer.locator('.data-library-update-overlay').waitFor()
    assert.equal(await drawer.getAttribute('aria-busy'),'true'); assert.equal(await inside.isDisabled(),true)
    await page.keyboard.press('Escape'); assert.equal(await drawer.isVisible(),true)
    release(); await drawer.locator('.data-library-update-overlay').waitFor({state:'detached'})
    await drawer.getByText(vi?'Đã cập nhật danh mục.':'Catalog updated.',{exact:true}).waitFor()
    assert.equal(posts,1)
    await page.keyboard.press('Escape'); await drawer.waitFor({state:'detached'})
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth<=innerWidth),true)
    entry.pass=true
  } catch(error) { entry.pass=false; entry.error=String(error); await page.screenshot({path:fileURLToPath(new URL(`FAIL-${theme}-${lang}-${width}.png`,import.meta.url))}).catch(()=>{}) }
  finally { release?.(); await context.close() }
}
try {
  for(const theme of ['dark','light']) for(const width of [360,768,1440]) await run(theme,width,width===768?'en':'vi')
  await run('dark',1440,'vi',true)
} finally {
  report.pass=report.cases.every(item=>item.pass) && !report.errors.length
  await writeFile(new URL('results.json',import.meta.url),JSON.stringify(report,null,2)); await browser.close()
  console.log(JSON.stringify(report)); if(!report.pass) process.exitCode=1
}
