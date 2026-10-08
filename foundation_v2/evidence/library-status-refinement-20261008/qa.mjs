import assert from 'node:assert/strict'
import {chromium} from '../../web/node_modules/playwright/index.mjs'
import {mkdir,writeFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
const out=new URL('./',import.meta.url),origin='http://127.0.0.1:5180'
await mkdir(out,{recursive:true})
const browser=await chromium.launch(),report={scope:'Actual cached local GET and explicit status fixture; all writes, external origins and WebSockets blocked',cases:[],errors:[]}
async function run({fixture,theme,width}){
 const result={fixture,theme,width};report.cases.push(result)
 const context=await browser.newContext({viewport:{width,height:987}});context.setDefaultTimeout(7000)
 await context.addInitScript(({theme})=>{localStorage.setItem('tw-theme',theme);localStorage.setItem('tw-language','vi')},{theme})
 const states=['running','paused','failed','completed','cancelled','queued','pausing']
 const assets=[...states,'none'].map(status=>({instrument_id:status.toUpperCase(),name:status,provider:'Dukascopy',provider_id:'dukascopy-catalog',asset_class:'fx'}))
 const jobs=states.map((status,i)=>({job_id:`fixture-${status}`,instrument_id:status.toUpperCase(),status,completed_days:3,total_days:10,transferred_bytes:1000000,from_date:'2026-09-01',to_date:'2026-09-10',stage:'downloading',error:status==='failed'?'source_unavailable':null,retry_after_seconds:0}))
 const mutations=[]
 await context.routeWebSocket('**/*',socket=>socket.close())
 await context.route('**/*',route=>{
  const req=route.request(),url=new URL(req.url())
  if(url.origin!==origin||/^\/api\/v2\/live/.test(url.pathname))return route.abort()
  if(!['GET','HEAD','OPTIONS'].includes(req.method())){mutations.push(req.url());return route.abort()}
  if(fixture&&url.pathname==='/api/v2/data/datasets')return route.fulfill({json:{items:[],catalog_items:assets,catalog_state:{status:'cached',configured:true,item_count:assets.length},download_state:{available:true,supports_full:true,supported_instruments:assets.map(a=>a.instrument_id),earliest_dates:{}}}})
  if(fixture&&url.pathname==='/api/v2/data/downloads')return route.fulfill({json:{items:jobs,available:true,supports_pause:true}})
  return route.continue()
 })
 const page=await context.newPage();page.on('pageerror',e=>report.errors.push(String(e)))
 try{
  await page.goto(`${origin}/?workspace=tenant-a&view=market-data&area=testing&section=market-data`)
  await page.locator('.rd-table thead').waitFor({timeout:15000})
  const toolbar=page.locator('.data-library-toolbar'),filter=toolbar.getByRole('button',{name:'Trạng thái tải',exact:true})
  await filter.click()
  assert.deepEqual((await page.getByRole('option').allInnerTexts()).map(t=>t.replace(/\s*✓$/,'')),['Tất cả trạng thái','Đã tải','Đang tải','Chưa tải'])
  await page.getByRole('option',{name:'Đang tải',exact:true}).click()
  assert.equal(await toolbar.getByRole('button',{name:'Tiến độ tải dữ liệu',exact:true}).count(),0)
  assert.equal(await toolbar.locator('.data-library-catalog-trigger').count(),1)
  const rows=page.locator('.rd-table tbody tr')
  if(fixture){
   assert.deepEqual(await rows.locator('td:first-child strong').allInnerTexts(),['FAILED','PAUSED','PAUSING','QUEUED','RUNNING'])
   const labels={FAILED:'Tải thất bại',PAUSED:'Đã tạm dừng',PAUSING:'Đang tạm dừng…',QUEUED:'Đang chờ tải',RUNNING:'Đang tải'}
   for(const [asset,label] of Object.entries(labels))assert.equal(await rows.filter({has:page.locator('strong',{hasText:asset})}).locator('td').nth(6).innerText(),label)
  }else{
   assert.deepEqual(await rows.locator('td:first-child strong').allInnerTexts(),['EUR/USD'])
   assert.equal(await rows.locator('td').nth(6).innerText(),'Đã tạm dừng')
   result.actualStatus='EUR/USD paused, visible in Downloading filter'
  }
  await page.screenshot({path:fileURLToPath(new URL(`${fixture?'fixture':'actual'}-${theme}-${width}.png`,out))})
  const progress=page.locator('.data-library-progress').first()
  await progress.click()
  const dialog=page.getByRole('dialog',{name:'Tiến độ tải dữ liệu',exact:true})
  await dialog.waitFor();assert(await dialog.locator('.data-library-download-job').count()>0)
  if(!fixture)assert.match(await dialog.innerText(),/624 \/ 8[.,]558/)
  await page.screenshot({path:fileURLToPath(new URL(`${fixture?'fixture':'actual'}-dialog-${theme}-${width}.png`,out))})
  await page.keyboard.press('Escape');assert.equal(await dialog.count(),0)
  assert.equal(await progress.evaluate(el=>document.activeElement===el),true)
  if(fixture){
   await filter.click();await page.getByRole('option',{name:'Chưa tải',exact:true}).click()
   assert.deepEqual(await rows.locator('td:first-child strong').allInnerTexts(),['CANCELLED','COMPLETED','NONE'])
   await toolbar.getByRole('button',{name:'Xóa bộ lọc',exact:true}).click();assert.equal(await rows.count(),8)
  }
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
  assert.equal(mutations.length,0);result.pass=true
 }catch(e){result.pass=false;result.error=String(e);await page.screenshot({path:fileURLToPath(new URL(`FAIL-${fixture?'fixture':'actual'}-${width}.png`,out))}).catch(()=>{})}
 finally{await context.close()}
}
try{await run({fixture:false,theme:'dark',width:1710});await run({fixture:true,theme:'light',width:360})}
finally{report.pass=report.cases.every(c=>c.pass)&&!report.errors.length;await writeFile(new URL('results.json',out),JSON.stringify(report,null,2));await browser.close();console.log(JSON.stringify(report));if(!report.pass)process.exitCode=1}
