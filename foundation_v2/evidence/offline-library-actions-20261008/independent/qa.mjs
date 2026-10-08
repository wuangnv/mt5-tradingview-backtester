import assert from 'node:assert/strict'
import {chromium} from '../../../web/node_modules/playwright/index.mjs'
import {mkdir,writeFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
const origin='http://127.0.0.1:5180',out=new URL('./',import.meta.url)
await mkdir(out,{recursive:true});const browser=await chromium.launch(),report={cases:[],errors:[],scope:'Explicit mock dataset/download/catalog GET and DELETE/full/resume/cancel POST; no actual data mutations/provider/live'}
async function run(theme,width,lang){
 const c={theme,width,lang};report.cases.push(c)
 const ctx=await browser.newContext({viewport:{width,height:987}});ctx.setDefaultTimeout(7000)
 await ctx.addInitScript(({theme,lang})=>{localStorage.setItem('tw-theme',theme);localStorage.setItem('tw-language',lang)},{theme,lang})
 const assets=Array.from({length:28},(_,i)=>({instrument_id:`ASSET${String(i).padStart(2,'0')}`,name:i<10?'Short':i<20?'Long name '.repeat(8):'Third page',provider:'Dukascopy',provider_id:'dukascopy-catalog',asset_class:i%2?'fx':'metal'}))
 let datasets=assets.filter((a,i)=>i%3===0).map((a,i)=>({...a,dataset_id:`ds${a.instrument_id}`,timeframe:i%2?'M1':'H4',row_count:i*123456,size_bytes:1024*(i+1),available_range:{from_utc:'2003-01-01T00:00:00Z',to_utc:'2026-10-07T23:59:00Z'},source:{provider:'Dukascopy'},quality:{disposition:i%2?'pass':'review'}})),job=null,requests=[],deleteConflict=false,gets=0
 await ctx.routeWebSocket('**/*',s=>s.close())
 await ctx.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url()),p=url.pathname,m=req.method()
  if(url.origin!==origin||/^\/api\/v2\/(live|data\/(providers|market-assets|categories))/.test(p))return route.abort()
  if(p==='/api/v2/data/datasets'&&m==='GET'){gets++;return route.fulfill({contentType:'application/json',body:JSON.stringify({items:datasets,catalog_items:assets,catalog_state:{configured:true,status:'cached',item_count:28,refresh_available:true,retrieved_at_utc:'2026-10-08T00:00:00Z'},download_state:{available:true,supports_full:true,supported_instruments:assets.map(a=>a.instrument_id)}})})}
  if(p==='/api/v2/data/downloads'&&m==='GET')return route.fulfill({contentType:'application/json',body:JSON.stringify({available:true,items:job?[job]:[]})})
  if(p==='/api/v2/data/downloads/full'&&m==='POST'){
   requests.push({path:p,body:req.postDataJSON()});job={job_id:'qa-job',instrument_id:req.postDataJSON().instrument_id,status:'running',stage:'downloading',completed_days:2,total_days:8,transferred_bytes:1048576,from_date:'2003-01-01',to_date:'2026-10-07'};return route.fulfill({contentType:'application/json',body:JSON.stringify(job)})
  }
  if(/^\/api\/v2\/data\/downloads\/qa-job\/(resume|cancel)$/.test(p)&&m==='POST'){requests.push({path:p});job={...job,status:p.endsWith('resume')?'running':'cancelled'};return route.fulfill({contentType:'application/json',body:JSON.stringify(job)})}
  if(p.startsWith('/api/v2/data/datasets/')&&m==='DELETE'){
   requests.push({path:p});if(deleteConflict)return route.fulfill({status:409,contentType:'application/json',body:'{"detail":"dataset_in_use"}'})
   datasets=datasets.filter(a=>a.dataset_id!==decodeURIComponent(p.split('/').at(-1)));return route.fulfill({contentType:'application/json',body:'{"deleted":true}'})
  }
  if(!['GET','HEAD','OPTIONS'].includes(m))return route.abort();return route.continue()
 })
 const page=await ctx.newPage();page.on('pageerror',e=>report.errors.push(String(e)))
 const row=s=>page.locator('.rd-table tbody tr').filter({hasText:s}),menu=page.getByRole('menu'),dialog=page.getByRole('dialog')
 const button=(vi,en)=>page.getByRole('button',{name:lang==='vi'?vi:en,exact:true})
 const readCols=()=>page.locator('.rd-table th').evaluateAll(els=>{const left=els[0].getBoundingClientRect().x;return els.map(e=>({x:e.getBoundingClientRect().x-left,w:e.getBoundingClientRect().width}))})
 const pageNumber=async n=>{while(Number(await page.locator('.wm-pagination-number.is-current').innerText())!==n){const current=Number(await page.locator('.wm-pagination-number.is-current').innerText());await page.locator(`.wm-pagination-pages > button${current<n?':nth-last-child(2)':':nth-child(2)'}`).click()}}
 try{
  await page.goto(`${origin}/?workspace=tenant-a&view=market-data&area=testing&section=market-data`);await page.locator('.rd-table tbody tr').first().waitFor()
  await page.locator('.wm-pagination-size button').click();await page.getByRole('option',{name:'10',exact:true}).click();const columns=await readCols()
  for(const n of [2,3,1]){await pageNumber(n);assert.deepEqual(await readCols(),columns)}c.columns=columns
  assert.match(await row('ASSET00').locator('td').nth(5).innerText(),/KiB/)
  const unavailable=row('ASSET02').locator('.data-library-more');await unavailable.scrollIntoViewIfNeeded();await unavailable.click();assert.equal(await menu.getByRole('menuitem').nth(0).isDisabled(),true);assert.equal(await menu.getByRole('menuitem').nth(2).isDisabled(),true);await page.keyboard.press('Escape');assert.equal(await menu.count(),0)
  const more=row('ASSET00').locator('.data-library-more');await more.scrollIntoViewIfNeeded();await more.focus();await page.keyboard.press('ArrowDown')
  assert.equal(await menu.getByRole('menuitem').count(),3);assert.equal(await menu.getByRole('menuitem').nth(1).isDisabled(),true)
  const b=await menu.boundingBox();assert(b.x>=0&&b.x+b.width<=width+1);assert(b.y>=0&&b.y+b.height<=987+1)
  await page.keyboard.press('End');assert.equal(await menu.getByRole('menuitem').nth(2).evaluate(e=>document.activeElement===e),true);await page.keyboard.press('Escape');assert.equal(await more.evaluate(e=>document.activeElement===e),true)
  const oval=await more.boundingBox();assert.equal(oval.width,oval.height)
  await more.click();await menu.getByRole('menuitem').nth(0).click();await dialog.waitFor();assert.match(await dialog.innerText(),/KiB/);await dialog.getByRole('button',{name:lang==='vi'?'Đóng':'Close',exact:true}).click()
  await more.click();await menu.getByRole('menuitem').nth(2).click();assert.equal(requests.length,0)
  await dialog.getByRole('button',{name:lang==='vi'?'Xoá':'Delete',exact:true}).click();await dialog.waitFor({state:'detached'});await page.waitForFunction(()=>!document.querySelector('[data-testid="dataset-row-dsASSET00"]'))
  assert.equal(await row('ASSET00').locator('.data-library-download').isDisabled(),false);assert.deepEqual(await readCols(),columns)
  deleteConflict=true;await row('ASSET03').locator('.data-library-more').click();await menu.getByRole('menuitem').nth(2).click();await dialog.getByRole('button',{name:lang==='vi'?'Xoá':'Delete',exact:true}).click();await dialog.getByRole('alert').waitFor();assert.match(await dialog.getByRole('alert').innerText(),lang==='vi'?/đang được/:/in use/);assert.equal(await row('ASSET03').locator('[data-testid="dataset-row-dsASSET03"]').count(),1);await dialog.getByRole('button',{name:lang==='vi'?'Đóng':'Close',exact:true}).click()
  await row('ASSET01').locator('.data-library-download').click();await row('ASSET01').locator('.data-library-progress').waitFor();assert.deepEqual(requests.find(r=>r.path.endsWith('/full')).body,{instrument_id:'ASSET01'});assert.equal(await dialog.count(),0)
  const progress=row('ASSET01').locator('.data-library-progress');assert.match(await progress.innerText(),/25%/);assert.deepEqual(await readCols(),columns)
  job={...job,transferred_bytes:3145728,completed_days:4};await page.waitForFunction(()=>document.querySelector('.data-library-progress-rate')?.innerText.includes('50%'));assert.match(await progress.innerText(),/MiB\/s/)
  await progress.click();await dialog.waitFor();assert.equal(await dialog.getByRole('button',{name:lang==='vi'?'Huỷ tải':'Cancel download',exact:true}).count(),1);await dialog.getByRole('button',{name:lang==='vi'?'Đóng':'Close',exact:true}).click()
  job={...job,stage:'processing',completed_days:8};await page.waitForFunction(()=>/Đang lưu|Saving/.test(document.querySelector('.data-library-progress-label')?.innerText||''));assert.match(await progress.locator('.data-library-progress-rate').innerText(),/^—/)
  await pageNumber(3);const recovery=button('Tiến độ tải dữ liệu','Data download progress');await recovery.waitFor();await recovery.click();await dialog.waitFor();await dialog.getByRole('button',{name:lang==='vi'?'Huỷ tải':'Cancel download',exact:true}).click();await dialog.getByRole('button',{name:lang==='vi'?'Đóng':'Close',exact:true}).click();await recovery.waitFor({state:'detached'})
  await pageNumber(1);job={...job,status:'paused',stage:'downloading',retry_after_seconds:0}
  await page.reload();await row('ASSET01').locator('.data-library-progress').click();await dialog.getByRole('button',{name:lang==='vi'?'Tiếp tục tải':'Resume download',exact:true}).click();await dialog.getByRole('button',{name:lang==='vi'?'Đóng':'Close',exact:true}).click()
  datasets.push({...assets[1],dataset_id:'dsASSET01',timeframe:'M1',size_bytes:4096,source:{provider:'Dukascopy'},quality:{disposition:'pass'}});const previousGets=gets;job={...job,status:'completed'};await page.waitForFunction(()=>document.querySelector('[data-testid="dataset-row-dsASSET01"]'));assert(gets>previousGets);assert.equal(await page.locator('.data-library-progress').count(),0);assert.deepEqual(await readCols(),columns)
  await page.screenshot({path:fileURLToPath(new URL(`actions-${theme}-${width}-${lang}.png`,out))});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);c.requests=requests;c.pass=true
 }catch(e){c.pass=false;c.error=String(e);await page.screenshot({path:fileURLToPath(new URL(`FAIL-${theme}-${width}-${lang}.png`,out))}).catch(()=>{})}
 finally{await ctx.close()}
}
try{for(const theme of ['dark','light'])for(const [width,lang] of [[360,'vi'],[1440,'en']])await run(theme,width,lang)}
finally{report.pass=report.cases.every(c=>c.pass)&&!report.errors.length;await writeFile(new URL('results.json',out),JSON.stringify(report,null,2));await browser.close();console.log(JSON.stringify({pass:report.pass,cases:report.cases.length,failures:report.cases.filter(c=>!c.pass),errors:report.errors}));if(!report.pass)process.exitCode=1}
