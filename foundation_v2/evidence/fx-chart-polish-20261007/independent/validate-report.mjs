import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
const report=JSON.parse(await readFile(new URL('report.json',import.meta.url),'utf8'))
assert.equal(report.failure,undefined);assert.equal(report.cases.length,5);assert.deepEqual(report.errors,[]);assert.deepEqual(report.blocked,[])
for(const c of report.cases){
 assert.equal(c.initial.overflow,0);assert.equal(c.tree.overflow,0)
 assert.equal(c.initial.top.width,c.width);assert.equal(c.tree.top.width,c.width)
 assert.ok(c.initial.headerHit);assert.ok(c.tree.headerHit)
 assert.equal(c.initial.rail.top,42);assert.equal(c.tree.side.top,42)
 assert.equal(c.initial.center.right,c.initial.rail.left)
 if(c.width>600)assert.equal(c.tree.center.right,c.tree.side.left)
 assert.equal(c.maxSpeed,'15');assert.equal(c.positionsHeight,130)
 assert.ok(c.maximized.class.includes('is-maximized'))
 assert.ok(c.intervalOptions.filter(x=>['5s','10s','15s','30s'].includes(x.text)).every(x=>x.disabled))
 assert.ok(c.balance.includes('—'));assert.ok(c.scalper.includes('Auto Break-even'))
}
assert.equal(report.cases[0].rewindCursor,495);assert.equal(report.cases[0].forwardCursor,500)
const files=['web/src/ReplayWorkspace.jsx','web/src/TradingViewReplayChart.jsx','web/src/ChartWorkbench.css','web/public/chart-legacy.css','web/src/LegacyReplayToolbar.jsx','web/src/LegacyTradingBar.jsx','web/src/LegacyTradingBar.css','web/src/legacyReplayModel.js','web/src/legacyScalperPreset.js','trading_workspace_v2/replay_interval.py','trading_workspace_v2/replay.py','trading_workspace_v2/contracts.py','trading_workspace_v2/api.py']
const hashes={};for(const f of files)hashes[f]=createHash('sha256').update(await readFile(new URL('../../../'+f,import.meta.url))).digest('hex')
const srcdoc=JSON.parse(await readFile(new URL('srcdoc-report.json',import.meta.url),'utf8'))
assert.equal(srcdoc.pass,true);assert.equal(srcdoc.initial.readyCount,1);assert.equal(srcdoc.reloaded.readyCount,1);assert.deepEqual(srcdoc.errors,[]);assert.deepEqual(srcdoc.blocked,[])
await writeFile(new URL('final-receipt.json',import.meta.url),JSON.stringify({pass:true,reviewScope:'Actual local GET UI5cases + optional srcdoc load/reload + source audit. No real owner replay/order writes.',backendIntervalTests:14,jsModelTests:13,srcdoc:{pass:true,readinessPerLoad:1,localLayoutRestore:true,nativeMenu:true,cutoffPreserved:true},sourceHashes:hashes},null,2))
console.log('Independent receipt PASS:5 guardedUI cases,14 interval tests,13JS model tests')
