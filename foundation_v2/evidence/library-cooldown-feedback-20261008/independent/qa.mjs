import assert from 'node:assert/strict'
import {chromium} from '../../../web/node_modules/playwright/index.mjs'
import {mkdir,writeFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import copy from '../../../web/src/testing-copy.json' with {type:'json'}
import {downloadRetrySeconds} from '../../../web/src/dataLibraryDownloadMetrics.js'
const out=new URL('./',import.meta.url),origin='http://127.0.0.1:5180';await mkdir(out,{recursive:true})
for(const [delay,received,now,expected] of [[239,1000,1000,239],[239,1000,1999,239],[239,1000,2000,238],[2,1000,3000,0],[2,1000,10000,0],[2,1000,0,2],[0,1000,2000,0]])assert.equal(downloadRetrySeconds({retry_after_seconds:delay},received,now),expected)
const browser=await chromium.launch(),report={scope:'Actual local GET-only and paused cooldown/manual-pause fixtures. No resume or other mutations.',mathPass:true,cases:[],errors:[]}
async function run(theme,width,language,mode){
 const c={theme,width,language,mode,checks:[]};report.cases.push(c);const t=k=>copy[k]?.[language]||k
 const context=await browser.newContext({viewport:{width,height:987}});context.setDefaultTimeout(7000);await context.addInitScript(({theme,language})=>{localStorage.setItem('tw-theme',theme);localStorage.setItem('tw-language',language)},{theme,language})
 const writes=[];let polls=0;await context.routeWebSocket('**/*',s=>s.close());await context.route('**/*',route=>{const req=route.request(),url=new URL(req.url());if(url.origin!==origin||url.pathname.startsWith('/api/v2/live'))return route.abort();if(!['GET','HEAD','OPTIONS'].includes(req.method())){writes.push(req.url());return route.abort()}
  if(mode!=='actual'&&url.pathname==='/api/v2/data/datasets')return route.fulfill({json:{items:[],catalog_items:[{instrument_id:'EUR/USD',name:'Explicit paused cooldown fixture',provider:'Dukascopy',provider_id:'dukascopy-catalog',asset_class:'fx'}],catalog_state:{configured:true},download_state:{available:true,supports_full:true,supported_instruments:['EUR/USD'],earliest_dates:{'EUR/USD':'2003-05-04'}}}})
  if(mode!=='actual'&&url.pathname==='/api/v2/data/downloads'){polls++;return route.fulfill({json:{items:[{job_id:'fixture-paused',instrument_id:'EUR/USD',status:'paused',stage:'downloading',completed_days:1356,total_days:8558,from_date:'2003-05-04',to_date:'2026-10-07',transferred_bytes:28521267,retry_after_seconds:mode==='cooldown'?4:0,error:mode==='cooldown'?'source_rate_limited':null}],available:true,supports_pause:true}})}
  return route.continue()
 })
 const page=await context.newPage();page.on('pageerror',e=>report.errors.push(String(e)))
 try{
  await page.goto(`${origin}/?workspace=tenant-a&view=market-data&area=testing&section=market-data`);await page.locator('.rd-table tbody tr').first().waitFor({timeout:15000});if(mode==='actual')await page.locator('.data-library-search input').fill('EUR/USD')
  const progress=page.locator('.data-library-progress').first();await progress.waitFor();await progress.scrollIntoViewIfNeeded();const resume=page.getByRole('button',{name:t('Tiếp tục tải'),exact:true}).first(),eta=progress.locator('.data-library-progress-eta');assert.equal(await progress.locator('.data-library-progress-label').count(),0,'paused visible label still rendered');assert.match(await progress.getAttribute('aria-label'),new RegExp(t('Đã tạm dừng')));assert.match(await progress.getAttribute('title'),new RegExp(t('Đã tạm dừng')))
  const initial={text:await progress.innerText(),title:await resume.getAttribute('title'),disabled:await resume.isDisabled()};if(mode==='cooldown'){assert(initial.disabled);assert.match(await eta.innerText(),language==='en'?/Wait 00:0[1-4]/:/Chờ 00:0[1-4]/);assert.equal(initial.title,t('Dukascopy đang giới hạn yêu cầu. Có thể tiếp tục sau thời gian chờ.'))}
  if(mode==='manual'){assert.equal(await eta.innerText(),'—');assert.equal(initial.disabled,false);assert.equal(initial.title,t('Tiếp tục tải'))}
  await page.screenshot({path:fileURLToPath(new URL(`${mode}-${theme}-${width}-${language}-initial.png`,out))});await progress.click();const dialog=page.getByRole('dialog',{name:t('Tiến độ tải dữ liệu'),exact:true});await dialog.waitFor();const dialogResume=dialog.getByRole('button',{name:t('Tiếp tục tải'),exact:true});assert.equal(await dialogResume.isDisabled(),initial.disabled)
  if(mode==='cooldown'){await dialogResume.waitFor();await page.waitForFunction(()=>{const buttons=[...document.querySelectorAll('.data-library-job-actions button')];return buttons.some(el=>!el.disabled&&el.textContent.match(/Tiếp tục tải|Resume download/))},null,{timeout:6500});assert.equal(await dialogResume.isDisabled(),false);await page.keyboard.press('Escape');assert.equal(await resume.isDisabled(),false);assert.equal(await eta.innerText(),'—');assert.equal(await resume.getAttribute('title'),t('Tiếp tục tải'));assert.equal(polls,1,'expiry required extra poll or page reload');c.checks.push({name:'Cooldown row/dialog share remaining time, expire and enable without reload/poll',initial,final:{text:await progress.innerText(),disabled:await resume.isDisabled(),title:await resume.getAttribute('title')},polls})}
  else{await page.keyboard.press('Escape');c.checks.push({name:mode==='manual'?'Manual pause no wait, Resume enabled':'Actual paused presentation GET-only',initial})}
  await page.screenshot({path:fileURLToPath(new URL(`${mode}-${theme}-${width}-${language}-final.png`,out))});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.equal(writes.length,0);c.pass=true
 }catch(error){c.pass=false;c.error=String(error);await page.screenshot({path:fileURLToPath(new URL(`FAIL-${mode}-${theme}-${width}-${language}.png`,out))}).catch(()=>{})}
 finally{await context.close()}
}
try{await run('dark',1710,'vi','cooldown');await run('light',360,'en','cooldown');await run('dark',1710,'vi','manual');await run('light',360,'vi','actual')}
finally{report.pass=report.cases.every(c=>c.pass)&&!report.errors.length;await writeFile(new URL('results.json',out),JSON.stringify(report,null,2));await browser.close();console.log(JSON.stringify(report));if(!report.pass)process.exitCode=1}
