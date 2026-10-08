import assert from 'node:assert/strict'
import { chromium } from '../../web/node_modules/playwright/index.mjs'
import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
const baseline=process.argv.includes('--baseline'), out=new URL('./',import.meta.url)
const browser=await chromium.launch(), results=[]
try {
  for (const [theme,width] of [['dark',1710],['light',1710],['dark',360]]) {
    const context=await browser.newContext({viewport:{width,height:987}})
    await context.addInitScript(theme=>localStorage.setItem('tw-theme',theme),theme)
    await context.routeWebSocket('**/*',socket=>socket.close())
    await context.route('**/*',route=>{
      const req=route.request(), url=new URL(req.url())
      if(url.origin!=='http://127.0.0.1:5180'||!['GET','HEAD','OPTIONS'].includes(req.method())||url.pathname.startsWith('/api/v2/live'))return route.abort()
      return route.continue()
    })
    const page=await context.newPage()
    await page.goto('http://127.0.0.1:5180/?workspace=tenant-a&view=market-data&area=testing&section=market-data')
    const button=page.locator('.data-library-more').first()
    await button.waitFor(); await button.scrollIntoViewIfNeeded(); await button.hover()
    await page.waitForTimeout(170)
    const geometry=await button.evaluate(el=>{
      const a=el.getBoundingClientRect(), b=el.querySelector('svg').getBoundingClientRect(), s=getComputedStyle(el)
      return {button:{width:a.width,height:a.height},icon:{width:b.width,height:b.height},dx:(b.x+b.width/2)-(a.x+a.width/2),dy:(b.y+b.height/2)-(a.y+a.height/2),padding:s.padding}
    })
    results.push({theme,width,...geometry})
    if(!baseline){assert(Math.abs(geometry.dx)<.5,`icon horizontally displaced ${geometry.dx}`);assert(Math.abs(geometry.dy)<.5,`icon vertically displaced ${geometry.dy}`);assert.equal(geometry.button.width,geometry.button.height)}
    await button.screenshot({path:fileURLToPath(new URL(`${baseline?'before':'after'}-${theme}-${width}.png`,out))})
    await context.close()
  }
} finally {await browser.close(); await writeFile(new URL(baseline?'baseline.json':'results.json',out),JSON.stringify(results,null,2));console.log(JSON.stringify(results))}
