import assert from 'node:assert/strict'
import {chromium} from '../../web/node_modules/playwright/index.mjs'
import {readFile,writeFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
const payload=JSON.parse(await readFile(new URL('../../.runtime/qdm-catalog-qa.json',import.meta.url),'utf8'))
const browser=await chromium.launch(),report={scope:'Labeled telemetry fixtures and live saved EUR/USD; no API mutations',cases:[]}
const url='http://127.0.0.1:5180/?workspace=tenant-a&view=market-data&area=testing&section=market-data'
try {
 for(const scenario of ['total','downloaded-only','qdm-unknown','zero','processing','reduced-motion']) {
  const job={job_id:'fixture-display',instrument_id:'EUR/USD',provider:'QuantDataManager',download_engine:'QuantDataManager',data_source:'Dukascopy',from_date:'2003-05-05',to_date:'2026-10-07',status:'running',stage:'downloading',progress_scope:'phase',progress_percent:2,transferred_bytes:600000000,bytes_per_second:48000000,estimated_seconds_remaining:600,total_days:8557,completed_days:0,supports_pause:false,supports_cancel:false}
  if(scenario==='total')job.total_bytes=28800000000
  if(['qdm-unknown','reduced-motion'].includes(scenario))Object.assign(job,{progress_percent:null,transferred_bytes:null,bytes_per_second:null,estimated_seconds_remaining:null})
  if(scenario==='processing')job.stage='processing'
  if(scenario==='zero')Object.assign(job,{transferred_bytes:0,bytes_per_second:0})
  const context=await browser.newContext({viewport:{width:1710,height:987},reducedMotion:scenario==='reduced-motion'?'reduce':'no-preference'})
  await context.addInitScript(()=>{localStorage.setItem('tw-language','vi');localStorage.setItem('tw-theme','dark')})
  await context.route('**/api/**',route=>{
   assert.equal(route.request().method(),'GET')
   const path=new URL(route.request().url()).pathname
   if(path.endsWith('/data/datasets'))return route.fulfill({json:payload})
   if(path.endsWith('/data/downloads'))return route.fulfill({json:{available:true,items:[job],supports_pause:false,supports_cancel:false}})
   return route.fulfill({json:{items:[]}})
  })
  const page=await context.newPage(),errors=[]
  page.on('pageerror',e=>errors.push(String(e)))
  await page.goto(url)
  await page.getByRole('button',{name:'Trạng thái tải',exact:true}).click()
  await page.getByRole('option',{name:'Đang tải',exact:true}).click()
  await page.getByRole('searchbox').fill('EUR/USD')
  const control=page.locator('.data-library-progress');await control.waitFor()
  const transfer=await control.locator('.data-library-progress-transfer').innerText(),eta=await control.locator('.data-library-progress-eta').innerText()
  assert(!transfer.includes('MiB'));assert(!transfer.includes('GiB'))
  assert.equal(await control.locator('.data-library-progress-percent,.data-library-progress-elapsed').count(),0)
  if(scenario==='total')assert.equal(transfer,'0,6/28,8 GB @ 48 MB/s')
  if(['downloaded-only','processing'].includes(scenario))assert.equal(transfer,scenario==='processing'?'600 MB @ — MB/s':'600 MB @ 48 MB/s')
  if(scenario==='zero')assert.equal(transfer,'0 MB @ 0 MB/s')
  if(['qdm-unknown','reduced-motion'].includes(scenario)) {
   assert.equal(transfer,'— MB @ — MB/s');assert.equal(await control.getByRole('progressbar').getAttribute('aria-valuenow'),null)
   assert.equal(await control.locator('.data-library-progress-fill').evaluate(e=>getComputedStyle(e).animationName),scenario==='reduced-motion'?'none':'data-library-indeterminate')
  }
  assert.equal(eta,['processing','qdm-unknown','reduced-motion'].includes(scenario)?'—':'≈ 10 phút')
  const geometry=await control.evaluate(e=>{
   const left=e.querySelector('.data-library-progress-transfer').getBoundingClientRect(),right=e.querySelector('.data-library-progress-eta').getBoundingClientRect(),track=e.querySelector('.data-library-progress-track').getBoundingClientRect()
   return{left:{x:left.x,y:left.y,right:left.right,height:left.height},right:{x:right.x,y:right.y,right:right.right},track:{x:track.x,y:track.y,right:track.right}}
  })
  assert.equal(geometry.left.height,16,'metrics must stay on a single line')
  assert(geometry.left.right<=geometry.right.x);assert.equal(geometry.left.y,geometry.right.y)
  assert(Math.abs(geometry.track.x-geometry.left.x)<1);assert(Math.abs(geometry.track.right-geometry.right.right)<1)
  if(['total','downloaded-only','qdm-unknown'].includes(scenario))await page.screenshot({path:fileURLToPath(new URL(`${scenario}.png`,import.meta.url))})
  assert.deepEqual(errors,[]);report.cases.push({scenario,pass:true,transfer,eta,geometry})
  await context.close()
 }
 const page=await browser.newPage({viewport:{width:1587,height:987}}),writes=[]
 await page.addInitScript(()=>{localStorage.setItem('tw-language','vi');localStorage.setItem('tw-theme','dark')})
 page.on('request',r=>{if(new URL(r.url()).pathname.startsWith('/api/')&&r.method()!=='GET')writes.push(r.url())})
 await page.goto(url);await page.getByRole('searchbox').fill('EUR/USD')
 const row=page.getByTestId('data-desk-dataset-table').locator('tbody tr').first()
 await row.getByText('M1',{exact:true}).waitFor()
 assert.equal(await row.locator('td').nth(7).innerText(),'140,9 MB')
 await row.getByRole('button',{name:'EUR/USD',exact:true}).click()
 const details=page.getByRole('dialog');await details.getByText('EUR/USD · M1',{exact:true}).waitFor()
 await details.getByText('140,9 MB',{exact:true}).waitFor()
 await page.screenshot({path:fileURLToPath(new URL('live-details-1587.png',import.meta.url))})
 await details.getByRole('button',{name:'Đóng',exact:true}).click()
 await page.screenshot({path:fileURLToPath(new URL('live-grid-1587.png',import.meta.url))})
 assert.deepEqual(writes,[]);report.live={pass:true,timeframe:'M1',replaySize:'140,9 MB',apiWrites:0};report.pass=true
} catch(error) {report.pass=false;report.error=String(error);process.exitCode=1}
finally {await writeFile(new URL('qa.json',import.meta.url),JSON.stringify(report,null,2));await browser.close();console.log(JSON.stringify(report))}
