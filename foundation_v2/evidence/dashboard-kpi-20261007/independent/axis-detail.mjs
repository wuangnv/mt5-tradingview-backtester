import { chromium } from '../../../web/node_modules/playwright/index.mjs'
import assert from 'node:assert/strict'
import {writeFile,readFile}from'node:fs/promises'
import {createHash}from'node:crypto'
const out='foundation_v2/evidence/dashboard-kpi-20261007/independent/'
const pins=()=>Promise.all(['DashboardPerformance.jsx','dashboard.css'].map(async file=>({file,sha256:createHash('sha256').update(await readFile('foundation_v2/web/src/'+file)).digest('hex')})))
const before=await pins()
const browser=await chromium.launch({headless:true,ignoreDefaultArgs:['--hide-scrollbars']}),context=await browser.newContext({viewport:{width:360,height:987}}),page=await context.newPage(),blocked=[]
await page.addInitScript(()=>{localStorage.setItem('tw-theme','light');localStorage.setItem('tw-language','en')})
await context.routeWebSocket('**/*',s=>s.close());await context.route('**/*',r=>{const u=new URL(r.request().url());if(!['http://127.0.0.1:5180','http://127.0.0.1:8010'].includes(u.origin)||!['GET','HEAD','OPTIONS'].includes(r.request().method())){blocked.push(r.request().url());return r.abort()}return r.continue()})
await page.goto('http://127.0.0.1:5180/?workspace=tenant-a&view=overview&area=testing&section=dashboard&demo=1');await page.waitForLoadState('networkidle')
const charts=page.locator('.fx-dashboard-chart-panel');await charts.first().scrollIntoViewIfNeeded();await page.screenshot({path:out+'mobile-axis-detail.png'});const report=await charts.evaluateAll(es=>es.map(e=>({title:e.querySelector('h3').textContent,axis:[...e.querySelectorAll('.fx-dashboard-chart-axis>span')].map(e=>({text:e.textContent,y:e.getBoundingClientRect().y})),grid:[...e.querySelectorAll('.fx-dashboard-plot-grid i')].map(e=>e.getBoundingClientRect().y),scrollHeight:e.querySelector('.fx-dashboard-chart-scroll')?.offsetHeight,clientHeight:e.querySelector('.fx-dashboard-chart-scroll')?.clientHeight})))
for(const row of report)for(let i=0;i<row.axis.length;i++)assert.ok(Math.abs(row.axis[i].y-row.grid[i])<=1)
const scrolls=page.locator('.fx-dashboard-chart-scroll'),scrollChecks=[]
for(const scroll of await scrolls.all()){
 await scroll.scrollIntoViewIfNeeded();await scroll.focus();await page.keyboard.press('ArrowRight');await page.waitForTimeout(250);assert.ok(await scroll.evaluate(e=>e.scrollLeft)>0,'native keyboard horizontal scroll')
 const check=await scroll.evaluate(e=>{e.scrollLeft=0;const axis=e.querySelector('.fx-dashboard-chart-axis'),x=axis.getBoundingClientRect().x;e.scrollLeft=e.scrollWidth-e.clientWidth;return{x,after:axis.getBoundingClientRect().x,scrollLeft:e.scrollLeft,max:e.scrollWidth-e.clientWidth,axisStyle:getComputedStyle(axis).position,ticks:[...axis.children].map(e=>e.getBoundingClientRect().y),grid:[...e.querySelectorAll('.fx-dashboard-plot-grid i')].map(e=>e.getBoundingClientRect().y)}})
 assert.ok(Math.abs(check.x-check.after)<=1);assert.ok(check.scrollLeft>0);assert.equal(check.axisStyle,'sticky');for(let i=0;i<check.ticks.length;i++)assert.ok(Math.abs(check.ticks[i]-check.grid[i])<=1);scrollChecks.push(check)
}
await page.screenshot({path:out+'mobile-axis-scrolled.png'});const after=await pins(),sourceUnchanged=JSON.stringify(before)===JSON.stringify(after);assert.ok(sourceUnchanged);assert.equal(blocked.length,0);await writeFile(out+'axis-detail.json',JSON.stringify({pass:true,report,scrollChecks,blocked,before,after,sourceUnchanged},null,2));await browser.close();console.log(JSON.stringify({pass:true,charts:report.length,scrollChecks:scrollChecks.length,sourceUnchanged}))
