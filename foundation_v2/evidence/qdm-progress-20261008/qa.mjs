import assert from 'node:assert/strict'
import {chromium} from '../../web/node_modules/playwright/index.mjs'
import {readFile,writeFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'

const payload=JSON.parse(await readFile(new URL('../../.runtime/qdm-catalog-qa.json',import.meta.url),'utf8'))
const url='http://127.0.0.1:5180/?workspace=tenant-a&view=market-data&area=testing&section=market-data'
const browser=await chromium.launch(),report={scope:'Labeled progress fixtures plus read-only live services; no job mutations',cases:[]}
try {
 for(const scenario of ['unknown','known','paused','failed','node','reduced-motion']) {
  const job={job_id:'fixture-progress',instrument_id:'EUR/USD',provider:'QuantDataManager',data_source:'Dukascopy',download_engine:'QuantDataManager',from_date:'2003-05-05',to_date:'2026-10-07',status:'running',stage:'processing',progress_scope:'phase',progress_percent:null,transferred_bytes:null,completed_days:8557,total_days:8557,created_at_utc:new Date(Date.now()-180000).toISOString(),supports_pause:false,supports_cancel:false}
  if(scenario==='known'){job.stage='downloading';job.progress_percent=42}
  if(['paused','failed'].includes(scenario))job.status=scenario
  if(scenario==='node')Object.assign(job,{provider:'Dukascopy',download_engine:'Dukascopy',stage:'downloading',progress_scope:'days',completed_days:10,total_days:100,transferred_bytes:1048576,supports_pause:true,supports_cancel:true})
  const context=await browser.newContext({viewport:{width:1710,height:987},reducedMotion:scenario==='reduced-motion'?'reduce':'no-preference'})
  await context.addInitScript(()=>{localStorage.setItem('tw-language','vi');localStorage.setItem('tw-theme','dark')})
  await context.route('**/api/**',route=>{
   assert.equal(route.request().method(),'GET')
   const path=new URL(route.request().url()).pathname
   if(path.endsWith('/data/datasets'))return route.fulfill({json:scenario==='node'?JSON.parse(JSON.stringify(payload).replaceAll('QuantDataManager','Dukascopy')):payload})
   if(path.endsWith('/data/downloads'))return route.fulfill({json:{available:true,items:[job],supports_pause:job.supports_pause,supports_cancel:job.supports_cancel}})
   return route.fulfill({json:{items:[]}})
  })
  const page=await context.newPage(),errors=[]
  page.on('pageerror',error=>errors.push(String(error)))
  await page.goto(url)
  await page.getByRole('button',{name:'Trạng thái tải',exact:true}).click()
  await page.getByRole('option',{name:'Tất cả trạng thái',exact:true}).click()
  await page.getByRole('searchbox').fill('EUR/USD')
  const control=page.locator('.data-library-progress'),bar=control.getByRole('progressbar')
  await control.waitFor()
  const text=(await control.innerText()).trim()
  if(scenario==='node'){assert(text.includes('10%'));assert(text.includes('1 MiB'))}
  else {
   assert(!text.includes('—'));assert(!text.includes('Đang'));assert(!text.includes('Đã tạm dừng'))
   assert.equal(await bar.getAttribute('aria-valuenow'),scenario==='known'?'42':null)
   if(['paused','failed'].includes(scenario)) {
    assert.equal(await bar.evaluate(e=>e.classList.contains('is-indeterminate')),false)
    assert.equal(await control.locator('.data-library-progress-fill').evaluate(e=>e.getBoundingClientRect().width),0)
   } else {
    assert.match(text,/\d{2}:\d{2}:\d{2}/)
    const elapsed=control.locator('.data-library-progress-elapsed'),initial=await elapsed.innerText()
    await page.waitForFunction(initial=>document.querySelector('.data-library-progress-elapsed')?.innerText!==initial,initial)
    const animation=await control.locator('.data-library-progress-fill').evaluate(e=>getComputedStyle(e).animationName)
    assert.equal(animation,['unknown'].includes(scenario)?'data-library-indeterminate':'none')
   }
  }
  if(scenario==='unknown') {
   await page.screenshot({path:fileURLToPath(new URL('fixture-unknown.png',import.meta.url))})
   await control.click()
   await page.getByRole('dialog',{name:'Tiến độ tải dữ liệu',exact:true}).getByText('Đang lưu dữ liệu…',{exact:true}).waitFor()
  }
  assert.deepEqual(errors,[]);report.cases.push({scenario,pass:true,text})
  await context.close()
 }
 const page=await browser.newPage({viewport:{width:1710,height:987}}),writes=[]
 page.on('request',r=>{if(new URL(r.url()).pathname.startsWith('/api/')&&r.method()!=='GET')writes.push(r.url())})
 await page.addInitScript(()=>{localStorage.setItem('tw-language','vi');localStorage.setItem('tw-theme','dark')})
 await page.goto(url)
 await page.getByRole('button',{name:'Trạng thái tải',exact:true}).click()
 await page.getByRole('option',{name:'Đang tải',exact:true}).click()
 const jobs=await page.evaluate(async()=>await(await fetch('/api/v2/data/downloads',{headers:{'X-Workspace-Id':'tenant-a'}})).json())
 report.live=jobs.items.map(({status,stage,error,dataset_id})=>({status,stage,error,dataset_id}))
 if(jobs.items.some(job=>job.status==='running')) {
  await page.locator('.data-library-progress-elapsed').waitFor()
  assert(!(await page.locator('.data-library-progress').innerText()).includes('—'))
  await page.screenshot({path:fileURLToPath(new URL('live-processing.png',import.meta.url))})
 } else if(jobs.items.some(job=>job.status==='completed')) {
  await page.getByRole('button',{name:'Trạng thái tải',exact:true}).click()
  await page.getByRole('option',{name:'Đã tải',exact:true}).click()
  await page.getByRole('searchbox').fill('EUR/USD')
  await page.getByTestId('data-desk-dataset-table').getByText('EUR/USD',{exact:true}).waitFor()
  assert.equal(await page.locator('.data-library-progress').count(),0)
  await page.screenshot({path:fileURLToPath(new URL('live-completed.png',import.meta.url))})
 }
 assert.deepEqual(writes,[])
 report.pass=true
} catch(error) {report.pass=false;report.error=String(error);process.exitCode=1}
finally {await writeFile(new URL('qa.json',import.meta.url),JSON.stringify(report,null,2));await browser.close();console.log(JSON.stringify(report))}
