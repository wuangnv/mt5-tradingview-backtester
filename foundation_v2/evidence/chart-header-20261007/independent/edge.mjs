import assert from 'node:assert/strict'
import {chromium} from '../../../web/node_modules/playwright/index.mjs'
import {writeFile} from 'node:fs/promises'
const browser=await chromium.launch({headless:true,ignoreDefaultArgs:['--hide-scrollbars']})
const report={scope:'Actual GET; activity POST fixtures; dock-to-overflow focus and denied fullscreen',cases:[],errors:[],blocked:[]},session='476f4b498e1a49ed9d48a75719f4d270'
try{for(const width of [1300,390]){
 const ctx=await browser.newContext({viewport:{width,height:987}});await ctx.addInitScript(()=>{localStorage.setItem('tw-theme','dark');localStorage.setItem('tw-language','en')});await ctx.routeWebSocket('**/*',s=>s.close())
 await ctx.route('**/*',async route=>{const r=route.request(),u=new URL(r.url());if(u.pathname===`/api/v2/replay/sessions/${session}/activity`&&r.method()==='POST'){const e=r.postDataJSON();return route.fulfill({status:200,json:{fixture:'header-edge',schema_version:'replay-activity-v1',session_id:session,event_id:e.event_id,accepted_seconds:(Date.parse(e.ended_at_utc)-Date.parse(e.started_at_utc))/1000}})}if(['GET','HEAD','OPTIONS'].includes(r.method())&&['http://127.0.0.1:5180','http://127.0.0.1:8010'].includes(u.origin))return route.continue();report.blocked.push({method:r.method(),url:r.url()});return route.abort()})
 const p=await ctx.newPage();p.setDefaultTimeout(10000);p.on('pageerror',e=>report.errors.push(String(e)));await p.goto(`http://127.0.0.1:5180/?workspace=tenant-a&view=replay&session=${session}&dataset=dataset-262639d819219431b8bbfd00a665d4fb7fde4c646a4fa0c5020608c1e1c3572d&mode=Practice&surface=workspace&cursor=500`,{waitUntil:'networkidle'});await p.locator('[data-chart-status=ready]').waitFor({timeout:25000})
 const frame=await(await p.locator('.advanced-chart-host iframe').elementHandle()).contentFrame(),overflow=p.locator('.chart-header-overflow')
 const menu=async()=>{await overflow.click();await p.locator('#chart-header-menu').waitFor();return p.locator('#chart-header-menu')}
 if(width===1300)await frame.getByRole('button',{name:'New Layout',exact:true}).click();else await(await menu()).getByRole('button',{name:'New Layout',exact:true}).click()
 await p.getByTestId('chart-preview-layout').waitFor();await overflow.waitFor()
 if(width===390){await p.keyboard.press('Escape');await p.getByTestId('chart-preview-layout').waitFor({state:'hidden'});await p.waitForFunction(()=>document.activeElement.classList.contains('chart-header-overflow'))}
 await(await menu()).getByRole('button',{name:'Editor',exact:true}).click();await p.getByTestId('chart-preview-editor').waitFor();await p.keyboard.press('Escape');await p.getByTestId('chart-preview-editor').waitFor({state:'hidden'})
 if(width===1300){await p.waitForFunction(()=>{const doc=document.querySelector('.advanced-chart-host iframe').contentDocument;return doc.activeElement?.getAttribute('aria-label')==='Editor'});assert.equal(await frame.getByRole('button',{name:'Editor',exact:true}).evaluate(e=>e.ownerDocument.activeElement===e),true)}else await p.waitForFunction(()=>document.activeElement.classList.contains('chart-header-overflow'))
 report.cases.push({width,name:'dock changes from native to overflow and returns focus to visible Editor/overflow',pass:true})
 if(width===390){
  await overflow.focus();await p.keyboard.press('Enter');await p.locator('#chart-header-menu').waitFor();await p.keyboard.press('Enter');await p.getByTestId('chart-preview-compare').waitFor();await p.keyboard.press('Escape');await p.getByTestId('chart-preview-compare').waitFor({state:'hidden'});await p.waitForFunction(()=>document.activeElement.classList.contains('chart-header-overflow'));report.cases.push({width,name:'keyboard Enter opens overflow/Compare; Escape returns persistent opener',pass:true})
  await p.evaluate(()=>{document.querySelector('.fx-app').requestFullscreen=async()=>{throw new Error('fixture_denied_fullscreen')}})
  await(await menu()).getByRole('button',{name:'Fullscreen',exact:true}).click();await p.locator('.chart-notice').filter({hasText:'Could not enter fullscreen.'}).waitFor();assert.equal(await p.evaluate(()=>Boolean(document.fullscreenElement)),false)
  report.cases.push({width,name:'fullscreen denied fixture visibly explained, no fullscreen or writes',pass:true})
 }
 await ctx.close()
}report.pass=!report.errors.length&&!report.blocked.length}catch(e){report.pass=false;report.failure=String(e);process.exitCode=1}finally{await browser.close();await writeFile(new URL('./edge-report.json',import.meta.url),JSON.stringify(report,null,2))}
console.log(JSON.stringify(report))
