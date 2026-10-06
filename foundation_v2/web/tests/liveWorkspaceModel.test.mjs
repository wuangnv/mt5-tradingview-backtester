import test from 'node:test'
import assert from 'node:assert/strict'
import { LIVE_FILTERS, dealNet, filterLiveDeals, calendarWeeks, cumulativeDealSeries, summarizeDeals, dayKey } from '../src/liveWorkspaceModel.js'
const makeDeal = (ticket, time, profit, costs = {}) => ({ ticket, type: 0, symbol: 'EURUSD', time_msc: Date.parse(time), profit, commission: 0, swap: 0, fee: 0, ...costs })
const payload = { account: { account_ref: 'A', currency: 'USD' }, history_from_utc: '2026-09-30T12:00:00Z', captured_at_utc: '2026-10-06T08:00:00Z', deals: [makeDeal('1', '2026-10-04T23:30:00Z', 100, { commission: -5 }), makeDeal('2', '2026-10-05T09:00:00Z', -50, { fee: -2 }), { ...makeDeal('cash', '2026-10-04T08:00:00Z', 1000), type: 2 }] }
test('net includes every cost and excludes non-trading cashflows', () => {
 const deals = filterLiveDeals(payload)
 assert.equal(deals.length, 2);assert.equal(summarizeDeals(deals).net,43)
 assert.equal(dealNet({...deals[0], fee:undefined}),null)
 assert.equal(dealNet({...deals[0],profit:'100'}),null)
 assert.equal(summarizeDeals([],false).net,null)
})
test('filters use selected timezone and date bounds without mutating the source', () => {
 assert.equal(dayKey(payload.deals[0].time_msc,'Asia/Ho_Chi_Minh'),'2026-10-05')
 assert.equal(filterLiveDeals(payload,{...LIVE_FILTERS,timezone:'Asia/Ho_Chi_Minh',from:'2026-10-05',to:'2026-10-05'}).length,2)
 assert.equal(filterLiveDeals(payload,{...LIVE_FILTERS,outcome:'loss'}).length,1)
 assert.equal(filterLiveDeals(payload,{...LIVE_FILTERS,account:'other'}).length,0)
 assert.equal(filterLiveDeals(payload,{...LIVE_FILTERS,side:'1'}).length,0)
 assert.equal(payload.deals.length,3)
})
test('calendar distinguishes missing feed, fully covered empty day and partial cutoff', () => {
 const cells = calendarWeeks('2026-10',payload,filterLiveDeals(payload)).flat()
 assert.equal(cells.find(x=>x.key==='2026-10-01').net,0)
 assert.equal(cells.find(x=>x.key==='2026-10-06').net,null)
 assert.equal(cells.find(x=>x.key==='2026-10-04').net,95)
 assert.equal(cells.find(x=>x.key==='2026-10-05').net,-52)
 assert.ok(calendarWeeks('2026-10',null,[]).flat().every(x=>x.net===null))
 assert.ok(calendarWeeks('2026-10',{...payload,history_from_utc:null},[]).flat().every(x=>x.net===null))
})
test('unknown costs stop cumulative totals instead of bridging a misleading curve',()=> {
 const deals=filterLiveDeals(payload)
 const series=cumulativeDealSeries([deals[0],{...deals[1],fee:null},{...deals[1],time_msc:Date.parse('2026-10-06T01:00:00Z')}])
 assert.deepEqual(series.map(x=>x.value),[95,null,null])
})
