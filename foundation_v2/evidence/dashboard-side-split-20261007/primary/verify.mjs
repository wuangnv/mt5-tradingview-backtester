import { chromium } from '../../../web/node_modules/playwright/index.mjs'
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
const browser=await chromium.launch({ignoreDefaultArgs:['--hide-scrollbars']})
const report={cases:[],errors:[],blocked:[]}
try{
 for(const width of [1710,360])for(const theme of ['dark','light'])for(const demo of [false,true]){
  const context=await browser.newContext({viewport:{width,height:987},reducedMotion:'reduce'})
  await context.addInitScript(theme=>{localStorage.setItem('tw-theme',theme);localStorage.setItem('tw-language','vi')},theme)
  await context.route('**/*',route=>{const r=route.request(),url=new URL(r.url());if(!['127.0.0.1','localhost'].includes(url.hostname)||!['GET','HEAD','OPTIONS'].includes(r.method())){report.blocked.push(url.href);return route.abort()}return route.continue()})
  await context.routeWebSocket('**/*',ws=>ws.close())
  const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message))
  let api=null
  if(!demo)page.on('response',async r=>{if(new URL(r.url()).pathname==='/api/v2/overview')api=(await r.json()).performance})
  await page.goto('http://127.0.0.1:5180/?workspace=tenant-a&view=overview&area=testing&section=dashboard'+(demo?'&demo=1':''))
  await page.locator('.fx-dashboard-side-split').waitFor()
  await page.locator('.fx-dashboard-card-summary').first().waitFor()
  await page.locator('.fx-dashboard-days').first().waitFor()
  const cards=page.locator('.fx-dashboard-metric'),values=await cards.locator(':scope > strong').allTextContents()
  assert.equal(await cards.nth(3).locator('small,.fx-dashboard-side-bar,.fx-dashboard-outcome-bar').count(),0)
  const split=await page.locator('.fx-dashboard-side-split').evaluate(e=>({text:e.innerText,buy:e.querySelector('.fx-dashboard-side-bar .is-buy').style.width,sell:e.querySelector('.fx-dashboard-side-bar .is-sell').style.width}))
  if(demo){assert.equal(split.buy,'50%');assert.equal(split.sell,'50%');assert.match(split.text,/50,00% Mua/);assert.match(split.text,/50,00% Bán/)}
  else{assert.deepEqual(api.side_counts,{buy:0,sell:1});assert.equal(split.buy,'0%');assert.equal(split.sell,'100%');assert.equal(values[0],'—');assert.equal(values[1],'—')}
  const geo=await page.evaluate(()=>{const box=s=>{const r=document.querySelector(s).getBoundingClientRect();return{cy:r.y+r.height/2,height:r.height}};return{progress:box('.fx-dashboard-card-progress'),actions:box('.fx-dashboard-card-actions'),overflow:document.documentElement.scrollWidth>innerWidth}})
  assert.equal(geo.overflow,false);if(width===1710)assert.ok(Math.abs(geo.progress.cy-geo.actions.cy)<1)
  await page.locator('.fx-content').evaluate(e=>e.scrollTop=0)
  await page.screenshot({path:fileURLToPath(new URL(`./${demo?'demo':'actual'}-${theme}-${width}.png`,import.meta.url))})
  if(width===1710)await page.locator('.fx-dashboard-session-card').first().screenshot({path:fileURLToPath(new URL(`./${demo?'demo':'actual'}-${theme}-session.png`,import.meta.url))})
  report.cases.push({width,theme,demo,values,split,geo});await context.close()
 }
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.blocked,[]);report.pass=true
 await writeFile(new URL('./report.json',import.meta.url),JSON.stringify(report,null,2));console.log(`${report.cases.length} dashboard cases PASS`)
}finally{await browser.close()}
