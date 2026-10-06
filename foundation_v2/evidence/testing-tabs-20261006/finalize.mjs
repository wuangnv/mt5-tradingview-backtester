import assert from 'node:assert/strict'
import { readFile,writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
const out='foundation_v2/evidence/testing-tabs-20261006/',r=JSON.parse(await readFile(out+'report.json','utf8')),v=JSON.parse(await readFile(out+'visual.json','utf8'))
assert.equal(r.pass,true);assert.equal(v.sourceUnchanged,true);assert.equal(v.blocked.length,0)
const current=await Promise.all(r.after.map(async x=>({file:x.file,sha256:createHash('sha256').update(await readFile('foundation_v2/web/src/'+x.file)).digest('hex')})));assert.deepEqual(current,r.before);assert.deepEqual(current,r.after);assert.deepEqual(current,v.before);assert.deepEqual(current,v.after)
const receipt={status:'PASS',scope:'Subheader parent/Analytics child hover,selected,keyboardfocus,icons and mobile horizontal scrolling; demo and actual local API loading',reviewer:'fx_analytics_review',at:new Date().toISOString(),matrix:{cases:r.cases.length,routes:['Sessions','Analytics'],modes:['demo','actual-local-API'],themes:['dark','light'],languages:['vi','en'],widths:[1320,768,360],analyticsChildSources:['sessions','prop']},catalogRead:r.catalog,apiReadResponses:r.responses.length,apiErrorResponses:r.responses.filter(x=>x.status>=400).length,unexpectedBlockedRequests:r.blocked.length,pageErrors:r.errors.length,demoApiRequests:r.requests.filter(x=>x.demo==='1').length,visualImages:v.images.length,sourceUnchanged:true,sourcePins:current,evidence:['report.json','visual.json','REVIEW.md'],limitations:['Local API8010 was already running with owner-reviewed historical-data serving and no MT5 synchronization. Reviewer did not start or change servers.','Actual load/GET journeys and route selection only: no financial calculation acceptance, MT5 connection, broker/execution or provider calls.','Only evidence files changed by this reviewer; no product source edit or commit.']}
await writeFile(out+'final-receipt.json',JSON.stringify(receipt,null,2))
await writeFile(out+'REVIEW.md',`# Independent subheader review — PASS

**48 browser cases passed**, covering Sessions and Analytics in demo/actual local API mode, dark/light, EN/VI, and1320/768/360px. There were0 page JS errors,0 API error responses,0 unexpected external/write requests and0 demo API requests. Six source-file hashes stayed identical through the main matrix, focused visual capture and receipt creation.

## Verified behavior

- Each parent tab reuses an18×18px icon. Tabs are52px high. Hover text is white in dark mode and uses neutral dark text in light mode; no anchor border or bright outline appears on pointer hover.
- Selected parent and Analytics child tabs use transparent background, neutral text and a matching2px underline. Dark mode text/underline is white; light mode is dark. The two Analytics sources switch between sessions and prop through their existing URL parameters. No vertical child-nav border remains.
- Keyboard Tab→focus keeps a2px solid neutral focus outline, distinct from hover. Both parent and child links remain keyboard reachable.
- At360px, the nav stays within the viewport and scrolls horizontally. The last parent tab can be revealed and focused; both Analytics child tabs can be scrolled to and activated. The action button retains its separate space. No document horizontal overflow or stuck skeleton was observed.
- The catalog read returnedHTTP200 with${r.catalog.count} existing sessions. Actual Sessions/Analytics pages loaded against the already-running local service, using the existing catalog session${r.catalog.selected}. All${r.responses.length} captured API read responses were belowHTTP400. Both Analytics source links were exercised without write requests.

## Visual review

18 focused images show parent hover, child selected and child hover in both themes at1320/768/360px. Representative images opened for visual inspection: visual-child-selected-dark-1320.png, visual-child-hover-light-360.png, visual-parent-hover-dark-768.png, demo-sessions-dark-en-1320.png and demo-analytics-dark-vi-360.png. Icons/labels and underlines align, hover has no bright border, child tabs have no dividing vertical line, and compact horizontal navigation remains usable.

## Boundaries

GET/HEAD/OPTIONS local5180/8010 traffic only, with external/write traffic and WebSockets blocked. The reviewer did not start/change a server, connect MT5, synchronize history, exercise broker/execution, edit product code or commit. The local API/history provenance comes from the owner's reviewed runtime setup; this receipt verifies UI read/loading behavior rather than data calculations or broker acceptance. Prior backend-unavailable evidence is historical and was not rerun against this running service.
`)
console.log(JSON.stringify({status:'PASS',cases:r.cases.length,apiResponses:r.responses.length,images:v.images.length,pins:current.length}))
