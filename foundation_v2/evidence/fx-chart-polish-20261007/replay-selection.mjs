import assert from 'node:assert/strict'
import { chromium } from '../../web/node_modules/playwright/index.mjs'
import { writeFile } from 'node:fs/promises'
const session='476f4b498e1a49ed9d48a75719f4d270',base='http://127.0.0.1:5180'
const url=`${base}/?workspace=tenant-a&view=replay&session=${session}&dataset=dataset-262639d819219431b8bbfd00a665d4fb7fde4c646a4fa0c5020608c1e1c3572d&mode=Practice&surface=workspace&cursor=500`
const report={scope:'Real native canvas click and actual historical GET. All POST except fixture activity blocked.',errors:[],gets:[],writes:[]}
const browser=await chromium.launch({headless:true})
try{
 const context=await browser.newContext({viewport:{width:1920,height:940}})
 await context.routeWebSocket('**/*',socket=>socket.close())
 await context.route('**/*',async route=>{
  const req=route.request(),u=new URL(req.url())
  if(req.method()==='POST'){
   if(u.pathname.endsWith('/activity')){const e=req.postDataJSON();return route.fulfill({status:200,json:{schema_version:'replay-activity-v1',event_id:e.event_id,session_id:session,accepted_seconds:(Date.parse(e.ended_at_utc)-Date.parse(e.started_at_utc))/1000}})}
   report.writes.push(u.pathname);return route.abort()
  }
  if(!['GET','HEAD','OPTIONS'].includes(req.method())||!u.origin.startsWith('http://127.0.0.1:'))return route.abort()
  if(u.pathname===`/api/v2/replay/sessions/${session}`)report.gets.push(u.search)
  if(u.pathname.endsWith('charting_library.standalone.js')){const response=await route.fetch();return route.fulfill({response,body:await response.text()+';window.TradingView.widget=new Proxy(window.TradingView.widget,{construct(Target,args){const item=new Target(...args);window.__qaWidget=item;return item}});'})}
  return route.continue()
 })
 const page=await context.newPage();page.on('pageerror',e=>report.errors.push(String(e)))
 await page.goto(url);await page.locator('[data-chart-status=ready]').waitFor({timeout:30000})
 await page.frameLocator('.advanced-chart-host iframe').getByTestId('legacy-native-market').waitFor()
 await page.evaluate(()=>window.__qaWidget.activeChart().crossHairMoved().subscribe(null,event=>{window.__qaCrosshairTime=event.time}))
 const response=await context.request.get(`${base}/api/v2/replay/sessions/${session}?cursor_index=500`,{headers:{'X-Workspace-Id':'tenant-a'}}),data=await response.json()
 const bounds=await page.evaluate(()=>{const frame=document.querySelector('.advanced-chart-host iframe'),r=frame.getBoundingClientRect(),c=frame.contentDocument.querySelector('.layout__area--center').getBoundingClientRect();return{x:r.x+c.x,y:r.y+c.y,width:c.width,height:c.height}})
 const toolbar=page.locator('.legacy-fx-playback');await toolbar.locator('.legacy-replay-reset').click()
 let target
 for(const ratio of [.4,.25,.6,.1]){
  const x=bounds.x+bounds.width*ratio,y=bounds.y+bounds.height*.4
  await page.mouse.move(x,y)
  await page.waitForTimeout(70)
  const time=await page.evaluate(()=>window.__qaCrosshairTime),index=data.visible_rows.findIndex(row=>Number(row.timestamp)===Number(time))
  if(index>=0&&index<500){target={time,index,x,y};break}
 }
 assert.ok(target,'Known prior visible candle has a native crosshair timestamp')
 await page.mouse.click(target.x,target.y)
 await page.waitForURL(u=>u.searchParams.get('cursor')===String(target.index),{timeout:10000})
 await page.locator('[data-chart-status=ready]').waitFor()
 assert.equal(await toolbar.locator('.legacy-replay-reset').getAttribute('aria-pressed'),'false')
 assert.deepEqual(report.writes,[]);assert.deepEqual(report.errors,[])
 report.pass=true;report.target=target
 await context.close()
}catch(e){report.pass=false;report.failure=String(e);throw e}
finally{await writeFile(new URL('replay-selection-report.json',import.meta.url),JSON.stringify(report,null,2));await browser.close();console.log(JSON.stringify(report))}
