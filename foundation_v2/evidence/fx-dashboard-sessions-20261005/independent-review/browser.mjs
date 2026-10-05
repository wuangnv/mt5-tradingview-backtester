import assert from 'node:assert/strict'
import {chromium} from '../../../foundation_v2/web/node_modules/playwright/index.mjs'
import {mkdir,readFile,writeFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import path from 'node:path'
if(!process.argv.includes('--source-frozen'))throw new Error('REVIEW_NOT_STARTED_SOURCE_FREEZE_REQUIRED')
const origin='http://127.0.0.1:5180',api='http://127.0.0.1:8010',out=path.resolve('.artifacts/fx-dashboard-sessions-20261005/independent-review')
await mkdir(out,{recursive:true})
const source=['foundation_v2/web/src/DashboardSessions.jsx','foundation_v2/web/src/DashboardPerformance.jsx','foundation_v2/web/src/dashboardModel.js','foundation_v2/web/src/SessionPicker.jsx','foundation_v2/web/src/SessionPerformance.jsx','foundation_v2/web/src/session-performance.css','foundation_v2/web/src/PropAnalytics.jsx','foundation_v2/web/src/FxSelect.jsx','foundation_v2/web/src/fx-select.css','foundation_v2/web/src/dashboard.css']
const hashes=()=>Promise.all(source.map(async file=>({file,sha256:createHash('sha256').update(await readFile(file)).digest('hex')})))
const report={scope:'Actual GET-only local Dashboard/Sessions review; synthetic error states explicitly labeled. No product edits, broker/provider access, session/DB writes.',before:await hashes(),cases:[],checks:[],errors:[],blocked:[],teardown:[]}
const b=await chromium.launch({headless:true}),c=await b.newContext({viewport:{width:1440,height:987}})
let fixture=null
await c.route('**/*',async r=>{
 const q=r.request(),u=new URL(q.url())
 if(u.origin!==origin||!['GET','HEAD','OPTIONS'].includes(q.method())){report.blocked.push({path:u.pathname,method:q.method()});return r.abort()}
 if(u.pathname.startsWith('/api/')){
  try { if(fixture){const replacement=await fixture(q,u);if(replacement)return r.fulfill(replacement)} return await r.fulfill({response:await r.fetch({url:api+u.pathname+u.search})}) }
  catch(error){const message=String(error);if(/Route is already handled|ERR_ABORTED/.test(message))report.teardown.push('Canceled navigation request '+u.pathname);else report.errors.push('API route failure '+u.pathname+': '+message);try{return await r.abort()}catch{}}
 }
 return r.continue()
})
await c.routeWebSocket('**/*',s=>s.close())
const p=await c.newPage();p.setDefaultTimeout(15000);p.on('pageerror',e=>report.errors.push(String(e)))
const get=async endpoint=>{const r=await c.request.get(api+endpoint,{headers:{'X-Workspace-Id':'tenant-a'}});assert.equal(r.status(),200);return r.json()}
const settle=async()=>{await p.waitForFunction(()=>document.getAnimations().every(a=>a.playState!=='running'));await p.waitForLoadState('networkidle')}
const select=async(label,value)=>{
 const native=p.getByRole('combobox',{name:label,exact:true})
 if(await native.count()&&await native.evaluate(el=>el.tagName==='SELECT'))return native.selectOption(value)
 const control=p.getByRole('button',{name:label,exact:true});await control.click();await p.getByRole('option',{name:value,exact:true}).click();await settle()
}
const layout=async(route,theme,width)=>{
 await p.setViewportSize({width,height:987});if(await p.getByTestId('fxreplay-shell').getAttribute('data-theme')!==theme)await p.getByTestId('theme-toggle').click();await settle()
 const overflow=await p.evaluate(()=>document.documentElement.scrollWidth-innerWidth);assert.equal(overflow,0)
 await p.addScriptTag({path:'../../.artifacts/wm-integration-quality-tools/node_modules/axe-core/axe.min.js'})
 const axe=await p.evaluate(()=>window.axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','wcag22aa']}}).then(r=>r.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)}))))
 report.cases.push({route,theme,width,overflow,axe});await p.screenshot({path:path.join(out,`${route}-${theme}-${width}.png`),fullPage:true});assert.deepEqual(axe,[])
}
try {
 const old='476f4b498e1a49ed9d48a75719f4d270',filled='273a1275538c42cb95cfff16e0f9f62c',initialized='d70ee54946144605bf20ba5b8e2f4cdf'
 const before=await get(`/api/v2/replay/sessions/${old}`),inventory=(await get('/api/v2/replay/sessions')).items,overview=await get('/api/v2/overview'),fullAnalytics=await get(`/api/v2/replay/sessions/${filled}/analytics`)
 const dashboard=`${origin}/?workspace=tenant-a&view=overview&area=testing&section=dashboard&session=${old}`
 const sessions=id=>`${origin}/?workspace=tenant-a&view=replay&select=1&area=testing&section=sessions&session=${id}`
 const rows=()=>p.locator('.fx-dashboard-session-row')
 const ids=()=>rows().evaluateAll(els=>els.map(el=>el.dataset.sessionId))
 const waitPerformance=async()=>{await p.getByTestId('dashboard-performance').waitFor();await p.waitForFunction(()=>document.querySelector('.fx-dashboard-results[aria-busy="false"]'));await settle()}
 await p.goto(dashboard,{waitUntil:'networkidle'});await waitPerformance()
 assert.equal(await rows().count(),inventory.filter(x=>!x.archived).length)
 assert.equal(await p.locator('.fx-dashboard-quick-actions a').count(),3)
 assert.equal(await p.locator('h1:not(.sr-only)').count(),0)
 assert.equal(await p.locator('.fx-dashboard-chart-foot,.fx-dashboard-provenance,.fx-dashboard-pagination').count(),0)
 assert.equal(await p.getByRole('link',{name:/Xem tất cả/}).count(),0)
 assert.equal(await p.getByRole('button',{name:/Tải lại/i}).count(),0)
 const countMetric=p.locator('.fx-dashboard-metric').filter({hasText:'Trades taken'}).locator('strong')
 assert.equal(await countMetric.innerText(),String(overview.performance.metrics.closed_trade_count))
 report.checks.push('Actual Dashboard counts match GET overview; three create/tutorial actions retained; repeated h1 is hidden; footer/provenance/View all/reload/single-page pagination removed')
 for(const theme of ['dark','light'])for(const width of [360,768,1440]){
  await layout('dashboard',theme,width)
  await p.getByRole('button',{name:'Phạm vi Performance',exact:true}).click();const menu=p.getByRole('listbox',{name:'Phạm vi Performance',exact:true});await menu.waitFor();assert.ok(await menu.getByRole('option',{name:/^Battles/}).isDisabled())
  const box=await menu.boundingBox(),clip=await p.locator('.fx-content').boundingBox();assert.ok(box.x>=clip.x&&box.x+box.width<=clip.x+clip.width+1,'Source menu must fit content clip region, not merely viewport')
  const all=menu.getByRole('option',{name:'All',exact:true});const normal=await all.evaluate(el=>getComputedStyle(el).backgroundColor);await all.hover();await settle();const hovered=await all.evaluate(el=>getComputedStyle(el).backgroundColor);assert.notEqual(hovered,normal)
  await p.screenshot({path:path.join(out,`source-menu-${theme}-${width}.png`)});const menuAxe=await p.evaluate(()=>window.axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','wcag22aa']}}).then(r=>r.violations.map(v=>v.id)));assert.deepEqual(menuAxe,[]);await menu.press('Escape');assert.equal(await p.locator('.fx-select-menu').count(),0)
 }
 await p.setViewportSize({width:1440,height:987});await select('Thời gian Performance','Last week');await waitPerformance();const weekUrl=new URL(p.url());const from=weekUrl.searchParams.get('dashboard_from'),to=weekUrl.searchParams.get('dashboard_to');assert.equal((Date.parse(to)-Date.parse(from))/86400000,6)
 const week=await get(`/api/v2/overview?from_close_utc=${from}T00:00:00.000Z&to_close_utc=${to}T23:59:59.999Z`);assert.equal(await countMetric.innerText(),String(week.performance.metrics.closed_trade_count));await p.reload({waitUntil:'networkidle'});await waitPerformance();assert.match(await p.getByRole('button',{name:'Thời gian Performance',exact:true}).innerText(),/Last week/)
 await select('Thời gian Performance','Lifetime');await waitPerformance();assert.equal(await countMetric.innerText(),String(overview.performance.metrics.closed_trade_count))
 await select('Phạm vi Performance','Prop Firm');await p.getByTestId('prop-analytics').waitFor();await settle();assert.equal(await p.getByRole('button',{name:'Thời gian Performance',exact:true}).count(),0);assert.equal(await p.getByTestId('dashboard-performance').count(),0)
 await select('Phạm vi Performance','All');await waitPerformance();await p.getByTestId('prop-analytics').waitFor();assert.equal(await p.getByRole('heading',{name:'Backtesting',exact:true}).count(),1);assert.equal(await p.getByRole('heading',{name:'Prop Firm',exact:true}).count(),1)
 await select('Phạm vi Performance','Backtesting');await waitPerformance();report.checks.push('Source choices expose real Backtesting and Prop firm separately; Battles explicitly disabled; weekly UTC range and count match actual GET and survive reload; Lifetime restores scope')
 await p.getByRole('button',{name:'Hiện bộ lọc phiên',exact:true}).click();await p.getByRole('button',{name:'Strategy',exact:true}).waitFor({state:'visible'});await p.waitForFunction(()=>!document.querySelector('button[aria-label="Strategy"]').disabled);await settle()
 await select('Trạng thái phiên','Tất cả');assert.equal(await rows().count(),inventory.length)
 await p.getByRole('button',{name:'Assets',exact:true}).click();const search=p.getByRole('searchbox',{name:'Tìm Assets',exact:true});await search.fill('xau');assert.equal(await p.getByRole('listbox',{name:'Assets',exact:true}).getByRole('option').count(),1);await search.press('ArrowUp');assert.equal(await p.evaluate(()=>document.activeElement.getAttribute('role')),'option');await p.getByRole('option',{name:'XAUUSDm',exact:true}).click();assert.deepEqual(await ids(),inventory.filter(x=>x.instrument_id==='XAUUSDm').map(x=>x.record_id));await select('Assets','Assets')
 await select('Strategy','Chưa gắn strategy');await p.waitForFunction(()=>!document.querySelector('button[aria-label="Strategy"]').disabled);await p.waitForFunction(expected=>document.querySelectorAll('.fx-dashboard-session-row').length===expected,inventory.length);assert.equal(await rows().count(),inventory.length);await select('Strategy','Strategy')
 await p.getByRole('searchbox',{name:'Tìm phiên gần đây',exact:true}).fill('Exness');assert.deepEqual(await ids(),[old]);assert.equal(await p.locator('.fx-dashboard-pagination').count(),0);await p.getByRole('searchbox',{name:'Tìm phiên gần đây',exact:true}).fill('missing-no-match');assert.equal(await rows().count(),0);assert.match(await p.getByTestId('dashboard-recent').innerText(),/Không có phiên khớp/);await p.getByRole('button',{name:'Xóa bộ lọc danh sách',exact:true}).click();assert.equal(await rows().count(),1)
 await select('Trạng thái phiên','Tất cả');await select('Sắp xếp phiên','Oldest to newest');const ordered=[...inventory].sort((a,b)=>Date.parse(a.created_at_utc)-Date.parse(b.created_at_utc)||a.record_id.localeCompare(b.record_id)).map(x=>x.record_id);assert.deepEqual(await ids(),ordered)
 await select('Sắp xếp phiên','Most profit');await settle();const profitOrder=await ids();assert.ok(profitOrder.indexOf(initialized)<profitOrder.indexOf(filled));report.checks.push('Actual recent Assets/search/Strategy/unassigned/status/date sort/profit sort operate on catalog + analytics metadata; unknown results sort after known comparable USD outcomes; no fake strategy names')
 // Test every revealed pill menu stays within a mobile viewport.
 await p.setViewportSize({width:360,height:987});for(const label of ['Assets','Strategy','Trạng thái phiên','Sắp xếp phiên']){await p.getByRole('button',{name:label,exact:true}).click();const menu=p.locator('.fx-select-menu');await menu.waitFor();const box=await menu.boundingBox(),clip=await p.locator('.fx-content').boundingBox();assert.ok(box.x>=clip.x&&box.x+box.width<=clip.x+clip.width+1,`${label} menu clipped by content`);await p.screenshot({path:path.join(out,`recent-menu-${label.replace(/[^a-zA-Z]/g,'')}-360.png`)});await menu.press('Escape')}
 await p.setViewportSize({width:1440,height:987});await p.locator('.fx-dashboard-recent').scrollIntoViewIfNeeded();await p.getByRole('button',{name:'Sắp xếp phiên',exact:true}).click();const bottomMenu=p.locator('.fx-select-menu');await bottomMenu.waitFor();let mb=await bottomMenu.boundingBox(),cb=await p.locator('.fx-content').boundingBox();assert.ok(mb.y>=cb.y-1&&mb.y+mb.height<=cb.y+cb.height+1);await p.screenshot({path:path.join(out,'recent-menu-desktop-bottom.png')});await bottomMenu.press('Escape');await p.screenshot({path:path.join(out,'dashboard-recent-desktop.png')})
 await p.goto(sessions(filled),{waitUntil:'networkidle'});await p.getByTestId('session-performance').waitFor();await settle();assert.equal(await p.locator('.fxs-metric').count(),6);assert.equal(await p.locator('.fxs-table-scroll tbody tr').count(),fullAnalytics.ledger.length);assert.equal(await p.locator('.fxr-session-actions').getByRole('link',{name:'Market Data',exact:true}).count(),0);assert.equal(await p.getByRole('checkbox',{name:'Hiện phiên đã lưu trữ',exact:true}).count(),0);assert.equal(await p.locator('h1:not(.sr-only)').count(),0)
 const money=new Intl.NumberFormat('vi-VN',{maximumFractionDigits:2}).format(fullAnalytics.metrics.net_pnl);assert.match(await p.locator('.fxs-metric').filter({hasText:'Total P/L'}).innerText(),new RegExp(money.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')))
 for(const theme of ['dark','light'])for(const width of [360,768,1440])await layout('sessions',theme,width)
 await p.getByRole('button',{name:'Chọn phiên replay',exact:true}).click();const sessionSearch=p.getByRole('searchbox',{name:'Tìm Chọn phiên replay',exact:true});await sessionSearch.fill('Exness');assert.equal(await p.getByRole('listbox',{name:'Chọn phiên replay',exact:true}).getByRole('option').count(),1);await sessionSearch.press('ArrowDown');await p.keyboard.press('Enter');await p.getByTestId('session-performance').waitFor();await settle();assert.equal(new URL(p.url()).searchParams.get('session'),old)
 assert.equal(await p.locator('.fxs-metric').count(),6);assert.deepEqual(await p.locator('.fxs-metric strong').allTextContents(),Array(6).fill('—'));assert.equal(await p.locator('.fxs-table-scroll tbody tr').count(),0);assert.equal(await p.locator('.fxs-balance-curve,.fxs-bars').count(),0);assert.equal(await p.locator('.fxs-balance strong').innerText(),'—');assert.match(await p.getByTestId('session-performance').innerText(),/Chưa có giao dịch|Chưa.*kết quả|chưa.*thực thi/i);await p.screenshot({path:path.join(out,'sessions-actual-no-init.png'),fullPage:true})
 await p.goto(sessions(initialized),{waitUntil:'networkidle'});await p.getByTestId('session-performance').waitFor();await settle();assert.match(await p.locator('.fxs-metric').filter({hasText:'Total P/L'}).innerText(),/0 USD/);assert.equal(await p.locator('.fxs-table-scroll tbody tr').count(),0);assert.match(await p.locator('.fxs-balance strong').innerText(),/10\.000 USD/);report.checks.push('Rich searchable session selector keyboard navigation reaches genuine no-init old session: six unknowns/no fabricated balance/path/empty recent trades; actual initialized-empty keeps measured zero and original balance; populated XAU metrics/trades match actual read model')
 fixture=async(q,u)=>u.pathname===`/api/v2/replay/sessions/${filled}/analytics`?{status:500,contentType:'application/json',body:JSON.stringify({detail:'INDEPENDENT_LABELED_ERROR_FIXTURE'})}:null
 await p.goto(sessions(filled),{waitUntil:'networkidle'});await p.getByRole('alert').filter({hasText:'Không tải được kết quả'}).waitFor();assert.equal(await p.getByTestId('session-performance').count(),0);report.checks.push('LABELED SYNTHETIC: analytics GET500 shows error and hides result; unavailable source cannot become empty-zero performance')
 fixture=async(q,u)=>u.pathname===`/api/v2/replay/sessions/${filled}/analytics`?{status:200,contentType:'application/json',body:JSON.stringify({...fullAnalytics,stale:true,freshness:'stale'})}:null
 await p.goto(sessions(filled),{waitUntil:'networkidle'});await p.getByTestId('session-performance').waitFor();assert.match(await p.getByTestId('session-performance').innerText(),/Dữ liệu chưa cập nhật/);report.checks.push('LABELED SYNTHETIC: stale source notice remains explicit with scoped results')
 fixture=async(q,u)=>u.pathname==='/api/v2/overview'?{status:500,contentType:'application/json',body:JSON.stringify({detail:'INDEPENDENT_LABELED_ERROR_FIXTURE'})}:null
 await p.goto(dashboard,{waitUntil:'networkidle'});await p.getByTestId('dashboard-data-state').filter({hasText:'Chưa tải được Performance'}).waitFor();assert.equal(await countMetric.innerText(),'—');report.checks.push('LABELED SYNTHETIC: overview GET500 retains truthful unknown metrics and visible failure')
 fixture=null
 const after=await get(`/api/v2/replay/sessions/${old}`);assert.equal(after.revision,before.revision);assert.deepEqual(after.payload,before.payload);assert.equal(after.dataset_sha256,before.dataset_sha256);assert.deepEqual(after.visible_rows,before.visible_rows)
 report.preserved={sessionId:old,revision:after.revision,visibleRows:after.visible_rows.length,unchanged:true};report.after=await hashes();report.sourceUnchanged=JSON.stringify(report.before)===JSON.stringify(report.after);assert.equal(report.sourceUnchanged,true);assert.deepEqual(report.errors,[]);assert.deepEqual(report.blocked,[]);report.pass=true
}catch(e){report.failure=String(e);report.after=await hashes();await p.screenshot({path:path.join(out,'failure.png'),fullPage:true}).catch(()=>{});console.error(e);process.exitCode=1}
finally{try{await c.unrouteAll({behavior:'wait'})}catch(e){report.teardown.push(String(e))}await b.close();await writeFile(path.join(out,'browser.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({pass:report.pass,cases:report.cases,checks:report.checks,failure:report.failure,errors:report.errors,blocked:report.blocked,teardown:report.teardown}))}
