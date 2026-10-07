import { chromium } from '../../../web/node_modules/playwright/index.mjs'
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const browser = await chromium.launch({ignoreDefaultArgs:['--hide-scrollbars']})
const report = {cases:[],errors:[],blocked:[]}
const home = 'http://127.0.0.1:5180/?workspace=tenant-a&view=overview&area=testing&section=dashboard'
try {
  for (const width of [1710,1440,768,360]) for (const theme of ['dark','light']) for (const language of ['vi','en']) for (const demo of [false,true]) {
    const context = await browser.newContext({viewport:{width,height:987},reducedMotion:'reduce'})
    await context.addInitScript(({theme,language})=>{localStorage.setItem('tw-theme',theme);localStorage.setItem('tw-language',language)}, {theme,language})
    await context.route('**/*',route=>{const r=route.request(),url=new URL(r.url());if (!['127.0.0.1','localhost'].includes(url.hostname)|| !['GET','HEAD','OPTIONS'].includes(r.method())) {report.blocked.push(url.href);return route.abort()}return route.continue()})
    await context.routeWebSocket('**/*',ws=>ws.close())
    const page = await context.newPage()
    page.on('pageerror',e=>report.errors.push(e.message))
    await page.goto(home+(demo?'&demo=1':''))
    await page.locator('.fx-dashboard-card-expand').first().waitFor()
    await page.waitForFunction(()=>document.querySelectorAll('.fx-dashboard-metric > strong').length===4 && document.querySelector('.fx-dashboard-results').getAttribute('aria-busy')==='false')
    const metrics = await page.locator('.fx-dashboard-metric > strong').allTextContents()
    if (demo) { assert.match(metrics[0],/18.*40/);assert.match(metrics[1],/36.*7/) }
    else {assert.equal(metrics[0],'—');assert.equal(metrics[1],'—')}
    const geometry = await page.evaluate(()=>{
      const rect=s=>{const r=document.querySelector(s).getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}}
      const progress=document.querySelector('.fx-dashboard-card-progress'), summary=document.querySelector('.fx-dashboard-card-summary')
      return {overflow:document.documentElement.scrollWidth>innerWidth,summary:rect('.fx-dashboard-card-summary'),icon:rect('.fx-dashboard-card-icon'),progress:rect('.fx-dashboard-card-progress small'),actions:rect('.fx-dashboard-card-actions'),font:getComputedStyle(summary).font,progressColor:getComputedStyle(progress.querySelector('small')).color,blue:getComputedStyle(progress).getPropertyValue('--project-primary').trim(),infoIcons:document.querySelectorAll('.fx-dashboard-metric .fxs-metric-info').length}
    })
    assert.equal(geometry.overflow,false,JSON.stringify({width,theme,language,demo}))
    assert.equal(geometry.summary.height,geometry.icon.height)
    assert.equal(geometry.infoIcons,0)
    if(width>1250)assert.ok(Math.abs(geometry.progress.y+geometry.progress.height/2-geometry.actions.y-geometry.actions.height/2)<1)
    await page.locator('.fx-dashboard-card-expand').first().focus()
    await page.keyboard.press('Enter')
    const card=page.locator('.fx-dashboard-session-card').first()
    await card.locator('.fx-dashboard-card-charts').waitFor()
    let emptyHeight = null
    if(!demo){await card.locator('.fxs-no-analytics').waitFor();emptyHeight=(await card.locator('.fx-dashboard-card-charts').boundingBox()).height;assert.ok(emptyHeight<45)}
    else {await card.locator('.fxs-charts').waitFor();assert.equal(await card.locator('.fxs-chart-panel').count(),3)}
    if (width===1710&&theme==='dark'&&language==='vi'||width===360&&language==='en'){
      await page.evaluate(()=>{window.scrollTo(0,0);document.querySelector('.fx-content').scrollTop=0})
      await page.screenshot({path:fileURLToPath(new URL(`./${demo?'demo':'actual'}-${theme}-${language}-${width}.png`,import.meta.url)),fullPage:true})
      if(width===1710)await card.screenshot({path:fileURLToPath(new URL(`./${demo?'demo':'actual'}-session.png`,import.meta.url))})
    }
    await page.locator('.fx-dashboard-card-expand').first().click()
    assert.equal(await card.locator('.fx-dashboard-card-charts').count(),0)
    report.cases.push({width,theme,language,demo,metrics,geometry,emptyHeight,pass:true})
    await context.close()
  }
  assert.deepEqual(report.errors,[]);assert.deepEqual(report.blocked,[])
  await writeFile(new URL('./report.json',import.meta.url),JSON.stringify(report,null,2))
  console.log(`${report.cases.length} Dashboard cases PASS`)
}finally {await browser.close()}
