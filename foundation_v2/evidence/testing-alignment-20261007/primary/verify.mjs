import assert from 'node:assert/strict'
import { chromium } from '../../../web/node_modules/playwright/index.mjs'
import { mkdir, writeFile } from 'node:fs/promises'

const out = 'foundation_v2/evidence/testing-alignment-20261007/primary'
await mkdir(out, {recursive:true})
const browser = await chromium.launch({headless:true, ignoreDefaultArgs:['--hide-scrollbars']})
const result = {cases:[],errors:[],writes:[]}
const paint = locator => locator.evaluate(e => {const s=getComputedStyle(e); return {color:s.color,bg:s.backgroundColor,lineHeight:s.lineHeight}})
const utcScope = page => {const q=new URL(page.url()).searchParams;return {from:q.get('dashboard_from'),to:q.get('dashboard_to')}}
try {
  for (const theme of ['dark','light']) for (const language of ['vi','en']) for (const width of [1440,360]) {
    const context = await browser.newContext({viewport:{width,height:987},reducedMotion:'reduce'})
    await context.addInitScript(({theme,language}) => {localStorage.setItem('tw-theme',theme);localStorage.setItem('tw-language',language)}, {theme,language})
    await context.routeWebSocket('**/*', socket => socket.close())
    await context.route('**/*', route => {
      const r=route.request(); if(!['GET','HEAD','OPTIONS'].includes(r.method())) {result.writes.push(r.url());return route.abort()}
      if(!['http://127.0.0.1:5180','http://127.0.0.1:8010'].includes(new URL(r.url()).origin)) return route.abort()
      return route.continue()
    })
    const page=await context.newPage();page.setDefaultTimeout(12000)
    await page.clock.setFixedTime(new Date('2026-10-07T12:00:00Z'))
    page.on('pageerror', error => result.errors.push(String(error)))
    const go=async query => {await page.goto(`http://127.0.0.1:5180/?workspace=tenant-a&area=testing&${query}`);await page.waitForLoadState('networkidle')}
    await go('view=overview')
    const count=page.locator('.fx-dashboard-session-count');await count.waitFor()
    const countText=await count.innerText();assert.match(countText, language==='vi'? /^\d+ phiên trong tổng số \d+$/ : /^Showing \d+ of \d+$/)
    const date=page.locator('.fx-dashboard-performance-filters .fx-select').nth(1).locator('.fx-select-trigger')
    await date.click()
    const labels=await page.getByRole('option').allTextContents()
    assert.deepEqual(labels.map(s=>s.replace('✓','').trim()),language==='vi'?['Tuần trước','Tháng trước','Tất cả','Tuỳ chọn']:['Last week','Last month','All time','Custom'])
    await page.getByRole('option',{name:language==='vi'?'Tuần trước':'Last week',exact:true}).click()
    assert.deepEqual(utcScope(page),{from:'2026-09-28',to:'2026-10-04'})
    await page.waitForLoadState('networkidle')
    await date.click();await page.getByRole('option',{name:language==='vi'?'Tháng trước':'Last month',exact:true}).click()
    assert.deepEqual(utcScope(page),{from:'2026-09-01',to:'2026-09-30'})
    await page.reload();await page.waitForLoadState('networkidle')
    assert.match(await date.innerText(), language==='vi'?/Tháng trước/:/Last month/)
    await date.click();await page.getByRole('option',{name:language==='vi'?'Tuỳ chọn':'Custom',exact:true}).click()
    assert.equal(await page.locator('.fx-dashboard-date-controls input').first().inputValue(),'2026-09-01')
    assert.equal(await page.locator('.fx-dashboard-date-controls input').last().inputValue(),'2026-09-30')
    await date.click();await page.getByRole('option',{name:language==='vi'?'Tất cả':'All time',exact:true}).click()
    assert.deepEqual(utcScope(page),{from:null,to:null})
    const sort=page.locator('.fx-dashboard-list-filters .fx-select').first().locator('.fx-select-trigger')
    await sort.click();assert.deepEqual((await page.getByRole('option').allTextContents()).map(s=>s.replace('✓','').trim()), language==='vi'?['Mới nhất','Cũ nhất','Mới cập nhật','Lợi nhuận cao nhất']:['Newest first','Oldest first','Recently updated','Highest profit'])
    await page.keyboard.press('Escape')
    const metrics=await page.locator('.fx-dashboard-metric > span').evaluateAll(labels => labels.map(label=>{const icon=label.querySelector('svg'),r=icon.getBoundingClientRect(),b=label.getBoundingClientRect();return {width:r.width,height:r.height,firstLineDelta:r.y+r.height/2-b.y-9}}))
    for(const m of metrics){assert.ok(Math.abs(m.firstLineDelta)<=.6);assert.equal(m.width,m.height)}
    await go('view=overview&dashboard_from=2026-10-01&dashboard_to=2026-10-07')
    assert.match(await date.innerText(),language==='vi'?/7 ngày gần nhất/:/Last 7 days/)
    assert.deepEqual(utcScope(page),{from:'2026-10-01',to:'2026-10-07'})
    await go('view=analytics&select=1&demo=1')
    const parent=page.locator('.fx-subnav-link.is-active'), active=page.locator('.fx-subsubnav a[aria-current="page"]'),inactive=page.locator('.fx-subsubnav a:not([aria-current="page"])')
    const rest=await paint(inactive),selected=await paint(active),parentPaint=await paint(parent)
    assert.notEqual(rest.color,selected.color);assert.notEqual(parentPaint.color,selected.color)
    await inactive.hover();const hover=await paint(inactive);assert.equal(hover.color,selected.color);assert.equal(hover.bg,'rgba(0, 0, 0, 0)')
    await parent.hover();assert.deepEqual(await paint(parent),parentPaint)
    await page.screenshot({path:`${out}/nav-${theme}-${language}-${width}.png`})
    await go('view=market-data')
    const fields=page.locator('.market-sync-filters input:not([type="checkbox"]),.market-sync-filters .fx-select-trigger')
    const heights=await fields.evaluateAll(es=>es.map(e=>e.getBoundingClientRect().height))
    assert.ok(heights.length>=3);for(const h of heights)assert.equal(h,width===360?44:40)
    result.cases.push({theme,language,width,count:countText,periods:labels,metrics,nav:{rest,selected,parent:parentPaint,hover},marketFieldHeights:heights})
    await context.close()
  }
  assert.deepEqual(result.errors,[]);assert.deepEqual(result.writes,[])
  result.pass=true
} catch(error){result.failure=String(error);result.stack=error.stack;process.exitCode=1}
finally{await browser.close();await writeFile(`${out}/verification.json`,JSON.stringify(result,null,2));console.log(JSON.stringify({pass:result.pass,cases:result.cases.length,failure:result.failure,errors:result.errors,writes:result.writes}))}
