import {createRequire} from 'node:module'
import {mkdir,writeFile} from 'node:fs/promises'
import assert from 'node:assert/strict'
const require=createRequire('D:/ANNAM/TradingWorkspace/projects/mt5-tradingview-backtester/foundation_v2/web/package.json'),{chromium}=require('playwright'),out='D:/ANNAM/TradingWorkspace/.artifacts/mt5-dashboard-20261003/independent-review',origin='http://127.0.0.1:5180',report={cases:[],errors:[],blocked:[]}
await mkdir(out,{recursive:true});const b=await chromium.launch({headless:true})
try {for(const width of [1440,768,390,320])for(const theme of ['dark','light']){
 const c=await b.newContext({viewport:{width,height:900},reducedMotion:'reduce'});await c.addInitScript(t=>localStorage.setItem('tw-theme',t),theme)
 await c.route('**/*',async r=>{const q=r.request(),u=new URL(q.url());if(['http:','https:'].includes(u.protocol)&&(u.origin!==origin||!['GET','HEAD','OPTIONS'].includes(q.method()))){report.blocked.push({method:q.method(),url:q.url()});await r.abort()}else await r.continue()})
 const p=await c.newPage();p.on('pageerror',e=>report.errors.push(String(e)));let items=[];p.on('response',async r=>{if(r.url().endsWith('/api/v2/replay/sessions')&&r.ok())items=(await r.json()).items})
 await p.goto(`${origin}/?workspace=tenant-a&view=overview&session=39b1d068edd64e75864f692f27237852&cursor=20`);await p.waitForLoadState('networkidle');await p.getByTestId('dashboard-recent').waitFor()
 const rows=p.locator('.fx-dashboard-session-row');assert.ok(await rows.count()<=5&&await rows.count()>0)
 const expected=items.filter(i=>!i.archived).sort((a,b)=>Date.parse(b.updated_at_utc)-Date.parse(a.updated_at_utc)||a.record_id.localeCompare(b.record_id)).slice(0,5).map(i=>i.record_id)
 assert.deepEqual(await rows.evaluateAll(rs=>rs.map(e=>e.dataset.sessionId)),expected)
 const resume=p.getByTestId('dashboard-resume').getByRole('link',{name:'Tiếp tục replay'});const u=new URL(await resume.getAttribute('href'),origin);assert.equal(u.searchParams.get('view'),'replay');assert.equal(u.searchParams.get('surface'),'workspace');assert.equal(u.searchParams.get('mode'),'Practice');assert.equal(u.searchParams.get('cursor'),null);assert.equal(u.searchParams.get('cutoff'),null);assert.equal(u.searchParams.get('select'),null);assert.ok(items.find(i=>i.record_id===u.searchParams.get('session'))?.dataset_available)
 assert.equal(await p.locator('.fx-dashboard-detail').getAttribute('open'),null)
 const geometry=await p.evaluate(()=>({overflow:document.documentElement.scrollWidth-innerWidth,clipped:[...document.querySelectorAll('.fx-dashboard a,.fx-dashboard button,.fx-dashboard summary')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&(r.right>innerWidth+1||r.left<0||e.scrollWidth>e.clientWidth+1)}).map(e=>e.innerText)}));assert.equal(geometry.overflow,0);assert.deepEqual(geometry.clipped,[])
 await p.screenshot({path:`${out}/dashboard-${width}-${theme}.png`,fullPage:true,animations:'disabled'})
 await p.getByRole('searchbox',{name:'Tìm phiên'}).fill('no matching session abcxyz');assert.equal(await rows.count(),0);await p.getByRole('searchbox',{name:'Tìm phiên'}).fill('')
 const first=rows.first(),summary=first.locator('summary');await summary.focus();await p.keyboard.press('Enter');assert.equal(await first.locator('details').getAttribute('open'),'')
 const menu=first.locator('.fx-dashboard-session-menu');await menu.scrollIntoViewIfNeeded();await p.screenshot({path:`${out}/menu-${width}-${theme}.png`,animations:'disabled'})
 const rename=menu.getByRole('link',{name:'Đổi tên và mô tả'});const renameURL=new URL(await rename.getAttribute('href'),origin);assert.equal(renameURL.searchParams.get('manage'),'rename');assert.equal(renameURL.searchParams.get('select'),'1');assert.equal(renameURL.searchParams.get('cursor'),null)
 await p.keyboard.press('Escape');assert.equal(await first.locator('details').getAttribute('open'),null);assert.equal(await summary.evaluate(e=>e===document.activeElement),true)
 if(width===1440&&theme==='dark'){await p.goto(renameURL.href);await p.waitForLoadState('networkidle');assert.equal(await p.getByRole('button',{name:'Lưu thay đổi'}).isVisible(),true);assert.equal(await p.getByRole('textbox',{name:'Tên phiên'}).inputValue(),items.find(i=>i.record_id===renameURL.searchParams.get('session')).name);assert.deepEqual(report.blocked,[])}
 report.cases.push({width,theme,rows:expected,resumeSession:u.searchParams.get('session'),...geometry});await c.close()
 }
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.blocked,[]);report.status='PASS'
}catch(e){report.status='FAIL';report.failure=e.stack;process.exitCode=1}finally{await b.close();await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,cases:report.cases.length,failure:report.failure}))}
