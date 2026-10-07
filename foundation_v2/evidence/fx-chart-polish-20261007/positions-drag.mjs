import assert from 'node:assert/strict'
import { chromium } from '../../web/node_modules/playwright/index.mjs'
import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
const out=new URL('./',import.meta.url),session='476f4b498e1a49ed9d48a75719f4d270'
const url=`http://127.0.0.1:5180/?workspace=tenant-a&view=replay&session=${session}&dataset=dataset-262639d819219431b8bbfd00a665d4fb7fde4c646a4fa0c5020608c1e1c3572d&mode=Practice&surface=workspace&cursor=500&chart_iframe=srcdoc`
const report={cases:[],errors:[],blocked:[],scope:'Actual local GET. Replay/order writes blocked; activity receipts nonpersistent fixtures.'}
const browser=await chromium.launch({headless:true})
try {
  for(const [width,height,theme] of [[1368,790,'dark'],[1368,790,'light'],[360,844,'dark']]) {
    const context=await browser.newContext({viewport:{width,height}})
    await context.addInitScript(theme=>{localStorage.setItem('tw-theme',theme);localStorage.setItem('tw-language','vi')},theme)
    await context.routeWebSocket('**/*',s=>s.close())
    await context.route('**/*',route=>{
      const r=route.request(),u=new URL(r.url())
      if(r.method()==='POST'&&u.pathname.endsWith('/activity')) { const e=r.postDataJSON();return route.fulfill({status:200,json:{schema_version:'replay-activity-v1',event_id:e.event_id,session_id:session,accepted_seconds:(Date.parse(e.ended_at_utc)-Date.parse(e.started_at_utc))/1000}}) }
      if(!['GET','HEAD','OPTIONS'].includes(r.method())||!['http://127.0.0.1:5180','http://127.0.0.1:8010'].includes(u.origin)){report.blocked.push(r.url());return route.abort()}
      return route.continue()
    })
    const page=await context.newPage();page.on('pageerror',e=>report.errors.push(String(e)))
    await page.goto(url);await page.locator('[data-chart-status=ready]').waitFor({timeout:30000})
    const item={width,height,theme};report.cases.push(item)
    const maximize=page.getByRole('button',{name:'Mở rộng danh sách lệnh',exact:true}),grip=page.locator('.legacy-positions-grip'),panel=page.locator('.legacy-resizable-positions')
    await maximize.click();assert.equal(await grip.isEnabled(),true)
    assert.equal((await page.locator('.legacy-trading-workspace').boundingBox()).y,0,'max covers chart header')
    item.icon=await page.getByRole('button',{name:'Thu nhỏ danh sách lệnh',exact:true}).locator('path').getAttribute('d')
    assert.equal(item.icon,'M9 3v6H3M15 3v6h6M3 15h6v6M21 15h-6v6')
    await grip.click();assert.equal(await page.locator('.legacy-trading-workspace.is-maximized').count(),1,'click alone preserves max')
    const box=await grip.boundingBox(),x=box.x+box.width/2,y=box.y+box.height/2
    await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x,y+70,{steps:8})
    assert.equal(await page.locator('.legacy-trading-workspace.is-maximized').count(),0)
    item.afterRestore=await panel.boundingBox();await page.mouse.move(x,y+120,{steps:5});item.afterDown=await panel.boundingBox()
    assert.ok(item.afterDown.height<item.afterRestore.height,'down continues shrinking')
    await page.mouse.move(x,y+80,{steps:5});item.afterUp=await panel.boundingBox();assert.ok(item.afterUp.height>item.afterDown.height,'up continues enlarging')
    await page.mouse.up();const released=await panel.boundingBox();await page.mouse.move(x,y+140);assert.equal((await panel.boundingBox()).height,released.height)
    const footer=await page.locator('.legacy-position-paging').boundingBox();assert.ok(Math.abs(footer.y+footer.height-height)<=1)
    const overlay=await page.locator('.legacy-trading-workspace.is-expanded').count()
    assert.equal(await page.locator('.legacy-replay-toolbar').isVisible(),!overlay)
    await page.mouse.move(width-5,60);await page.screenshot({path:fileURLToPath(new URL(`positions-drag-${theme}-${width}.png`,out))})
    await maximize.click();await grip.focus();await grip.press('ArrowDown');assert.equal(await page.locator('.legacy-trading-workspace.is-maximized').count(),0)
    await grip.press('Home');assert.equal(await panel.count(),0)
    await grip.press('ArrowUp');assert.equal(await panel.count(),1)
    await grip.press('End');assert.equal(await page.locator('.legacy-trading-workspace.is-maximized').count(),1)
    await grip.press('ArrowDown');assert.equal(await page.locator('.legacy-trading-workspace.is-maximized').count(),0)
    const normalGrip=await grip.boundingBox(), nx=normalGrip.x+normalGrip.width/2, ny=normalGrip.y+normalGrip.height/2
    await page.mouse.move(nx,ny);await page.mouse.down();await page.mouse.move(nx,0,{steps:12});await page.mouse.up()
    assert.equal(await page.locator('.legacy-trading-workspace.is-maximized').count(),1,'drag to top enters max')
    assert.equal((await page.locator('.legacy-trading-workspace').boundingBox()).y,0)
    await page.mouse.move(width-5,height/2);await page.screenshot({path:fileURLToPath(new URL(`positions-drag-full-${theme}-${width}.png`,out))})
    await context.close()
  }
  assert.deepEqual(report.errors,[]);assert.deepEqual(report.blocked,[]);report.pass=true
} finally { await browser.close();await writeFile(new URL('positions-drag-report.json',out),JSON.stringify(report,null,2)+'\n') }
console.log(JSON.stringify({pass:report.pass,cases:report.cases.length,errors:report.errors,blocked:report.blocked}))
