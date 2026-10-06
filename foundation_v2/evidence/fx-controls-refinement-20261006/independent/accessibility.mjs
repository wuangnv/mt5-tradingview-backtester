import assert from 'node:assert/strict'
import { chromium } from '../../../web/node_modules/playwright/index.mjs'
import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
const out=path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/,'$1'))
const files=['SessionActions.jsx','session-actions.css','SessionFilter.jsx','session-filter.css','FxSelect.jsx','fx-select.css','AnalyticsFilterControls.jsx','analytics-filter-controls.css']
const pins=async()=>Promise.all(files.map(async f=>({file:f,sha256:createHash('sha256').update(await readFile('foundation_v2/web/src/'+f)).digest('hex')})))
const report={checks:[],failures:[],errors:[],blocked:[],before:await pins()}
const browser=await chromium.launch({headless:true,ignoreDefaultArgs:['--hide-scrollbars']})
const context=await browser.newContext({viewport:{width:1440,height:987}}),page=await context.newPage()
await context.routeWebSocket('**/*',ws=>ws.close())
await context.route('**/*',async route=>{const req=route.request(),url=new URL(req.url());if(url.origin!=='http://127.0.0.1:5180'||!['GET','HEAD','OPTIONS'].includes(req.method())){report.blocked.push({method:req.method(),url:req.url()});return route.abort()}if(url.pathname.startsWith('/api/')){report.blocked.push({method:req.method(),url:req.url()});return route.abort()}return route.continue()})
page.on('pageerror',e=>report.errors.push(e.message))
const axe=await readFile('../../.artifacts/wm-integration-quality-tools/node_modules/axe-core/axe.min.js','utf8')
const scan=async(selector,name)=>{const result=await page.evaluate(async({selector})=>{return window.axe.run({include:[selector]},{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}})},{selector});report.checks.push({name,violations:result.violations.map(v=>({id:v.id,impact:v.impact,description:v.description,nodes:v.nodes.map(n=>({html:n.html,target:n.target,summary:n.failureSummary}))})),incomplete:result.incomplete.map(v=>({id:v.id,nodes:v.nodes.length}))});assert.deepEqual(result.violations,[],name+' axe violations')}
const goto=async(view,theme)=>{await page.goto('http://127.0.0.1:5180/?workspace=tenant-a&demo=1&view='+view+'&area=testing&section='+({overview:'dashboard',trade:'trades',analytics:'analytics'}[view])+'&select=1');await page.waitForLoadState('networkidle');if(await page.getByTestId('fxreplay-shell').getAttribute('data-theme')!==theme)await page.getByTestId('theme-toggle').click();await page.evaluate(axe)}
const run=async(name,fn)=>{try{await fn()}catch(e){report.failures.push({name,error:String(e)})}}
try{
for(const theme of ['dark','light']){
 await run('action-dialog-'+theme,async()=>{await goto('overview',theme);await page.getByRole('button',{name:'Xóa Gold Swing',exact:true}).click();await scan('.fxs-action-dialog','action-dialog-'+theme);await page.keyboard.press('Escape')})
 await run('session-filter-'+theme,async()=>{await goto('trade',theme);await page.getByRole('button',{name:/^Session:/}).click();await scan('.fxa-session-filter','session-filter-'+theme);await page.getByRole('searchbox').fill('Gold');await page.keyboard.press('Shift+Tab');await page.keyboard.press('Shift+Tab');assert.equal(await page.locator('.fx-select-menu').count(),0,'Session dropdown must close on Tab out')})
 await run('type-timezone-calendar-'+theme,async()=>{await goto('analytics',theme);await page.getByRole('button',{name:'Type',exact:true}).click();await scan('.fx-select-menu','type-'+theme);await page.keyboard.press('Escape');await page.getByRole('button',{name:'Timezone',exact:true}).click();await scan('.fx-select-menu','timezone-'+theme);await page.getByRole('searchbox',{name:'Tìm Timezone'}).focus();await page.keyboard.press('Shift+Tab');await page.keyboard.press('Shift+Tab');await page.keyboard.press('Shift+Tab');assert.equal(await page.locator('.fx-select-menu').count(),0,'Timezone dropdown must close on Tab out');await page.getByRole('button',{name:'Backtesting Date',exact:true}).click();await page.getByLabel('Analytics from date').fill('2026-07-08');await page.getByLabel('Analytics to date').fill('2026-07-10');await scan('.fx-filter-popover','calendar-'+theme);await page.keyboard.press('Escape')})
}
report.after=await pins();report.sourceUnchanged=JSON.stringify(report.before)===JSON.stringify(report.after);assert.deepEqual(report.errors,[]);assert.deepEqual(report.blocked,[]);assert.deepEqual(report.failures,[]);assert.ok(report.sourceUnchanged);report.pass=true
}catch(e){report.failure=String(e);process.exitCode=1}finally{await browser.close();await writeFile(path.join(out,'accessibility-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({pass:report.pass,checks:report.checks.length,failures:report.failures,violations:report.checks.filter(c=>c.violations.length),sourceUnchanged:report.sourceUnchanged}))}
