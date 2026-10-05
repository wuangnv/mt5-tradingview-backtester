import {chromium} from '../../../web/node_modules/playwright/index.mjs'
import {mkdir} from 'node:fs/promises'
const out='.artifacts/fx-dashboard-sessions-20261005/root'
await mkdir(out,{recursive:true})
const b=await chromium.launch({headless:true}),c=await b.newContext(),p=await c.newPage()
await c.route('**/*',r=>['GET','HEAD','OPTIONS'].includes(r.request().method())?r.continue():r.abort())
await c.routeWebSocket('**/*',s=>s.close())
for(const [name,url] of [['dashboard','?workspace=tenant-a&view=overview&area=testing&section=dashboard'],['session','?workspace=tenant-a&view=replay&area=testing&section=sessions&select=1&session=476f4b498e1a49ed9d48a75719f4d270'],['populated','?workspace=tenant-a&view=replay&area=testing&section=sessions&select=1&session=273a1275538c42cb95cfff16e0f9f62c']]){
await p.setViewportSize({width:1710,height:987});await p.goto('http://127.0.0.1:5180/'+url);await p.waitForLoadState('networkidle');await p.screenshot({path:out+'/'+name+'.png',fullPage:true})
if(name==='dashboard'){await p.getByRole('button',{name:'Phạm vi Performance',exact:true}).click();await p.screenshot({path:out+'/source-menu.png'});await p.keyboard.press('Escape')}
await p.setViewportSize({width:360,height:800});await p.screenshot({path:out+'/'+name+'-mobile.png',fullPage:true});console.log(name,await p.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth})))
}
await b.close()
