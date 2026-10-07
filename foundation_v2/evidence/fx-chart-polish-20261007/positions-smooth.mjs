import assert from 'node:assert/strict'
import { chromium } from '../../web/node_modules/playwright/index.mjs'
import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
const baseline=process.argv.includes('--baseline'), out=new URL('./',import.meta.url),session='476f4b498e1a49ed9d48a75719f4d270'
const url=`http://127.0.0.1:5180/?workspace=tenant-a&view=replay&session=${session}&dataset=dataset-262639d819219431b8bbfd00a665d4fb7fde4c646a4fa0c5020608c1e1c3572d&mode=Practice&surface=workspace&cursor=500&chart_iframe=srcdoc`
const report={baseline,scope:'Actual local GET UI; activity receipts are nonpersistent fixtures. Replay/order writes and remote requests blocked.',cases:[],errors:[],blocked:[]},browser=await chromium.launch({headless:true})
try {
 for(const [width,height,theme] of baseline?[[1368,790,'dark']]:[[1368,790,'dark'],[1368,790,'light'],[360,844,'dark'],[360,844,'light']]) {
  const context=await browser.newContext({viewport:{width,height}})
  await context.addInitScript(theme=>{localStorage.setItem('tw-theme',theme);localStorage.setItem('tw-language','vi')},theme)
  await context.routeWebSocket('**/*',s=>s.close())
  await context.route('**/*',route=>{const r=route.request(),u=new URL(r.url());if(r.method()==='POST'&&u.pathname.endsWith('/activity')){const e=r.postDataJSON();return route.fulfill({status:200,json:{schema_version:'replay-activity-v1',event_id:e.event_id,session_id:session,accepted_seconds:(Date.parse(e.ended_at_utc)-Date.parse(e.started_at_utc))/1000}})}if(!['GET','HEAD','OPTIONS'].includes(r.method())||!['http://127.0.0.1:5180','http://127.0.0.1:8010'].includes(u.origin)){report.blocked.push(r.url());return route.abort()}return route.continue()})
  const page=await context.newPage();page.on('pageerror',e=>report.errors.push(String(e)))
  await page.goto(url);await page.locator('[data-chart-status=ready]').waitFor({timeout:30000})
  const grip=page.locator('.legacy-positions-grip'),work=page.locator('.legacy-trading-workspace'),panel=page.locator('.legacy-resizable-positions')
  const frame=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
  await grip.focus();await grip.press('ArrowUp');await frame()
  const b=await grip.boundingBox(),x=b.x+b.width/2,startY=b.y+b.height/2,item={width,height,theme,up:[],down:[]};report.cases.push(item)
  await page.mouse.move(x,startY);await page.mouse.down()
  const sample=async(y,target)=>{await page.mouse.move(x,y);await frame();target.push(await grip.evaluate((e,y)=>({pointer:y,center:e.getBoundingClientRect().top+e.getBoundingClientRect().height/2,panel:e.closest('.legacy-trading-workspace').querySelector('.legacy-resizable-positions').getBoundingClientRect().toJSON()}),y))}
  for(let y=startY-10;y>0;y-=10)await sample(y,item.up)
  await sample(0,item.up)
  item.maxTop=(await work.boundingBox()).y
  assert.equal(await work.evaluate(e=>e.classList.contains('is-maximized')),true)
  const deviations=item.up.filter(s=>s.pointer>60).map(s=>Math.abs(s.center-s.pointer));item.maxTrackingError=Math.max(...deviations)
  if(!baseline)assert.ok(item.maxTrackingError<=2,`grip must follow pointer without plateau/jump: ${item.maxTrackingError}`)
  await page.mouse.up();await frame()
  const full=await grip.boundingBox(),fullY=full.y+full.height/2
  await page.mouse.move(x,fullY);await page.mouse.down()
  for(let y=fullY+10;y<startY;y+=10)await sample(y,item.down)
  item.maxDownError=Math.max(...item.down.map(s=>Math.abs(s.center-s.pointer)))
  if(!baseline)assert.ok(item.maxDownError<=2,`restoring must track pointer: ${item.maxDownError}`)
  await page.mouse.up();await frame()
  if(!baseline){
   const released=await panel.boundingBox();await page.mouse.move(x,startY+40);await frame();assert.equal((await panel.boundingBox()).height,released.height)
   assert.ok(Math.abs((await page.locator('.legacy-position-paging').boundingBox()).y+(await page.locator('.legacy-position-paging').boundingBox()).height-height)<=1)
   await page.mouse.move(width-4,height/2);await page.screenshot({path:fileURLToPath(new URL(`positions-smooth-${theme}-${width}.png`,out))})
  }
  await context.close()
 }
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.blocked,[]);report.pass=true
}catch(e){report.failure=String(e);throw e}
finally{await browser.close();await writeFile(new URL(baseline?'positions-smooth-baseline.json':'positions-smooth-report.json',out),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({pass:report.pass,cases:report.cases.map(c=>({width:c.width,theme:c.theme,maxTrackingError:c.maxTrackingError,maxDownError:c.maxDownError})),failure:report.failure}))}
