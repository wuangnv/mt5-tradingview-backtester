import assert from 'node:assert/strict'
import { chromium } from '../../../web/node_modules/playwright/index.mjs'
import { readFile,writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { demoOverview,DEMO_SESSIONS } from '../../../web/src/demoFixtures.js'
const out='foundation_v2/evidence/live-market-dividers-20261007/independent/',src='foundation_v2/web/src/'
const files=['DashboardSessions.jsx','DashboardPerformance.jsx','dashboardModel.js','dashboard-session.css','DashboardSessionCard.jsx']
const pins=()=>Promise.all(files.map(async file=>({file,sha256:createHash('sha256').update(await readFile(src+file)).digest('hex')})))
const report={scope:'Synthetic intercepted Dashboard GET responses; no actual mutation/feed acceptance',before:await pins(),checks:[],errors:[],blocked:[]}
const browser=await chromium.launch({headless:true,ignoreDefaultArgs:['--hide-scrollbars']})
const context=await browser.newContext({viewport:{width:1440,height:987}}),page=await context.newPage()
let status=200,hold=null,release,requests=0
try {
  await page.addInitScript(()=>{localStorage.setItem('tw-theme','dark');localStorage.setItem('tw-language','en')})
  await context.routeWebSocket('**/*',socket=>socket.close())
  await context.route('**/*',route=>{const r=route.request(),u=new URL(r.url());if(!['http://127.0.0.1:5180','http://127.0.0.1:8010'].includes(u.origin)||!['GET','HEAD','OPTIONS'].includes(r.method())){report.blocked.push({method:r.method(),url:r.url()});return route.abort()}return route.continue()})
  await context.route('**/api/v2/replay/sessions',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({items:[...DEMO_SESSIONS,{...DEMO_SESSIONS[0],record_id:'qa-archived',name:'QA archived',archived:true}]})}))
  await context.route('**/api/v2/datasets',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({items:[]})}))
  await context.route(/\/api\/v2\/overview(?:\?|$)/,async route=>{requests++;if(hold)await hold;await route.fulfill({status,contentType:'application/json',body:JSON.stringify(status===200?demoOverview():{detail:'qa-overview-unavailable'})})})
  page.on('pageerror',e=>report.errors.push(String(e)))
  await page.goto('http://127.0.0.1:5180/?workspace=tenant-a&view=overview&area=testing&section=dashboard&dashboard_status=archived');await page.waitForLoadState('networkidle')
  const perf=page.locator('.fx-dashboard-results'),cards=page.locator('.fx-dashboard-session-card'),notice=page.getByTestId('dashboard-data-state')
  assert.equal(await cards.count(),3);assert.ok((await cards.evaluateAll(es=>es.map(e=>e.dataset.sessionId))).includes('demo-gold'),'completed fixture removed')
  assert.equal(await page.locator('.fx-dashboard-filter-toggle').getAttribute('aria-expanded'),'false');assert.equal(await page.locator('.fx-dashboard-list-filters .fx-select-trigger').count(),1);report.checks.push('legacy archived query ignored; 3 nonarchived including completed; no status control')
  await page.locator('.fx-dashboard-filter-toggle').click();await page.locator('.fx-dashboard-filter-toggle').click();assert.equal(new URL(page.url()).searchParams.has('dashboard_status'),false);report.checks.push('clear removes legacy status query')
  const metrics=await page.getByTestId('dashboard-performance').innerText(),beforeRequests=requests
  hold=new Promise(resolve=>release=resolve);await page.evaluate(()=>window.dispatchEvent(new Event('online')))
  await page.waitForFunction(()=>document.querySelector('.fx-dashboard-results')?.getAttribute('aria-busy')==='true')
  assert.ok(requests>beforeRequests);assert.equal(await page.getByTestId('dashboard-performance').innerText(),metrics);assert.ok(!/Refreshing|Đang cập nhật/.test(await notice.innerText()));await page.screenshot({path:out+'dashboard-refresh-held.png'});report.checks.push('held same-scope refresh uses aria-busy, retains metrics, no refresh text')
  status=500;release();hold=null;await notice.filter({hasText:'Data is out of date.'}).waitFor();assert.equal(await perf.getAttribute('aria-busy'),'false');assert.equal(await page.getByTestId('dashboard-performance').innerText(),metrics);report.checks.push('failed refresh preserves stale warning/results and clears busy')
  status=200;await notice.getByRole('button',{name:'Retry',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.fx-dashboard-results')?.getAttribute('aria-busy')==='false'&&!document.querySelector('[data-testid="dashboard-data-state"]')?.textContent.trim());report.checks.push('retry recovers warning and busy')
  status=500;await page.reload();await notice.getByRole('button',{name:'Retry',exact:true}).waitFor();assert.equal(await notice.getAttribute('role'),'alert');assert.match(await notice.innerText(),/Could not load performance/);assert.equal(await perf.getAttribute('aria-busy'),'false');report.checks.push('initial read failure still visible as alert with retry')
  await page.screenshot({path:out+'dashboard-initial-error.png'})
  report.after=await pins();report.sourceUnchanged=JSON.stringify(report.before)===JSON.stringify(report.after);assert.ok(report.sourceUnchanged);assert.equal(report.errors.length,0);assert.equal(report.blocked.length,0);report.pass=true
}catch(e){report.failure=String(e);process.exitCode=1;await page.screenshot({path:out+'dashboard-states-failure.png'}).catch(()=>{})}
finally{await browser.close();await writeFile(out+'dashboard-states-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify({pass:report.pass,failure:report.failure,checks:report.checks,errors:report.errors,blocked:report.blocked,sourceUnchanged:report.sourceUnchanged}))}
