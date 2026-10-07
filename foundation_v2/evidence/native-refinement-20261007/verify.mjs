import assert from 'node:assert/strict'
import { chromium } from '../../web/node_modules/playwright/index.mjs'
import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
const out = new URL('./', import.meta.url)
const session = '476f4b498e1a49ed9d48a75719f4d270'
const url = `http://127.0.0.1:5180/?workspace=tenant-a&view=replay&session=${session}&dataset=dataset-262639d819219431b8bbfd00a665d4fb7fde4c646a4fa0c5020608c1e1c3572d&mode=Practice&surface=workspace&cursor=500`
const report = { scope: 'Actual service GET; activity fixture; native chart UI; no replay/orders/provider writes', cases: [], errors: [], unexpected: [] }
const browser = await chromium.launch({ headless: true })
try {
  for (const [width, theme, language] of [[1710,'dark','vi'],[1273,'dark','en'],[768,'dark','en'],[390,'light','en'],[360,'dark','vi'],[1710,'light','en']]) {
    const context = await browser.newContext({ viewport: {width,height:987}, acceptDownloads:true })
    await context.addInitScript(({theme,language})=>{localStorage.setItem('tw-theme',theme);localStorage.setItem('tw-language',language)}, {theme,language})
    await context.routeWebSocket('**/*',socket=>socket.close())
    await context.route('**/*',async route=>{
      const request=route.request(),u=new URL(request.url())
      if (request.method()==='POST' && u.pathname===`/api/v2/replay/sessions/${session}/activity`) return route.fulfill({status:200,json:{fixture:'native-refinement',accepted_seconds:0}})
      if (!['GET','HEAD','OPTIONS'].includes(request.method()) || !['http://127.0.0.1:5180','http://127.0.0.1:8010'].includes(u.origin)) {
        if (!request.url().includes('google-analytics.com/analytics.js')) report.unexpected.push({method:request.method(),url:request.url()})
        return route.abort()
      }
      if (u.pathname.endsWith('charting_library.standalone.js')) {
        const response=await route.fetch()
        return route.fulfill({response,body:await response.text()+';window.TradingView.widget=new Proxy(window.TradingView.widget,{construct(Target,args){const item=new Target(...args);window.__qaWidget=item;window.__qaOptions=args[0];return item}});'})
      }
      return route.continue()
    })
    const page=await context.newPage()
    page.on('pageerror',e=>report.errors.push(String(e)))
    await page.goto(url)
    await page.locator('[data-chart-status=ready]').waitFor()
    const frame=page.frameLocator('.advanced-chart-host iframe')
    await frame.getByTestId('legacy-native-market').waitFor()
    const geometry=await page.evaluate(()=>{
      const frame=document.querySelector('.advanced-chart-host iframe'),d=frame.contentDocument
      const top=d.querySelector('.layout__area--top').getBoundingClientRect(),r=frame.getBoundingClientRect(),cap=document.querySelector('.legacy-rail-cap').getBoundingClientRect()
      const bars=[...document.querySelectorAll('.chart-floating-toolbar')].filter(e=>e.getBoundingClientRect().width)
      const controls=bars.map(e=>({name:e.getAttribute('aria-label'),rect:e.getBoundingClientRect().toJSON(),scroll:[e.querySelector('.chart-float-content').scrollWidth,e.querySelector('.chart-float-content').clientWidth]}))
      const center=d.querySelector('.layout__area--center').getBoundingClientRect()
      const headerControls=[...d.querySelectorAll('.legacy-native-extension button,.legacy-native-extension a,[data-name=header-toolbar-properties]')].map(e=>({label:e.getAttribute('aria-label')||e.textContent,rect:e.getBoundingClientRect().toJSON()})).filter(e=>e.rect.width>0)
      return {nativeHeader:{left:r.left+top.left,right:r.left+top.right,top:r.top+top.top,height:top.height},cap:cap.toJSON(),viewport:innerWidth,overflow:document.documentElement.scrollWidth-innerWidth,centerRight:center.right,iframeWidth:r.width,bars:controls,headerControls}
    })
    report.current={width,geometry}
    assert.equal(geometry.nativeHeader.left,0);assert.equal(geometry.nativeHeader.top,0);assert.ok(Math.abs(geometry.nativeHeader.right-geometry.cap.left)<=4);assert.equal(geometry.cap.right,width);assert.equal(geometry.overflow,0)
    assert.ok(geometry.centerRight<=geometry.iframeWidth)
    geometry.headerControls.forEach(e=>assert.ok(e.rect.left>=0 && e.rect.right<=geometry.iframeWidth+1,JSON.stringify(e)))
    geometry.bars.forEach(bar=>assert.ok(bar.scroll[0]<=bar.scroll[1]+1,JSON.stringify(bar)))
    if(geometry.bars.length===2) {const [a,b]=geometry.bars.map(x=>x.rect);assert.ok(a.bottom<=b.top || b.bottom<=a.top || a.right<=b.left || b.right<=a.left,'floating bars overlap')}
    assert.equal(await page.locator('.legacy-chart-header').count(),0)
    assert.equal(await page.locator('.chart-trading-actions .chart-sim-tag').count(),0)
    assert.equal(await page.evaluate(()=>window.__qaOptions.disabled_features.includes('header_widget')),false)
    for(const id of ['header-toolbar-intervals','header-toolbar-chart-styles','header-toolbar-indicators']) assert.equal(await frame.locator(`#${id}`).count(),1)
    await page.screenshot({path:fileURLToPath(new URL(`chart-${theme}-${language}-${width}.png`,out))})
    const before=await page.locator('[data-chart-status=ready]').getAttribute('data-cutoff')
    const compact=await frame.locator('.chart-header-overflow').isVisible()
    const openTool=async label=>{
      if(compact) {await frame.locator('.chart-header-overflow').click();await page.locator('.legacy-native-menu').getByRole('button',{name:label,exact:true}).click()}
      else await frame.getByRole('button',{name:label,exact:true}).click()
    }
    for(const [tool,label] of [['layout','New Layout'],['editor','Editor'],['mentor','AI Mentor']]) {
      await openTool(label);await page.getByTestId(`chart-preview-${tool}`).waitFor()
      const dock=await page.locator('.replay-side').boundingBox();assert.ok(dock.y>=38)
      assert.equal(await frame.locator('.layout__area--top').evaluate(e=>e.getBoundingClientRect().width),geometry.nativeHeader.right)
      await page.locator('.replay-panel-close').click()
    }
    await frame.locator('[data-name=header-toolbar-properties]').click()
    await frame.locator('[data-name=series-properties-dialog]').waitFor()
    await frame.locator('body').press('Escape')
    const intervals=frame.locator('#header-toolbar-intervals')
    const favorite=intervals.locator('[data-value="5"]')
    if(await favorite.isVisible()) await favorite.click()
    else {
      await intervals.locator('> [class*=menu]').click()
      await frame.locator('[data-value="5"][class*=item-]:visible').click()
    }
    await page.waitForFunction(()=>window.__qaWidget.activeChart().resolution()==='5')
    await page.waitForFunction(()=>document.querySelector('.legacy-replay-toolbar select').value==='5')
    await page.locator('.legacy-replay-toolbar select').selectOption('15')
    await page.waitForFunction(()=>window.__qaWidget.activeChart().resolution()==='15' && document.querySelector('.legacy-replay-toolbar select').value==='15')
    await openTool(language==='vi'?'Lưu chart':'Save chart')
    const localSave=await page.evaluate(()=>Object.keys(localStorage).some(k=>k.startsWith('tw:advanced-chart:v1:')))
    assert.ok(localSave)
    assert.equal(await page.locator('[data-chart-status=ready]').getAttribute('data-cutoff'),before)
    report.cases.push({width,theme,language,geometry,compact,nativeActions:true,cutoffPreserved:true,pass:true})
    await context.close()
  }
  assert.deepEqual(report.errors,[]);assert.deepEqual(report.unexpected,[]);report.pass=true
}catch(e){report.pass=false;report.failure=String(e);throw e}
finally{await writeFile(new URL('report.json',out),JSON.stringify(report,null,2));await browser.close();console.log(JSON.stringify({pass:report.pass,cases:report.cases.length,errors:report.errors,failure:report.failure}))}
