import assert from 'node:assert/strict'
import {chromium} from '../../../web/node_modules/playwright/index.mjs'
import {readFile,writeFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import {createHash} from 'node:crypto'

const out=new URL('./',import.meta.url),owner='476f4b498e1a49ed9d48a75719f4d270',fake='independent-quick-session',dataset='dataset-262639d819219431b8bbfd00a665d4fb7fde4c646a4fa0c5020608c1e1c3572d'
const dashboard='http://127.0.0.1:5180/?workspace=tenant-a&view=overview&area=testing&section=dashboard&chart_iframe=srcdoc'
const report={scope:'Independent UI with real local reads; all creation/activity writes intercepted in memory; no external/reference/broker changes.',cases:[],fixtures:[],errors:[],blocked:[]},browser=await chromium.launch({headless:true})
const response=await fetch(`http://127.0.0.1:8010/api/v2/replay/sessions/${owner}?cursor_index=500`,{headers:{'X-Workspace-Id':'tenant-a'}}),seed=await response.json()
async function setup(width,height,theme,fixture={}) {
 const context=await browser.newContext({viewport:{width,height}}),traffic={creates:[],reads:[]};let created
 await context.addInitScript(theme=>{localStorage.setItem('tw-theme',theme);localStorage.setItem('tw-language','vi')},theme)
 await context.routeWebSocket('**/*',s=>s.close())
 await context.route('**/*',async route=>{
  const r=route.request(),u=new URL(r.url())
  if(r.method()==='POST'&&u.pathname.endsWith('/activity')){const e=r.postDataJSON();return route.fulfill({status:200,json:{schema_version:'replay-activity-v1',event_id:e.event_id,session_id:fake,accepted_seconds:(Date.parse(e.ended_at_utc)-Date.parse(e.started_at_utc))/1000}})}
  if(r.method()==='POST'&&u.pathname==='/api/v2/replay/sessions'){
   traffic.creates.push({body:r.postDataJSON(),workspace:r.headers()['x-workspace-id']});assert.notEqual(fixture.status,undefined,'Creation requires isolated fixture')
   if(fixture.delay)await new Promise(resolve=>setTimeout(resolve,fixture.delay))
   if(fixture.status!==201)return route.fulfill({status:fixture.status,json:{detail:'Independent create rejection'}})
   const body=traffic.creates.at(-1).body,start=body.start_index
   created={...structuredClone(seed),record_id:fake,revision:1,view_cursor_index:start,canonical_cursor_index:start,historical_view:false,visible_row_count:start+1,visible_rows:seed.visible_rows.slice(0,start+1),cutoff_timestamp:seed.visible_rows[start].timestamp,payload:{dataset_id:body.dataset_id,cursor_index:start,branch_id:'independent-branch',parent_session_id:null,parent_revision:null,status:'paused',chart_engine:body.chart_engine,name:body.name,description:body.description,starting_balance:body.starting_balance,starting_balance_ccy:fixture.currency||'USD',...(body.playbook_id?{playbook_id:body.playbook_id,playbook_revision:body.playbook_revision}:{})}}
   return route.fulfill({status:201,json:fixture.malformed?{record_id:fake,payload:{dataset_id:'wrong'},revision:1}:created})
  }
  if(!['GET','HEAD','OPTIONS'].includes(r.method())||!['http://127.0.0.1:5180','http://127.0.0.1:8010'].includes(u.origin)){report.blocked.push({method:r.method(),url:r.url()});return route.abort()}
  traffic.reads.push(u.pathname)
  if(created&&u.pathname===`/api/v2/replay/sessions/${fake}`)return route.fulfill({json:created})
  if(created&&u.pathname.includes(`/api/v2/replay/sessions/${fake}/`))return route.fulfill({status:404,json:{detail:'Independent fixture has no supplementary service'}})
  if(u.pathname==='/api/v2/data/datasets'&&fixture.currency){const response=await route.fetch(),body=await response.json();body.items=body.items.map(item=>({...item,instrument_spec:{...item.instrument_spec,account_ccy:fixture.currency}}));return route.fulfill({response,json:body})}
  if(u.pathname==='/api/v2/data/datasets'&&fixture.data==='empty')return route.fulfill({json:{items:[]}})
  if(u.pathname==='/api/v2/data/datasets'&&fixture.data==='error')return route.fulfill({status:503,json:{detail:'Independent catalog unavailable'}})
  if(u.pathname==='/api/v2/playbooks'&&fixture.books==='error')return route.fulfill({status:503,json:{detail:'Independent strategies unavailable'}})
  if(u.pathname==='/api/v2/playbooks'&&fixture.books==='one')return route.fulfill({json:{items:[{record_id:'strategy-1',revision:3,payload:{name:'Independent strategy'}}]}})
  return route.continue()
 })
 const page=await context.newPage();page.on('pageerror',e=>report.errors.push(String(e)))
 await page.goto(dashboard);await page.locator('.fx-dashboard-quick-action.is-primary').waitFor();return{context,page,traffic}
}
async function open(page){await page.locator('.fx-dashboard-quick-action.is-primary').click();const dialog=page.locator('dialog.quick-session-dialog');await dialog.waitFor();return dialog}
async function fill(dialog,{strategy=false,advanced=false}={}) {
 await dialog.locator('.quick-session-fields > label').first().locator('input').fill('Independent session')
 await dialog.locator('.quick-session-balance input').fill('25000.75')
 if(strategy){await dialog.getByRole('button',{name:'Chiến lược',exact:true}).click();await dialog.getByRole('option',{name:/Independent strategy/}).click()}
 await dialog.getByRole('button',{name:'Chọn tài sản',exact:true}).click();await dialog.locator('.fx-select-menu input[type=search]').fill('EURUSDm');await dialog.getByRole('option',{name:/^EURUSDm/}).last().click()
 if(advanced){await dialog.locator('.quick-session-advanced').click();await dialog.locator('textarea').fill('Independent description');await dialog.locator('input[type=number]').last().fill('17')}
}
try {
 for(const [width,height,theme] of [[1368,790,'dark'],[1710,987,'dark'],[360,844,'dark'],[1368,790,'light'],[1710,987,'light'],[360,844,'light']]){
  const {context,page,traffic}=await setup(width,height,theme),item={width,height,theme};report.cases.push(item);const dialog=await open(page)
  assert.equal(await dialog.locator('.quick-session-fields > label').first().locator('input').evaluate(e=>e===document.activeElement),true)
  assert.equal(await dialog.locator('.quick-session-submit').isDisabled(),true)
  assert.equal(await dialog.getByRole('radio',{name:/New Chart/}).isDisabled(),true)
  assert.equal(await dialog.getByRole('radio',{name:'Legacy Chart',exact:true}).getAttribute('aria-checked'),'true')
  assert.equal(await dialog.getByRole('button',{name:'Bố cục biểu đồ',exact:true}).isDisabled(),true)
  await fill(dialog)
  assert.equal(await dialog.locator('.quick-session-submit').isDisabled(),false)
  await dialog.getByRole('button',{name:'Chọn tài sản',exact:true}).click();const menu=dialog.locator('.fx-select-menu');await menu.waitFor()
  item.popup=await menu.evaluate(e=>{const r=e.getBoundingClientRect(),body=e.closest('.quick-session-body').getBoundingClientRect(),option=e.querySelector('[role=option]'),o=option.getBoundingClientRect(),hit=document.elementFromPoint(o.left+o.width/2,o.top+o.height/2);return{left:r.left,right:r.right,top:r.top,bottom:r.bottom,bodyTop:body.top,bodyBottom:body.bottom,firstClickable:option===hit||option.contains(hit)}})
  assert.equal(item.popup.firstClickable,true);assert.ok(item.popup.top>=item.popup.bodyTop-1);assert.ok(item.popup.bottom<=item.popup.bodyBottom+1);assert.ok(item.popup.left>=0&&item.popup.right<=width)
  await dialog.locator('.fx-select-menu input[type=search]').fill('no-such-review-asset');assert.equal(await dialog.getByRole('option').count(),0)
  await page.keyboard.press('Escape');assert.equal(await dialog.count(),1);assert.equal(await dialog.locator('.fx-select-menu').count(),0);await page.waitForTimeout(180)
  await dialog.locator('.quick-session-body').evaluate(e=>e.scrollTo(0,0));await page.screenshot({path:fileURLToPath(new URL(`quick-session-${theme}-${width}.png`,out))})
  await dialog.locator('.quick-session-advanced').click();await dialog.locator('input[type=number]').last().fill('-1');assert.equal(await dialog.locator('.quick-session-submit').isDisabled(),true);await dialog.locator('input[type=number]').last().fill('17');assert.equal(await dialog.locator('.quick-session-submit').isDisabled(),false)
  await dialog.getByRole('radio',{name:'Legacy Chart',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:fileURLToPath(new URL(`quick-session-advanced-${theme}-${width}.png`,out))})
  await dialog.getByRole('tab').last().click();assert.equal(await dialog.locator('.quick-session-submit').getAttribute('href')!==null,true)
  item.propHref=await dialog.locator('.quick-session-submit').getAttribute('href');assert.equal(new URL(item.propHref,dashboard).searchParams.get('view'),'testing')
  await page.keyboard.press('Escape');await dialog.waitFor({state:'detached'});assert.equal(await page.locator('.fx-dashboard-quick-action.is-primary').evaluate(e=>e===document.activeElement),true)
  assert.equal(traffic.creates.length,0);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth),0);item.pass=true;await context.close();console.log(JSON.stringify({case:theme+width,pass:true}))
 }
 for(const fixture of [{data:'empty'},{data:'error'},{books:'error'},{status:422},{status:500},{status:201,malformed:true},{status:201,books:'one',delay:250},{status:201,books:'one',currency:'EUR'}]){
  const {context,page,traffic}=await setup(1368,790,'dark',fixture),item={fixture};report.fixtures.push(item);const dialog=await open(page)
  if(fixture.data){await dialog.locator('.quick-session-fields > label').first().locator('input').fill('Independent session');if(fixture.data==='error'){await dialog.getByRole('alert').waitFor();await dialog.getByRole('button',{name:'Thử lại',exact:true}).click();await dialog.getByRole('alert').waitFor()}else await dialog.getByText('Chưa có bộ dữ liệu đã tải trong không gian làm việc này.',{exact:true}).waitFor();assert.equal(await dialog.locator('.quick-session-submit').isDisabled(),true)}
  else {await fill(dialog,{strategy:fixture.books==='one',advanced:fixture.books==='one'});if(fixture.currency){assert.match(await dialog.locator('.quick-session-balance').locator('..').innerText(),/EUR/);assert.equal(await dialog.locator('.quick-session-balance > span').innerText(),'EUR')}if(fixture.books==='error'){await dialog.getByText(/Chưa đọc được chiến lược/).waitFor();assert.equal(await dialog.locator('.quick-session-submit').isDisabled(),false)}else{
   await dialog.locator('.quick-session-submit').click();if(fixture.delay){assert.equal(await dialog.locator('.quick-session-submit').isDisabled(),true);await page.keyboard.press('Escape');assert.equal(await dialog.count(),1)}
   if(fixture.status===201&&!fixture.malformed){await page.waitForURL(u=>u.searchParams.get('session')===fake);await page.locator('[data-chart-status=ready]').waitFor({timeout:30000});const query=new URL(page.url()).searchParams;assert.equal(query.get('view'),'replay');assert.equal(query.get('dataset'),dataset);assert.equal(query.has('fresh'),false);assert.equal(query.get('cursor'),'17');assert.equal(traffic.creates.length,1);item.request=traffic.creates[0];assert.equal(item.request.workspace,'tenant-a');assert.deepEqual(item.request.body,{name:'Independent session',dataset_id:dataset,starting_balance:'25000.75',chart_engine:'legacy',start_index:17,description:'Independent description',playbook_id:'strategy-1',playbook_revision:3});item.destination=page.url();item.balance=await page.locator('.legacy-balance-pill').innerText();assert.match(item.balance,/25[ .]?000[,.]75/);if(fixture.currency)assert.match(item.balance,/€|EUR/);await page.locator('.legacy-session-settings').click();await page.locator('dialog.fxs-settings-drawer').getByRole('tab').nth(1).click();item.savedBalance=await page.locator('dialog.fxs-settings-drawer').locator('input').first().inputValue();assert.match(item.savedBalance,/25[ .]?000[,.]75/);if(fixture.currency)assert.match(item.savedBalance,/EUR/);await page.keyboard.press('Escape');await page.locator('.chart-trading-actions .buy').click();await page.locator('.legacy-init-details summary').click();item.initialBalance=await page.locator('.chart-order-panel input[type=number]').first().inputValue();assert.equal(item.initialBalance,'25000.75');await page.keyboard.press('Escape');await page.screenshot({path:fileURLToPath(new URL('quick-session-created-fixture.png',out))})}
   else{await dialog.locator('.quick-session-error').waitFor();item.error=await dialog.locator('.quick-session-error').innerText();assert.equal(await dialog.locator('.quick-session-submit').isDisabled(),fixture.status!==422);assert.equal(traffic.creates.length,1)}
  }}item.traffic=traffic;item.pass=true;await page.keyboard.press('Escape');await context.close();console.log(JSON.stringify({fixture,pass:true}))
 }
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.blocked,[]);report.pass=true
}catch(e){report.pass=false;report.failure=String(e);throw e}
finally {report.sourceHashes={};for(const file of ['web/src/QuickSessionDialog.jsx','web/src/quick-session.css','web/src/DashboardSessions.jsx','web/src/sessionCatalog.js','web/src/ChartOrderPanel.jsx','web/src/LegacyTradingBar.jsx','web/src/sessionSettingsModel.js','web/src/FxSelect.jsx','web/src/testing-copy.json','trading_workspace_v2/contracts.py','trading_workspace_v2/api.py','trading_workspace_v2/replay.py'])report.sourceHashes[file]=createHash('sha256').update(await readFile(new URL('../../../'+file,import.meta.url))).digest('hex');await writeFile(new URL('quick-session-review.json',out),JSON.stringify(report,null,2));await browser.close();console.log(JSON.stringify({pass:report.pass,cases:report.cases.length,fixtures:report.fixtures.length,errors:report.errors,blocked:report.blocked,failure:report.failure}))}
