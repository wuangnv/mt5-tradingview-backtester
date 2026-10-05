import assert from 'node:assert/strict'
import {chromium} from '../../../foundation_v2/web/node_modules/playwright/index.mjs'
import {readFile,writeFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import path from 'node:path'
const out=path.resolve('.artifacts/fx-dashboard-sessions-20261005/independent-review'),origin='http://127.0.0.1:5180',api='http://127.0.0.1:8010'
const base=JSON.parse(await readFile(path.join(out,'browser-attempt-3-behavior-pass-source-delta.json')))
const hashes=()=>Promise.all(base.before.map(async({file})=>({file,sha256:createHash('sha256').update(await readFile(file)).digest('hex')})))
const report={scope:'Final focused validation for late strategy unknown/null defense and mobile pill typography; actual GET UI and labeled response fixtures only',before:await hashes(),checks:[],cases:[],errors:[],blocked:[]}
const b=await chromium.launch({headless:true}),c=await b.newContext({viewport:{width:360,height:987}})
let mode='actual'
await c.route('**/*',async r=>{const q=r.request(),u=new URL(q.url());if(u.origin!==origin||!['GET','HEAD','OPTIONS'].includes(q.method())){report.blocked.push(u.pathname);return r.abort()}if(!u.pathname.startsWith('/api/'))return r.continue();try{const response=await r.fetch({url:api+u.pathname+u.search});if(mode!=='actual'&&/^\/api\/v2\/replay\/sessions\/[^/]+\/analytics$/.test(u.pathname)){const payload=await response.json();payload.provenance={...payload.provenance};if(mode==='missing')delete payload.provenance.playbook_id;else payload.provenance.playbook_id=null;return await r.fulfill({response,json:payload})}return await r.fulfill({response})}catch(e){report.errors.push(String(e));try{return await r.abort()}catch{}}})
await c.routeWebSocket('**/*',s=>s.close());const p=await c.newPage();p.setDefaultTimeout(15000);p.on('pageerror',e=>report.errors.push(String(e)))
const settle=async()=>{await p.waitForLoadState('networkidle');await p.waitForFunction(()=>document.getAnimations().every(a=>a.playState!=='running'))}
const url=`${origin}/?workspace=tenant-a&view=overview&area=testing&section=dashboard&dashboard_status=all`
try{
 await p.goto(url,{waitUntil:'networkidle'});await p.waitForFunction(()=>!document.querySelector('button[aria-label="Strategy"]').disabled)
 for(const theme of ['dark','light']){
  if(await p.getByTestId('fxreplay-shell').getAttribute('data-theme')!==theme)await p.getByTestId('theme-toggle').click();await settle()
  for(const label of ['Phạm vi Performance','Thời gian Performance']){const value=p.getByRole('button',{name:label,exact:true}).locator('.fx-select-value');const box=await value.boundingBox();assert.ok(box.height<24,`${label} should fit one mobile line`)}
  await p.getByRole('button',{name:'Phạm vi Performance',exact:true}).click();await settle();const menu=p.locator('.fx-select-menu'),box=await menu.boundingBox(),clip=await p.locator('.fx-content').boundingBox();assert.ok(box.x>=clip.x+10&&box.x+box.width<=clip.x+clip.width-10);assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth-innerWidth),0)
  await p.addScriptTag({path:'../../.artifacts/wm-integration-quality-tools/node_modules/axe-core/axe.min.js'});const axe=await p.evaluate(()=>window.axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','wcag22aa']}}).then(r=>r.violations.map(v=>v.id)));assert.deepEqual(axe,[]);await p.screenshot({path:path.join(out,`final-source-menu-${theme}-360.png`)});await menu.press('Escape');report.cases.push({theme,width:360,pillsOneLine:true,menuClipSafe:true,axe})
 }
 await p.setViewportSize({width:1440,height:987});await p.getByRole('button',{name:'Strategy',exact:true}).click();await p.getByRole('option',{name:'Chưa gắn strategy',exact:true}).click();await settle();assert.equal(await p.locator('.fx-dashboard-session-row').count(),6);report.checks.push('Actual final strategy null metadata filters six real sessions without transient no-match/refetch')
 mode='missing';await p.reload({waitUntil:'networkidle'});await p.waitForFunction(()=>!document.querySelector('button[aria-label="Strategy"]').disabled);assert.equal(await p.locator('.fx-dashboard-session-row').count(),0);await p.getByRole('button',{name:'Strategy',exact:true}).click();assert.equal(await p.getByRole('option',{name:'Chưa gắn strategy',exact:true}).count(),0);await p.locator('.fx-select-menu').press('Escape');report.checks.push('LABELED SYNTHETIC: absent playbook_id stays unknown, not unassigned; stale unassigned filter matches no unknown metadata')
 mode='null';await p.reload({waitUntil:'networkidle'});await p.waitForFunction(()=>!document.querySelector('button[aria-label="Strategy"]').disabled);await p.waitForFunction(()=>document.querySelectorAll('.fx-dashboard-session-row').length===6);report.checks.push('LABELED SYNTHETIC: explicit typed null remains unassigned and matches six fixtures')
 report.after=await hashes();report.sourceUnchanged=JSON.stringify(report.before)===JSON.stringify(report.after);assert.equal(report.sourceUnchanged,true);assert.deepEqual(report.errors,[]);assert.deepEqual(report.blocked,[]);report.pass=true
}catch(e){report.failure=String(e);await p.screenshot({path:path.join(out,'final-focused-failure.png')}).catch(()=>{});process.exitCode=1;console.error(e)}finally{await c.unrouteAll({behavior:'wait'});await b.close();await writeFile(path.join(out,'final-focused.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report))}
