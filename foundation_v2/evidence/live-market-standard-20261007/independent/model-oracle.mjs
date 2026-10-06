import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { ready, empty, missingCost, invalidProfit, invalidTime, expected } from './fixtures.mjs'
import { LIVE_FILTERS, dealNet, dayKey, filterLiveDeals, summarizeDeals, calendarWeeks, cumulativeDealSeries } from '../../../web/src/liveWorkspaceModel.js'

const target = 'foundation_v2/web/src/liveWorkspaceModel.js'
const pin = async () => createHash('sha256').update(await readFile(target)).digest('hex')
const report = { stage: process.env.LIVE_DIAGNOSTIC ? 'diagnostic-not-acceptance' : 'frozen-model-oracle', cases: [], failures: [], before: await pin() }
function check(name, fn) { try { fn(); report.cases.push({ name, pass: true }) } catch (error) { report.failures.push({ name, error: String(error) }) } }
check('net includes all four cost components and excludes cashflow', () => assert.deepEqual(summarizeDeals(filterLiveDeals(ready)), { count: 3, net: expected.net }))
check('UTC boundary separates adjacent days', () => { assert.equal(dayKey(ready.deals[0].time_msc), '2026-10-04'); assert.equal(dayKey(ready.deals[1].time_msc), '2026-10-05') })
check('chosen timezone shifts calendar day consistently', () => assert.equal(dayKey(ready.deals[0].time_msc, 'Asia/Ho_Chi_Minh'), '2026-10-05'))
check('entry commission participates in losses', () => assert.deepEqual(filterLiveDeals(ready, { ...LIVE_FILTERS, outcome: 'loss' }).map(row => row.ticket), ['qa-utc-after', 'qa-entry-cost']))
check('side and asset filter original broker fields', () => assert.deepEqual(filterLiveDeals(ready, { ...LIVE_FILTERS, asset: 'EURUSD', side: '0' }).map(row => row.ticket), ['qa-utc-before', 'qa-entry-cost']))
check('account mismatch produces no selected deals', () => assert.deepEqual(filterLiveDeals(ready, { ...LIVE_FILTERS, account: 'other-workspace' }), []))
check('date range inclusive with UTC weekday', () => assert.deepEqual(filterLiveDeals(ready, { ...LIVE_FILTERS, from: '2026-10-05', to: '2026-10-05', day: '1' }).map(row => row.ticket), ['qa-utc-after', 'qa-entry-cost']))
check('missing fee leaves net unknown', () => { assert.equal(dealNet(missingCost.deals[0]), null); assert.equal(summarizeDeals(missingCost.deals).net, null) })
check('string profit is not silently coerced', () => assert.equal(dealNet(invalidProfit.deals[0]), null))
check('missing timestamp has no inferred calendar date', () => assert.equal(dayKey(invalidTime.deals[0].time_msc), ''))
check('no-feed summary remains unknown', () => assert.deepEqual(summarizeDeals([], false), { count: null, net: null }))
check('ready empty summary has zero known deals', () => assert.deepEqual(summarizeDeals(empty.deals), { count: 0, net: 0 }))
check('calendar known UTC buckets and future/edge unknown', () => {
  const cells = calendarWeeks('2026-10', ready, filterLiveDeals(ready)).flat(), cell = key => cells.find(row => row.key === key)
  for (const [key, value] of Object.entries(expected.daily)) { assert.equal(cell(key).count, value.count); assert.equal(cell(key).net, value.net) }
  assert.equal(cell('2026-10-06').net, 0); assert.equal(cell('2026-10-08').net, null); assert.equal(cell('2026-10-01').net, null)
})
check('no feed calendar never asserts zero P/L', () => assert.ok(calendarWeeks('2026-10', null, []).flat().every(row => row.net === null && row.count === null)))
check('calendar includes weekday Monday first and adjacent dates', () => { const cells = calendarWeeks('2026-10', ready, ready.deals); assert.equal(cells[0][0].key, '2026-09-28'); assert.equal(cells[4][6].key, '2026-11-01') })
check('cumulative realized net series chronological', () => assert.deepEqual(cumulativeDealSeries([...ready.deals].reverse()).map(row => row.value), [95, 41, 38]))
check('unknown cost keeps subsequent cumulative result unknown', () => assert.deepEqual(cumulativeDealSeries([...missingCost.deals, ready.deals[1]]).map(row => row.value), [null, null]))
report.after = await pin(); report.sourceUnchanged = report.before === report.after
report.pass = report.failures.length === 0 && report.sourceUnchanged
await writeFile('foundation_v2/evidence/live-market-standard-20261007/independent/model-oracle' + (process.env.LIVE_DIAGNOSTIC ? '-diagnostic' : '') + '.json', JSON.stringify(report, null, 2))
console.log(JSON.stringify({ pass: report.pass, stage: report.stage, cases: report.cases.length, failures: report.failures, sourceUnchanged: report.sourceUnchanged }))
if (!report.pass) process.exitCode = 1
