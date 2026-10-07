import assert from 'node:assert/strict'
import {chromium} from '../../../web/node_modules/playwright/index.mjs'
import {mkdir,writeFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
const out=new URL('./',import.meta.url);await mkdir(out,{recursive:true})
const browser=await chromium.launch({headless:true,ignoreDefaultArgs:['--hide-scrollbars']})
const report={scope:'Actual GET; activity fixture POST; local native chart actions only',cases:[],errors:[],blocked:[],vendorBlocked:[],axe:[]}
const session='476f4b498e1a49ed9d48a75719f4d270'
const url=`http://127.0.0.1:5180/?workspace=tenant-a&view=replay&session=${session}&dataset=dataset-262639d819219431b8bbfd00a665d4fb7fde4c646a4fa0c5020608c1e1c3572d&mode=Practice&surface=workspace&cursor=500`
let latest
try{for(const[theme,width,language]of [['light',1710,'en'],['dark',1710,'vi'],['light',360,'vi'],['dark',768,'en'],['dark',1300,'vi']]){
 const context=await browser.newContext({viewport:{width,height:987}})
 await context.addInitScript(({theme,language})=>{if(!localStorage.getItem('tw-theme'))localStorage.setItem('tw-theme',theme);if(!localStorage.getItem('tw-language'))localStorage.setItem('tw-language',language)},{theme,language})
 await context.routeWebSocket('**/*',s=>s.close())
 await context.route('**/*',async route=>{const r=route.request(),u=new URL(r.url());
  if(r.method()==='POST'&&u.pathname===`/api/v2/replay/sessions/${session}/activity`){const e=r.postDataJSON();return route.fulfill({status:200,json:{fixture:'legacy-independent',schema_version:'replay-activity-v1',event_id:e.event_id,session_id:session,accepted_seconds:(Date.parse(e.ended_at_utc)-Date.parse(e.started_at_utc))/1000}})}
  if(['GET','HEAD','OPTIONS'].includes(r.method())&&['http://127.0.0.1:5180','http://127.0.0.1:8010'].includes(u.origin)){
   if(u.pathname.endsWith('charting_library.standalone.js')){const response=await route.fetch();return route.fulfill({response,body:await response.text()+`;window.TradingView.widget=new Proxy(window.TradingView.widget,{construct(Target,args){const item=new Target(...args);window.__qaWidget=item;window.__qaOptions=args[0];return item}});`})}
   return route.continue()
  }
  if(r.method()==='GET'&&r.url()==='http://www.google-analytics.com/analytics.js')report.vendorBlocked.push(r.url());else report.blocked.push({method:r.method(),url:r.url()});return route.abort()
 })
 const p=await context.newPage();latest=p;p.setDefaultTimeout(12000);p.on('pageerror',e=>report.errors.push(String(e)));const t=(vi,en)=>language==='vi'?vi:en
 console.log('case',theme,width,language);await p.goto(url,{waitUntil:'networkidle'});await p.locator('[data-chart-status=ready]').waitFor({timeout:25000})
 const header=p.getByTestId('legacy-chart-header'),menu=p.locator('.legacy-header-menu'),overflow=header.locator('.chart-header-overflow')
 const open=async label=>{const direct=header.getByRole('button',{name:label,exact:true});if(await direct.isVisible())await direct.click();else{await overflow.click();await menu.getByRole('button',{name:label,exact:true}).click()}}
 const canonical=()=>p.evaluate(()=>{const host=document.querySelector('[data-testid=replay-chart]');return{rows:host.dataset.visibleRowCount,cutoff:host.dataset.cutoff,symbol:window.__qaWidget.activeChart().symbol()}})
 const before=await canonical(),checks=[]
 assert.equal(await header.getByRole('button',{name:'Alerts',exact:true}).count(),0);assert.ok(await p.evaluate(()=>window.__qaOptions.disabled_features.includes('header_widget')&&window.__qaOptions.disabled_features.includes('widget_logo')))
 for(const [tool,label]of [['compare',t('So sánh mã','Compare symbols')],['layout','New Layout'],['editor','Editor'],['mentor','AI Mentor'],['search',t('Tìm công cụ','Quick Search')]]){
  await open(label);const panel=p.getByTestId(`chart-preview-${tool}`);await panel.waitFor();await p.waitForFunction(()=>document.activeElement.id==='replay-context-panel');if(tool!=='search')assert.ok(await panel.locator('button:disabled').count())
  if(['editor','mentor'].includes(tool)){await panel.locator('textarea').fill('fixture private note');await panel.locator('textarea').press('ArrowRight')}
  if(tool==='search'){await panel.locator('input').fill('zz-fixture');assert.equal(await panel.locator('button').count(),0)}
  await p.keyboard.press('Escape');await panel.waitFor({state:'hidden'});await p.waitForFunction(()=>document.activeElement.tagName==='BUTTON');assert.deepEqual(await canonical(),before);checks.push(`${tool}: open/close, explicit preview or local search, cutoff preserved`)
 }
 await p.getByRole('button',{name:'Scalper mode',exact:true}).click();await p.getByTestId('chart-preview-scalper').waitFor();assert.ok(await p.getByTestId('chart-preview-scalper').locator('button:disabled').count());await p.keyboard.press('Escape')
 const balance=p.locator('.legacy-balance');const balanceText=await balance.innerText();await p.getByRole('button',{name:t('Ẩn số dư','Hide balance'),exact:true}).click();assert.equal(await balance.innerText(),'••••••');await p.getByRole('button',{name:t('Hiện số dư','Show balance'),exact:true}).click();assert.equal(await balance.innerText(),balanceText)
 await p.getByRole('button',{name:t('Mở danh sách lệnh','Expand positions'),exact:true}).click();await p.locator('.legacy-positions').waitFor();assert.match(await p.locator('.legacy-positions tbody').innerText(),language==='vi'?/cutoff/:/cutoff/);await p.getByRole('button',{name:t('Thu gọn danh sách lệnh','Collapse positions'),exact:true}).click();await p.locator('.legacy-positions').waitFor({state:'hidden'});assert.deepEqual(await canonical(),before);checks.push('footer balance visibility/positions toggle with actual unknown cutoff preserved')
 const quick=p.locator('.legacy-quick-actions');assert.equal(await quick.isVisible(),width>900);if(width>900){const initial=await quick.boundingBox();await quick.locator('.chart-float-grip').focus();await p.keyboard.press('ArrowLeft');await p.waitForFunction(x=>document.querySelector('.legacy-quick-actions').getBoundingClientRect().x<x,initial.x);const moved=await quick.boundingBox();assert.equal(Math.round(initial.x-moved.x),12);checks.push('quick actions keyboard drag12px, local preference only')}
 // Official interval API recomputes from the visible dataset prefix.
 if(width>720)await header.locator('.legacy-header-intervals').getByRole('button',{name:'5m',exact:true}).click();else{await header.locator('.legacy-interval-menu').click();await menu.getByRole('button',{name:'5m',exact:true}).click()}
 await p.waitForFunction(()=>window.__qaWidget.activeChart().resolution()==='5');assert.deepEqual(await canonical(),before);checks.push('native5m resolution with unchanged canonical cutoff')
 await open(t('Kiểu biểu đồ','Chart type'));await menu.getByRole('button',{name:t('Đường','Line'),exact:true}).click();await p.waitForFunction(()=>window.__qaWidget.activeChart().chartType()===2);assert.deepEqual(await canonical(),before);checks.push('native chart style with unchanged cutoff')
 // Native settings opens through the documented chart action (no persistence API).
 await open(t('Cài đặt biểu đồ','Chart settings'))
 const frame=await(await p.locator('.advanced-chart-host iframe').elementHandle()).contentFrame();const nativeSettings=frame.locator('[data-name="series-properties-dialog"]');await nativeSettings.waitFor();await nativeSettings.locator('[data-name="close"]').click();await nativeSettings.waitFor({state:'hidden'});checks.push('native series settings dialog desktop/mobile')
 // Menu boundary must dismiss on native iframe pointerdown.
 await header.locator('.legacy-interval-menu').isVisible().then(async visible=>{if(visible)await header.locator('.legacy-interval-menu').click();else await header.getByRole('button',{name:t('Kiểu biểu đồ','Chart type'),exact:true}).click()})
 const box=await p.locator('.advanced-chart-host iframe').boundingBox();await p.mouse.click(box.x+80,box.y+650);await menu.waitFor({state:'hidden'});checks.push('iframe outside dismissal')
 await p.addScriptTag({path:'../../.artifacts/wm-integration-quality-tools/node_modules/axe-core/axe.min.js'})
 const axe=await p.evaluate(()=>window.axe.run({include:[['.legacy-chart-header']]},{rules:{region:{enabled:false}}}));report.axe.push({theme,width,language,violations:axe.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))}))})
 assert.equal(axe.violations.length,0)
 const geometry=await header.evaluate(e=>{const r=e.getBoundingClientRect();return{left:r.left,right:r.right,top:r.top,scroll:document.documentElement.scrollWidth-innerWidth,badControls:[...e.querySelectorAll('button,a')].filter(b=>b.getBoundingClientRect().width&&b.getBoundingClientRect().height).map(b=>{const x=b.getBoundingClientRect(),hit=document.elementFromPoint(x.x+x.width/2,x.y+x.height/2);return{label:b.getAttribute('aria-label')||b.textContent,left:x.left,right:x.right,hit:hit===b||b.contains(hit)}}).filter(b=>b.left<0||b.right>innerWidth||!b.hit)}});assert.equal(geometry.left,0);assert.equal(geometry.right,width);assert.equal(geometry.scroll,0);assert.deepEqual(geometry.badControls,[])
 await p.screenshot({path:fileURLToPath(new URL(`actual-${theme}-${language}-${width}.png`,out))});report.cases.push({theme,width,language,checks,geometry,pass:true});await context.close();await writeFile(new URL('progress.json',out),JSON.stringify(report,null,2))
}report.pass=!report.errors.length&&!report.blocked.length}catch(e){report.pass=false;report.failure=String(e);await latest?.screenshot({path:fileURLToPath(new URL('failure.png',out))}).catch(()=>{});process.exitCode=1}finally{await browser.close();await writeFile(new URL('report.json',out),JSON.stringify(report,null,2))}
console.log(JSON.stringify({pass:report.pass,cases:report.cases.length,errors:report.errors,failure:report.failure}))
