import assert from 'node:assert/strict'
import { chromium } from '../../web/node_modules/playwright/index.mjs'
import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const origin = 'http://127.0.0.1:5180', headers = { 'X-Workspace-Id':'tenant-a' }
const deletedSessions = ['476f4b498e1a49ed9d48a75719f4d270','d70ee54946144605bf20ba5b8e2f4cdf',
  '273a1275538c42cb95cfff16e0f9f62c','a11f6ccb63b3499a9a0e36d43c271912',
  '4a3ca707b2494948be4523f6c91f3958','dca9128ca872470c8f93d35ee6320213']
const report = { scope:'post-purge readonly real local API/UI', datasets:0, sessions:0, deletedSessionStatuses:[], errors:[], blocked:[] }
const browser = await chromium.launch({headless:true})
try {
  const context = await browser.newContext({viewport:{width:1428,height:987}})
  for (const path of ['data/datasets','replay/sessions']) {
    const response = await context.request.get(origin + '/api/v2/' + path, {headers})
    assert.equal(response.status(),200); assert.equal((await response.json()).items.length,0)
  }
  for (const id of deletedSessions) {
    const response = await context.request.get(origin + '/api/v2/replay/sessions/' + id, {headers})
    assert.equal(response.status(),404); report.deletedSessionStatuses.push(404)
  }
  await context.routeWebSocket('**/*', s=>s.close())
  await context.route('**/*', route=>{
    const r=route.request(),u=new URL(r.url())
    if(!['GET','HEAD','OPTIONS'].includes(r.method()) || u.origin!==origin || /^\/api\/v2\/(live|data\/market-assets)/.test(u.pathname)) {
      report.blocked.push(r.method()+' '+u.pathname); return route.abort()
    }
    return route.continue()
  })
  await context.addInitScript(()=>{ localStorage.setItem('tw-theme','dark');localStorage.setItem('tw-language','vi') })
  const page = await context.newPage()
  page.on('pageerror',e=>report.errors.push(String(e)))
  await page.goto(origin+'/?workspace=tenant-a&view=market-data&mode=Practice&area=testing&section=market-data')
  await page.getByTestId('data-desk-empty').waitFor()
  assert.match(await page.locator('.data-library-count').innerText(),/^0 /)
  assert.equal(await page.getByTestId('data-desk-dataset-table').count(),0)
  assert.equal(await page.locator('.data-library-import').isEnabled(),true)
  report.emptyText=await page.getByTestId('data-desk-empty').innerText()
  await page.screenshot({path:fileURLToPath(new URL('empty-library.png',import.meta.url)),fullPage:true})
  assert.equal(report.errors.length,0);assert.equal(report.blocked.length,0)
  report.pass=true
  await context.close()
} finally {
  await browser.close()
  await writeFile(new URL('verification.json',import.meta.url),JSON.stringify(report,null,2))
}
console.log(JSON.stringify(report))
