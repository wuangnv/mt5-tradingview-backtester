import assert from 'node:assert/strict'
import { chromium } from '../../../web/node_modules/playwright/index.mjs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'

const out=path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/,'$1'))
await mkdir(out,{recursive:true})
const sources=['SessionActions.jsx','session-actions.css','DashboardSessions.jsx','DashboardSessionCard.jsx','SessionPicker.jsx','sessionCatalog.js','DemoPreview.jsx'].map(f=>'foundation_v2/web/src/'+f).concat(['store.py','contracts.py','api.py'].map(f=>'foundation_v2/trading_workspace_v2/'+f))
const pins=async()=>Promise.all(sources.map(async file=>({file,sha256:createHash('sha256').update(await readFile(file)).digest('hex')})))
const report={checks:[],failures:[],errors:[],blocked:[],api:[],styles:[],before:await pins()}
const browser=await chromium.launch({headless:true})
const context=await browser.newContext()
await context.routeWebSocket('**/*',ws=>ws.close())
await context.route('**/*',async route=>{
 const req=route.request(),url=new URL(req.url())
 if(!['http://127.0.0.1:5180','http://127.0.0.1:8010'].includes(url.origin)||!['GET','HEAD','OPTIONS'].includes(req.method())){report.blocked.push({method:req.method(),url:req.url()});return route.abort()}
 if(url.pathname.startsWith('/api/')){report.api.push({method:req.method(),path:url.pathname,demo:new URL(req.frame().url()).searchParams.get('demo')});const response=await route.fetch({url:'http://127.0.0.1:8010'+url.pathname+url.search});return route.fulfill({response})}
 return route.continue()
})
const p=await context.newPage();p.on('pageerror',e=>report.errors.push(e.message))
const get=async endpoint=>{const res=await context.request.get('http://127.0.0.1:8010'+endpoint,{headers:{'X-Workspace-Id':'tenant-a'}});assert.ok(res.ok());return res.json()}
const catalogBefore=await get('/api/v2/replay/sessions'),recordId=catalogBefore.items.find(x=>!x.archived)?.record_id||catalogBefore.items[0].record_id
const recordBefore=await get('/api/v2/replay/sessions/'+recordId)
const settle=async()=>{await p.waitForLoadState('networkidle');await p.locator('.fxs-actions-trigger').first().waitFor()}
const trap=async dialog=>{for(const key of ['Tab','Shift+Tab'])for(let i=0;i<15;i++){await p.keyboard.press(key);assert.ok(await dialog.evaluate(e=>e.contains(document.activeElement)),'focus escaped dialog')}}
const run=async(name,work)=>{try{await work();report.checks.push({name,pass:true})}catch(e){report.failures.push({name,error:String(e),stack:e.stack});await p.screenshot({path:path.join(out,'failure-'+name+'.png')}).catch(()=>{})}await writeFile(path.join(out,'progress.json'),JSON.stringify(report,null,2))}
try{
 for(const demo of [true,false])for(const view of ['overview','replay'])for(const [width,theme] of demo?[[1440,'dark'],[1440,'light'],[360,'dark'],[360,'light']]:[[1440,'dark'],[360,'light']])await run(`${demo?'demo':'actual'}-${view}-${theme}-${width}`,async()=>{
  await p.setViewportSize({width,height:width===360?700:900})
  await p.goto(`http://127.0.0.1:5180/?workspace=tenant-a&view=${view}&area=testing&section=${view==='overview'?'dashboard':'sessions'}&select=1&session=${recordId}${demo?'&demo=1&demo_session=demo-gold':''}`)
  await settle()
  if(await p.getByTestId('fxreplay-shell').getAttribute('data-theme')!==theme)await p.getByTestId('theme-toggle').click()
  const trigger=demo?p.getByRole('button',{name:'Thao tác Gold Swing',exact:true}):p.locator('.fxs-actions-trigger').first()
  const name=(await trigger.getAttribute('aria-label')).slice('Thao tác '.length)
  await trigger.scrollIntoViewIfNeeded();await trigger.focus();await p.keyboard.press('ArrowDown')
  const menu=p.getByRole('menu',{name:'Thao tác phiên',exact:true});await menu.waitFor()
  const box=await menu.boundingBox();assert.ok(box.x>=0&&box.y>=0&&box.x+box.width<=width&&box.y+box.height<= (width===360?700:900))
  assert.deepEqual(await menu.getByRole('menuitem').allTextContents(),[await menu.getByRole('menuitem').first().innerText(),'Xóa phiên'])
  await p.keyboard.press('End');assert.equal(await p.evaluate(()=>document.activeElement.textContent),'Xóa phiên')
  await menu.getByRole('menuitem',{name:'Xóa phiên',exact:true}).hover()
  const hover=await menu.getByRole('menuitem',{name:'Xóa phiên',exact:true}).evaluate(e=>({background:getComputedStyle(e).backgroundColor,hover:getComputedStyle(e).getPropertyValue('--wm-hover')}));assert.notEqual(hover.background,'rgba(0, 0, 0, 0)')
  await p.screenshot({path:path.join(out,`${demo?'demo':'actual'}-${view}-${theme}-${width}-menu.png`)})
  await p.keyboard.press('Escape');await menu.waitFor({state:'hidden'});assert.ok(await trigger.evaluate(e=>document.activeElement===e))
  await trigger.click();await menu.getByRole('menuitem',{name:'Xóa phiên',exact:true}).click()
  const dialog=p.getByRole('dialog',{name:'Xóa phiên',exact:true}),input=dialog.getByRole('textbox',{name:'Tên phiên xác nhận xóa',exact:true}),submit=dialog.getByRole('button',{name:'Xóa phiên',exact:true})
  await dialog.waitFor();assert.ok(await input.evaluate(e=>document.activeElement===e),'delete input not focused after modal open');assert.ok(await submit.isDisabled())
  await input.fill(name+' ');assert.ok(await submit.isDisabled());await input.fill(name);assert.ok(await submit.isEnabled())
  const style=await input.evaluate(e=>{const s=getComputedStyle(e),parent=getComputedStyle(e.parentElement);return{border:s.borderLeftWidth,parentBorder:parent.borderLeftWidth,outline:s.outlineStyle,shadow:s.boxShadow,borderColor:s.borderColor,color:s.color}})
  assert.equal(style.border,'1px');assert.equal(style.parentBorder,'0px');assert.equal(style.outline,'none');assert.equal(style.shadow,'none');report.styles.push({demo,view,width,theme,input:style,hover})
  await trap(dialog);await input.focus();await dialog.screenshot({path:path.join(out,`${demo?'demo':'actual'}-${view}-${theme}-${width}-dialog.png`)})
  await dialog.getByRole('button',{name:'Hủy',exact:true}).click();await dialog.waitFor({state:'hidden'});assert.ok(await trigger.evaluate(e=>document.activeElement===e))
  await trigger.click();await menu.getByRole('menuitem').first().click();const archive=p.getByRole('dialog');await archive.waitFor();await trap(archive);await p.keyboard.press('Escape');await archive.waitFor({state:'hidden'});assert.ok(await trigger.evaluate(e=>document.activeElement===e))
  if(demo){await trigger.click();await menu.getByRole('menuitem',{name:'Xóa phiên',exact:true}).click();await p.getByRole('dialog').getByRole('textbox',{name:'Tên phiên xác nhận xóa',exact:true}).fill(name);await p.getByRole('dialog').getByRole('button',{name:'Xóa phiên',exact:true}).click();await p.getByRole('dialog').waitFor({state:'hidden'});if(view==='overview')assert.equal(await p.locator('[data-session-id="demo-gold"]').count(),0);else assert.notEqual(new URL(p.url()).searchParams.get('demo_session'),'demo-gold')}
  assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth-innerWidth),0)
 })
 assert.deepEqual(await get('/api/v2/replay/sessions'),catalogBefore);assert.deepEqual(await get('/api/v2/replay/sessions/'+recordId),recordBefore)
 report.actualRecordsUnchanged=true;report.after=await pins();report.sourceUnchanged=JSON.stringify(report.before)===JSON.stringify(report.after)
 assert.ok(report.sourceUnchanged);assert.deepEqual(report.errors,[]);assert.deepEqual(report.blocked,[]);assert.equal(report.api.filter(x=>x.demo==='1').length,0);assert.deepEqual(report.failures,[]);report.pass=true
}catch(e){report.failure=String(e);process.exitCode=1}finally{await context.unrouteAll({behavior:'wait'});await browser.close();await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({pass:report.pass,checks:report.checks.length,failures:report.failures,errors:report.errors,blocked:report.blocked,sourceUnchanged:report.sourceUnchanged}))}
