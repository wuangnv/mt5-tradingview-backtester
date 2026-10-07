import assert from 'node:assert/strict'
import {chromium} from '../../../web/node_modules/playwright/index.mjs'
import {writeFile,mkdir} from 'node:fs/promises'
const out=new URL('./',import.meta.url);await mkdir(out,{recursive:true})
const browser=await chromium.launch({headless:true,ignoreDefaultArgs:['--hide-scrollbars']})
const report={scope:'Actual localhost GET; labeled activity POST fixtures only; no persisted writes',cases:[],errors:[],blocked:[]}
const session='476f4b498e1a49ed9d48a75719f4d270',key=`tw:replay-activity:v1:tenant-a:${session}`
const url=`http://127.0.0.1:5180/?workspace=tenant-a&view=replay&session=${session}&dataset=dataset-262639d819219431b8bbfd00a665d4fb7fde4c646a4fa0c5020608c1e1c3572d&mode=Practice&surface=workspace&cursor=500`
async function guardedContext(options={},handler){
 const context=await browser.newContext(options)
 await context.routeWebSocket('**/*',s=>s.close())
 await context.route('**/*',async route=>{
  const r=route.request(),u=new URL(r.url())
  if(u.pathname===`/api/v2/replay/sessions/${session}/activity`&&r.method()==='POST')return handler(route,r.postDataJSON())
  if(['GET','HEAD','OPTIONS'].includes(r.method())&&['http://127.0.0.1:5180','http://127.0.0.1:8010'].includes(u.origin))return route.continue()
  report.blocked.push({method:r.method(),url:r.url()});return route.abort()
 })
 return context
}
try{
 // Execute the real hook in an isolated React mount. The app stays on Dashboard.
 const held=[],calls=[]
 const context=await guardedContext({},async(route,event)=>{calls.push(event);await new Promise(resolve=>held.push({route,event,resolve}));})
 const page=await context.newPage();page.on('pageerror',e=>report.errors.push(String(e)))
 await page.clock.install({time:new Date()});await page.goto('http://127.0.0.1:5180/?workspace=tenant-a&view=overview',{waitUntil:'networkidle'});await page.bringToFront()
 await page.evaluate(async session=>{
  const source=await(await fetch('/src/useReplayActivity.js')).text()
  const reactUrl=source.match(/from\s+["']([^"']*\/react\.js[^"']*)["']/)[1]
  const reactModule=await import(reactUrl),domModule=await import(reactUrl.replace('react.js','react-dom_client.js'));const React=reactModule.default||reactModule,DOM=domModule.default||domModule
  const hook=(await import('/src/useReplayActivity.js')).default
  function Test({enabled}){const waiting=hook({workspace:'tenant-a',sessionId:session,enabled});return React.createElement('span',{id:'qa-hook', 'data-waiting':String(waiting),'data-enabled':String(enabled)},'fixture hook')}
  const host=document.createElement('div');document.body.append(host);const root=DOM.createRoot(host)
  window.__qaRender=enabled=>root.render(React.createElement(Test,{enabled}));window.__qaRender(true)
 },session)
 await page.locator('#qa-hook[data-enabled=true]').waitFor();console.log('hook mounted');await page.clock.runFor(11000)
 await page.waitForFunction(k=>JSON.parse(sessionStorage.getItem(k)||'[]').length>0,key)
 assert.equal(held.length,1);console.log('first held')
 await page.evaluate(()=>window.__qaRender(false));await page.locator('#qa-hook[data-enabled=false]').waitFor()
 await page.evaluate(()=>window.__qaRender(true));await page.locator('#qa-hook[data-enabled=true]').waitFor()
 await page.waitForFunction(()=>document.querySelector('#qa-hook').dataset.waiting==='true');console.log('remounted')
 await page.clock.runFor(11000)
 const before=await page.evaluate(k=>JSON.parse(sessionStorage.getItem(k)||'[]'),key)
 assert.ok(before.length>=2,'new owner persisted a new interval')
 await held[0].route.fulfill({status:200,json:{schema_version:'replay-activity-v1',session_id:session,event_id:held[0].event.event_id,accepted_seconds:(Date.parse(held[0].event.ended_at_utc)-Date.parse(held[0].event.started_at_utc))/1000,fixture:'held-old-owner-success'}});held[0].resolve()
 await new Promise(resolve=>setTimeout(resolve,100))
 const after=await page.evaluate(k=>JSON.parse(sessionStorage.getItem(k)||'[]'),key)
 report.cases.push({name:'same-key-teardown-inflight',before,after,requests:calls,pass:before.every(e=>after.some(a=>a.event_id===e.event_id))})
 for(const item of held.slice(1)){await item.route.fulfill({status:503,json:{fixture:'new-owner-offline'}}).catch(()=>{});item.resolve()}
 await context.close();console.log('race checked')
 // Real replay: reload retry, explicit background/focus fixture and both chart engines.
 for(const [theme,width,language,engine] of [['dark',1710,'vi','advanced'],['light',360,'en','advanced'],['dark',360,'en','lightweight'],['light',1710,'vi','lightweight']]){
  const events=[];let fail=true
  const ctx=await guardedContext({viewport:{width,height:987}},async(route,event)=>{events.push(event);return route.fulfill({status:fail?503:200,json:{schema_version:'replay-activity-v1',session_id:session,event_id:event.event_id,accepted_seconds:(Date.parse(event.ended_at_utc)-Date.parse(event.started_at_utc))/1000,fixture:'independent-activity'}})})
  await ctx.addInitScript(({theme,language})=>{localStorage.setItem('tw-theme',theme);localStorage.setItem('tw-language',language)}, {theme,language})
  const p=await ctx.newPage();p.on('pageerror',e=>report.errors.push(String(e)));await p.clock.install({time:new Date()})
  console.log('replay',engine,theme,width);await p.goto(url+(engine==='lightweight'?'&chart_engine=lightweight':''),{waitUntil:'networkidle'});await p.bringToFront()
  await p.locator(engine==='advanced'?'[data-chart-engine=advanced]':'[data-testid=replay-chart]:not([data-chart-engine])').waitFor({timeout:25000})
  if(engine==='advanced')await p.locator('[data-chart-status=ready]').waitFor({timeout:25000})
  await p.mouse.move(200,300);await p.clock.runFor(11000);assert.ok(events.length)
  const pending=await p.evaluate(k=>JSON.parse(sessionStorage.getItem(k)||'[]'),key);assert.ok(pending.length)
  fail=false;const count=events.length;await p.reload({waitUntil:'networkidle'})
  await p.waitForFunction(k=>!sessionStorage.getItem(k),key)
  assert.deepEqual(events[count],pending[0],'reload retries original interval')
  // Browser visibility/focus getters are explicitly controlled for deterministic testing.
  await p.evaluate(()=>{window.__qaHidden=true;window.__qaFocused=false;Object.defineProperty(document,'hidden',{configurable:true,get:()=>window.__qaHidden});document.hasFocus=()=>window.__qaFocused;document.dispatchEvent(new Event('visibilitychange'));window.dispatchEvent(new Event('blur'))})
  await p.clock.runFor(11000);const settled=events.length;await p.clock.runFor(40000);assert.equal(events.length,settled,'hidden/blur accumulates no intervals')
  await p.evaluate(()=>{window.__qaHidden=false;window.__qaFocused=true;document.dispatchEvent(new Event('visibilitychange'));window.dispatchEvent(new Event('focus'))});await p.clock.runFor(11000);assert.ok(events.length>settled,'focus resumes')
  await p.screenshot({path:new URL(`${engine}-${theme}-${language}-${width}.png`,out).pathname.replace(/^\/([A-Za-z]:)/,'$1')})
  report.cases.push({name:'reload-hidden-focus',theme,width,language,engine,requests:events.length,pass:true})
  await ctx.close()
 }
 report.pass=report.cases.every(c=>c.pass)&&!report.errors.length
}catch(e){report.pass=false;report.failure=String(e);process.exitCode=1}
finally{await browser.close();await writeFile(new URL('report.json',out),JSON.stringify(report,null,2))}
console.log(JSON.stringify({pass:report.pass,cases:report.cases.map(c=>({name:c.name,pass:c.pass,engine:c.engine})),failure:report.failure,errors:report.errors}))
