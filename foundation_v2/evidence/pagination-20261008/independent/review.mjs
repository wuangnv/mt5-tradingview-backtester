import { chromium } from '../../../web/node_modules/playwright/index.mjs'
import fs from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'

const out = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1'))
await fs.mkdir(out,{recursive:true})
const browser = await chromium.launch({headless:true})
const results=[]
const context=await browser.newContext({viewport:{width:1440,height:987}})
const page=await context.newPage()
const errors=[]
page.on('pageerror',error=>errors.push(error.message))
const base='http://127.0.0.1:5180/'
const library=base+'?workspace=tenant-a&view=market-data&area=testing&section=market-data'
const trades=base+'?workspace=tenant-a&view=trade&area=testing&section=trades&select=1&sessions=all'
async function geometry(){return page.locator('.wm-pagination').last().evaluate(el=>{const b=el.getBoundingClientRect(),c=el.querySelector('.wm-pagination-controls').getBoundingClientRect(),s=getComputedStyle(el);return {x:b.x,right:b.right,bottom:b.bottom,width:b.width,controlsCenter:(c.x+c.right)/2,center:(b.x+b.right)/2,border:s.borderTopWidth,docOverflow:document.documentElement.scrollWidth-innerWidth}})}
try {
  for(const width of [360,768,1440]){
    await page.setViewportSize({width,height:987})
    for(const [name,url] of [['library',library],['trades',trades]]){
      await page.goto(url)
      await page.locator('.wm-pagination').waitFor()
      await page.waitForTimeout(500)
      const g=await geometry()
      assert(Math.abs(g.bottom-987)<2,`${name}/${width} footer bottom ${g.bottom}`)
      assert(Math.abs(g.center-g.controlsCenter)<2,`${name}/${width} centered controls`)
      assert.equal(g.border,'1px')
      assert.equal(g.docOverflow,0)
      if(name==='library') assert.equal(await page.locator('.data-library-download-job').count(),0)
      await page.screenshot({path:path.join(out,`${name}-${width}.png`)})
      results.push({name,width,geometry:g})
    }
  }
  // Explicit browser-only component fixture: no server mutation or owner data change.
  await page.setViewportSize({width:1440,height:987})
  await page.goto(trades)
  await page.locator('.wm-pagination').waitFor()
  await page.evaluate(async()=>{
    const {default:React}=await import('/node_modules/.vite/deps/react.js')
    const {default:ReactDOM}=await import('/node_modules/.vite/deps/react-dom_client.js')
    const {createRoot}=ReactDOM
    const {default:Ledger}=await import('/src/FxTradeLedger.jsx')
    const host=document.createElement('div')
    host.id='independent-fixture'
    host.className='fx-app fx-shell-story'
    host.style.display='block'
    host.dataset.uiArea='testing';host.dataset.theme='dark'
    host.innerHTML='<div class="fx-content" style="height:987px"><section class="wm-page as-page" style="height:100%"></section></div>'
    document.querySelector('#root').style.display='none';document.body.append(host)
    window.changes=[];window.fixture={page:7,pageSize:10,totalCount:137,pending:false,sort:{key:'close_time_utc',direction:'desc'}}
    const model={ledger:[],result:{account_currency:'USD'},startBalance:100000}
    const target=host.querySelector('section');window.fixtureRoot=createRoot(target)
    window.renderFixture=()=>window.fixtureRoot.render(React.createElement(Ledger,{model,extra:{},onSelect:()=>{},remotePage:{...window.fixture,onChange:change=>{window.changes.push(change);window.fixture={...window.fixture,...change};window.renderFixture()}}}))
    window.renderFixture()
  })
  const nav=page.locator('#independent-fixture .wm-pagination')
  await nav.waitFor()
  assert.equal(await nav.locator('[aria-current=page]').textContent(),'7')
  await nav.getByRole('button',{name:'Trang cuối',exact:true}).click()
  assert.equal(await nav.locator('[aria-current=page]').textContent(),'14')
  assert(await nav.getByRole('button',{name:'Trang sau',exact:true}).isDisabled())
  await nav.getByRole('button',{name:'Trang đầu',exact:true}).click()
  assert.equal(await nav.locator('[aria-current=page]').textContent(),'1')
  await nav.getByRole('button',{name:'Số dòng mỗi trang',exact:true}).click()
  const menu=page.getByRole('listbox').last();await menu.waitFor()
  const menuBox=await menu.boundingBox();assert(menuBox.y+menuBox.height<=987,'upward popup visible')
  await page.keyboard.press('End');await page.keyboard.press('Enter')
  const changes=await page.evaluate(()=>window.changes)
  assert.deepEqual(changes.at(-1),{pageSize:100,page:1})
  assert.equal(changes.length,3,'size reset calls remote once')
  assert.equal(await page.evaluate(()=>document.activeElement.getAttribute('aria-label')),'Số dòng mỗi trang')
  await page.evaluate(()=>{window.fixture={...window.fixture,pending:true};window.renderFixture()})
  await page.waitForTimeout(30)
  assert.equal(await nav.locator('button:not([disabled])').count(),0)
  await page.evaluate(()=>{window.fixture={...window.fixture,pending:false,totalCount:null};window.renderFixture()})
  await page.waitForTimeout(30)
  assert.equal(await nav.locator('.wm-pagination-pages button:not([disabled])').count(),0)
  results.push({name:'remote-ledger-browser-fixture',changes,pending:'all disabled',unknown:'page controls disabled'})
  for(const width of [360,768,1440]){
    await page.setViewportSize({width,height:987})
    await page.evaluate(()=>{window.fixture={page:7,pageSize:10,totalCount:137,pending:false,sort:{key:'close_time_utc',direction:'desc'}};window.renderFixture()})
    await page.waitForTimeout(50)
    const g=await geometry();assert.equal(g.docOverflow,0);assert(Math.abs(g.center-g.controlsCenter)<2)
    assert(await nav.locator('[aria-current=page]').evaluate(el=>getComputedStyle(el).backgroundColor!=='rgba(0, 0, 0, 0)'))
    assert.equal(await nav.locator('.wm-pagination-number:not(.is-current)').first().evaluate(el=>getComputedStyle(el).backgroundColor),'rgba(0, 0, 0, 0)')
    await page.screenshot({path:path.join(out,`fixture-${width}.png`)})
    results.push({name:'multi-page-fixture',width,geometry:g})
  }
  await page.evaluate(async()=>{
    const {default:React}=await import('/node_modules/.vite/deps/react.js')
    const {default:Dashboard}=await import('/src/DashboardSessions.jsx')
    const demo=await import('/src/demoFixtures.js')
    const items=Array.from({length:18},(_,index)=>({...demo.DEMO_SESSIONS[index%3],record_id:`independent-${index}`,source_record_id:demo.DEMO_SESSIONS[index%3].record_id,name:`Fixture session ${index}`}))
    const preview={items,datasets:demo.DEMO_DATASETS,analytics:demo.demoDashboardAnalytics,replayContext:demo.demoReplayContext,overview:filters=>demo.demoOverview(demo.demoFilterRows(null,filters))}
    document.querySelector('#independent-fixture .fx-content').style.overflow='auto'
    window.fixtureRoot.render(React.createElement('section',{className:'fx-dashboard'},React.createElement('div',{className:'fx-dashboard-inner'},React.createElement(Dashboard,{workspace:'fixture-only',query:new URLSearchParams(),preview}))))
  })
  await nav.waitFor();await nav.scrollIntoViewIfNeeded()
  assert.equal(await page.locator('#independent-fixture .fx-dashboard-session-list > *').count(),6)
  await nav.getByRole('button',{name:'Trang cuối',exact:true}).click()
  assert.equal(await nav.locator('[aria-current=page]').textContent(),'3')
  await page.mouse.move(0,0)
  await page.waitForTimeout(200)
  const dashboardStyles=await nav.locator('.wm-pagination-number').evaluateAll(els=>els.map(el=>({number:el.textContent,current:el.getAttribute('aria-current'),background:getComputedStyle(el).backgroundColor})))
  assert(dashboardStyles.filter(entry=>entry.current!=='page').every(entry=>entry.background==='rgba(0, 0, 0, 0)'),JSON.stringify(dashboardStyles))
  await page.screenshot({path:path.join(out,'dashboard-fixture.png')})
  results.push({name:'dashboard-preview-fixture',page:3,visibleSessions:6})
  await page.evaluate(async()=>{
    const {default:React}=await import('/node_modules/.vite/deps/react.js')
    const {default:Performance}=await import('/src/SessionPerformance.jsx')
    const {buildAnalyticsModel}=await import('/src/AnalyticsWorkspace.jsx')
    const demo=await import('/src/demoFixtures.js')
    const item=demo.DEMO_SESSIONS[0],model=buildAnalyticsModel(demo.demoResult(demo.DEMO_LEDGER,item))
    window.fixtureRoot.render(React.createElement(Performance,{model,payload:demo.demoDashboardAnalytics(item,'fixture-only'),item,href:()=> '#fixture-only'}))
  })
  await nav.waitFor();await nav.scrollIntoViewIfNeeded()
  await nav.getByRole('button',{name:'Trang cuối',exact:true}).click()
  assert.equal(await nav.locator('[aria-current=page]').textContent(),'12')
  await nav.getByRole('button',{name:'Số dòng mỗi trang',exact:true}).click()
  await page.getByRole('option',{name:'20',exact:true}).click()
  assert.equal(await nav.locator('[aria-current=page]').textContent(),'1')
  assert.equal(await page.locator('#independent-fixture .fxs-table-scroll tbody tr').count(),20)
  await nav.scrollIntoViewIfNeeded();await page.mouse.move(0,0)
  await page.screenshot({path:path.join(out,'performance-fixture.png')})
  results.push({name:'performance-preview-fixture',size:20,page:1,visibleTrades:20})
  const touchContext=await browser.newContext({viewport:{width:1440,height:987},hasTouch:true})
  const touchPage=await touchContext.newPage()
  await touchPage.goto(trades);await touchPage.locator('.wm-pagination').waitFor()
  const touchSize=await touchPage.locator('.wm-pagination-button').first().evaluate(el=>({width:el.getBoundingClientRect().width,height:el.getBoundingClientRect().height}))
  assert.deepEqual(touchSize,{width:44,height:44})
  await touchContext.close()
  results.push({name:'coarse-pointer-desktop',touchSize})
  assert.deepEqual(errors,[])
  await fs.writeFile(path.join(out,'results.json'),JSON.stringify({status:'PASS',results,errors},null,2))
  console.log(JSON.stringify({status:'PASS',checks:results.length}))
}catch(error){
  await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{})
  await fs.writeFile(path.join(out,'results.json'),JSON.stringify({status:'FAIL',message:error.message,results,errors},null,2))
  throw error
}finally{await browser.close()}
