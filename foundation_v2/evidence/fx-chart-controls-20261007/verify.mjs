import assert from 'node:assert/strict'
import { chromium } from '../../web/node_modules/playwright/index.mjs'
import { writeFile, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
const out=new URL('./',import.meta.url), session='476f4b498e1a49ed9d48a75719f4d270'
const url=`http://127.0.0.1:5180/?workspace=tenant-a&view=replay&session=${session}&dataset=dataset-262639d819219431b8bbfd00a665d4fb7fde4c646a4fa0c5020608c1e1c3572d&mode=Practice&surface=workspace&cursor=500`
const report={scope:'Actual service GET only; intercepted activity receipt and Clipboard sink; no step/order/cloud writes',cases:[],errors:[],unexpected:[]}
const browser=await chromium.launch({headless:true})
try{
 for(const [width,theme,language] of [[1710,'dark','vi'],[1611,'dark','en'],[768,'dark','vi'],[360,'light','en'],[1710,'light','en']]){
  const context=await browser.newContext({viewport:{width,height:987},acceptDownloads:true})
  await context.addInitScript(({theme,language})=>{
   localStorage.setItem('tw-theme',theme);localStorage.setItem('tw-language',language)
   // Exercise PNG serialization without touching the owner's OS clipboard.
   Object.defineProperty(navigator,'clipboard',{value:{write:async items=>{window.__qaCopy=await items[0].getType('image/png').then(blob=>blob.size)}}})
  },{theme,language})
  await context.routeWebSocket('**/*',socket=>socket.close())
  await context.route('**/*',async route=>{
   const r=route.request(),u=new URL(r.url())
   if(r.method()==='POST' && u.pathname===`/api/v2/replay/sessions/${session}/activity`){const e=r.postDataJSON();return route.fulfill({status:200,json:{schema_version:'replay-activity-v1',event_id:e.event_id,session_id:session,accepted_seconds:(Date.parse(e.ended_at_utc)-Date.parse(e.started_at_utc))/1000}})}
   if(!['GET','HEAD','OPTIONS'].includes(r.method()) || !['http://127.0.0.1:5180','http://127.0.0.1:8010'].includes(u.origin)){
    if(!r.url().includes('google-analytics.com/analytics.js'))report.unexpected.push({method:r.method(),url:r.url()})
    return route.abort()
   }
   if(u.pathname.endsWith('charting_library.standalone.js')){
    const response=await route.fetch()
    return route.fulfill({response,body:await response.text()+';window.TradingView.widget=new Proxy(window.TradingView.widget,{construct(Target,args){const item=new Target(...args);window.__qaWidget=item;return item}});'})
   }
   return route.continue()
  })
  const page=await context.newPage();page.on('pageerror',e=>report.errors.push(String(e)))
  await page.goto(url);await page.locator('[data-chart-status=ready]').waitFor()
  const frame=page.frameLocator('.advanced-chart-host iframe')
  await frame.getByTestId('legacy-native-market').waitFor()
  await frame.locator('.legacy-save-layout[data-save-state=saved]').waitFor({state:'attached',timeout:15000})
  const geometry=await page.evaluate(()=>{
   const f=document.querySelector('.advanced-chart-host iframe'),d=f.contentDocument,r=f.getBoundingClientRect(),c=d.querySelector('.layout__area--center').getBoundingClientRect(),top=d.querySelector('.layout__area--top').getBoundingClientRect(),rail=document.querySelector('.chart-utility-rail').getBoundingClientRect()
   return {iframe:r.toJSON(),center:c.toJSON(),top:top.toJSON(),rail:rail.toJSON(),overflow:document.documentElement.scrollWidth-innerWidth}
  })
  assert.equal(geometry.overflow,0);assert.ok(geometry.center.right<=geometry.iframe.width+1);assert.equal(geometry.rail.right,width)
  assert.equal(await frame.locator('button.legacy-session-name').count(),0)
  assert.ok(await frame.locator('span.legacy-session-name').count())
  assert.equal(await frame.locator('.legacy-save-layout').isEnabled(),false)
  assert.equal(await page.locator('.legacy-rail-cap').count(),0)
  const compact=await frame.locator('.chart-header-overflow').isVisible()
  const tool=async(kind)=>{
   if(compact){await frame.locator('.chart-header-overflow').click();await page.locator('.legacy-native-menu').getByRole('button',{name:kind==='layout'?'New Layout':/PNG/,exact:kind==='layout'}).click()}
   else if(kind==='layout')await frame.locator('.legacy-native-session > button').nth(0).click()
   else await frame.locator('.legacy-native-tools > button').nth(0).click()
  }
  await tool('layout');await frame.locator('.legacy-layout-grid').waitFor()
  assert.equal(await frame.locator('.legacy-layout-row').count(),8)
  assert.equal(await frame.locator('.legacy-layout-grid button:enabled').count(),1)
  const popup=await frame.locator('.legacy-popover').boundingBox();assert.ok(popup.x>=0 && popup.x+popup.width<=width)
  await page.screenshot({path:fileURLToPath(new URL(`layout-${theme}-${language}-${width}.png`,out))})
  await frame.locator('.legacy-layout-grid button:enabled').press('Escape')
  assert.equal(await frame.locator('.legacy-popover').count(),0)
  await tool('capture');await frame.locator('.legacy-popover').waitFor()
  await frame.locator('.legacy-popover button').first().press('Escape')
  await tool('layout');await frame.locator('.legacy-layout-grid').waitFor()
  await frame.locator('.legacy-layout-grid button:enabled').press('Escape')
  // Actual native interval edit, manual Ctrl+S, then reload-resume.
  await page.evaluate(()=>window.__qaWidget.activeChart().setResolution('5'))
  await frame.locator('.legacy-save-layout[data-save-state=dirty]').waitFor({state:'attached'})
  await frame.locator('body').press('Control+s')
  await frame.locator('.legacy-save-layout[data-save-state=saved]').waitFor({state:'attached'})
  assert.ok(await page.evaluate(()=>Object.keys(localStorage).some(k=>k.startsWith('tw:advanced-chart:v1:'))))
  await tool('capture');assert.equal(await frame.locator('.legacy-popover button').count(),2)
  const download=page.waitForEvent('download');await frame.locator('.legacy-popover button').nth(0).click()
  const png=await readFile(await (await download).path());assert.equal(png.subarray(1,4).toString(),'PNG')
  await tool('capture');await frame.locator('.legacy-popover button').nth(1).click();await page.waitForFunction(()=>window.__qaCopy>1000)
  const rail=page.locator('.chart-utility-rail')
  await rail.locator('.legacy-rail-tools button').click();await page.locator('.legacy-object-tree').waitFor()
  assert.ok(await page.locator('.legacy-object-row').count()>1)
  await page.locator('.replay-panel-close').click()
  await rail.locator('> button').nth(0).click();await page.getByRole('dialog').waitFor()
  assert.equal(await page.locator('.fx-app').evaluate(e=>e.inert),true)
  assert.equal(await page.locator('form form').count(),0)
  await page.screenshot({path:fileURLToPath(new URL(`order-${theme}-${language}-${width}.png`,out))})
  await page.locator('.legacy-order-modal > header button').last().click()
  assert.equal(await page.locator('.fx-app').evaluate(e=>e.inert),false)
  await rail.locator('> button').nth(1).click();await page.locator('body > .legacy-popover').waitFor()
  assert.equal(await page.locator('body > .legacy-popover button:disabled').count(),4)
  await page.locator('body > .legacy-popover button:enabled').click();assert.equal(await page.locator('body > .legacy-popover form').count(),2)
  await page.locator('body > .legacy-popover input').first().press('Escape')
  await rail.locator('> button').nth(3).click();await page.locator('.legacy-journal').waitFor()
  if(width>1100){
   await page.waitForFunction(()=>{const f=document.querySelector('.advanced-chart-host iframe'),c=f.contentDocument.querySelector('.layout__area--center').getBoundingClientRect(),r=f.getBoundingClientRect(),side=document.querySelector('.replay-side').getBoundingClientRect();return c.right<=r.width+1 && r.right+48<=side.left+1 && side.top===0})
  }
  await page.screenshot({path:fileURLToPath(new URL(`journal-${theme}-${language}-${width}.png`,out))})
  await page.locator('#journal-tab-calendar').click();await page.locator('.legacy-calendar-month').waitFor()
  await page.locator('.legacy-calendar-toolbar > div button').nth(1).click();assert.equal(await page.locator('.legacy-calendar-month').count(),12)
  await page.screenshot({path:fileURLToPath(new URL(`calendar-${theme}-${language}-${width}.png`,out))})
  await page.locator('.legacy-journal header > button').click()
  await page.screenshot({path:fileURLToPath(new URL(`header-${theme}-${language}-${width}.png`,out))})
  const cutoff=await page.locator('[data-chart-status=ready]').getAttribute('data-cutoff')
  await page.reload();await page.locator('[data-chart-status=ready]').waitFor();await frame.getByTestId('legacy-native-market').waitFor()
  assert.equal(await page.evaluate(()=>window.__qaWidget.activeChart().resolution()),'5')
  assert.equal(await page.locator('[data-chart-status=ready]').getAttribute('data-cutoff'),cutoff)
  report.cases.push({width,theme,language,geometry,downloadBytes:png.length,copyPng:true,restoredInterval:true,pass:true})
  await context.close()
 }
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.unexpected,[]);report.pass=true
}catch(e){report.pass=false;report.failure=String(e);throw e}
finally{await writeFile(new URL('report.json',out),JSON.stringify(report,null,2));await browser.close();console.log(JSON.stringify({pass:report.pass,cases:report.cases.length,errors:report.errors,failure:report.failure}))}
