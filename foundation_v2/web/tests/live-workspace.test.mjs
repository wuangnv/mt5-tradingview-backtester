import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
const source=fs.readFileSync('src/LiveWorkspace.jsx','utf8'), surfaces=fs.readFileSync('src/LiveSurfaces.jsx','utf8'), css=fs.readFileSync('src/live-workspace.css','utf8'), demo=fs.readFileSync('src/DemoPreview.jsx','utf8')
test('Live reads workspace-local snapshots and preview does not call the reader',()=>{
 assert.match(source,/X-Workspace-Id/);assert.match(source,/method: 'GET'/);assert.match(source,/if \(preview\) return/)
 assert.doesNotMatch(source+surfaces,/OrderSend|submitLive|\/api\/trade\/send|method: 'POST'/)
 assert.match(demo,/<LiveWorkspace[^>]+preview=\{DEMO_LIVE\}/)
})
test('Live retains stale snapshots but clears data when access is denied',()=>{
 assert.match(source,/error.kind === 'denied' \|\| previous.workspace !== workspace \? null/)
 assert.match(source,/stale: true/);assert.match(source,/payload.status === 'ready' \? payload : null/)
 assert.match(source,/response.status === 404 \|\| response.status === 501/)
 assert.match(source,/TestingSkeleton/);assert.match(surfaces,/live-empty/)
})
test('Live shares every reference surface with labeled local previews and responsive layouts',()=>{
 for(const section of ['calendar','trades','notes','tag-analytics','analytics','trading-accounts']) assert.ok(source.includes(section))
 assert.match(surfaces,/showModal\(\)/);assert.match(surfaces,/Changes are not saved/)
 assert.match(css,/@media \(max-width: 760px\)/);assert.match(css,/@media \(max-width: 480px\)/);assert.match(css,/prefers-reduced-motion/)
 assert.doesNotMatch(css,/gradient\(|backdrop-filter|framer-motion/i)
})
