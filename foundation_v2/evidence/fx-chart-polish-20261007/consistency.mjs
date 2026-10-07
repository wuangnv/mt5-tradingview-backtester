import assert from 'node:assert/strict'
import { chromium } from '../../web/node_modules/playwright/index.mjs'
import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
const out=new URL('./',import.meta.url),session='476f4b498e1a49ed9d48a75719f4d270'
const url=`http://127.0.0.1:5180/?workspace=tenant-a&view=replay&session=${session}&dataset=dataset-262639d819219431b8bbfd00a665d4fb7fde4c646a4fa0c5020608c1e1c3572d&mode=Practice&surface=workspace&cursor=500`
const report={scope:'Actual local GET UI; owner mutations and external requests blocked, browser preferences isolated.',cases:[],errors:[],blocked:[],external:[]}
const browser=await chromium.launch({headless:true})
try {
 for(const [width,height,theme] of [[1920,940,'dark'],[1920,940,'light'],[1080,844,'dark'],[360,844,'dark']]) {
  const context=await browser.newContext({viewport:{width,height}})
  await context.addInitScript(theme=>{localStorage.setItem('tw-theme',theme);localStorage.setItem('tw-language','vi')},theme)
  await context.routeWebSocket('**/*',s=>s.close())
  await context.route('**/*',r=>{const u=new URL(r.request().url());if(u.hostname!=='127.0.0.1'){report.external.push(u.origin);return r.abort()}if(r.request().method()==='POST'&&u.pathname.endsWith('/activity')){const e=r.request().postDataJSON();return r.fulfill({status:200,json:{schema_version:'replay-activity-v1',event_id:e.event_id,session_id:session,accepted_seconds:(Date.parse(e.ended_at_utc)-Date.parse(e.started_at_utc))/1000}})}if(!['GET','HEAD'].includes(r.request().method())){report.blocked.push({method:r.request().method(),url:r.request().url()});return r.abort()}return r.continue()})
  const page=await context.newPage();page.on('pageerror',e=>report.errors.push(String(e)))
  await page.goto(url);await page.locator('[data-chart-status=ready]').waitFor()
  const frame=page.frameLocator('iframe');await frame.getByTestId('legacy-native-market').waitFor()
  assert.equal(await page.locator('.legacy-quick-actions').count(),0)
  const geometry=await frame.locator('.layout__area--top').evaluate(e=>{
   const rect=n=>{const r=n.getBoundingClientRect();return {left:r.left,right:r.right,width:r.width}}
   const ids=['header-toolbar-intervals','header-toolbar-chart-styles','header-toolbar-indicators','header-toolbar-undo-redo']
   const groups=ids.map(id=>e.querySelector('#'+id)?.parentElement).concat([...e.querySelectorAll('.legacy-layout-group,.legacy-search-group')])
   return {top:rect(e),separators:groups.filter(n=>n&&n.getBoundingClientRect().width>0).map(n=>({id:n.querySelector('[id]')?.id||n.className,left:getComputedStyle(n,'::before').left,width:getComputedStyle(n,'::before').width,height:getComputedStyle(n,'::before').height,bg:getComputedStyle(n,'::before').backgroundColor})),name:e.querySelector('.legacy-session-name')&&rect(e.querySelector('.legacy-session-name')),save:e.querySelector('.legacy-save-layout')&&rect(e.querySelector('.legacy-save-layout')),session:e.querySelector('.legacy-session-group')&&rect(e.querySelector('.legacy-session-group')),search:e.querySelector('.legacy-search-group')&&rect(e.querySelector('.legacy-search-group')),sessionSeparator:getComputedStyle(e.querySelector('.legacy-session-group'),'::before').display,mentorBorders:['::before','::after'].map(p=>getComputedStyle(e.querySelector('.legacy-mentor'),p).width),themeBorder:getComputedStyle(e.querySelector('[data-testid=theme-toggle]'),'::after').width}
  })
  assert.equal(geometry.top.width,width)
  for(const s of geometry.separators){assert.equal(s.left,'0px');assert.equal(s.width,'1px');assert.equal(s.height,'24px')}
  if(width>1180){assert.ok(geometry.session.width>350);assert.ok(Math.abs(geometry.session.right-geometry.search.left)<3);assert.equal(geometry.sessionSeparator,'none');assert.deepEqual(geometry.mentorBorders,['1px','1px']);assert.equal(geometry.themeBorder,'1px')}
  const grips=await page.locator('.chart-float-grip,.legacy-positions-grip').evaluateAll(es=>es.map(e=>({dots:e.querySelectorAll('circle').length,color:getComputedStyle(e).color,radius:e.querySelector('circle')?.getAttribute('r')})))
  assert.ok(grips.every(g=>g.dots===6&&g.radius==='1.5'))
  const quantity=page.locator('.legacy-quantity-control');await quantity.locator('input').hover();await page.waitForTimeout(180)
  const hover=await quantity.evaluate(e=>{const s=getComputedStyle(e),input=e.querySelector('input'),i=getComputedStyle(input);return {bg:s.backgroundColor,border:s.borderColor,radius:s.borderRadius,projectHover:s.getPropertyValue('--project-hover').trim(),inputBg:i.backgroundColor,inputBorder:i.borderWidth,inputShadow:i.boxShadow,width:e.getBoundingClientRect().width}})
  assert.equal(hover.bg,'rgba(0, 0, 0, 0)');assert.equal(hover.inputBg,'rgba(0, 0, 0, 0)');assert.equal(hover.inputBorder,'0px');assert.equal(hover.inputShadow,'none')
  await page.screenshot({path:fileURLToPath(new URL(`consistency-${theme}-${width}.png`,out))})
  if(width===1080)await quantity.screenshot({path:fileURLToPath(new URL('consistency-quantity-hover.png',out))})
  await quantity.locator('input').focus()
  const focus=await quantity.evaluate(e=>({outline:getComputedStyle(e).outlineWidth,color:getComputedStyle(e).outlineColor,inputOutline:getComputedStyle(e.querySelector('input')).outlineWidth,inputStyle:getComputedStyle(e.querySelector('input')).outlineStyle}))
  assert.equal(focus.outline,'2px');assert.equal(focus.inputStyle,'none')
  const interval=page.locator('.legacy-replay-interval');await interval.click();await page.locator('.legacy-replay-intervals button').filter({hasText:/^5m$/}).click();await interval.click()
  await page.locator('.legacy-popover').waitFor()
  assert.equal(await page.evaluate(()=>document.activeElement.textContent),'5m✓')
  const menu=page.locator('.legacy-popover');const typography=await menu.evaluate(e=>({font:getComputedStyle(e).fontFamily,line:getComputedStyle(e).lineHeight,focus:getComputedStyle(e.querySelector(':focus')).outlineColor}))
  assert.match(typography.font,/Inter/);assert.equal(typography.line,'20px')
  await page.keyboard.press('Escape');assert.equal(await menu.count(),0);assert.equal(await interval.evaluate(e=>e===document.activeElement),true)
  await interval.click();await page.locator('.legacy-replay-intervals button').last().focus();await page.keyboard.press('Tab');await menu.waitFor({state:'hidden'});assert.equal(await menu.count(),0)
  await page.locator('.legacy-scalper-button').click();await page.locator('.legacy-scalper-settings').waitFor();await page.screenshot({path:fileURLToPath(new URL(`consistency-scalper-${theme}-${width}.png`,out))});await page.locator('.legacy-scalper-settings footer button').first().click();assert.equal(await page.locator('.legacy-scalper-button').evaluate(e=>e===document.activeElement),true)
  if(width<=1180){await frame.getByRole('button',{name:'Công cụ biểu đồ',exact:true}).click();await page.locator('.legacy-native-menu').waitFor();await page.keyboard.press('End');await page.keyboard.press('Tab');assert.equal(await page.locator('.legacy-native-menu').count(),0)}
  await page.emulateMedia({reducedMotion:'reduce'});assert.ok(await quantity.evaluate(e=>getComputedStyle(e).transitionDuration.split(',').every(value=>parseFloat(value)<=0.001)))
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth),0)
  report.cases.push({width,height,theme,geometry,grips,hover,focus,typography});await context.close()
 }
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.blocked,[]);report.pass=true
}catch(e){report.pass=false;report.failure=String(e);throw e}
finally{await writeFile(new URL('consistency-report.json',out),JSON.stringify(report,null,2));await browser.close();console.log(JSON.stringify({pass:report.pass,cases:report.cases.length,failure:report.failure,errors:report.errors,blocked:report.blocked}))}
