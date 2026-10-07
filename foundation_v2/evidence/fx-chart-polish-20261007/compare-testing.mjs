import { chromium } from '../../web/node_modules/playwright/index.mjs'
import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
const browser=await chromium.launch({headless:true})
try {
 const page=await browser.newPage({viewport:{width:1710,height:987}})
 await page.route('**/*',r=>['GET','HEAD'].includes(r.request().method()) && new URL(r.request().url()).hostname==='127.0.0.1' ? r.continue() : r.abort())
 await page.goto('http://127.0.0.1:5180/?workspace=tenant-a&view=overview&area=testing&section=dashboard')
 await page.locator('.fx-dashboard-session-card').first().waitFor()
 const selectors=['.fx-app','.fx-select-trigger','.fx-dashboard-card-summary','.fx-dashboard-card-play']
 const styles=await page.evaluate(selectors=>selectors.map(selector=>{const e=document.querySelector(selector),s=e&&getComputedStyle(e);return {selector,font:s?.fontFamily,size:s?.fontSize,line:s?.lineHeight,radius:s?.borderRadius,height:e?.getBoundingClientRect().height,transition:s?.transition,focus:s?.getPropertyValue('--wm-focus'),hover:s?.getPropertyValue('--wm-hover')}}),selectors)
 await writeFile(new URL('testing-comparison.json',import.meta.url),JSON.stringify(styles,null,2))
 await page.screenshot({path:fileURLToPath(new URL('testing-reference-1710.png',import.meta.url))})
 console.log(styles)
} finally {await browser.close()}
