import assert from 'node:assert/strict'
import {writeFile} from 'node:fs/promises'
import {sampleDownloadMetrics,downloadEtaDuration} from '../../../web/src/dataLibraryDownloadMetrics.js'
const base={status:'running',stage:'downloading',total_days:100,from_date:'2026-01-01',to_date:'2026-04-10'},checks=[]
let state
const step=(time,bytes,days,extra={})=>{const r=sampleDownloadMetrics(state,{...base,transferred_bytes:bytes,completed_days:days,...extra},time);state=r.state;return r.metrics}
let m=step(0,100,0);assert.equal(m.bytes_per_second,null);assert.equal(m.estimated_seconds_remaining,null)
m=step(2000,300,1);assert.equal(m.bytes_per_second,100);assert.equal(m.estimated_seconds_remaining,null)
m=step(10000,1100,5);assert.equal(m.bytes_per_second,100);assert.equal(m.estimated_seconds_remaining,190);checks.push('Warmup waits10s and3 days; ETA uses remaining days divided by recent day rate')
m=step(18000,1100,5);assert.equal(m.bytes_per_second,1000/18);assert.equal(m.estimated_seconds_remaining,342)
m=step(26000,1100,5);assert.equal(m.estimated_seconds_remaining,null);checks.push('ETA becomes unknown after more than15s without day advance; byte speed is rolling average')
m=step(28000,1100,5,{status:'paused'});assert.equal(m.bytes_per_second,null);assert.equal(m.estimated_seconds_remaining,null)
m=step(30000,1100,5);assert.equal(m.bytes_per_second,null);assert.equal(m.estimated_seconds_remaining,null);checks.push('Pause/resume signature resets warmup instead of counting paused time')
m=step(40000,2100,10);assert.equal(m.estimated_seconds_remaining,180)
m=step(50001,3100,15);assert.equal(m.bytes_per_second,null);assert.equal(m.estimated_seconds_remaining,null);checks.push('Polling gap>10s resets samples')
m=step(52000,10,1);assert.equal(m.bytes_per_second,null);assert.equal(m.estimated_seconds_remaining,null)
m=step(51000,10,1);assert.equal(m.bytes_per_second,null);assert.equal(m.estimated_seconds_remaining,null);checks.push('Byte/day rollback and non-monotonic clock reset samples')
state=undefined;step(0,100,0);m=step(10000,100,5);assert.equal(m.bytes_per_second,0);assert.equal(m.estimated_seconds_remaining,190);checks.push('Cached-day progress permits ETA with measured0 byte/s; zero is a valid rate')
m=step(12000,100,6,{stage:'processing'});assert.equal(m.bytes_per_second,null);assert.equal(m.estimated_seconds_remaining,null)
m=step(14000,100,6,{status:'failed'});assert.equal(m.estimated_seconds_remaining,null);checks.push('Processing/error states expose no transfer ETA')
state=undefined;step(0,0,0);m=step(10000,100,3,{total_days:0});assert.equal(m.estimated_seconds_remaining,null);checks.push('Unknown total calendar days do not produce ETA')
state=undefined;for(let time=0;time<=40000;time+=5000)m=step(time,time,time/5000);assert.equal(state.samples[0].time,10000);assert.equal(m.bytes_per_second,1000);checks.push('Rolling window retains at most30s of sample history')
for(const value of [undefined,null,0,-1,Infinity,NaN])assert.equal(downloadEtaDuration(value),null)
for(const [seconds,count,unit] of [[.2,1,'duration.second'],[59,59,'duration.second'],[60,1,'duration.minute'],[61,2,'duration.minute'],[3600,1,'duration.hour'],[86400,1,'duration.day']])assert.deepEqual(downloadEtaDuration(seconds),{count,unit});checks.push('Duration rejects unknown/nonpositive values and rounds estimates upward with units')
await writeFile(new URL('./metrics-results.json',import.meta.url),JSON.stringify({pass:true,checks},null,2));console.log(JSON.stringify({pass:true,checks}))
