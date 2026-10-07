import assert from 'node:assert/strict'
import {chromium} from '../../../web/node_modules/playwright/index.mjs'
import {writeFile} from 'node:fs/promises'
const browser=await chromium.launch({headless:true,ignoreDefaultArgs:['--hide-scrollbars']})
const report={scope:'Real header isolated React mount with labeled controls fixture; no activity or persisted writes',cases:[],errors:[],blocked:[]}
try{
 const ctx=await browser.newContext({viewport:{width:1710,height:987}});await ctx.routeWebSocket('**/*',s=>s.close());await ctx.route('**/*',route=>{const r=route.request(),u=new URL(r.url());if(['GET','HEAD','OPTIONS'].includes(r.method())&&['http://127.0.0.1:5180','http://127.0.0.1:8010'].includes(u.origin))return route.continue();report.blocked.push({method:r.method(),url:r.url()});return route.abort()})
 const p=await ctx.newPage();p.setDefaultTimeout(10000);p.on('pageerror',e=>report.errors.push(String(e)));await p.goto('http://127.0.0.1:5180/?view=overview',{waitUntil:'networkidle'})
 await p.evaluate(async()=>{
  const src=await(await fetch('/src/LegacyChartHeader.jsx')).text(),reactUrl=src.match(/from\s+["']([^"']*\/react\.js[^"']*)["']/)[1],r=await import(reactUrl),d=await import(reactUrl.replace('react.js','react-dom_client.js')),React=r.default||r,DOM=d.default||d,Header=(await import('/src/LegacyChartHeader.jsx')).default
  const host=document.createElement('div');host.id='qa-readiness';host.className='fx-app is-chart-workspace';host.dataset.theme='light';host.style.display='block';host.style.position='fixed';host.style.inset='0';host.style.zIndex='100';host.style.background='white';document.body.append(host)
  await import('/src/ChartWorkbench.css');const root=DOM.createRoot(host);window.__qaCalls=[];window.__qaRender=enabled=>root.render(React.createElement(Header,{controls:enabled?{intervals:['1','5','60','1D'],interval:'1',chartType:1,setType:v=>window.__qaCalls.push(['type',v]),setInterval:v=>window.__qaCalls.push(['interval',v]),action:v=>window.__qaCalls.push(['action',v]),save:()=>window.__qaCalls.push(['save']),capture:()=>window.__qaCalls.push(['capture'])}:null,symbol:'FIXTURE',name:'Fixture only',backHref:'#fixture',theme:'light',onTheme:()=>{},onOpenTool:()=>{},onError:()=>{}}));window.__qaRender(false)
 })
 const host=p.locator('#qa-readiness'),header=host.getByTestId('legacy-chart-header');await header.waitFor()
 for(const name of ['Kiểu biểu đồ','Các chỉ báo','Hoàn tác','Làm lại','Lưu chart','Chụp biểu đồ PNG'])assert.equal(await header.getByRole('button',{name,exact:true}).isDisabled(),true,name)
 report.cases.push({name:'null controls disables native actions before readiness',pass:true})
 await p.evaluate(()=>window.__qaRender(true));await header.getByRole('button',{name:'Kiểu biểu đồ',exact:true}).click();await host.locator('.legacy-header-menu').waitFor();await p.evaluate(()=>window.__qaRender(false));await p.waitForFunction(()=>document.querySelector('#qa-readiness .legacy-header-menu button').disabled)
 assert.equal(await host.locator('.legacy-header-menu button:enabled').count(),0);assert.deepEqual(await p.evaluate(()=>window.__qaCalls),[]);await p.keyboard.press('Escape');await host.locator('.legacy-header-menu').waitFor({state:'hidden'})
 report.cases.push({name:'readiness lost while style menu open disables choices, no null call',pass:true})
 await p.evaluate(()=>window.__qaRender(true));await header.getByRole('button',{name:'Kiểu biểu đồ',exact:true}).click();await p.setViewportSize({width:360,height:987});report.resizeStyle=await p.evaluate(()=>({innerWidth,display:getComputedStyle(document.querySelector('#qa-readiness .legacy-header-chart-tools')).display,css:[...document.querySelectorAll('style')].map(s=>s.dataset.viteDevId)}));await p.waitForFunction(()=>innerWidth===360);await p.keyboard.press('Escape');const focused=await p.evaluate(()=>({tag:document.activeElement.tagName,label:document.activeElement.getAttribute('aria-label'),width:document.activeElement.getBoundingClientRect().width}))
 report.cases.push({name:'resize while style menu open returns focus to visible opener',focused,pass:focused.tag==='BUTTON'&&focused.width>0})
 await ctx.close();report.pass=report.cases.every(c=>c.pass)&&!report.errors.length&&!report.blocked.length
}catch(e){report.pass=false;report.failure=String(e);process.exitCode=1}finally{await browser.close();await writeFile(new URL('./readiness-report.json',import.meta.url),JSON.stringify(report,null,2))}
console.log(JSON.stringify(report))
