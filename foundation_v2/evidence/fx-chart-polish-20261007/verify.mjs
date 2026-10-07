import assert from 'node:assert/strict'
import { chromium } from '../../web/node_modules/playwright/index.mjs'
import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
const out=new URL('./',import.meta.url),report={scope:'Actual service GET; all mutation requests blocked',cases:[],errors:[]}
const browser=await chromium.launch({headless:true})
try {
 for(const [width,height,theme,language] of [[1920,940,'dark','vi'],[1611,1259,'dark','vi'],[768,987,'dark','en'],[360,987,'light','en'],[1710,987,'light','en']]) {
  console.log(`Checking ${width} ${theme}`)
  const context=await browser.newContext({viewport:{width,height}})
  await context.addInitScript(({theme,language})=>{localStorage.setItem('tw-theme',theme);localStorage.setItem('tw-language',language)},{theme,language})
  await context.routeWebSocket('**/*',s=>s.close())
  await context.route('**/*',r=>['GET','HEAD'].includes(r.request().method()) && ['http://127.0.0.1:5180','http://127.0.0.1:8010'].includes(new URL(r.request().url()).origin) ? r.continue() : r.abort())
  const page=await context.newPage();page.on('pageerror',e=>report.errors.push(String(e)))
  await page.goto('http://127.0.0.1:5180/?workspace=tenant-a&view=replay&session=476f4b498e1a49ed9d48a75719f4d270&surface=workspace&cursor=500')
  await page.locator('[data-chart-status=ready]').waitFor()
  const geometry=()=>page.evaluate(()=>{
   const iframe=document.querySelector('.advanced-chart-host iframe'),doc=iframe.contentDocument,offset=iframe.getBoundingClientRect(),rect=e=>e.getBoundingClientRect().toJSON()
   return {headerHit:doc.elementFromPoint(innerWidth-18,18)?.closest('button')?.getAttribute('aria-label'),offset:rect(iframe),top:rect(doc.querySelector('.layout__area--top')),center:rect(doc.querySelector('.layout__area--center')),canvases:[...doc.querySelectorAll('.layout__area--center canvas')].map(rect),rail:rect(document.querySelector('.chart-utility-rail')),side:rect(document.querySelector('.replay-side')),overflow:document.documentElement.scrollWidth-innerWidth}
  })
  let g=await geometry();assert.ok(g.headerHit);assert.equal(g.top.width,width);assert.equal(g.rail.right,width);assert.equal(g.overflow,0)
  assert.equal(g.rail.top,g.offset.top+g.center.top)
  assert.ok(g.canvases.every(c=>c.right<=g.rail.left-g.offset.left+1))
  await page.locator('.legacy-rail-tools button').click();await page.locator('.legacy-object-tree').waitFor()
  if(width>600) await page.waitForFunction(()=>{const f=document.querySelector('.advanced-chart-host iframe'),d=f.contentDocument,s=document.querySelector('.replay-side').getBoundingClientRect();return Math.abs(d.querySelector('.layout__area--center').getBoundingClientRect().right+f.getBoundingClientRect().left-s.left)<2})
  g=await geometry();assert.equal(g.top.width,width);assert.equal(g.side.top,g.rail.top);assert.equal(g.side.right,g.rail.left);assert.ok(g.canvases.every(c=>c.right<=(width>600 ? g.side.left : g.rail.left)-g.offset.left+1))
  await page.screenshot({path:fileURLToPath(new URL(`tree-${theme}-${width}.png`,out))})
  await page.locator('.replay-panel-close').click()
  await page.screenshot({path:fileURLToPath(new URL(`chart-${theme}-${width}.png`,out))})
  report.cases.push({width,height,theme,language,geometry:g})
  await context.close()
 }
 assert.equal(report.errors.length,0)
 await writeFile(new URL('report.json',out),JSON.stringify(report,null,2));console.log(`PASS ${report.cases.length} layouts; header/rail/drawer/native canvas geometry`)
} finally {await browser.close()}
