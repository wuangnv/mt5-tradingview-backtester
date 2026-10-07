import assert from 'node:assert/strict'
import { chromium } from '../../../web/node_modules/playwright/index.mjs'
import { writeFile } from 'node:fs/promises'

const browser = await chromium.launch({ headless: true })
const report = { scope: 'Actual replay GET, intercepted activity POST only; no persisted writes', cases: [], errors: [], blocked: [], vendorAnalyticsBlocked: [] }
const session = '476f4b498e1a49ed9d48a75719f4d270'
const url = `http://127.0.0.1:5180/?workspace=tenant-a&view=replay&session=${session}&dataset=dataset-262639d819219431b8bbfd00a665d4fb7fde4c646a4fa0c5020608c1e1c3572d&mode=Practice&surface=workspace&cursor=500`
try {
  for (const [theme, width, language] of [['dark',1710,'vi'], ['light',360,'en']]) {
    const context = await browser.newContext({ viewport: { width, height: 987 } })
    const calls = [], accepted = []
    let fail = true
    await context.addInitScript(({theme,language}) => { localStorage.setItem('tw-theme',theme); localStorage.setItem('tw-language',language) }, {theme,language})
    await context.routeWebSocket('**/*', socket => socket.close())
    await context.route('**/*', async route => {
      const request = route.request(), target = new URL(request.url())
      if (target.pathname === `/api/v2/replay/sessions/${session}/activity` && request.method() === 'POST') {
        const event = request.postDataJSON(); calls.push(event)
        if (fail) return route.fulfill({status:503,json:{detail:'synthetic_activity_offline'}})
        accepted.push(event)
        return route.fulfill({status:200,json:{schema_version:'replay-activity-v1',session_id:session,event_id:event.event_id,duplicate:false,accepted_seconds:(Date.parse(event.ended_at_utc)-Date.parse(event.started_at_utc))/1000}})
      }
      if (['http://127.0.0.1:5180','http://127.0.0.1:8010'].includes(target.origin) && ['GET','HEAD','OPTIONS'].includes(request.method())) return route.continue()
      if (request.method() === 'GET' && request.url() === 'http://www.google-analytics.com/analytics.js') {
        report.vendorAnalyticsBlocked.push(request.url()); return route.abort()
      }
      report.blocked.push({method:request.method(),url:request.url()}); return route.abort()
    })
    const page = await context.newPage()
    page.on('pageerror', error => report.errors.push(String(error)))
    await page.clock.install({ time: new Date() })
    await page.goto(url, { waitUntil: 'networkidle' })
    await page.locator('.advanced-chart-host iframe').waitFor({timeout:25000})
    await page.bringToFront()
    await page.mouse.move(450,350)
    await page.clock.runFor(11_000)
    await page.waitForFunction(()=>Array.from(document.querySelectorAll('.chart-notice')).some(node=>/Chưa lưu được|Practice time/.test(node.textContent)))
    assert.ok(calls.length, 'activity flushed')
    assert.ok(await page.locator('.chart-notice').filter({hasText:language==='vi'?'Chưa lưu được':'Practice time'}).count(), 'offline save visibly pending')
    const first = calls[0]
    fail = false
    await page.clock.runFor(11_000)
    await page.waitForFunction(key=>sessionStorage.getItem(key)===null, `tw:replay-activity:v1:tenant-a:${session}`)
    assert.deepEqual(accepted[0],first,'retry preserves immutable event ID and interval')
    for(const event of accepted) {
      const span=Date.parse(event.ended_at_utc)-Date.parse(event.started_at_utc)
      assert.ok(span>0 && span<=30000)
    }
    await page.clock.runFor(130_000)
    const beforeIdle=calls.length
    await page.clock.runFor(20_000)
    assert.equal(calls.length,beforeIdle,'idle stops activity requests')
    const frame = await (await page.locator('.advanced-chart-host iframe').elementHandle()).contentFrame()
    assert.ok(frame)
    await frame.locator('body').dispatchEvent('pointermove',{clientX:200,clientY:200})
    await page.clock.runFor(11_000)
    assert.ok(calls.length>beforeIdle,'chart iframe activity wakes tracker')
    report.cases.push({theme,width,language,requests:calls.length,accepted:accepted.length,retryEvent:first.event_id,pass:true})
    await context.close()
  }
  assert.equal(report.errors.length,0)
  assert.equal(report.blocked.length,0)
  report.pass = true
} catch(error) {report.pass=false;report.failure=String(error);process.exitCode=1}
finally {await browser.close();await writeFile(new URL('./activity-ui-report.json',import.meta.url),JSON.stringify(report,null,2))}
console.log(JSON.stringify({pass:report.pass,cases:report.cases.length,errors:report.errors,failure:report.failure}))
