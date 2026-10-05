import assert from 'node:assert/strict'
import {readFile,writeFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
const dir='.artifacts/fx-trades-demo-layout-20261005/independent-review/'
const comprehensive=JSON.parse(await readFile(dir+'browser-attempt1.json','utf8')),focused=JSON.parse(await readFile(dir+'focused-attempt2.json','utf8')),simulation=JSON.parse(await readFile(dir+'focused.json','utf8'))
const hashes=await Promise.all(comprehensive.after.map(async({file})=>({file,sha256:createHash('sha256').update(await readFile(file)).digest('hex')})))
const changes=hashes.filter(row=>comprehensive.after.find(prior=>prior.file===row.file)?.sha256!==row.sha256).map(row=>row.file)
assert.deepEqual(changes,['foundation_v2/web/src/DemoPreview.jsx'])
assert.ok(focused.sourceUnchanged&&simulation.sourceUnchanged&&simulation.pass)
assert.equal(focused.checks.length,13)
assert.deepEqual(focused.failures.map(row=>row.name),['demo-analytics-report-tabs-simulation'])
assert.equal(comprehensive.preserved.wholePayloadEqual,true)
assert.equal(comprehensive.errors.length+comprehensive.blocked.length+focused.errors.length+focused.blocked.length+simulation.errors.length+simulation.blocked.length,0)
assert.equal(comprehensive.apiRequests.filter(row=>row.mode==='1').length+focused.api.filter(row=>row.demo==='1').length+simulation.api.filter(row=>row.demo==='1').length,0)
const result={status:'SCOPED_PASS',evidenceComposition:'Frozen comprehensive observations plus corrected focused reruns; raw failing attempts retained without changing their outcome',finalHashes:hashes,changesAfterComprehensive:changes,actualGutterCases:56,demoGutterCases:56,actualOracle:comprehensive.oracle,preserved:comprehensive.preserved,zeroRuntimeErrors:true,zeroBlockedWritesDownloadsExternalRequests:true,zeroApiReadsInSupportedDemoRoutes:true,rawAttempts:[{file:'browser-attempt1.json',exit:1,issues:'4 wrong Settings selectors; 1 invalid cursor fixture; 3 Journal contrast failures fixed in product and rechecked'},{file:'focused-attempt1.json',exit:1,issues:'Invalid cursor fixture and wrong role selector for report tab; Settings and Journal/LiveNotes rechecks passed'},{file:'focused-attempt2.json',exit:1,issues:'Restore, Settings and Journal/LiveNotes pass; only incorrect expectation that local demo report tab changes real URL failed'},{file:'focused.json',exit:0,issues:'Corrected preview URL oracle; Drawdown/Simulation/config/disabled SL/RR/local Monte Carlo/a11y pass with unchanged source'}],limits:['Prop reports actual inventory is empty; demo objectives/report are presentation fixtures only','No broker/provider/execution/import/download/export/DB write/native zoom/canonical golden/full product acceptance','Chart/order workspaces intentionally excluded from shared report gutter contract']}
await writeFile(dir+'summary.json',JSON.stringify(result,null,2));console.log(JSON.stringify({status:result.status,hashes:hashes.length,changes,actual:result.actualGutterCases,demo:result.demoGutterCases}))
