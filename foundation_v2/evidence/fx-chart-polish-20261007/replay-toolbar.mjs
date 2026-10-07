import assert from 'node:assert/strict'
import { chromium } from '../../web/node_modules/playwright/index.mjs'
import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { replayRewindBucket } from '../../web/src/legacyReplayModel.js'
const session='476f4b498e1a49ed9d48a75719f4d270', base='http://127.0.0.1:5180'
const url=`${base}/?workspace=tenant-a&view=replay&session=${session}&dataset=dataset-262639d819219431b8bbfd00a665d4fb7fde4c646a4fa0c5020608c1e1c3572d&mode=Practice&surface=workspace&cursor=500`
const report={scope:'Real service GET and actual native chart; all POST intercepted. Step returns revision conflict fixture, no order/session writes.',errors:[],writes:[],gets:[],cases:[]}
const browser=await chromium.launch({headless:true})
try{
 const context=await browser.newContext({viewport:{width:1920,height:940}})
 await context.routeWebSocket('**/*',socket=>socket.close())
 await context.route('**/*',async route=>{
  const req=route.request(),u=new URL(req.url())
  if(req.method()==='POST'){
   report.writes.push({path:u.pathname,body:req.postDataJSON()})
   if(u.pathname.endsWith('/activity'))return route.fulfill({status:200,json:{schema_version:'replay-activity-v1',event_id:req.postDataJSON().event_id,session_id:session,accepted_seconds:(Date.parse(req.postDataJSON().ended_at_utc)-Date.parse(req.postDataJSON().started_at_utc))/1000}})
   if(u.pathname.endsWith('/step')){await new Promise(resolve=>setTimeout(resolve,500));return route.fulfill({status:409,json:{detail:'Guarded QA revision conflict'}})}
   return route.abort()
  }
  if(!['GET','HEAD','OPTIONS'].includes(req.method())||!u.origin.startsWith('http://127.0.0.1:'))return route.abort()
  if(u.pathname===`/api/v2/replay/sessions/${session}`)report.gets.push(u.search)
  if(u.pathname.endsWith('charting_library.standalone.js')){
   const response=await route.fetch();return route.fulfill({response,body:await response.text()+';window.TradingView.widget=new Proxy(window.TradingView.widget,{construct(Target,args){const item=new Target(...args);window.__qaWidget=item;return item}});'})
  }
  return route.continue()
 })
 const page=await context.newPage();page.on('pageerror',e=>report.errors.push(String(e)))
 await page.goto(url);await page.locator('[data-chart-status=ready]').waitFor({timeout:30000})
 const toolbar=page.locator('.legacy-fx-playback'), frame=page.frameLocator('.advanced-chart-host iframe')
 const knownResponse=await context.request.get(`${base}/api/v2/replay/sessions/${session}`,{headers:{'X-Workspace-Id':'tenant-a'}}),known=await knownResponse.json()
 const currentCursor=()=>Number(new URL(page.url()).searchParams.get('cursor'))
 const backTarget=(cursor,seconds)=>replayRewindBucket(known.visible_rows.slice(0,cursor+1),cursor,seconds)
 const forwardTarget=(cursor,seconds)=>{const boundary=(Math.floor(known.visible_rows[cursor].timestamp/seconds)+1)*seconds;const next=known.visible_rows.findIndex((row,i)=>i>cursor&&row.timestamp>=boundary);return next<0?known.canonical_cursor_index:next}
 await frame.getByTestId('legacy-native-market').waitFor()
 const slider=toolbar.locator('input[type=range]')
 assert.equal(await slider.getAttribute('max'),'15');await slider.fill('15');assert.equal(await slider.getAttribute('aria-valuetext'),'16\u00d7 / s')
 await toolbar.locator('.legacy-replay-interval').click()
 const menu=page.locator('.legacy-replay-intervals');assert.equal(await menu.getByRole('button',{name:'5s',exact:true}).isEnabled(),false)
 await menu.getByRole('button',{name:'5m',exact:true}).click();assert.equal(await page.evaluate(()=>window.__qaWidget.activeChart().resolution()),'1')
 let rewind=backTarget(currentCursor(),300);await toolbar.locator('.legacy-replay-previous').click();await page.waitForURL(u=>u.searchParams.get('cursor')===String(rewind));await page.locator('[data-chart-status=ready]').waitFor()
 let forward=forwardTarget(rewind,300);await toolbar.getByTestId('step-1').click();await page.waitForURL(u=>u.searchParams.get('cursor')===String(forward));await page.locator('[data-chart-status=ready]').waitFor()
 report.cases.push('Independent5m rewind/forward is actual historical GET, native chart remains1m')
 await page.evaluate(()=>window.__qaWidget.activeChart().setResolution('15'))
 await toolbar.getByRole('switch').check();await page.waitForFunction(()=>document.querySelector('.legacy-replay-interval').textContent==='15m')
 rewind=backTarget(currentCursor(),900);await toolbar.locator('.legacy-replay-previous').click();await page.waitForURL(u=>u.searchParams.get('cursor')===String(rewind));await page.locator('[data-chart-status=ready]').waitFor()
 assert.equal(await page.evaluate(()=>window.__qaWidget.activeChart().resolution()),'15')
 forward=forwardTarget(rewind,900);await toolbar.getByTestId('step-1').click();await page.waitForURL(u=>u.searchParams.get('cursor')===String(forward));await page.locator('[data-chart-status=ready]').waitFor()
 report.cases.push('Sync15m stays across historical remount and uses occupied UTC bucket boundary')
 await toolbar.locator('.legacy-replay-reset').click();assert.equal(await toolbar.locator('.legacy-replay-reset').getAttribute('aria-pressed'),'true')
 await frame.locator('body').press('Escape');assert.equal(await toolbar.locator('.legacy-replay-reset').getAttribute('aria-pressed'),'false')
 report.cases.push('Bar selection arms and native-frame Escape cancels')
 await page.screenshot({path:fileURLToPath(new URL('replay-toolbar-1920.png',import.meta.url))})
 await toolbar.getByRole('switch').uncheck();await toolbar.locator('.legacy-replay-interval').click();await menu.getByRole('button',{name:'1h',exact:true}).click()
 // Read latest canonical cursor before intercepted step; no user-session POST can leave this browser.
 const response=await context.request.get(`${base}/api/v2/replay/sessions/${session}`,{headers:{'X-Workspace-Id':'tenant-a'}}),data=await response.json()
 await page.goto(url.replace('cursor=500',`cursor=${data.canonical_cursor_index}`));await page.locator('[data-chart-status=ready]').waitFor();await frame.getByTestId('legacy-native-market').waitFor()
 await toolbar.locator('.legacy-replay-interval').click();await menu.getByRole('button',{name:'1h',exact:true}).click()
 await toolbar.locator('input[type=range]').fill('15');await toolbar.getByTestId('play-toggle').click()
 await page.waitForTimeout(150);assert.equal(report.writes.filter(w=>w.path.endsWith('/step')).length,1)
 assert.equal(await toolbar.getByTestId('play-toggle').isEnabled(),true);await toolbar.getByTestId('play-toggle').click()
 await page.waitForTimeout(600)
 const steps=report.writes.filter(w=>w.path.endsWith('/step'));assert.equal(steps.length,1);assert.equal(steps[0].body.steps,1);assert.equal(steps[0].body.replay_interval_seconds,3600)
 assert.equal(await toolbar.getByTestId('play-toggle').isEnabled(),false)
 report.cases.push('Canonical1h dispatches typed3600seconds; single request in flight, Pause works while pending and409 locks playback')
 assert.deepEqual(report.errors,[]);report.pass=true
 await context.close()
}catch(e){report.pass=false;report.failure=String(e);throw e}
finally{await writeFile(new URL('replay-toolbar-report.json',import.meta.url),JSON.stringify(report,null,2));await browser.close();console.log(JSON.stringify({pass:report.pass,cases:report.cases,failure:report.failure,errors:report.errors}))}
