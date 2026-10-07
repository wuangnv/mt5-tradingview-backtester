import assert from 'node:assert/strict'
import {chromium}from'../../../web/node_modules/playwright/index.mjs'
import{readFile,writeFile}from'node:fs/promises'
import{createHash}from'node:crypto'
const out='foundation_v2/evidence/dashboard-kpi-20261007/independent/',prior=JSON.parse(await readFile(out+'report.json','utf8'))
const pins=()=>Promise.all(prior.after.map(async({file})=>({file,sha256:createHash('sha256').update(await readFile(file.startsWith('ui/')?file:'foundation_v2/web/src/'+file)).digest('hex')})))
const report={scope:'Final localized duration-detail delta, synthetic GET fixtures; broad geometry acceptance retained',before:await pins(),cases:[],errors:[],blocked:[]}
report.sourceDelta=report.before.filter(p=>prior.after.find(v=>v.file===p.file)?.sha256!==p.sha256);assert.deepEqual(report.sourceDelta.map(p=>p.file),['DashboardPerformance.jsx','testing-copy.json'])
const browser=await chromium.launch({headless:true,ignoreDefaultArgs:['--hide-scrollbars']})
try{
 for(const[theme,language,width]of[['dark','en',1440],['light','vi',360]])for(const[name,a,b,known]of[['null',null,null,false],['invalid','60',-1,false],['zero',0,0,true],['positive',67200,3135600,true]]){
  const context=await browser.newContext({viewport:{width,height:987}}),page=await context.newPage(),r={name,theme,language,width}
  try{
   await page.addInitScript(({theme,language})=>{localStorage.setItem('tw-theme',theme);localStorage.setItem('tw-language',language)},{theme,language});await context.routeWebSocket('**/*',s=>s.close());await context.route('**/*',route=>{const q=route.request(),u=new URL(q.url());if(!['http://127.0.0.1:5180','http://127.0.0.1:8010'].includes(u.origin)||!['GET','HEAD','OPTIONS'].includes(q.method())){report.blocked.push({method:q.method(),url:q.url()});return route.abort()}return route.continue()})
   await context.route('**/api/v2/replay/sessions',route=>route.fulfill({status:200,contentType:'application/json',body:'{"items":[]}'}));await context.route('**/api/v2/data/datasets',route=>route.fulfill({status:200,contentType:'application/json',body:'{"items":[]}'}))
   const performance={schema_version:'dashboard-replay-performance-v1',status:'ready',scope:{session_count:0,readable_session_count:0},metrics:{closed_trade_count:0,wins:0,losses:0,breakeven:0,win_rate_pct:null},months:[],symbols:[],sessions:[],sources:[],excluded:[],time_invested_seconds:a,historical_time_replayed_seconds:b}
   await context.route(/\/api\/v2\/overview(?:\?|$)/,route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({performance})}));page.on('pageerror',e=>report.errors.push(String(e)))
   await page.goto('http://127.0.0.1:5180/?workspace=tenant-a&view=overview&area=testing&section=dashboard');await page.waitForLoadState('networkidle')
   r.metrics=await page.locator('.fx-dashboard-metric').evaluateAll(es=>es.slice(0,2).map(e=>({value:e.querySelector(':scope>strong').textContent,detail:e.querySelector(':scope>small').textContent})))
   if(known){assert.deepEqual(r.metrics.map(m=>m.detail),language==='en'?['Recorded time','Recorded time']:['Thời gian đã ghi nhận','Thời gian đã ghi nhận']);assert.ok(r.metrics.every(m=>!m.value.includes('—')))}else{assert.deepEqual(r.metrics.map(m=>m.value),['—','—']);assert.ok(r.metrics.every(m=>language==='en'?m.detail.includes('unavailable'):m.detail.includes('Chưa có')))}
   if(name==='zero')assert.deepEqual(r.metrics.map(m=>m.value),language==='en'?['0min','0min']:['0phút','0phút'])
   if(name==='positive'){assert.match(r.metrics[0].value,language==='en'?/18hr40min/:/18giờ40phút/);assert.match(r.metrics[1].value,language==='en'?/36d7hr/:/36ngày7giờ/)}
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)<=1)
   if(['null','zero'].includes(name)){await page.addScriptTag({path:'../../.artifacts/wm-integration-quality-tools/node_modules/axe-core/axe.min.js'});r.axe=await page.evaluate(async()=>({violations:(await axe.run(document)).violations.map(({id,nodes})=>({id,targets:nodes.map(n=>n.target)}))}));assert.equal(r.axe.violations.length,0)}
   await page.screenshot({path:out+`duration-copy-${name}-${theme}-${language}-${width}.png`});report.cases.push(r)
  }finally{await context.close()}
 }
 report.after=await pins();report.sourceUnchanged=JSON.stringify(report.before)===JSON.stringify(report.after);assert.ok(report.sourceUnchanged);assert.equal(report.errors.length,0);assert.equal(report.blocked.length,0);report.pass=true
}catch(e){report.failure=String(e);process.exitCode=1}
finally{await browser.close();await writeFile(out+'duration-copy-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify({pass:report.pass,cases:report.cases.length,failure:report.failure,errors:report.errors,blocked:report.blocked,sourceUnchanged:report.sourceUnchanged}))}
