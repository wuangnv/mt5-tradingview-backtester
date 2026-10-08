import assert from 'node:assert/strict'
import { chromium } from '../../web/node_modules/playwright/index.mjs'
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
const out = new URL('./',import.meta.url), origin = 'http://127.0.0.1:5180'
await mkdir(out,{recursive:true})
const browser = await chromium.launch()
const report = {scope:'UI state-machine fixtures on actual Vite source; all fixture API writes intercepted. Separate live GET-only check.',cases:[]}
try {
  for (const width of [1710,768,360]) {
    const context = await browser.newContext({viewport:{width,height:987}})
    await context.addInitScript(()=>{localStorage.setItem('tw-language','vi');localStorage.setItem('tw-theme','dark')})
    const asset = {instrument_id:'EUR/USD',name:'Fixture EUR/USD',provider:'Dukascopy',provider_id:'dukascopy-catalog',asset_class:'fx'}
    let job = null, polls = 0, failPoll = false
    const writes = [],errors = []
    await context.route('**/api/**',async route=>{
      const req = route.request(), path = new URL(req.url()).pathname
      const send = payload=>route.fulfill({json:payload})
      if (path==='/api/v2/data/datasets') return send({items:[],catalog_items:[asset],catalog_state:{status:'cached',configured:true,refresh_available:true},download_state:{available:true,supports_full:true,supported_instruments:['EUR/USD'],earliest_dates:{'EUR/USD':'2003-05-04'}}})
      if (path==='/api/v2/data/downloads' && req.method()==='GET') {
        polls++
        if (failPoll) {failPoll=false;return route.abort('failed')}
        return send({available:true,supports_pause:true,items:job?[job]:[]})
      }
      if (path.startsWith('/api/v2/data/downloads/') && req.method()==='POST') {
        writes.push({path,workspace:req.headers()['x-workspace-id'],body:req.postDataJSON()})
        if (path.endsWith('/full')) job = {job_id:'fixture-job',instrument_id:'EUR/USD',status:'running',stage:'downloading',from_date:'2003-05-04',to_date:'2026-10-07',total_days:8558,completed_days:1358,transferred_bytes:28516998,network_days:0}
        else if (path.endsWith('/pause')) job = {...job,status:'paused',retry_after_seconds:0}
        else if (path.endsWith('/resume')) job = {...job,status:'running',error:null,retry_after_seconds:0}
        else if (path.endsWith('/cancel')) job = {...job,status:'cancelled'}
        else throw Error(`unexpected write ${path}`)
        return send(job)
      }
      return send({items:[]})
    })
    const page = await context.newPage()
    page.setDefaultTimeout(12000)
    page.on('pageerror',e=>errors.push(String(e)))
    await page.goto(`${origin}/?workspace=tenant-a&view=market-data&area=testing&section=market-data`)
    const row = page.locator('tbody tr').filter({hasText:'EUR/USD'})
    await row.getByRole('button',{name:'Tải về',exact:true}).click()
    await row.getByRole('button',{name:'Tạm dừng',exact:true}).waitFor()
    assert.equal(writes.length,1);assert.equal(writes[0].workspace,'tenant-a');assert.deepEqual(writes[0].body,{instrument_id:'EUR/USD'})
    const before = polls; failPoll = true
    await page.waitForFunction(()=>document.querySelector('.data-library-download-error'))
    await page.waitForFunction(()=>!document.querySelector('.data-library-download-error'))
    assert(polls>=before+2,'polling did not recover');assert.equal(writes.length,1,'GET recovery must not resend start')
    await row.getByRole('button',{name:'Tạm dừng',exact:true}).click()
    await row.getByRole('button',{name:'Tiếp tục tải',exact:true}).waitFor()
    assert.equal(writes.at(-1).path,'/api/v2/data/downloads/fixture-job/pause')
    job = {...job,error:'source_rate_limited',retry_after_seconds:3}
    await page.reload()
    const resume = row.getByRole('button',{name:'Tiếp tục tải',exact:true})
    await resume.waitFor();assert.equal(await resume.isDisabled(),true)
    assert.equal(writes.length,2,'reload must not auto-resume')
    await resume.scrollIntoViewIfNeeded()
    await page.screenshot({path:fileURLToPath(new URL(`fixture-cooldown-${width}.png`,out))})
    await resume.click();assert.equal(writes.at(-1).path,'/api/v2/data/downloads/fixture-job/resume')
    await row.getByRole('button',{name:'Tạm dừng',exact:true}).waitFor()
    await row.getByRole('button',{name:'Huỷ tải',exact:true}).click()
    await row.getByRole('button',{name:'Tải về',exact:true}).waitFor()
    assert.equal(writes.at(-1).path,'/api/v2/data/downloads/fixture-job/cancel')
    assert.equal(writes.length,4);assert.deepEqual(errors,[])
    job = {...job,status:'paused',error:'source_access_challenge',retry_after_seconds:0}
    await page.reload()
    const progress = row.locator('.data-library-progress')
    await progress.waitFor()
    assert.match(await progress.getAttribute('title'),/xác minh truy cập/)
    assert.equal(await progress.locator('.data-library-progress-eta').innerText(),'—')
    await progress.click()
    await page.getByRole('dialog').getByText('Dukascopy yêu cầu xác minh truy cập. Bộ tải tự động chưa thể tiếp tục; dữ liệu đã tải được giữ lại.',{exact:true}).waitFor()
    await page.screenshot({path:fileURLToPath(new URL(`fixture-challenge-${width}.png`,out))})
    assert.equal(writes.length,4,'challenge must not cause automatic source retry')
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
    report.cases.push({width,pass:true,polls,writes,checks:['start-once','poll-network-recovery','pause','persisted-reload','cooldown-disabled','resume-same-job','cancel','no-page-overflow']})
    await context.close()
  }
  const context = await browser.newContext({viewport:{width:1710,height:987}})
  let mutations=0
  await context.route('**/api/**',route=>{if(route.request().method()!=='GET'){mutations++;return route.abort()}return route.continue()})
  const page = await context.newPage()
  await page.goto(`${origin}/?workspace=tenant-a&view=market-data&area=testing&section=market-data`)
  await page.locator('tbody tr').first().waitFor()
  await page.screenshot({path:fileURLToPath(new URL('actual-get-only.png',out))})
  assert.equal(mutations,0)
  report.cases.push({scope:'Actual API GET-only',pass:true,mutations})
  await context.close()
  report.pass=true
} catch(error) {report.pass=false;report.error=String(error);process.exitCode=1}
finally {await writeFile(new URL('qa.json',out),JSON.stringify(report,null,2));await browser.close();console.log(JSON.stringify(report))}
