import test from 'node:test'
import assert from 'node:assert/strict'
import { formatDataSize, displayTimeframe } from '../src/dataDisplay.js'
import { libraryDataType } from '../src/dataLibraryModel.js'
const fmt=(value,suffix='',digits=1)=>new Intl.NumberFormat('en-US',{maximumFractionDigits:digits}).format(value)+suffix

test('decimal data sizes respect unit boundaries and unknown vs zero',()=>{
 for(const value of [null,undefined,NaN,-1])assert.equal(formatDataSize(value,fmt),'—')
 assert.equal(formatDataSize(0,fmt),'0 B')
 assert.equal(formatDataSize(999,fmt),'999 B')
 assert.equal(formatDataSize(1000,fmt),'1 KB')
 assert.equal(formatDataSize(1000000,fmt),'1 MB')
 assert.equal(formatDataSize(1000000000,fmt),'1 GB')
 assert.equal(formatDataSize(1000000000000,fmt),'1 TB')
 assert.equal(formatDataSize(140930011,fmt),'140.9 MB')
 assert.equal(formatDataSize(600000000,fmt,'GB'),'0.6 GB')
})
test('saved seconds and catalog timeframes use the same trading labels without mutating metadata',()=>{
 for(const [seconds,label] of [[10,'S10'],[60,'M1'],[300,'M5'],[3600,'H1'],[14400,'H4'],[86400,'D1'],[604800,'W1']]) {
  assert.equal(displayTimeframe({timeframe:`${seconds}s`}),label)
  assert.equal(displayTimeframe({timeframe_seconds:seconds}),label)
 }
 assert.equal(displayTimeframe({timeframe:'m1'}),'M1')
 assert.equal(displayTimeframe({timeframe:'1m'}),'M1')
 assert.equal(displayTimeframe({timeframe:'4h'}),'H4')
 assert.equal(displayTimeframe({timeframe:'TICK'}),'TICK')
 assert.equal(displayTimeframe({timeframe:'custom'}),'custom')
 assert.equal(displayTimeframe({timeframe_seconds:0}),'—')
 const item={downloaded:true,timeframe:'60s',timeframe_seconds:60}
 assert.deepEqual(libraryDataType(item),{timeframe:'M1',price:undefined})
 assert.equal(item.timeframe,'60s')
})
