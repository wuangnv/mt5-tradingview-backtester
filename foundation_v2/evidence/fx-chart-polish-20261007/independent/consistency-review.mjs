import assert from 'node:assert/strict'
import { chromium } from '../../../web/node_modules/playwright/index.mjs'
import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
const out=new URL('./',import.meta.url),session='476f4b498e1a49ed9d48a75719f4d270'
const transport=process.env.CHART_REVIEW_TRANSPORT||'srcdoc',prefix=transport==='srcdoc'?'consistency':'consistency-default'
const url=`http://127.0.0.1:5180/?workspace=tenant-a&view=replay&session=${session}&dataset=dataset-262639d819219431b8bbfd00a665d4fb7fde4c646a4fa0c5020608c1e1c3572d&mode=Practice&surface=workspace&cursor=500${transport==='srcdoc'?'&chart_iframe=srcdoc':''}`
const report={scope:'Independent app-control consistency actualGET. Preferences/localStorage only; no owner step/order/activity writes.',transport,cases:[],errors:[],blocked:[]}
const browser=await chromium.launch({headless:true})
try{
 for(const [width,theme] of [[1920,'dark'],[1080,'dark'],[360,'dark'],[1920,'light'],[1080,'light'],[360,'light']]){
  const context=await browser.newContext({viewport:{width,height:987}})
  await context.addInitScript(theme=>{localStorage.setItem('tw-theme',theme);localStorage.setItem('tw-language','vi')},theme)
  await context.routeWebSocket('**/*',socket=>socket.close())
  await context.route('**/*',async route=>{const r=route.request(),u=new URL(r.url());if(r.method()==='POST'&&u.pathname===`/api/v2/replay/sessions/${session}/activity`){const e=r.postDataJSON();return route.fulfill({status:200,json:{schema_version:'replay-activity-v1',event_id:e.event_id,session_id:session,accepted_seconds:(Date.parse(e.ended_at_utc)-Date.parse(e.started_at_utc))/1000}})}if(!['GET','HEAD','OPTIONS'].includes(r.method())||!['http://127.0.0.1:5180','http://127.0.0.1:8010'].includes(u.origin)){report.blocked.push({method:r.method(),url:r.url()});return route.abort()}return route.continue()})
  const page=await context.newPage();page.on('pageerror',e=>report.errors.push(String(e)))
  await page.goto(url);await page.locator('[data-chart-status=ready]').waitFor({timeout:30000})
  const frame=page.frameLocator('.advanced-chart-host iframe');await frame.getByTestId('legacy-native-market').waitFor()
  const item={width,theme};report.cases.push(item)
  item.geometry=await page.evaluate(()=>{const f=document.querySelector('.advanced-chart-host iframe'),d=f.contentDocument;return{overflow:document.documentElement.scrollWidth-innerWidth,top:d.querySelector('.layout__area--top').getBoundingClientRect().toJSON(),rail:document.querySelector('.chart-utility-rail').getBoundingClientRect().toJSON(),headerHit:d.elementFromPoint(innerWidth-18,18)?.closest('button')?.title,session:d.querySelector('.legacy-native-session')?.getBoundingClientRect().toJSON(),sessionName:d.querySelector('.legacy-session-name')?getComputedStyle(d.querySelector('.legacy-session-name')).textAlign:null,separators:[...d.querySelectorAll('.layout__area--top [class^=group-]')].filter(e=>e.getBoundingClientRect().width).map(e=>({class:e.className,left:getComputedStyle(e,'::before').left,content:getComputedStyle(e,'::before').content,height:getComputedStyle(e,'::before').height})),grips:[...document.querySelectorAll('.chart-float-grip,.legacy-positions-grip')].map(e=>({dots:e.querySelectorAll('circle').length,color:getComputedStyle(e).color}))}})
  assert.equal(item.geometry.overflow,0);assert.equal(item.geometry.top.width,width);assert.equal(item.geometry.rail.top,42);assert.ok(item.geometry.headerHit);assert.equal(await page.locator('.legacy-quick-actions').count(),0);assert.ok(item.geometry.grips.every(g=>g.dots===6))
  if(width>1180)assert.equal(item.geometry.sessionName,'center')
  const q=page.locator('.legacy-quantity-control'),qi=q.locator('input')
  const styles=locator=>locator.evaluate(e=>{const s=getComputedStyle(e);return{border:s.borderColor,outline:s.outlineColor,outlineWidth:s.outlineWidth,outlineStyle:s.outlineStyle,bg:s.backgroundColor,font:s.fontFamily,line:s.lineHeight,transition:s.transitionDuration,opacity:s.opacity}})
  item.quantityBase=await styles(q);await q.hover();await page.waitForTimeout(160);item.quantityHover=await styles(q)
  if(await qi.isEnabled()){assert.notEqual(item.quantityHover.border,item.quantityBase.border);await qi.focus();item.quantityFocus=await styles(q);item.quantityInputFocus=await styles(qi);assert.equal(item.quantityFocus.outlineWidth,'2px');assert.equal(item.quantityInputFocus.outlineStyle,'none')}
  const interval=page.locator('.legacy-replay-interval');await interval.click();await page.locator('.legacy-replay-intervals button').filter({hasText:/^5m$/}).click();await interval.click()
  await page.locator('.legacy-replay-intervals').waitFor();await page.waitForTimeout(100)
  item.selectedFocus=await page.evaluate(()=>document.activeElement.outerHTML);assert.equal(await page.locator('.legacy-replay-intervals button[aria-pressed=true]').evaluate(e=>e===document.activeElement),true)
  await page.keyboard.press('Home');item.afterHome=await page.evaluate(()=>document.activeElement.outerHTML);assert.match(item.afterHome,/1m/)
  await page.keyboard.press('Shift+Tab');await page.locator('body > .legacy-popover').waitFor({state:'detached'});item.tabOutClosed=true
  await interval.click();await page.locator('.legacy-replay-intervals button:not(:disabled)').last().focus();await page.keyboard.press('Tab');await page.locator('body > .legacy-popover').waitFor({state:'detached'});item.lastTabOutClosed=true
  await interval.click();await page.keyboard.press('Escape');assert.equal(await interval.evaluate(e=>e.ownerDocument.activeElement===e),true);item.escapeReturn=true
  const rocket=page.locator('.legacy-scalper-button');await rocket.click();await page.locator('.legacy-scalper-settings').waitFor();item.scalperStyles=await styles(page.locator('body > .legacy-popover'))
  const toggle=page.locator('.legacy-scalper-settings input[type=checkbox]').first();await toggle.focus();await toggle.press('Space')
  const distance=page.locator('.legacy-scalper-distance input').first();await distance.focus();item.portalFocus=await styles(distance);assert.equal(item.portalFocus.outlineWidth,'2px')
  await page.screenshot({path:fileURLToPath(new URL(`${prefix}-scalper-${theme}-${width}.png`,out))})
  await page.locator('.legacy-scalper-settings footer button').first().click();await page.locator('body > .legacy-popover').waitFor({state:'detached'});assert.equal(await rocket.evaluate(e=>e.ownerDocument.activeElement===e),true);item.discardReturn=true
  // Native iframe portal placement, focus/keyboard dismissal and compact menu.
  if(width<=1180){await frame.locator('.chart-header-overflow').click();await page.locator('.legacy-native-menu').waitFor();assert.equal(await page.locator('.legacy-native-menu button').first().evaluate(e=>e===document.activeElement),true);await page.keyboard.press('End');assert.equal(await page.locator('.legacy-native-menu button').last().evaluate(e=>e===document.activeElement),true);await page.keyboard.press('Tab');await page.locator('.legacy-native-menu').waitFor({state:'detached'});item.compactLastTabOutClosed=true}
  if(width>1180)await frame.locator('.legacy-native-tools > button').first().click()
  else{await frame.locator('.chart-header-overflow').click();await page.locator('.legacy-native-menu').getByRole('button',{name:/Chụp.*PNG/}).click()}
  await frame.locator('.legacy-popover').waitFor();item.nativeMenuStyles=await styles(frame.locator('.legacy-popover'));await frame.locator('.legacy-popover button').last().press('Escape');assert.equal(await frame.locator('.legacy-popover').count(),0)
  await page.emulateMedia({reducedMotion:'reduce'});item.reducedMotion=await styles(interval);assert.equal(item.reducedMotion.transition,'0s');await page.emulateMedia({reducedMotion:'no-preference'})
  await page.screenshot({path:fileURLToPath(new URL(`${prefix}-chart-${theme}-${width}.png`,out))})
  const grip=page.locator('.chart-float-grip');await grip.focus();const before=await page.locator('.legacy-replay-toolbar').boundingBox();await grip.press('ArrowLeft');const after=await page.locator('.legacy-replay-toolbar').boundingBox();assert.ok(after.x<=before.x);item.gripKeyboard=true
  await context.close()
 }
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.blocked,[]);report.pass=true
}catch(e){report.pass=false;report.failure=String(e);throw e}
finally{
 const files=['web/public/chart-controls.css','web/public/chart-legacy.css','web/src/ChartWorkbench.css','web/src/LegacyTradingBar.css','web/src/LegacyReplayToolbar.css','web/src/LegacyPopover.jsx','web/src/LegacyChartHeader.jsx','web/src/ChartIcon.jsx','web/src/ReplayWorkspace.jsx']
 report.sourceHashes={};for(const f of files)report.sourceHashes[f]=createHash('sha256').update(await readFile(new URL('../../../'+f,import.meta.url))).digest('hex')
 await writeFile(new URL(`${prefix}-review.json`,out),JSON.stringify(report,null,2));await browser.close();console.log(JSON.stringify({pass:report.pass,cases:report.cases.length,errors:report.errors,blocked:report.blocked,failure:report.failure}))
}
