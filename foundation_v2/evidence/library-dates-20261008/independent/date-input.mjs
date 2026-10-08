import assert from 'node:assert/strict'
import {chromium} from '../../../web/node_modules/playwright/index.mjs'
import {writeFile} from 'node:fs/promises'
const origin='http://127.0.0.1:5180',browser=await chromium.launch(), context=await browser.newContext(),results={scope:'Isolated browser component fixture using actual Vite modules; local reads only',errors:[],checks:[]}
await context.routeWebSocket('**/*',s=>s.close())
await context.route('**/*',route=>{const u=new URL(route.request().url());return u.origin===origin&&route.request().method()==='GET'?route.continue():route.abort()})
const page=await context.newPage();page.on('pageerror',e=>results.errors.push(String(e)))
const source=await (await context.request.get(origin+'/src/ProjectDateInput.jsx')).text(),main=await (await context.request.get(origin+'/src/main.jsx')).text()
const react=source.match(/from "([^"]*react\.js[^\"]*)"/)[1],client=main.match(/from "([^"]*react-dom_client\.js[^\"]*)"/)[1]
await context.route(origin+'/independent-date-fixture.html',route=>route.fulfill({contentType:'text/html',body:`<html><body><div id="fixture" class="fx-app"></div><script type="module">import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;import React from '${react}';const{useState}=React;import ReactDOM from '${client}';const{createRoot}=ReactDOM;const{default:Input}=await import('/src/ProjectDateInput.jsx');function Test(){const[v,setV]=useState('2024-02-29'),[max,setMax]=useState('2024-12-31'),[dt,setDt]=useState('2026-10-08T18:45');return React.createElement('form',{onSubmit:e=>e.preventDefault()},React.createElement(Input,{'aria-label':'Fixture date',value:v,min:'2024-01-01',max,onChange:e=>setV(e.target.value)}),React.createElement('output',{id:'iso'},v),React.createElement('button',{type:'button',id:'reset',onClick:()=>setV('')},'Reset'),React.createElement('button',{type:'button',id:'limit',onClick:()=>setMax('2024-02-28')},'Constrain'),React.createElement(Input,{'aria-label':'Fixture datetime',type:'datetime-local',value:dt,onChange:e=>setDt(e.target.value)}),React.createElement('output',{id:'datetime'},dt))};createRoot(document.getElementById('fixture')).render(React.createElement(Test));</script></body></html>`}))
try{
 await page.goto(origin+'/independent-date-fixture.html');const date=page.getByLabel('Fixture date',{exact:true}),time=page.getByLabel('Fixture datetime');await date.waitFor()
 assert.equal(await date.inputValue(),'29/02/2024');results.checks.push('Initial leap date dd/mm/yyyy')
 await date.fill('28/02/2024');assert.equal(await page.locator('#iso').innerText(),'2024-02-28');results.checks.push('Typed date -> ISO callback')
 await time.fill('08/10/2026 23:15');assert.equal(await page.locator('#datetime').innerText(),'2026-10-08T23:15');results.checks.push('Typed 24h wall time -> ISO callback')
 await date.fill('31/02/2024');assert.equal(await date.evaluate(el=>el.validity.valid),false);assert.equal(await page.locator('#iso').innerText(),'');results.checks.push('Invalid leap day blocks native validity')
 await page.locator('#reset').click();results.invalidAfterExternalClear=await date.inputValue();results.invalidClearValidity=await date.evaluate(el=>el.validity.valid)
 await date.fill('29/02/2024');await page.locator('#limit').click();results.validityAfterChangingMax=await date.evaluate(el=>el.validity.valid);results.isoAfterChangingMax=await page.locator('#iso').innerText()
 const native=page.locator('.project-date-native').first();await native.fill('2024-02-27');assert.equal(await date.inputValue(),'27/02/2024');assert.equal(await page.locator('#iso').innerText(),'2024-02-27');results.checks.push('Native picker ISO change -> Vietnamese text')
 await page.locator('.project-date-picker').first().click();results.pickerClickNoError=true
 await page.screenshot({path:new URL('date-input-fixture.png',import.meta.url).pathname.replace(/^\/(\w:)/,'$1')})
}catch(e){results.error=String(e)}finally{await writeFile(new URL('date-input-results.json',import.meta.url),JSON.stringify(results,null,2));await context.close();await browser.close();console.log(JSON.stringify(results))}
