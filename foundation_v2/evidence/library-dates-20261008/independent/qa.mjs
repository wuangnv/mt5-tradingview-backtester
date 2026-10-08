import assert from 'node:assert/strict'
import {chromium} from '../../../web/node_modules/playwright/index.mjs'
import {mkdir,writeFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'

const out=new URL('./',import.meta.url),origin='http://127.0.0.1:5180'
await mkdir(out,{recursive:true})
const browser=await chromium.launch(), report={scope:'Read-only actual catalog plus explicitly labeled fixtures; no writes, external origins, live API or WebSockets',cases:[],errors:[]}
const assets=['CATALOG','RUNNING','PAUSED','NO-RANGE'].map(instrument_id=>({instrument_id,name:`Fixture ${instrument_id}`,provider:'Dukascopy',provider_id:'dukascopy-catalog',asset_class:'fx'}))
const datasets=[{dataset_id:'fixture-saved-dukascopy',instrument_id:'SAVED-DUKA',timeframe:'M1',row_count:31,size_bytes:8123,first_timestamp:Date.parse('2026-01-02T00:00:00Z')/1000,last_timestamp:Date.parse('2026-01-03T00:00:00Z')/1000,source:{provider:'Dukascopy',export_settings:JSON.stringify({price:'bid'}),retrieved_at_utc:'2026-01-04T10:20:00Z'},quality:{disposition:'review',gap_count:2,gaps:[],duplicates:1},quality_status:'unverified'}, {dataset_id:'fixture-saved-csv',instrument_id:'SAVED-CSV',timeframe:'H1',row_count:0,size_bytes:0,first_timestamp:Date.parse('2024-02-29T23:00:00Z')/1000,last_timestamp:Date.parse('2024-03-01T00:00:00Z')/1000,source:{provider:'local-csv',export_settings:'browser-file-text-v1'},quality:{disposition:'pass',gaps:[],duplicates:0}}]
const jobs=['running','paused'].map(status=>({job_id:`fixture-${status}`,instrument_id:status.toUpperCase(),status,completed_days:3,total_days:10,transferred_bytes:1048576,bytes_per_second:204800,from_date:'2026-01-02',to_date:'2026-01-11',stage:'downloading'}))

async function run({fixture,theme,width}){
 const result={fixture,theme,width};report.cases.push(result)
 const context=await browser.newContext({viewport:{width,height:987}});context.setDefaultTimeout(8000)
 await context.addInitScript(({theme})=>{localStorage.setItem('tw-theme',theme);localStorage.setItem('tw-language','vi')},{theme})
 const mutations=[];let downloadReads=0
 await context.routeWebSocket('**/*',socket=>socket.close())
 await context.route('**/*',route=>{
  const req=route.request(),url=new URL(req.url())
  if(url.origin!==origin||/^\/api\/v2\/live/.test(url.pathname))return route.abort()
  if(!['GET','HEAD','OPTIONS'].includes(req.method())){mutations.push(req.url());return route.abort()}
  if(fixture&&url.pathname==='/api/v2/data/datasets')return route.fulfill({json:{items:datasets,catalog_items:assets,catalog_state:{status:'cached',configured:true,item_count:assets.length,retrieved_at_utc:'2026-01-04T10:20:00Z'},download_state:{available:true,supports_full:true,supported_instruments:assets.map(a=>a.instrument_id),earliest_dates:{CATALOG:'2003-05-04',RUNNING:'2003-05-04',PAUSED:'2003-05-04'}}}})
  if(fixture&&url.pathname==='/api/v2/data/downloads')return route.fulfill({json:{items:jobs.map(job=>job.status==='running'?{...job,transferred_bytes:4*1024**3+(downloadReads++)*64*1024**2}:job),available:true,supports_pause:true}})
  return route.continue()
 })
 const page=await context.newPage();page.on('pageerror',e=>report.errors.push(String(e)))
 try{
  await page.goto(`${origin}/?workspace=tenant-a&view=market-data&area=testing&section=market-data`)
  await page.locator('.rd-table thead').waitFor({timeout:15000})
  const table=page.locator('.rd-table'),rows=table.locator('tbody tr')
  result.headers=await table.locator('th').allInnerTexts()
  assert.equal(result.headers.length,9)
  assert(result.headers.includes('Trạng thái'));assert(result.headers.includes('Dữ liệu'));assert(!result.headers.includes('Chất lượng'))
  if(fixture){
   if(width===1710&&theme==='dark'){
    const progress=rows.filter({has:page.locator('strong',{hasText:'RUNNING'})}).locator('.data-library-progress')
    await progress.locator('.data-library-progress-rate').filter({hasText:'MiB/s'}).waitFor({timeout:6000})
    assert.match(await progress.innerText(),/GiB/)
    result.largeSpeedBounded=await progress.evaluate(el=>[...el.children].filter(c=>!c.classList.contains('data-library-progress-fill')).every(c=>c.scrollWidth<=el.clientWidth))
    assert.equal(result.largeSpeedBounded,true)
    await page.screenshot({path:fileURLToPath(new URL('fixture-large-speed-dark-1710.png',out))})
   }
   assert.equal(await rows.count(),6)
   const row=asset=>rows.filter({has:page.locator('td:first-child strong',{hasText:new RegExp(`^${asset}$`)})})
   assert.match(await row('CATALOG').locator('td').nth(4).innerText(),/04\/05\/2003/)
   assert.equal(await row('CATALOG').locator('td').nth(5).innerText(),'—');assert.equal(await row('CATALOG').locator('td').nth(6).innerText(),'—')
   assert.match(await row('SAVED-DUKA').locator('td').nth(4).innerText(),/02\/01\/2026/)
   assert.match(await row('SAVED-DUKA').locator('td').nth(4).innerText(),/03\/01\/2026/)
   assert.match(await row('SAVED-DUKA').locator('td').nth(3).innerText(),/M1\s*Bid/)
   assert.match(await row('SAVED-CSV').locator('td').nth(4).innerText(),/29\/02\/2024/)
   assert(!/Bid/i.test(await row('SAVED-CSV').locator('td').nth(3).innerText()))
   assert.match(await row('RUNNING').locator('td').nth(7).innerText(),/Đang tải/)
   assert.equal(await row('RUNNING').locator('td').nth(6).innerText(),'—')
   assert.match(await row('PAUSED').locator('td').nth(7).innerText(),/Đã tạm dừng/)
   assert.equal(await row('RUNNING').locator('.data-library-more').count(),0)
   result.fixtureRows=await rows.allInnerTexts()
  }else{
   result.actualRows=await rows.count();assert(result.actualRows>0)
   const history=await rows.locator('td:nth-child(5)').allInnerTexts()
   assert(history.some(text=>/\d{2}\/\d{2}\/\d{4}/.test(text)))
   assert(!history.some(text=>/\b\d{4}-\d{2}-\d{2}\b/.test(text)))
  }
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
  await page.screenshot({path:fileURLToPath(new URL(`${fixture?'fixture':'actual'}-${theme}-${width}.png`,out))})
  if(fixture){
   // The active worker locks mutation menus; the symbol keeps read-only details available.
   await page.getByTestId('dataset-row-fixture-saved-dukascopy').click()
   const details=page.getByRole('dialog',{name:'Chi tiết dữ liệu và chất lượng',exact:true})
   await details.waitFor();assert.match(await details.innerText(),/Cần kiểm tra chất lượng/);assert.match(await details.innerText(),/02\/01\/2026/)
   await page.screenshot({path:fileURLToPath(new URL(`fixture-details-${theme}-${width}.png`,out))})
   await page.keyboard.press('Escape')
   await rows.filter({has:page.locator('strong',{hasText:'RUNNING'})}).locator('.data-library-progress').click()
   const progress=page.getByRole('dialog',{name:'Tiến độ tải dữ liệu',exact:true})
   await progress.waitFor();assert.match(await progress.innerText(),/02\/01\/2026.*11\/01\/2026/s)
   assert(!/2026-01-(02|11)/.test(await progress.innerText()))
   await page.screenshot({path:fileURLToPath(new URL(`fixture-progress-${theme}-${width}.png`,out))})
   await page.keyboard.press('Escape')
  }
  assert.equal(mutations.length,0);result.pass=true
 }catch(e){result.pass=false;result.error=String(e);await page.screenshot({path:fileURLToPath(new URL(`FAIL-${fixture?'fixture':'actual'}-${theme}-${width}.png`,out))}).catch(()=>{})}
 finally{await context.close()}
}
try{for(const theme of ['dark','light'])for(const width of [1710,768,360])await run({fixture:true,theme,width});await run({fixture:false,theme:'dark',width:1710})}
finally{report.pass=report.cases.every(c=>c.pass)&&!report.errors.length;await writeFile(new URL('results.json',out),JSON.stringify(report,null,2));await browser.close();console.log(JSON.stringify({pass:report.pass,cases:report.cases.map(({fixture,theme,width,pass,error})=>({fixture,theme,width,pass,error})),errors:report.errors}));if(!report.pass)process.exitCode=1}
