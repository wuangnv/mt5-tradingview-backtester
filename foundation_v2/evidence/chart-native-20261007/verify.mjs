import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from '../../web/node_modules/playwright/index.mjs';
const out=path.dirname(fileURLToPath(import.meta.url));const root=path.resolve(out,'../../..');
const url='http://127.0.0.1:5180/?workspace=tenant-a&view=replay&session=476f4b498e1a49ed9d48a75719f4d270&dataset=dataset-262639d819219431b8bbfd00a665d4fb7fde4c646a4fa0c5020608c1e1c3572d&mode=Practice&surface=workspace&cursor=500';
const browser=await chromium.launch({headless:true});const checks=[],errors=[],blocked=[];
try{
for(const width of [1710,768,390]){
const context=await browser.newContext({viewport:{width,height:987}});
await context.route('**/*',async route=>{const r=route.request(),u=new URL(r.url());if(!['GET','HEAD','OPTIONS'].includes(r.method())||!['http://127.0.0.1:5180','http://127.0.0.1:8010'].includes(u.origin)){blocked.push({method:r.method(),path:u.pathname});return route.abort()}
if(u.pathname.endsWith('charting_library.standalone.js')){const response=await route.fetch();return route.fulfill({response,body:await response.text()+`;window.TradingView.widget=new Proxy(window.TradingView.widget,{construct(Target,args){const result=new Target(...args);window.__qaWidget=result;window.__qaOptions=args[0];return result}});`})}return route.continue()});
const page=await context.newPage();page.on('pageerror',e=>errors.push(String(e)));page.setDefaultTimeout(20000);
const ready=async()=>{await page.locator('[data-chart-status="ready"]').waitFor();await page.waitForFunction(()=>!!window.__qaWidget);};
const state=()=>page.evaluate(()=>new Promise(resolve=>window.__qaWidget.save(resolve)));
const assertPalette=async theme=>{const layout=await state();const chart=layout.charts[0];const series=chart.panes.flatMap(p=>p.sources).find(s=>s.type==='MainSeries').state;const color=series.candleStyle;assert.equal(color.upColor.toUpperCase(),'#26A69A');assert.equal(color.downColor.toUpperCase(),'#EF5350');assert.equal(chart.chartProperties.paneProperties.background.toUpperCase(),theme==='dark'?'#131722':'#FFFFFF');assert.equal(await page.evaluate(()=>window.__qaOptions.disabled_features.includes('widget_logo')),true);return layout};
await page.goto(url);await ready();await assertPalette('dark');const frame=page.frames().find(f=>f!==page.mainFrame());await page.screenshot({path:path.join(out,`native-dark-${width}.png`)});checks.push(`${width}: actual dark native candles/background and widget_logo disabled`);
// Save an old project-colored layout with a Volume study to prove restore repaints existing styles.
await page.evaluate(async()=>{const chart=window.__qaWidget.activeChart();if(!chart.getAllStudies().some(s=>s.name==='Volume'))await chart.createStudy('Volume',false,false);window.__qaWidget.applyOverrides({'mainSeriesProperties.candleStyle.upColor':'#9BAC96','mainSeriesProperties.candleStyle.downColor':'#D79A96','paneProperties.background':'#171C20'});for(const s of chart.getAllStudies())if(s.name==='Volume')chart.getStudyById(s.id).applyOverrides({'volume.color.0':'#D79A96','volume.color.1':'#9BAC96'});});
const shapesBefore=await page.evaluate(()=>{const chart=window.__qaWidget.activeChart();chart.createShape({time:Number(document.querySelector('[data-testid="replay-chart"]').dataset.cutoff),price:1.1429},{shape:'horizontal_line'});return chart.getAllShapes().length});
const old=await state();const interval=old.charts[0].panes.flatMap(p=>p.sources).find(s=>s.type==='MainSeries').state.interval;await page.evaluate(layout=>{const host=document.querySelector('[data-testid="replay-chart"]');const key='tw:advanced-chart:v1:tenant-a:476f4b498e1a49ed9d48a75719f4d270:dataset-262639d819219431b8bbfd00a665d4fb7fde4c646a4fa0c5020608c1e1c3572d';localStorage.setItem(key,JSON.stringify([{version:1,cutoff:Number(host.dataset.cutoff),layout}]))},old);await page.reload();await ready();const restored=await assertPalette('dark');assert.equal(await page.evaluate(()=>window.__qaWidget.activeChart().getAllShapes().length),shapesBefore);const main=restored.charts[0].panes.flatMap(p=>p.sources).find(s=>s.type==='MainSeries');assert.equal(main.state.interval,interval);await writeFile(path.join(out,'layout.json'),JSON.stringify(restored,null,2));const volume=restored.charts[0].panes.flatMap(p=>p.sources).find(s=>s.metaInfo?.description==='Volume');assert.ok(volume,'Volume persisted');assert.equal(volume.state.palettes.volumePalette.colors[0].color.toUpperCase(),'#EF5350');assert.equal(volume.state.palettes.volumePalette.colors[1].color.toUpperCase(),'#26A69A');
checks.push(`${width}: saved layout restores native colors and keeps interval/drawing/Volume`);
const currentFrame=page.frames().find(f=>f!==page.mainFrame());let toggle=currentFrame.getByTestId('theme-toggle');if(!await toggle.isVisible())toggle=page.locator('.legacy-mobile-theme');await toggle.click();await page.waitForFunction(()=>document.querySelector('.fx-app').dataset.theme==='light');await page.waitForFunction(()=>!document.querySelector('iframe').contentDocument.documentElement.classList.contains('theme-dark'));await assertPalette('light');await page.reload();await ready();await assertPalette('light');await page.screenshot({path:path.join(out,`native-light-${width}.png`)});checks.push(`${width}: theme toggle/reload native light`);
await context.close();
}
assert.deepEqual(errors,[]);await writeFile(path.join(out,'report.json'),JSON.stringify({status:'PASS',checks,errors,blocked},null,2));console.log(JSON.stringify({status:'PASS',checks:checks.length,errors,blocked:blocked.length}));
}finally{await browser.close()}
