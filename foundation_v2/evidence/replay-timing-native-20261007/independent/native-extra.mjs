import assert from 'node:assert/strict'
import {chromium} from '../../../web/node_modules/playwright/index.mjs'
import {writeFile} from 'node:fs/promises'
const browser=await chromium.launch({headless:true,ignoreDefaultArgs:['--hide-scrollbars']})
const out=new URL('./',import.meta.url),report={scope:'Actual replay GET; labeled activity fixture POST; local chart state only',cases:[],errors:[],blocked:[]}
const session='476f4b498e1a49ed9d48a75719f4d270'
const base=`http://127.0.0.1:5180/?workspace=tenant-a&view=replay&session=${session}&dataset=dataset-262639d819219431b8bbfd00a665d4fb7fde4c646a4fa0c5020608c1e1c3572d&mode=Practice&surface=workspace&cursor=500`
try{for(const [engine,theme,width,language] of [['advanced','dark',360,'en'],['advanced','light',1710,'vi'],['lightweight','dark',1710,'vi'],['lightweight','light',360,'en']]){
 const ctx=await browser.newContext({viewport:{width,height:987}})
 await ctx.addInitScript(({theme,language})=>{if(!localStorage.getItem('tw-theme'))localStorage.setItem('tw-theme',theme);if(!localStorage.getItem('tw-language'))localStorage.setItem('tw-language',language)},{theme,language})
 await ctx.routeWebSocket('**/*',s=>s.close())
 await ctx.route('**/*',async route=>{const r=route.request(),u=new URL(r.url())
  if(u.pathname===`/api/v2/replay/sessions/${session}/activity`&&r.method()==='POST'){const e=r.postDataJSON();return route.fulfill({status:200,json:{schema_version:'replay-activity-v1',session_id:session,event_id:e.event_id,accepted_seconds:(Date.parse(e.ended_at_utc)-Date.parse(e.started_at_utc))/1000,fixture:'native-extra'}})}
  if(!['GET','HEAD','OPTIONS'].includes(r.method())||!['http://127.0.0.1:5180','http://127.0.0.1:8010'].includes(u.origin)){report.blocked.push({method:r.method(),url:r.url()});return route.abort()}
  if(u.pathname.endsWith('charting_library.standalone.js')){const response=await route.fetch();return route.fulfill({response,body:await response.text()+`;window.TradingView.widget=new Proxy(window.TradingView.widget,{construct(Target,args){const item=new Target(...args);window.__qaWidget=item;window.__qaOptions=args[0];return item}});`})}
  return route.continue()
 })
 const p=await ctx.newPage();p.on('pageerror',e=>report.errors.push(String(e)));await p.goto(base+(engine==='lightweight'?'&chart_engine=lightweight':''),{waitUntil:'networkidle'})
 const chart=p.getByTestId('replay-chart');await chart.waitFor()
 const checks=[]
 if(engine==='advanced'){
  await p.locator('[data-chart-status=ready]').waitFor({timeout:25000})
  const state=()=>p.evaluate(()=>new Promise(resolve=>window.__qaWidget.save(resolve)))
  const check=async expected=>{const s=await state(),pane=s.charts[0],main=pane.panes.flatMap(x=>x.sources||[]).find(x=>x.type==='MainSeries');assert.equal(main.state.candleStyle.upColor.toUpperCase(),'#26A69A');assert.equal(main.state.candleStyle.downColor.toUpperCase(),'#EF5350');assert.equal(pane.chartProperties.paneProperties.background.toUpperCase(),expected==='dark'?'#131722':'#FFFFFF');assert.equal(await p.evaluate(()=>window.__qaOptions.disabled_features.includes('widget_logo')),true);checks.push({theme:expected,colors:true,logoDisabled:true})}
  await check(theme)
  const frame=await(await p.locator('.advanced-chart-host iframe').elementHandle()).contentFrame()
  const target=theme==='dark'?'light':'dark';let button=frame.getByTestId('theme-toggle');if(!await button.isVisible())button=p.locator('.legacy-mobile-theme');await button.click()
  await p.waitForFunction(theme=>document.querySelector('.fx-app').dataset.theme===theme,target)
  await p.waitForFunction(theme=>document.querySelector('.advanced-chart-host iframe').contentDocument.documentElement.classList.contains('theme-dark')===(theme==='dark'),target)
  await p.waitForFunction(theme=>new Promise(resolve=>window.__qaWidget.save(s=>resolve(s.charts[0].chartProperties.paneProperties.background.toUpperCase()===(theme==='dark'?'#131722':'#FFFFFF')))),target)
  await check(target);await p.reload({waitUntil:'networkidle'});await p.locator('[data-chart-status=ready]').waitFor({timeout:25000});await check(target)
 }else{
  await p.waitForFunction(()=>[...document.querySelectorAll('[data-testid=replay-chart] canvas')].some(x=>x.width>200))
  const colors=await chart.evaluate((host,theme)=>{const values={background:0,up:0,down:0};const wanted={background:theme==='dark'?[19,23,34]:[255,255,255],up:[38,166,154],down:[239,83,80]};for(const c of host.querySelectorAll('canvas')){const data=c.getContext('2d').getImageData(0,0,c.width,c.height).data;for(let i=0;i<data.length;i+=4)if(data[i+3]>250)for(const [name,rgb]of Object.entries(wanted))if(rgb.every((v,j)=>data[i+j]===v))values[name]++}return values},theme)
  assert.ok(colors.background>1000,JSON.stringify(colors));assert.ok(colors.up>0,JSON.stringify(colors));assert.ok(colors.down>0,JSON.stringify(colors));assert.equal(await chart.locator('a[href*=tradingview]').count(),0);checks.push({theme,canvasExactPixels:colors,logoAbsent:true})
 }
 await chart.screenshot({path:new URL(`chart-${engine}-${theme}-${width}.png`,out).pathname.replace(/^\/([A-Za-z]:)/,'$1')})
 report.cases.push({engine,theme,width,language,checks,pass:true});await ctx.close()
}report.pass=!report.errors.length}catch(e){report.pass=false;report.failure=String(e);process.exitCode=1}finally{await browser.close();await writeFile(new URL('native-extra-report.json',out),JSON.stringify(report,null,2))}
console.log(JSON.stringify({pass:report.pass,cases:report.cases.length,errors:report.errors,failure:report.failure}))
