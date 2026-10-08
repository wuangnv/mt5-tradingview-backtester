import assert from 'node:assert/strict'
import {chromium} from '../../../web/node_modules/playwright/index.mjs'
import {mkdir,writeFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
const origin='http://127.0.0.1:5180',out=new URL('./',import.meta.url)
await mkdir(out,{recursive:true});const browser=await chromium.launch(),report={cases:[],errors:[],scope:'Explicit browser dataset/catalog/download fixtures; catalog POST mocked; all unrelated mutations/provider/live blocked'}
async function run(theme,width){
 const c={theme,width};report.cases.push(c)
 const context=await browser.newContext({viewport:{width,height:987}});context.setDefaultTimeout(7000)
 await context.addInitScript(theme=>{localStorage.setItem('tw-theme',theme);localStorage.setItem('tw-language','vi')},theme)
 const assets=[{instrument_id:'EURUSD',provider:'Dukascopy',provider_id:'dukascopy-catalog',asset_class:'fx'},{instrument_id:'XAUUSD',provider:'Dukascopy',provider_id:'dukascopy-catalog',asset_class:'metal'}]
 const dataset=(id,symbol,created,retrieved)=>({dataset_id:id,instrument_id:symbol,timeframe:'M1',row_count:50,asset_class:'fx',created_at_utc:created,source:{provider:'local-csv',retrieved_at_utc:retrieved},quality:{disposition:'pass'}})
 const datasets=[dataset('csv-old','GBPUSD','2026-10-07T09:00:00Z'),dataset('csv-new','GBPUSD','2026-10-08T11:00:00Z'),dataset('csv-aud','AUDUSD',null,'2026-10-08T10:00:00Z')]
 let catalog={configured:true,status:'cached',item_count:2,refresh_available:true,retrieved_at_utc:'2026-10-08T03:00:00Z'},posts=0
 await context.routeWebSocket('**/*',socket=>socket.close())
 await context.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url())
  if(url.origin!==origin||/^\/api\/v2\/(live|data\/(providers|market-assets|categories))/.test(url.pathname))return route.abort()
  if(url.pathname==='/api/v2/data/catalog/refresh'){
   posts++;catalog={...catalog,retrieved_at_utc:'2026-10-08T12:00:00Z'};return route.fulfill({contentType:'application/json',body:JSON.stringify({catalog_items:assets,catalog_state:catalog})})
  }
  if(!['GET','HEAD','OPTIONS'].includes(req.method()))return route.abort()
  if(url.pathname==='/api/v2/data/datasets')return route.fulfill({contentType:'application/json',body:JSON.stringify({items:datasets,catalog_items:assets,catalog_state:catalog,download_state:{available:false}})})
  if(url.pathname==='/api/v2/data/downloads')return route.fulfill({contentType:'application/json',body:'{"items":[],"available":false}'})
  return route.continue()
 })
 const page=await context.newPage();page.on('pageerror',e=>report.errors.push(String(e)))
 try{
  await page.goto(`${origin}/?workspace=tenant-a&view=market-data&area=testing&section=market-data`)
  const opener=page.getByRole('button',{name:'Danh mục tài sản',exact:true}),drawer=page.getByRole('dialog',{name:'Danh mục tài sản',exact:true}),close=drawer.getByRole('button',{name:'Đóng',exact:true}),internal=drawer.getByRole('button',{name:'Nguồn dữ liệu',exact:true}),outside=page.locator('.data-library-toolbar').getByRole('button',{name:'Nguồn dữ liệu',exact:true}),refresh=drawer.getByRole('button',{name:'Cập nhật danh mục',exact:true})
  await opener.waitFor();assert.equal(await page.locator('.rd-table tbody tr').count(),5)
  await opener.click();assert.equal(posts,0);assert.match(await internal.innerText(),/Tất cả nguồn/);assert.equal(await drawer.locator('dd').nth(0).innerText(),'4');assert.match(await drawer.locator('dt').nth(1).innerText(),/Cập nhật Dukascopy/);assert.match(await drawer.locator('dd').nth(1).innerText(),/03:00/)
  await internal.click();const menu=drawer.locator('.fx-select-menu');assert.equal(await menu.evaluate(e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth}),true)
  await page.keyboard.press('Escape');assert.equal(await menu.count(),0);assert.equal(await drawer.getAttribute('open'),'')
  await close.click();await page.getByRole('button',{name:'Hiện bộ lọc dữ liệu',exact:true}).click();await outside.click();await page.getByRole('option',{name:'local-csv',exact:true}).click();assert.equal(await page.locator('.rd-table tbody tr').count(),3)
  await opener.click();assert.match(await internal.innerText(),/local-csv/);assert.equal(await drawer.locator('dd').nth(0).innerText(),'2');assert.match(await drawer.locator('dt').nth(1).innerText(),/Lần lưu gần nhất/);assert.match(await drawer.locator('dd').nth(1).innerText(),/11:00/);assert.equal(await refresh.isDisabled(),true);await refresh.evaluate(e=>e.click());assert.equal(posts,0)
  await internal.click();await drawer.getByRole('option',{name:'Dukascopy',exact:true}).click();assert.equal(await refresh.isDisabled(),false);assert.equal(await drawer.locator('dd').nth(0).innerText(),'2');assert.match(await drawer.locator('dd').nth(1).innerText(),/03:00/)
  await close.click();assert.match(await outside.innerText(),/local-csv/);assert.equal(await page.locator('.rd-table tbody tr').count(),3)
  await opener.click();assert.match(await internal.innerText(),/Dukascopy/);await close.click()
  await outside.click();await page.getByRole('option',{name:'Tất cả nguồn',exact:true}).click();assert.equal(await page.locator('.rd-table tbody tr').count(),5)
  await opener.click();assert.match(await internal.innerText(),/Tất cả nguồn/);assert.equal(await drawer.locator('dd').nth(0).innerText(),'4')
  await internal.focus();await page.keyboard.press('ArrowDown');await page.keyboard.press('End');await page.keyboard.press('Enter');assert.match(await internal.innerText(),/local-csv/)
  await close.click();assert.match(await outside.innerText(),/Tất cả nguồn/);assert.equal(await page.locator('.rd-table tbody tr').count(),5)
  await outside.click();await page.getByRole('option',{name:'Dukascopy',exact:true}).click();assert.equal(await page.locator('.rd-table tbody tr').count(),2)
  await opener.click();assert.match(await internal.innerText(),/Dukascopy/);await refresh.click();await page.waitForFunction(()=>document.querySelector('.data-library-catalog-drawer')?.getAttribute('aria-busy')==='false');assert.equal(posts,1);assert.match(await drawer.locator('dd').nth(1).innerText(),/12:00/)
  await page.screenshot({path:fileURLToPath(new URL(`source-${theme}-${width}.png`,out))});await page.keyboard.press('Escape');assert.equal(await opener.evaluate(e=>document.activeElement===e),true);assert.match(await outside.innerText(),/Dukascopy/);assert.equal(await page.locator('.rd-table tbody tr').count(),2)
  await page.getByRole('button',{name:'Ẩn bộ lọc dữ liệu',exact:true}).click();assert.equal(await page.locator('.rd-table tbody tr').count(),5);await opener.click();assert.match(await internal.innerText(),/Tất cả nguồn/);await close.click()
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);c.posts=posts;c.pass=true
 }catch(e){c.pass=false;c.error=String(e);await page.screenshot({path:fileURLToPath(new URL(`FAIL-${theme}-${width}.png`,out))}).catch(()=>{})}
 finally{await context.close()}
}
try{for(const theme of ['dark','light'])for(const width of [360,1440])await run(theme,width)}
finally{report.pass=report.cases.every(c=>c.pass)&&!report.errors.length;await writeFile(new URL('results.json',out),JSON.stringify(report,null,2));await browser.close();console.log(JSON.stringify({pass:report.pass,cases:report.cases.length,failures:report.cases.filter(c=>!c.pass),errors:report.errors}));if(!report.pass)process.exitCode=1}
