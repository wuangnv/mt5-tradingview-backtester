import { chromium } from '../../../web/node_modules/playwright/index.mjs'
import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
const out=new URL('./',import.meta.url),session='476f4b498e1a49ed9d48a75719f4d270'
const url=`http://127.0.0.1:5180/?workspace=tenant-a&view=replay&session=${session}&dataset=dataset-262639d819219431b8bbfd00a665d4fb7fde4c646a4fa0c5020608c1e1c3572d&mode=Practice&surface=workspace&cursor=500`
const report={scope:'Independent actual GET only; no backend mutations, localStorage-only UI controls.',cases:[],errors:[],blocked:[]}
const browser=await chromium.launch({headless:true})
try{
 for(const [width,height,theme,language] of [[1920,940,'dark','vi'],[1611,1259,'dark','en'],[768,987,'dark','vi'],[360,987,'light','en'],[1920,940,'light','en']]){
  const context=await browser.newContext({viewport:{width,height}})
  await context.addInitScript(({theme,language})=>{localStorage.setItem('tw-theme',theme);localStorage.setItem('tw-language',language)},{theme,language})
  await context.routeWebSocket('**/*',socket=>socket.close())
  await context.route('**/*',async route=>{
   const request=route.request(),u=new URL(request.url())
   if(request.method()==='POST' && u.pathname===`/api/v2/replay/sessions/${session}/activity`){const e=request.postDataJSON();return route.fulfill({status:200,json:{schema_version:'replay-activity-v1',event_id:e.event_id,session_id:session,accepted_seconds:(Date.parse(e.ended_at_utc)-Date.parse(e.started_at_utc))/1000}})}
   if(!['GET','HEAD','OPTIONS'].includes(request.method()) || !['http://127.0.0.1:5180','http://127.0.0.1:8010'].includes(u.origin)){report.blocked.push({method:request.method(),url:request.url()});return route.abort()}
   return route.continue()
  })
  const page=await context.newPage();page.on('pageerror',e=>report.errors.push(String(e)))
  await page.goto(url);await page.locator('[data-chart-status=ready]').waitFor({timeout:30000})
  const frame=page.frameLocator('.advanced-chart-host iframe');await frame.getByTestId('legacy-native-market').waitFor()
  const geometry=()=>page.evaluate(()=>{
   const f=document.querySelector('.advanced-chart-host iframe'),d=f.contentDocument,r=f.getBoundingClientRect(),c=d.querySelector('.layout__area--center').getBoundingClientRect(),top=d.querySelector('.layout__area--top').getBoundingClientRect(),rail=document.querySelector('.chart-utility-rail').getBoundingClientRect(),side=document.querySelector('.replay-side')?.getBoundingClientRect(),toolbar=document.querySelector('.legacy-replay-toolbar').getBoundingClientRect(),bar=document.querySelector('.legacy-trading-bar').getBoundingClientRect()
   return {iframe:r.toJSON(),center:c.toJSON(),top:top.toJSON(),rail:rail.toJSON(),side:side?.toJSON(),toolbar:toolbar.toJSON(),bar:bar.toJSON(),headerHit:d.elementFromPoint(r.width-18,18)?.closest('button')?.title,hitTag:d.elementFromPoint(r.width-18,18)?.outerHTML?.slice(0,300),clippingAncestors:(()=>{let n=d.querySelector('.legacy-native-tools'),a=[];while(n){const z=getComputedStyle(n);a.push({tag:n.tagName,class:n.className,overflow:z.overflow,clip:z.clipPath,rect:n.getBoundingClientRect().toJSON()});n=n.parentElement}return a})(),headerTools:[...d.querySelectorAll('.legacy-native-tools button,.legacy-search-host,[data-name=header-toolbar-properties]')].map(x=>({label:x.title,rect:x.getBoundingClientRect().toJSON(),display:getComputedStyle(x).display})),overflow:document.documentElement.scrollWidth-innerWidth,body:d.body.getBoundingClientRect().toJSON(),centerCanvas:[...d.querySelectorAll('.layout__area--center canvas')].map(x=>({rect:x.getBoundingClientRect().toJSON(),width:x.width,height:x.height}))}
  })
  const item={width,height,theme,language,initial:await geometry()}
  await page.screenshot({path:fileURLToPath(new URL(`initial-${theme}-${language}-${width}.png`,out))})
  await page.locator('.legacy-rail-tools button').click();await page.locator('.legacy-object-tree').waitFor();await page.waitForTimeout(400)
  item.tree=await geometry();await page.screenshot({path:fileURLToPath(new URL(`tree-${theme}-${language}-${width}.png`,out))})
  await page.locator('.replay-panel-close').click()
  const interval=page.locator('.legacy-replay-interval');await interval.click();item.intervalOptions=await page.locator('.legacy-replay-intervals button').evaluateAll(nodes=>nodes.map(n=>({text:n.textContent,disabled:n.disabled})));await page.locator('.legacy-replay-intervals button:enabled').first().press('Escape');if(width===1920&&theme==='dark'){await interval.click();await page.locator('.legacy-replay-intervals button').filter({hasText:/^5m$/}).click();await page.locator('.legacy-replay-previous').click();await page.waitForFunction(()=>new URL(location.href).searchParams.get('cursor')==='495');await page.locator('[data-chart-status=ready]').waitFor();item.rewindCursor=495;await page.getByTestId('step-1').click();await page.waitForFunction(()=>new URL(location.href).searchParams.get('cursor')==='500');await page.locator('[data-chart-status=ready]').waitFor();item.forwardCursor=500}
  const input=page.locator('.legacy-speed-slider');await input.focus();await input.press('End');item.maxSpeed=await input.inputValue();await input.press('Home')
  const grip=page.locator('.legacy-positions-grip');await grip.focus();await grip.press('ArrowUp');item.positionsHeight=await page.locator('.legacy-resizable-positions').evaluate(e=>e.getBoundingClientRect().height)
  await page.locator('.legacy-trading-bar .chart-trading-account > button').last().click();item.maximized=await page.locator('.legacy-trading-workspace').evaluate(e=>({class:e.className,rect:e.getBoundingClientRect().toJSON()}));await page.screenshot({path:fileURLToPath(new URL(`positions-${theme}-${language}-${width}.png`,out))})
  await page.locator('.legacy-trading-bar .chart-trading-account > button').last().click()
  await page.locator('.legacy-scalper-button').click();item.scalper=await page.locator('.legacy-scalper-settings').innerText();await page.screenshot({path:fileURLToPath(new URL(`scalper-${theme}-${language}-${width}.png`,out))});await page.locator('.legacy-scalper-settings input').first().press('Escape')
  await page.locator('.legacy-balance-pill').hover();await page.locator('.legacy-account-details').waitFor();item.balance=await page.locator('.legacy-account-details').innerText()
  report.cases.push(item);await context.close()
 }
}catch(error){report.failure=String(error);throw error}
finally{await writeFile(new URL('report.json',out),JSON.stringify(report,null,2));await browser.close();console.log(JSON.stringify({cases:report.cases.length,errors:report.errors,blocked:report.blocked,failure:report.failure}))}
