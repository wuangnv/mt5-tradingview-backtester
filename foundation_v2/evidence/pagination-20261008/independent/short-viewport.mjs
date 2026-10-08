import { chromium } from '../../../web/node_modules/playwright/index.mjs'
import fs from 'node:fs/promises'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'

const out=new URL('./',import.meta.url),browser=await chromium.launch(),results=[]
const origin='http://127.0.0.1:5180'
try{
  for(const scenario of ['actual','running','failed','failed-many']){
    const context=await browser.newContext({viewport:{width:360,height:600}})
    await context.addInitScript(()=>{localStorage.setItem('tw-theme','dark');localStorage.setItem('tw-language','vi')})
    await context.route('**/*',route=>{
      const req=route.request(),url=new URL(req.url())
      if(url.origin!==origin||!['GET','HEAD','OPTIONS'].includes(req.method())||/^\/api\/v2\/(live|data\/(providers|market-assets))/.test(url.pathname))return route.abort()
      if(scenario!=='actual'&&url.pathname==='/api/v2/data/downloads')return route.fulfill({json:{available:true,items:Array.from({length:scenario==='failed-many'?6:1},(_,index)=>({job_id:'independent-short-'+index,instrument_id:'EUR/USD',from_date:'2026-10-05',to_date:'2026-10-06',completed_days:1,total_days:2,status:scenario==='running'?'running':'failed',error:scenario==='running'?undefined:'source_unavailable',retry_after_seconds:0}))}})
      return route.continue()
    })
    const page=await context.newPage()
    await page.goto(origin+'/?workspace=tenant-a&view=market-data&area=testing&section=market-data')
    const pager=page.locator('.wm-pagination');await pager.waitFor()
    const footerGeometry=()=>pager.evaluate(el=>{const b=el.getBoundingClientRect();return {bottom:b.bottom,x:b.x,right:b.right,docOverflow:document.documentElement.scrollWidth-innerWidth}})
    const before=await footerGeometry();assert.equal(before.bottom,600);assert.equal(before.docOverflow,0)
    const entry={scenario,geometry:before}
    if(scenario!=='actual'){
      const jobs=page.locator('.data-library-download-jobs')
      const isWithin=async locator=>{await locator.scrollIntoViewIfNeeded();return locator.evaluate(el=>{const r=el.getBoundingClientRect(),j=el.closest('.data-library-download-jobs').getBoundingClientRect();return r.top>=j.top-1&&r.bottom<=j.bottom+1})}
      if(scenario==='running'){await page.getByRole('progressbar').waitFor();assert(await isWithin(page.getByRole('progressbar')))}
      else {assert(await isWithin(page.locator('.data-library-job-error').last()));const resume=page.getByRole('button',{name:'Tiếp tục tải',exact:true}).last();assert(await resume.isEnabled());assert(await isWithin(resume));await resume.focus();assert.equal(await resume.evaluate(el=>el===document.activeElement),true)}
      const cancel=page.getByRole('button',{name:'Huỷ tải',exact:true}).last();assert(await cancel.isEnabled());assert(await isWithin(cancel));await cancel.focus();assert.equal(await cancel.evaluate(el=>el===document.activeElement),true)
      entry.jobs=await jobs.evaluate(el=>({height:el.clientHeight,scrollHeight:el.scrollHeight,scrollTop:el.scrollTop,overflow:getComputedStyle(el).overflowY}))
      assert.equal(entry.jobs.overflow,'auto');assert(entry.jobs.scrollHeight>entry.jobs.height)
      assert.deepEqual(await footerGeometry(),before)
      const table=await page.locator('.rd-table-wrap').boundingBox();assert(table.height>=40,JSON.stringify(table))
    }
    await page.screenshot({path:fileURLToPath(new URL(`short-${scenario}.png`,out))})
    results.push(entry);await context.close()
  }
  await fs.writeFile(new URL('short-results.json',out),JSON.stringify({status:'PASS',results},null,2))
  console.log(JSON.stringify({status:'PASS',cases:results.length}))
}finally{await browser.close()}
