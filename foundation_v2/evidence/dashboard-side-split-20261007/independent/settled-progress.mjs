import assert from'node:assert/strict'
import{chromium}from'../../../web/node_modules/playwright/index.mjs'
import{readFile,writeFile}from'node:fs/promises'
import{createHash}from'node:crypto'
const out='foundation_v2/evidence/dashboard-side-split-20261007/independent/',prior=JSON.parse(await readFile(out+'report.json','utf8'))
const pins=()=>Promise.all(prior.after.map(async({file})=>({file,sha256:createHash('sha256').update(await readFile(file)).digest('hex')})))
const report={before:await pins(),cases:[],blocked:[],errors:[]};assert.deepEqual(report.before,prior.after)
const browser=await chromium.launch({headless:true,ignoreDefaultArgs:['--hide-scrollbars']})
try{for(const[theme,language,width]of[['dark','en',1710],['light','vi',1710],['dark','vi',768],['light','en',360]]){
 const context=await browser.newContext({viewport:{width,height:987}}),page=await context.newPage()
 try{
  await page.addInitScript(({theme,language})=>{localStorage.setItem('tw-theme',theme);localStorage.setItem('tw-language',language)},{theme,language});await context.routeWebSocket('**/*',s=>s.close());await context.route('**/*',route=>{const r=route.request(),u=new URL(r.url());if(!['http://127.0.0.1:5180','http://127.0.0.1:8010'].includes(u.origin)||!['GET','HEAD','OPTIONS'].includes(r.method())){report.blocked.push(r.url());return route.abort()}return route.continue()});page.on('pageerror',e=>report.errors.push(String(e)))
  await page.goto('http://127.0.0.1:5180/?workspace=tenant-a&view=overview&area=testing&section=dashboard');await page.locator('.fx-dashboard-session-card').first().locator('.fx-dashboard-days').waitFor();await page.waitForLoadState('networkidle')
  const card=page.locator('.fx-dashboard-session-card').first();await card.scrollIntoViewIfNeeded();const result=await card.evaluate(e=>{const rect=e=>{const r=e.getBoundingClientRect();return{y:r.y,bottom:r.bottom,height:r.height,cy:r.y+r.height/2}};const group=e.querySelector('.fx-dashboard-card-progress'),track=group.querySelector('progress'),label=group.querySelector('small'),actions=e.querySelector('.fx-dashboard-card-actions');return{id:e.dataset.sessionId,days:e.querySelector('.fx-dashboard-days').textContent,label:label.textContent,group:rect(group),track:rect(track),text:rect(label),actions:rect(actions)}})
  assert.match(result.days,/91/);assert.match(result.label,/91/);const center=(result.track.y+result.text.bottom)/2;assert.ok(Math.abs(center-result.group.cy)<=1);if(width===1710)assert.ok(Math.abs(center-result.actions.cy)<=1);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)<=1)
  await page.screenshot({path:out+`settled-progress-${theme}-${language}-${width}.png`});report.cases.push({theme,language,width,...result})
 }finally{await context.close()}
}report.after=await pins();report.sourceUnchanged=JSON.stringify(report.before)===JSON.stringify(report.after);assert.ok(report.sourceUnchanged);assert.equal(report.blocked.length,0);assert.equal(report.errors.length,0);report.pass=true}catch(e){report.failure=String(e);process.exitCode=1}finally{await browser.close();await writeFile(out+'settled-progress-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify({pass:report.pass,cases:report.cases.length,failure:report.failure,blocked:report.blocked,errors:report.errors,sourceUnchanged:report.sourceUnchanged}))}
