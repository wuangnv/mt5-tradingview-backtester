import assert from 'node:assert/strict'
import { chromium } from '../../../web/node_modules/playwright/index.mjs'
import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
const session='476f4b498e1a49ed9d48a75719f4d270',out=new URL('./',import.meta.url)
const url=`http://127.0.0.1:5180/?workspace=tenant-a&view=replay&session=${session}&dataset=dataset-262639d819219431b8bbfd00a665d4fb7fde4c646a4fa0c5020608c1e1c3572d&mode=Practice&surface=workspace&cursor=500&chart_iframe=srcdoc`
const report={scope:'Explicit srcdoc Chromium actualGET; local chart settings/storage only, all owner step/order writes blocked.',errors:[],blocked:[]}
const browser=await chromium.launch({headless:true}),context=await browser.newContext({viewport:{width:1920,height:940}})
try{
 await context.addInitScript(()=>{localStorage.setItem('tw-theme','dark');localStorage.setItem('tw-language','vi')})
 await context.routeWebSocket('**/*',socket=>socket.close())
 await context.route('**/*',async route=>{
  const r=route.request(),u=new URL(r.url())
  if(r.method()==='POST' && u.pathname===`/api/v2/replay/sessions/${session}/activity`){const e=r.postDataJSON();return route.fulfill({status:200,json:{schema_version:'replay-activity-v1',event_id:e.event_id,session_id:session,accepted_seconds:(Date.parse(e.ended_at_utc)-Date.parse(e.started_at_utc))/1000}})}
  if(!['GET','HEAD','OPTIONS'].includes(r.method()) || !['http://127.0.0.1:5180','http://127.0.0.1:8010'].includes(u.origin)){report.blocked.push({method:r.method(),url:r.url()});return route.abort()}
  if(u.pathname.endsWith('charting_library.standalone.js')){const res=await route.fetch();return route.fulfill({response:res,body:await res.text()+`;window.TradingView.widget=new Proxy(window.TradingView.widget,{construct(T,args){const w=new T(...args);window.__qaWidget=w;window.__qaReadyCount=0;const original=w.onChartReady.bind(w);w.onChartReady=function(callback){return original(()=>{window.__qaReadyCount++;callback()})};return w}})`})}
  return route.continue()
 })
 const page=await context.newPage();page.on('pageerror',e=>report.errors.push(String(e)))
 await page.goto(url);await page.locator('[data-chart-status=ready]').waitFor({timeout:30000})
 const frame=page.frameLocator('.advanced-chart-host iframe');await frame.getByTestId('legacy-native-market').waitFor();await page.waitForTimeout(350)
 const snapshot=()=>page.evaluate(()=>{const f=document.querySelector('.advanced-chart-host iframe'),d=f.contentDocument,c=d.querySelector('.layout__area--center').getBoundingClientRect(),top=d.querySelector('.layout__area--top').getBoundingClientRect();return {srcdoc:f.srcdoc.length,frameUrl:f.contentWindow.location.href,origin:f.contentWindow.origin,readyCount:window.__qaReadyCount,interval:window.__qaWidget.activeChart().resolution(),cutoff:document.querySelector('[data-chart-status=ready]').dataset.cutoff,topWidth:top.width,centerRight:c.right,headerHit:d.elementFromPoint(innerWidth-18,18)?.closest('button')?.title}})
 report.initial=await snapshot();assert.ok(report.initial.srcdoc>1000);assert.match(report.initial.frameUrl,/about:srcdoc#symbol=EURUSDm/);assert.equal(report.initial.readyCount,1);assert.equal(report.initial.topWidth,1920);assert.ok(report.initial.headerHit)
 await frame.locator('.legacy-native-tools > button').first().click();await frame.locator('.legacy-popover').waitFor();assert.equal(await frame.locator('.legacy-popover button').count(),2);await frame.locator('.legacy-popover button').first().press('Escape')
 await page.evaluate(()=>window.__qaWidget.activeChart().setResolution('5'))
 await frame.locator('.legacy-save-layout[data-save-state=dirty]').waitFor({state:'attached'});await frame.locator('body').press('Control+s');await frame.locator('.legacy-save-layout[data-save-state=saved]').waitFor({state:'attached'})
 report.localSaved=await page.evaluate(()=>Object.keys(localStorage).some(k=>k.startsWith('tw:advanced-chart:v1:')));assert.equal(report.localSaved,true)
 await page.screenshot({path:fileURLToPath(new URL('srcdoc-native-1920.png',out))})
 await page.reload();await page.locator('[data-chart-status=ready]').waitFor();await frame.getByTestId('legacy-native-market').waitFor();await page.waitForTimeout(350)
 report.reloaded=await snapshot();assert.equal(report.reloaded.interval,'5');assert.equal(report.reloaded.cutoff,report.initial.cutoff);assert.equal(report.reloaded.readyCount,1)
 await page.locator('.legacy-rail-tools button').click();await page.locator('.legacy-object-tree').waitFor();await page.waitForTimeout(200)
 report.drawer=await snapshot();assert.equal(report.drawer.centerRight,1592);assert.ok(report.drawer.headerHit)
 await page.screenshot({path:fileURLToPath(new URL('srcdoc-tree-1920.png',out))})
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.blocked,[]);report.pass=true
}catch(e){report.pass=false;report.failure=String(e);throw e}
finally{await writeFile(new URL('srcdoc-report.json',out),JSON.stringify(report,null,2));await browser.close();console.log(JSON.stringify(report))}
