import assert from 'node:assert/strict'
import { chromium } from '../../../web/node_modules/playwright/index.mjs'
import { readFile,writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
const out='foundation_v2/evidence/live-market-dividers-20261007/independent/'
const hash=async()=>createHash('sha256').update(await readFile('foundation_v2/web/src/FxReplayShell.jsx')).digest('hex')
const report={before:await hash(),cases:[],errors:[],blocked:[]};const browser=await chromium.launch({headless:true,ignoreDefaultArgs:['--hide-scrollbars']})
try {
 for(const [theme,language,width] of [['dark','vi',1440],['light','en',1440],['dark','en',360],['light','vi',360]]) {
  const context=await browser.newContext({viewport:{width,height:987}}),page=await context.newPage()
  await page.addInitScript(({theme,language})=>{localStorage.setItem('tw-theme',theme);localStorage.setItem('tw-language',language)},{theme,language})
  await context.routeWebSocket('**/*',socket=>socket.close())
  await context.route('**/*',route=>{const r=route.request(),u=new URL(r.url());if(!['http://127.0.0.1:5180','http://127.0.0.1:8010'].includes(u.origin)||!['GET','HEAD','OPTIONS'].includes(r.method())){report.blocked.push({method:r.method(),url:r.url()});return route.abort()}return route.continue()})
  page.on('pageerror',e=>report.errors.push(String(e)))
  for(const section of ['calendar','trades','notes','tag-analytics','analytics','trading-accounts','market-data','dashboard']) {
   await page.goto('http://127.0.0.1:5180/?'+new URLSearchParams({workspace:'tenant-a',view:section==='dashboard'?'overview':section==='market-data'?'market-data':'live',area:['dashboard','market-data'].includes(section)?'testing':'live',section,demo:'1'}));await page.waitForLoadState('networkidle')
   const mainCount=await page.locator('main,[role=main]').count(),nestedCount=await page.locator('main main, main [role=main], [role=main] main, [role=main] [role=main]').count()
   assert.equal(mainCount,1);assert.equal(nestedCount,0);report.cases.push({section,theme,language,width,mainCount,nestedCount})
  }await context.close()
 }
 report.after=await hash();report.sourceUnchanged=report.before===report.after;assert.ok(report.sourceUnchanged);assert.equal(report.errors.length,0);assert.equal(report.blocked.length,0);report.pass=true
}catch(e){report.failure=String(e);process.exitCode=1}
finally{await browser.close();await writeFile(out+'main-landmarks-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify({pass:report.pass,failure:report.failure,cases:report.cases.length,errors:report.errors,blocked:report.blocked,sourceUnchanged:report.sourceUnchanged}))}
