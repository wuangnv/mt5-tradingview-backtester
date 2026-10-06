import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { writeFile } from 'node:fs/promises'
const require = createRequire(new URL('../../../web/package.json', import.meta.url))
const { chromium } = require('playwright')
const out = fileURLToPath(new URL('./', import.meta.url))
const browser = await chromium.launch({ ignoreDefaultArgs: ['--hide-scrollbars'] })
const page = await browser.newPage({ viewport: { width: 1710, height: 987 } })
const requests = [], errors = [], writes = [], checks = []
let revision = 1, delayNext = 0
page.on('pageerror', error => errors.push(error.message))
const rows = Array.from({length:137}, (_, i) => ({ session_id: i % 2 ? 'session-b' : 'session-a', session_name: i % 2 ? 'Beta' : 'Alpha', trade_id:`trade-${i}`, symbol:i<120?'EURUSD':'XAUUSD', side:'BUY', net_pnl:i+1, account_currency:'USD', starting_balance:10000, close_time_utc:1700000000+i*60, close_cursor_index:i, close_event_sequence:i+1, tags:i===136?['review, later']:[], source_provenance:{session_id:i%2?'session-b':'session-a',revision:1,dataset_id:'dataset',dataset_sha256:'a'.repeat(64),cutoff_timestamp:1700000000+i*60} }))
await page.route('**/api/**', async route => {
  if (!['GET','HEAD','OPTIONS'].includes(route.request().method())) { writes.push(route.request().method()); return route.abort() }
  const url = new URL(route.request().url())
  if (url.pathname === '/api/v2/replay/sessions') return route.fulfill({json:{items:[{record_id:'session-a',revision:1,name:'Alpha',instrument_id:'EURUSD',dataset_available:true},{record_id:'session-b',revision:1,name:'Beta',instrument_id:'XAUUSD',dataset_available:true}]}})
  if (url.pathname !== '/api/v2/replay/trades') return route.continue()
  const p = url.searchParams, req=Object.fromEntries(p); requests.push(req)
  const extra=JSON.parse(p.get('extra_filters')||'{}'), size=Number(p.get('page_size')), requested=Number(p.get('page'))
  let scope=rows.filter(row=>!p.has('sessions')||p.get('sessions').split(',').includes(row.session_id))
  if(extra.assets) scope=scope.filter(r=>JSON.parse(extra.assets).includes(r.symbol))
  const sort=p.get('sort_key'), asc=p.get('sort_direction')==='asc'
  scope=[...scope].sort((a,b)=>(a[sort]>b[sort]?1:a[sort]<b[sort]?-1:0)*(asc?1:-1))
  const count=scope.length, pages=Math.ceil(count/size), current=Math.min(requested,Math.max(1,pages)), visible=scope.slice((current-1)*size,current*size)
  const payload={schema_version:'replay-trades-page-v1',status:'ready',scope:{session_ids:p.has('sessions')?p.get('sessions').split(','):['session-a','session-b']},sources:[],excluded:[],sessions:[],ledger:visible,facets:{assets:['EURUSD','XAUUSD'],tags:['review, later'],strategies:[],years:['2023'],types:[],has_notes:false},pagination:{page:current,page_size:size,returned_count:visible.length,filtered_count:count,page_count:pages,has_next:current<pages},sort:{key:sort,direction:p.get('sort_direction')},snapshot_key:`snapshot-${revision}`}
  const delay=delayNext;delayNext=0;if(delay)await new Promise(r=>setTimeout(r,delay))
  try { await route.fulfill({json:payload}) } catch {}
})
const settled=async()=>{await page.waitForTimeout(150);await page.locator('tbody tr .fxa-detail-button').first().waitFor();await page.waitForFunction(()=>!document.querySelector('.fxa-trades')?.hasAttribute('aria-busy'))}
const run=async(name,fn)=>{try{await fn();checks.push({name,pass:true})}catch(error){checks.push({name,pass:false,error:error.message})}}
try {
  await page.goto('http://127.0.0.1:5180/?workspace=tenant-a&view=trade&area=testing&section=trades&sessions=all');await settled()
  await run('remote paging >100 rows and all-scope facets',async()=>{
    assert.equal(await page.locator('tbody tr').count(),10)
    await page.locator('.fxa-pagination > div').first().locator('button').last().click();await settled()
    assert.equal(requests.at(-1).page,'14');assert.equal(await page.locator('tbody tr').count(),7)
    await page.locator('.fxa-pagination > div').first().locator('button').first().click();await settled()
    await page.getByRole('button',{name:/^(Basic|Cơ bản)$/}).click()
    await page.locator('dialog summary').filter({hasText:/^(Assets|Tài sản)$/}).click()
    assert.equal(await page.locator('dialog details[open] .fxl-choices input').count(),2)
    await page.keyboard.press('Escape')
  })
  await run('size and sort controlled by API',async()=>{
    await page.locator('.fxa-pagination .fx-select-trigger').click();await page.getByRole('option',{name:/^25/}).click();await settled()
    assert.equal(requests.at(-1).page_size,'25');assert.equal(requests.at(-1).page,'1');assert.equal(await page.locator('tbody tr').count(),25)
    await page.locator('thead th').nth(10).getByRole('button').click();await settled()
    assert.equal(requests.at(-1).sort_key,'net_pnl');assert.equal(requests.at(-1).page,'1')
  })
  await run('session scope change starts first page',async()=>{
    await page.locator('.fxa-pagination > div').first().locator('button').last().click();await settled()
    await page.locator('.fxa-session-trigger').click()
    await page.locator('.fxa-session-options button').filter({hasText:'Beta'}).click();await page.keyboard.press('Escape');await settled()
    assert.equal(requests.at(-1).sessions,'session-a');assert.equal(requests.at(-1).page,'1')
  })
  await run('scope revision refresh resets page predictably',async()=>{
    await page.locator('.fxa-pagination > div').first().locator('button').last().click();await settled()
    revision++;const oldRequests=requests.length
    await page.evaluate(()=>window.dispatchEvent(new Event('focus')))
    await page.waitForFunction(count=>window.document.querySelector('.fxa-trades')!==null,oldRequests);await page.waitForTimeout(500);await settled()
    assert.ok(requests.length>oldRequests);assert.equal(requests.at(-1).page,'1')
  })
  await run('loading retains full facets and aborted late response cannot overwrite new scope',async()=>{
    delayNext=1500
    await page.locator('.fxa-pagination .fx-select-trigger').click();await page.getByRole('option',{name:/^50/}).click()
    await page.waitForFunction(()=>document.querySelector('.fxa-trades')?.getAttribute('aria-busy')==='true')
    assert.equal(await page.locator('.fxa-empty').count(),0)
    await page.getByRole('button',{name:/^(Basic|Cơ bản)$/}).click()
    await page.locator('dialog summary').filter({hasText:/^(Assets|Tài sản)$/}).click()
    assert.equal(await page.locator('dialog details[open] .fxl-choices input').count(),2)
    await page.keyboard.press('Escape')
    await page.locator('.fxa-session-trigger').click();await page.locator('.fxa-session-all').click();await page.keyboard.press('Escape');await settled()
    assert.equal(requests.at(-1).sessions,undefined)
    assert.equal(await page.locator('tbody tr').count(),50)
    await page.waitForTimeout(1600)
    assert.equal(await page.locator('tbody tr').count(),50)
    const sessions=await page.locator('tbody tr td:nth-child(3)').allTextContents()
    assert.ok(sessions.includes('Alpha')&&sessions.includes('Beta'))
  })
  await page.screenshot({path:out+'remote-ledger.png'})
} finally {
  await browser.close();await writeFile(out+'BROWSER-RESULT.json',JSON.stringify({checks,requests,errors,writes},null,2))
  console.log(JSON.stringify({checks,errors,writes},null,2))
}
