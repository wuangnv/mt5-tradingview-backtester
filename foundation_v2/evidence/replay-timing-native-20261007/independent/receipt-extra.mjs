import assert from 'node:assert/strict'
import {chromium} from '../../../web/node_modules/playwright/index.mjs'
import {writeFile} from 'node:fs/promises'
const browser=await chromium.launch({headless:true,ignoreDefaultArgs:['--hide-scrollbars']})
const report={scope:'Real hook isolated React mount; activity POST fixture only',cases:[],blocked:[],errors:[]}
const session='476f4b498e1a49ed9d48a75719f4d270',key=`tw:replay-activity:v1:tenant-a:${session}`
try{
for(const field of ['schema_version','event_id','session_id','accepted_seconds']){
 const context=await browser.newContext(),events=[];let valid=false
 await context.routeWebSocket('**/*',s=>s.close())
 await context.route('**/*',async route=>{const r=route.request(),u=new URL(r.url())
  if(u.pathname===`/api/v2/replay/sessions/${session}/activity`&&r.method()==='POST'){
   const e=r.postDataJSON();events.push(e);const json={fixture:'receipt-negative',schema_version:'replay-activity-v1',session_id:session,event_id:e.event_id,accepted_seconds:(Date.parse(e.ended_at_utc)-Date.parse(e.started_at_utc))/1000}
   if(!valid)json[field]=field==='accepted_seconds'?null:'fixture-invalid'
   return route.fulfill({status:200,json})
  }
  if(['GET','HEAD','OPTIONS'].includes(r.method())&&['http://127.0.0.1:5180','http://127.0.0.1:8010'].includes(u.origin))return route.continue()
  report.blocked.push({method:r.method(),url:r.url()});return route.abort()
 })
 const page=await context.newPage();page.on('pageerror',e=>report.errors.push(String(e)));await page.clock.install({time:new Date()});await page.goto('http://127.0.0.1:5180/?view=overview',{waitUntil:'networkidle'});await page.bringToFront()
 await page.evaluate(async session=>{const source=await(await fetch('/src/useReplayActivity.js')).text(),reactUrl=source.match(/from\s+["']([^"']*\/react\.js[^"']*)["']/)[1];const r=await import(reactUrl),d=await import(reactUrl.replace('react.js','react-dom_client.js')),React=r.default||r,DOM=d.default||d,hook=(await import('/src/useReplayActivity.js')).default;function Test(){const waiting=hook({workspace:'tenant-a',sessionId:session,enabled:true});return React.createElement('span',{id:'qa-receipt','data-waiting':String(waiting)},'fixture')};const host=document.createElement('div');document.body.append(host);DOM.createRoot(host).render(React.createElement(Test))},session)
 await page.locator('#qa-receipt').waitFor();await page.clock.runFor(11000);await page.waitForFunction(()=>document.querySelector('#qa-receipt').dataset.waiting==='true')
 const pending=await page.evaluate(key=>JSON.parse(sessionStorage.getItem(key)||'[]'),key);assert.ok(pending.some(e=>e.event_id===events[0].event_id),'invalid receipt retains event')
 valid=true;const count=events.length;await page.clock.runFor(11000);await page.waitForFunction(key=>!sessionStorage.getItem(key),key);assert.deepEqual(events[count],events[0],'valid retry uses original event')
 report.cases.push({field,pass:true,requests:events.length});await context.close()
}
report.pass=!report.blocked.length&&!report.errors.length
}catch(e){report.pass=false;report.failure=String(e);process.exitCode=1}finally{await browser.close();await writeFile(new URL('./receipt-extra-report.json',import.meta.url),JSON.stringify(report,null,2))}
console.log(JSON.stringify(report))
