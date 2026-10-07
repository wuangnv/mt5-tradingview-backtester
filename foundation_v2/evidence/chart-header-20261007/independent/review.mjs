import assert from 'node:assert/strict'
import {chromium} from '../../../web/node_modules/playwright/index.mjs'
import {mkdir,writeFile} from 'node:fs/promises'
const out=new URL('./',import.meta.url);await mkdir(out,{recursive:true})
const session='476f4b498e1a49ed9d48a75719f4d270',report={scope:'Actual chart localhost GET; labeled activity POST fixture; local layout/download/fullscreen only',cases:[],errors:[],blocked:[],vendorAnalyticsBlocked:[],activityFixtures:0,axe:[]}
const url=`http://127.0.0.1:5180/?workspace=tenant-a&view=replay&session=${session}&dataset=dataset-262639d819219431b8bbfd00a665d4fb7fde4c646a4fa0c5020608c1e1c3572d&mode=Practice&surface=workspace&cursor=500`
const browser=await chromium.launch({headless:true,ignoreDefaultArgs:['--hide-scrollbars']})
let latestPage
try{for(const [theme,width,language]of [['dark',1710,'vi'],['light',1710,'en'],['dark',768,'en'],['light',768,'vi'],['dark',390,'vi'],['light',360,'en'],['dark',1300,'en']]){
 const context=await browser.newContext({viewport:{width,height:987}})
 await context.addInitScript(({theme,language})=>{if(!localStorage.getItem('tw-theme'))localStorage.setItem('tw-theme',theme);if(!localStorage.getItem('tw-language'))localStorage.setItem('tw-language',language)},{theme,language})
 await context.routeWebSocket('**/*',s=>s.close())
 await context.route('**/*',async route=>{const r=route.request(),u=new URL(r.url());
  if(u.pathname===`/api/v2/replay/sessions/${session}/activity`&&r.method()==='POST'){const e=r.postDataJSON();report.activityFixtures++;return route.fulfill({status:200,json:{fixture:'header-independent',schema_version:'replay-activity-v1',session_id:session,event_id:e.event_id,accepted_seconds:(Date.parse(e.ended_at_utc)-Date.parse(e.started_at_utc))/1000}})}
  if(['GET','HEAD','OPTIONS'].includes(r.method())&&['http://127.0.0.1:5180','http://127.0.0.1:8010'].includes(u.origin)){
   if(u.pathname.endsWith('charting_library.standalone.js')){const response=await route.fetch();return route.fulfill({response,body:await response.text()+`;window.TradingView.widget=new Proxy(window.TradingView.widget,{construct(Target,args){const result=new Target(...args);window.__qaWidget=result;window.__qaWidgetOptions=args[0];return result}});`})}
   return route.continue()
  }
  if(r.method()==='GET'&&r.url()==='http://www.google-analytics.com/analytics.js')report.vendorAnalyticsBlocked.push(r.url());else report.blocked.push({method:r.method(),url:r.url()});return route.abort()
 })
 const p=await context.newPage();latestPage=p;p.setDefaultTimeout(15000);p.on('pageerror',e=>report.errors.push(String(e)))
 const label=s=>language==='vi'?s[0]:s[1]
 console.log('case',theme,width,language)
 await p.goto(url,{waitUntil:'networkidle'});await p.locator('[data-chart-status=ready]').waitFor({timeout:25000})
 const frame=await(await p.locator('.advanced-chart-host iframe').elementHandle()).contentFrame()
 const tail=p.getByTestId('chart-header-tail'),overflow=p.locator('.chart-header-overflow')
 const state=()=>p.evaluate(()=>{const chart=window.__qaWidget.activeChart(),host=document.querySelector('[data-testid=replay-chart]');return {symbol:chart.symbol(),resolution:chart.resolution(),shapeCount:chart.getAllShapes().length,cutoff:host.dataset.cutoff,rows:host.dataset.visibleRowCount}})
 const before=await state(),checks=[]
 assert.equal(await frame.locator('.legacy-header-session [data-testid=replay-status]').count(),0)
 assert.equal(await frame.getByRole('button',{name:label(['Vừa lệnh','Fit order']),exact:true}).count(),0)
 assert.ok(await p.evaluate(()=>window.__qaWidgetOptions.disabled_features.includes('widget_logo')))
 const menu=async()=>{await overflow.click();await p.locator('#chart-header-menu').waitFor();return p.locator('#chart-header-menu')}
 async function action(name){const native=frame.getByRole('button',{name,exact:true});if(await tail.evaluate(e=>e.classList.contains('is-compact'))){const m=await menu();const button=m.getByRole('button',{name,exact:true});await button.click();return {kind:'menu',locator:overflow}}await native.click();return {kind:'native',locator:native}}
 for(const [tool,name]of [['compare',label(['So sánh mã','Compare symbols'])],['layout','New Layout'],['alerts','Alerts'],['editor','Editor']]){
  const opener=await action(name),preview=p.getByTestId(`chart-preview-${tool}`);await preview.waitFor();await p.waitForFunction(()=>document.activeElement.id==='replay-context-panel')
  assert.ok((await preview.innerText()).includes(label(['Giao diện mẫu · chưa kích hoạt chức năng','UI preview · feature not enabled'])))
  assert.ok(await preview.locator('button:disabled').count())
  if(tool==='compare'){await preview.locator('input').fill('GBPUSD');await preview.locator('input').press('ArrowRight')}
  if(tool==='layout'){await preview.getByRole('button',{name:/^2 /}).click();assert.equal(await preview.getByRole('button',{name:/^2 /}).getAttribute('aria-pressed'),'true')}
  if(tool==='alerts'){await preview.locator('select').selectOption('above');await preview.locator('input[type=number]').fill('1.2');await preview.locator('input[type=number]').press('ArrowRight')}
  if(tool==='editor'){await preview.locator('textarea').fill('// fixture code\nplot(close)');await preview.locator('textarea').press('ArrowRight');await preview.locator('textarea').press('Control+Enter')}
  assert.deepEqual(await state(),before,'reference panels preserve chart symbol/resolution/cutoff/drawings')
  if(['layout','editor'].includes(tool)){
   await p.addScriptTag({path:'../../.artifacts/wm-integration-quality-tools/node_modules/axe-core/axe.min.js'})
   const axe=await p.evaluate(()=>window.axe.run({include:[['.chart-header-preview']]},{rules:{'region':{enabled:false}}}));report.axe.push({theme,width,language,tool,violations:axe.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>n.target)}))});assert.equal(axe.violations.length,0)
  }
  if(tool==='editor')await p.screenshot({path:new URL(`editor-${theme}-${language}-${width}.png`,out).pathname.replace(/^\/([A-Za-z]:)/,'$1')})
  await p.keyboard.press('Escape');await preview.waitFor({state:'hidden'})
  await p.waitForFunction(()=>document.activeElement.id!=='replay-context-panel')
  const focused=await opener.locator.evaluate(e=>new Promise(resolve=>{let frames=0;const check=()=>{if(e.ownerDocument.activeElement===e)return resolve(true);if(frames++>60)return resolve(false);e.ownerDocument.defaultView.requestAnimationFrame(check)};check()}))
  assert.equal(focused,true,`${tool} closes back to its opener at ${width}`)
  checks.push(`${tool}: inputs/local choice, execution disabled, chart preserved, Escape/focus`)
 }
 // Test compact menu's dismissal across the same-origin native chart boundary.
 if(await overflow.isVisible()){
  await menu();await p.keyboard.press('Escape');assert.equal(await overflow.getAttribute('aria-expanded'),'false');assert.equal(await overflow.evaluate(e=>document.activeElement===e),true)
  await menu();const box=await p.locator('.advanced-chart-host iframe').boundingBox();await p.mouse.click(box.x+90,box.y+650);await p.locator('#chart-header-menu').waitFor({state:'hidden'});checks.push('compact menu Escape and iframe outside dismissal')
 }
 // Existing local save and client PNG screenshot remain usable.
 const chartKey=`tw:advanced-chart:v1:tenant-a:${session}:dataset-262639d819219431b8bbfd00a665d4fb7fde4c646a4fa0c5020608c1e1c3572d`
 await action(label(['Lưu chart','Save chart']));await p.waitForFunction(key=>Boolean(localStorage.getItem(key)),chartKey)
 const downloadPromise=p.waitForEvent('download');await action(label(['Chụp biểu đồ PNG','Capture chart as PNG']));const download=await downloadPromise;assert.ok(download.suggestedFilename().startsWith('WMReplay-'));checks.push('local save/client PNG retained')
 // Fullscreen encompasses app+native chart+rail, including compact menu inside fullscreen.
 const fullscreen=label(['Toàn màn hình','Fullscreen']),exit=label(['Thoát toàn màn hình','Exit fullscreen'])
 if(await overflow.isVisible())await(await menu()).getByRole('button',{name:fullscreen,exact:true}).click();else await tail.getByRole('button',{name:fullscreen,exact:true}).click()
 await p.waitForFunction(()=>document.fullscreenElement?.classList.contains('fx-app'))
 if(await overflow.isVisible())await(await menu()).getByRole('button',{name:exit,exact:true}).click();else await tail.getByRole('button',{name:exit,exact:true}).click()
 await p.waitForFunction(()=>!document.fullscreenElement);checks.push('actual fullscreen enter/exit with all header controls retained')
 // Theme: match native pane palette after asynchronous vendor transition and reload.
 if(await overflow.isVisible())await(await menu()).getByRole('button',{name:label(['Đổi giao diện','Change theme']),exact:true}).click();else await frame.getByTestId('theme-toggle').click()
 const target=theme==='dark'?'light':'dark';await p.waitForFunction(target=>document.querySelector('.fx-app').dataset.theme===target,target)
 await p.waitForFunction(target=>new Promise(resolve=>window.__qaWidget.save(s=>resolve(s.charts[0].chartProperties.paneProperties.background.toUpperCase()===(target==='dark'?'#131722':'#FFFFFF')))),target)
 await p.reload({waitUntil:'networkidle'});await p.locator('[data-chart-status=ready]').waitFor({timeout:25000})
 const reframe=await(await p.locator('.advanced-chart-host iframe').elementHandle()).contentFrame();assert.equal(await reframe.locator('.legacy-market-host').count(),1);assert.equal(await reframe.locator('.legacy-tools-host').count(),1);assert.equal(await reframe.locator('.legacy-session-host').count(),1);assert.deepEqual(await state(),before)
 const rects=await p.evaluate(()=>{const i=document.querySelector('.advanced-chart-host iframe').getBoundingClientRect(),t=document.querySelector('.chart-header-tail').getBoundingClientRect(),r=document.querySelector('.chart-utility-rail').getBoundingClientRect();return {iframe:{x:i.x,y:i.y,right:i.right},tail:{x:t.x,y:t.y,right:t.right,height:t.height},rail:{x:r.x,right:r.right}}})
 assert.ok(Math.abs(rects.tail.x-rects.iframe.right)<=1);assert.ok(Math.abs(rects.tail.y-rects.iframe.y)<=1);assert.ok(Math.abs(rects.tail.right-rects.rail.right)<=1);checks.push('tail aligns native header and spans rail; reload has one control group')
 await p.screenshot({path:new URL(`header-${target}-${language}-${width}.png`,out).pathname.replace(/^\/([A-Za-z]:)/,'$1')})
 report.cases.push({theme,width,language,checks,rects,pass:true});await context.close();await writeFile(new URL('progress.json',out),JSON.stringify(report,null,2))
}
assert.equal(report.errors.length,0);assert.equal(report.blocked.length,0);report.pass=true
}catch(e){report.pass=false;report.failure=String(e);await latestPage?.screenshot({path:new URL('failure.png',out).pathname.replace(/^\/([A-Za-z]:)/,'$1')}).catch(()=>{});process.exitCode=1}finally{await browser.close();await writeFile(new URL('report.json',out),JSON.stringify(report,null,2))}
console.log(JSON.stringify({pass:report.pass,cases:report.cases.length,axe:report.axe.length,errors:report.errors,failure:report.failure}))
