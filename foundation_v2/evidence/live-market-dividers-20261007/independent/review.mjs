import assert from 'node:assert/strict'
import { chromium } from '../../../web/node_modules/playwright/index.mjs'
import { readFile, writeFile, readdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { ready } from '../../live-market-standard-20261007/independent/fixtures.mjs'
import { dashboardRecentSessions } from '../../../web/src/dashboardModel.js'

const out = 'foundation_v2/evidence/live-market-dividers-20261007/independent/'
const src = 'foundation_v2/web/src/'
const names = (await readdir(src)).filter(n => /live|MarketAssetCatalog|market-sync|Dashboard|dashboard|demoFixtures|DemoPreview|FxReplayShell|fx-shell-story|testing-copy|testing-standard|FxSelect|fx-select|page-layout|component-interactions|main.jsx/i.test(n))
const pins = () => Promise.all(names.map(async file => ({ file, sha256: createHash('sha256').update(await readFile(src + file)).digest('hex') })))
const report = { scope: 'Independent r2 frozen UI review, read-only local origins', before: await pins(), cases: [], failures: [], errors: [], blocked: [], states: [] }
const previous=process.env.QA_RERUN || process.env.QA_FINAL ? JSON.parse(await readFile(out+(process.env.QA_FINAL?'attempt2-report.json':'attempt1-report.json'),'utf8')) : null
if(previous){report.cases=previous.cases;report.states=previous.states;report.priorPinsMatch=JSON.stringify(previous.before)===JSON.stringify(report.before);report.sourceDelta=report.before.filter(p=>previous.before.find(v=>v.file===p.file)?.sha256!==p.sha256);if(process.env.QA_FINAL)assert.deepEqual(report.sourceDelta.map(p=>p.file),['FxReplayShell.jsx']);else assert.ok(report.priorPinsMatch)}
const browser = await chromium.launch({ headless: true, ignoreDefaultArgs: ['--hide-scrollbars'] })
async function setup(theme='dark', language='en', width=1440) {
  const context = await browser.newContext({ viewport: { width, height: 987 } }), page = await context.newPage()
  await page.addInitScript(({theme,language})=>{localStorage.setItem('tw-theme',theme);localStorage.setItem('tw-language',language)}, {theme,language})
  await context.routeWebSocket('**/*', socket => socket.close())
  await context.route('**/*', route => {
    const r=route.request(), u=new URL(r.url())
    if(!['http://127.0.0.1:5180','http://127.0.0.1:8010'].includes(u.origin)||!['GET','HEAD','OPTIONS'].includes(r.method())) { report.blocked.push({method:r.method(),url:r.url()});return route.abort() }
    return route.continue()
  })
  page.on('pageerror',e=>report.errors.push(String(e)))
  return {context,page}
}
const routeUrl = (section, demo=true, extra={}) => 'http://127.0.0.1:5180/?'+new URLSearchParams({workspace:'tenant-a',view:section==='dashboard'?'overview':section==='market-data'?'market-data':'live',area:['dashboard','market-data'].includes(section)?'testing':'live',section,...(demo?{demo:'1'}:{}),...extra})
function close(a,b,label) { assert.ok(Math.abs(a-b)<=1, `${label}: ${a} vs ${b}`) }
async function geometry(page) {
  return page.evaluate(()=>{
    const rect=e=>{const r=e.getBoundingClientRect();return {x:r.x,right:r.right,y:r.y,bottom:r.bottom,width:r.width,height:r.height}}
    const get=s=>{const e=document.querySelector(s);if(!e)return null;const css=getComputedStyle(e);return {rect:rect(e),borderLeft:css.borderLeftWidth,borderTop:css.borderTopWidth,borderBottom:css.borderBottomWidth,gap:css.gap,padding:css.padding,background:css.backgroundColor}}
    const q=['.fx-content','.live-workspace','.live-topbar','.live-toolbar','.live-split','.live-split>section:first-child','.live-analytics-side','.live-analytics-side>h2','.live-tag-grid','.live-tag-chart','.live-tag-list','.live-accounts-layout','.live-accounts-layout>section:first-child','.live-accounts-layout .live-toolbar','.live-add-account','.live-add-account>h2','.market-data-workspace','.market-sync-filters','.market-sync-table','.market-sync-note','.market-data-workspace .fxa-pagination','.live-source-details']
    return {overflow:document.documentElement.scrollWidth-innerWidth,contentClientWidth:document.querySelector('.fx-content').clientWidth,nodes:Object.fromEntries(q.map(s=>[s,get(s)]))}
  })
}
async function dashboardChecks(page,language,result) {
  const cards=page.locator('.fx-dashboard-session-card'), head=cards.first().locator('.fx-dashboard-session-card-head')
  assert.ok(await cards.count()>0)
  result.dashboardIds=await cards.evaluateAll(es=>es.map(e=>e.dataset.sessionId))
  assert.equal(await page.locator('.fx-select-trigger').filter({hasText:language==='vi'?'Trạng thái':'Status'}).count(),0)
  const toggle=page.locator('.fx-dashboard-filter-toggle')
  assert.equal(await toggle.getAttribute('aria-expanded'),'false','legacy status query opens filters')
  const canvas=await head.evaluate(e=>{const d=document.createElement('div');d.style.background='var(--project-canvas)';e.append(d);const c=getComputedStyle(d).backgroundColor;d.remove();return c})
  await head.hover();await page.waitForTimeout(180)
  assert.equal(await head.evaluate(e=>getComputedStyle(e).backgroundColor),canvas,'session hover differs from canvas')
  const expand=cards.first().locator('.fx-dashboard-card-expand');await expand.click()
  await page.waitForTimeout(180)
  assert.equal(await expand.getAttribute('aria-expanded'),'true')
  assert.equal(await cards.first().evaluate(e=>getComputedStyle(e).backgroundColor),canvas,'expanded surface differs from canvas')
  assert.ok(await cards.first().locator('.fx-dashboard-card-charts').isVisible())
  assert.ok((await cards.first().locator('.fx-dashboard-card-charts').innerText()).length>0)
  await page.screenshot({path:out+result.name+'-expanded.png'})
  await expand.click();assert.equal(await cards.first().locator('.fx-dashboard-card-charts').count(),0)
  await toggle.click();assert.equal(await toggle.getAttribute('aria-expanded'),'true')
  assert.equal(await page.locator('.fx-dashboard-list-filters .fx-select-trigger').count(),3,'expected asset, strategy, sort only')
  const asset=page.locator('.fx-dashboard-list-filters .fx-select-trigger').first();await asset.click();await page.getByRole('option',{name:'EURUSD',exact:true}).click()
  assert.ok((await cards.evaluateAll(es=>es.map(e=>e.querySelector('.fx-dashboard-card-asset').textContent))).every(v=>v==='EURUSD'))
  await toggle.click();assert.equal(await toggle.getAttribute('aria-expanded'),'false');assert.equal(await cards.count(),result.dashboardIds.length)
  const search=page.locator('.fx-dashboard-search input');await search.fill('ZZ_NO_SESSION_QA');await page.locator('.fx-dashboard-catalog-status button').waitFor();assert.equal(await cards.count(),0)
  await search.fill('');assert.equal(await cards.count(),result.dashboardIds.length)
}
try {
  const oracleItems=[{record_id:'a',revision:1,status:'completed',archived:false},{record_id:'b',revision:1,status:'active',archived:true},{record_id:'c',revision:1,status:'paused',archived:false}]
  assert.deepEqual(dashboardRecentSessions(oracleItems).map(e=>e.record_id),['a','c']);report.modelOracle='default includes completed and paused; excludes archived'
  for(const [theme,language,width] of [['dark','vi',1440],['light','en',1440],['dark','en',360],['light','vi',360]]) for(const section of ['calendar','trades','notes','tag-analytics','analytics','trading-accounts','market-data','dashboard']) {
    const name=`r2-demo-${section}-${theme}-${language}-${width}`,result={name};const {context,page}=await setup(theme,language,width)
    const finalSubset=section==='dashboard'||previous?.failures.some(e=>e.name===name)||(['calendar','trading-accounts','market-data'].includes(section)&&((theme==='dark'&&width===1440)||(theme==='light'&&width===360)))
    if(previous&&!(process.env.QA_FINAL?finalSubset:previous.failures.some(e=>e.name===name))){await context.close();continue}
    try {
      await page.goto(routeUrl(section,true,section==='dashboard'?{dashboard_status:'archived'}:{}));await page.waitForLoadState('networkidle')
      result.geometry=await geometry(page);assert.ok(result.geometry.overflow<=1,'page overflow')
      assert.equal(await page.locator('main,[role=main]').count(),1,'exactly one shell main')
      assert.equal(await page.locator('main main, main [role=main], [role=main] main, [role=main] [role=main]').count(),0,'nested main')
      assert.equal(await page.getByTestId('fxreplay-shell').getAttribute('data-theme'),theme);assert.equal(await page.getByTestId('fxreplay-shell').getAttribute('lang'),language)
      if(!['market-data','dashboard'].includes(section)) {
        assert.equal(await page.getByTestId('live-status').count(),0,'demo status clutter remains')
        assert.equal(await page.locator('.live-topbar h1:not(.sr-only)').count(),0,'visible repeated heading')
        const n=result.geometry.nodes,w=n['.live-workspace'].rect,t=n['.live-topbar'].rect
        close(w.x,t.x,'topbar left');close(w.right,t.right,'topbar right')
        if(n['.live-toolbar']) {close(w.x,n['.live-toolbar'].rect.x,'toolbar left');close(section==='trading-accounts'?n['.live-accounts-layout>section:first-child'].rect.right:w.right,n['.live-toolbar'].rect.right,'toolbar right')}
        for(const [container,left,right,heading] of [['.live-split','.live-split>section:first-child','.live-analytics-side','.live-analytics-side>h2'],['.live-tag-grid','.live-tag-chart','.live-tag-list',null],['.live-accounts-layout','.live-accounts-layout>section:first-child','.live-add-account','.live-add-account>h2']]) {
          if(!n[container]||!n[right])continue
          assert.equal(n[container].gap,'0px','structural gap')
          if(width===1440){close(n[left].rect.right,n[right].rect.x,'joined columns');close(n[container].rect.y,n[right].rect.y,'vertical divider start');close(n[container].rect.bottom,n[right].rect.bottom,'vertical divider end');assert.equal(n[right].borderLeft,'1px')}
          else {close(n[left].rect.bottom,n[right].rect.y,'joined stacked sections');assert.equal(n[right].borderTop,'1px')}
          if(heading){close(n[right].rect.x,n[heading].rect.x,'heading left');close(n[right].rect.right,n[heading].rect.right,'heading right')}
        }
        if(section==='trading-accounts'&&width===1440)close(n['.live-accounts-layout .live-toolbar'].rect.bottom,n['.live-add-account>h2'].rect.bottom,'account/sidebar heading rule')
        const disclosure=page.locator('.live-source-details');await disclosure.locator('summary').click();assert.match(await disclosure.innerText(),language==='en'?/read only[\s\S]*costs[\s\S]*synced deals only/:/chỉ được đọc[\s\S]*tính phí deal[\s\S]*đồng bộ/);await disclosure.locator('summary').click()
      }
      if(section==='market-data') {
        const n=result.geometry.nodes,w={...n['.fx-content'].rect,right:n['.fx-content'].rect.x+result.geometry.contentClientWidth}
        for(const s of ['.market-sync-filters','.market-sync-table','.market-sync-note','.market-data-workspace .fxa-pagination']) if(n[s]){close(w.x,n[s].rect.x,s+' left');close(w.right,n[s].rect.right,s+' right')}
      }
      if(section==='dashboard')await dashboardChecks(page,language,result)
      if(theme==='dark'&&width===1440 || theme==='light'&&width===360) {
        await page.addScriptTag({path:'../../.artifacts/wm-integration-quality-tools/node_modules/axe-core/axe.min.js'})
        result.axe=await page.evaluate(async()=>({violations:(await axe.run(document)).violations.map(({id,impact,nodes})=>({id,impact,targets:nodes.map(n=>n.target)}))}));assert.equal(result.axe.violations.length,0,'axe violations')
      }
      await page.locator('.fx-content').evaluate(e=>e.scrollTop=0);await page.screenshot({path:out+name+'.png'});report.cases=report.cases.filter(e=>e.name!==name);report.cases.push(result)
    }catch(e){report.failures.push({name,error:String(e),result,content:await page.locator('.fx-content').innerText().catch(()=>'' )});await page.screenshot({path:out+name+'-failure.png'})}
    finally{await context.close();await writeFile(out+'progress.json',JSON.stringify(report,null,2))}
  }
  for(const synthetic of previous?[]:[false,true]){
    const {context,page}=await setup();let state={status:200,payload:ready}
    try {
      if(synthetic){await context.route('**/api/v2/live/status',route=>route.fulfill({status:state.status,contentType:'application/json',body:JSON.stringify(state.payload)}));await page.clock.install({time:new Date('2026-10-07T12:00:00Z')})}
      await page.goto(routeUrl('trades',false));await page.waitForLoadState('networkidle')
      if(!synthetic){await page.getByTestId('live-status').filter({hasText:'No account connected'}).waitFor();assert.equal(await page.getByTestId('live-broker-snapshot').count(),0);report.states.push({name:'actual-unavailable',text:await page.getByTestId('live-status').innerText()})}
      else {
        await page.getByTestId('live-broker-snapshot').waitFor();assert.equal(await page.getByTestId('live-status').count(),0)
        state={status:500,payload:{detail:'qa-interrupted'}};await page.clock.fastForward(5100);await page.getByTestId('live-status').filter({hasText:'Previous snapshot'}).waitFor();assert.match(await page.getByTestId('live-broker-snapshot').innerText(),/qa-utc-before/);report.states.push({name:'synthetic-stale-data-retained',text:await page.getByTestId('live-status').innerText()});await page.screenshot({path:out+'synthetic-stale.png'})
        state={status:403,payload:{detail:'qa-denied'}};await page.clock.fastForward(5100);await page.getByTestId('live-status').filter({hasText:'cannot read account data'}).waitFor();assert.equal(await page.getByTestId('live-broker-snapshot').count(),0);assert.ok(!/qa-utc-before/.test(await page.locator('.fx-content').innerText()));report.states.push({name:'synthetic-denied-data-cleared',text:await page.getByTestId('live-status').innerText()})
      }
      await page.screenshot({path:out+(synthetic?'synthetic-denied':'actual-unavailable')+'.png'})
    }catch(e){report.failures.push({name:synthetic?'synthetic-states':'actual-unavailable',error:String(e)})}finally{await context.close()}
  }
  report.after=await pins();report.sourceUnchanged=JSON.stringify(report.before)===JSON.stringify(report.after)
  assert.equal(report.failures.length,0);assert.equal(report.blocked.length,0);assert.equal(report.errors.length,0);assert.ok(report.sourceUnchanged);report.pass=true
}catch(e){report.failure=String(e);process.exitCode=1}
finally{await browser.close();await writeFile(out+'report.json',JSON.stringify(report,null,2));console.log(JSON.stringify({pass:report.pass,cases:report.cases.length,failures:report.failures.map(({name,error})=>({name,error})),errors:report.errors,blocked:report.blocked,sourceUnchanged:report.sourceUnchanged,states:report.states}))}
