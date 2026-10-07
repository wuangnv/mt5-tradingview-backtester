import assert from 'node:assert/strict'
import { chromium } from '../../web/node_modules/playwright/index.mjs'
import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const out = new URL('./', import.meta.url), session = '476f4b498e1a49ed9d48a75719f4d270'
const url = `http://127.0.0.1:5180/?workspace=tenant-a&view=replay&session=${session}&dataset=dataset-262639d819219431b8bbfd00a665d4fb7fde4c646a4fa0c5020608c1e1c3572d&mode=Practice&surface=workspace&cursor=500&chart_iframe=srcdoc`
const report = { scope: 'Actual local GET, isolated contexts; writes blocked, activity receipts fulfilled locally.', cases: [], errors: [], blocked: [] }
const browser = await chromium.launch({ headless: true })
const styles = locator => locator.evaluate(e => {
  const s = getComputedStyle(e)
  return { background:s.backgroundColor, color:s.color, shadow:s.boxShadow, filter:s.filter, radius:s.borderRadius, border:s.border, outlineStyle:s.outlineStyle, offset:s.outlineOffset }
})
try {
  for (const [width,height,theme] of [[1368,790,'dark'],[1368,790,'light'],[1920,940,'dark'],[360,844,'dark']]) {
    const context = await browser.newContext({ viewport:{width,height} })
    await context.addInitScript(theme => { localStorage.setItem('tw-theme',theme); localStorage.setItem('tw-language','vi') }, theme)
    await context.routeWebSocket('**/*', socket => socket.close())
    await context.route('**/*', route => {
      const r=route.request(), u=new URL(r.url())
      if (r.method()==='POST' && u.pathname.endsWith('/activity')) {
        const e=r.postDataJSON()
        return route.fulfill({status:200,json:{schema_version:'replay-activity-v1',event_id:e.event_id,session_id:session,accepted_seconds:(Date.parse(e.ended_at_utc)-Date.parse(e.started_at_utc))/1000}})
      }
      if (!['GET','HEAD','OPTIONS'].includes(r.method()) || !['http://127.0.0.1:5180','http://127.0.0.1:8010'].includes(u.origin)) { report.blocked.push({method:r.method(),url:r.url()}); return route.abort() }
      return route.continue()
    })
    const page=await context.newPage(); page.on('pageerror',e=>report.errors.push(String(e)))
    await page.goto(url); await page.locator('[data-chart-status=ready]').waitFor({timeout:30000})
    const item={width,height,theme}; report.cases.push(item)
    const grip=page.locator('.chart-float-grip'), footerGrip=page.locator('.legacy-positions-grip')
    for (const [name,locator] of [['replay',grip],['positions',footerGrip]]) {
      await page.mouse.move(width-5,60); const base=await styles(locator)
      await locator.hover(); await page.waitForTimeout(180); const hover=await styles(locator)
      // A zero-width border's color changes under the global hover rule but is not painted.
      assert.ok(base.border.startsWith('0px none')); assert.ok(hover.border.startsWith('0px none'))
      const {border:baseBorder,...baseVisible}=base, {border:hoverBorder,...hoverVisible}=hover
      assert.deepEqual(hoverVisible,baseVisible,`${name} grip must not change on hover`); item[name+'Grip']=hover
    }
    const quantity=page.locator('.legacy-quantity-control'), input=quantity.locator('input')
    await input.focus(); item.quantityFocus=await styles(quantity); item.inputFocus=await styles(input)
    assert.equal(item.quantityFocus.offset,'-2px'); assert.equal(item.inputFocus.outlineStyle,'none'); assert.equal(item.quantityFocus.shadow,'none')
    await page.screenshot({path:fileURLToPath(new URL(`positions-quantity-${theme}-${width}.png`,out))})
    await quantity.locator('button').first().focus(); assert.equal((await styles(quantity)).offset,'-2px'); assert.equal((await styles(quantity.locator('button').first())).outlineStyle,'none')
    const frame=page.frameLocator('.advanced-chart-host iframe')
    const header=frame.getByTestId('legacy-native-market').locator('button').first()
    await header.hover(); item.headerHover=await styles(header); assert.equal(item.headerHover.radius,'6px')
    const native=frame.locator('#header-toolbar-intervals > div').first()
    await native.hover(); assert.equal((await styles(native)).radius,'6px')
    const drawing=frame.locator('.layout__area--left .button-G7o5fBfa').first()
    await drawing.hover(); assert.equal((await styles(drawing)).radius,'6px')
    await page.getByRole('button',{name:'Mở danh sách lệnh',exact:true}).click()
    item.normalFooter=await page.locator('.legacy-position-paging').boundingBox()
    assert.ok(Math.abs(item.normalFooter.y+item.normalFooter.height-height)<=1,'normal footer reaches viewport bottom')
    await page.getByRole('button',{name:'Mở rộng danh sách lệnh',exact:true}).click()
    assert.equal(await page.locator('.legacy-replay-toolbar').isVisible(),false)
    const tab=page.getByRole('tab',{name:'Lệnh chờ',exact:true})
    await page.mouse.move(width-5,60); item.tabBase=await styles(tab)
    await tab.hover(); await page.waitForTimeout(180); item.tabHover=await styles(tab)
    assert.equal(item.tabHover.background,'rgba(0, 0, 0, 0)'); assert.notEqual(item.tabHover.color,item.tabBase.color)
    await tab.click(); const active=await tab.evaluate(e=>{const s=getComputedStyle(e);return{borderBottom:s.borderBottomWidth,padding:s.paddingLeft,radius:s.borderRadius}})
    assert.equal(active.borderBottom,'1px'); assert.equal(active.padding,'16px'); assert.equal(active.radius,'0px')
    item.geometry=await page.evaluate(()=>{
      const paging=document.querySelector('.legacy-position-paging'), tabs=document.querySelector('.legacy-position-tabs'), th=document.querySelector('.legacy-positions th'), row=document.querySelector('.legacy-positions tbody')
      return {overflow:document.documentElement.scrollWidth-innerWidth,paging:paging.getBoundingClientRect().toJSON(),topBorder:getComputedStyle(paging).borderTopWidth,tabsTop:getComputedStyle(tabs).borderTopWidth,headerBg:getComputedStyle(th).backgroundColor,tableBg:getComputedStyle(row.closest('.legacy-positions')).backgroundColor,sizeLabel:paging.querySelector('label').getBoundingClientRect().toJSON(),navigation:paging.querySelector('.legacy-position-navigation').getBoundingClientRect().toJSON()}
    })
    assert.equal(item.geometry.overflow,0); assert.ok(Math.abs(item.geometry.paging.bottom-height)<=1)
    assert.equal(item.geometry.topBorder,'1px'); assert.equal(item.geometry.tabsTop,'1px'); assert.notEqual(item.geometry.headerBg,item.geometry.tableBg)
    assert.ok(item.geometry.sizeLabel.right<=item.geometry.navigation.left)
    await page.getByLabel('Số dòng mỗi trang',{exact:true}).selectOption('25')
    await page.getByLabel('Trang hiện tại',{exact:true}).selectOption('0')
    await page.mouse.click(width/2,height/2); await page.mouse.move(width-5,60)
    await page.screenshot({path:fileURLToPath(new URL(`positions-maximized-${theme}-${width}.png`,out))})
    await context.close()
  }
  assert.deepEqual(report.errors,[]); assert.deepEqual(report.blocked,[]); report.pass=true
} finally { await browser.close(); await writeFile(new URL('positions-report.json',out),JSON.stringify(report,null,2)+'\n') }
console.log(JSON.stringify({pass:report.pass,cases:report.cases.length,errors:report.errors,blocked:report.blocked}))
