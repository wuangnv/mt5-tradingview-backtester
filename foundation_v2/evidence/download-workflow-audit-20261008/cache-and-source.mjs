import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {readFile,writeFile,readdir} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import {fetchRaw,originalCandles} from '../../data_worker/index.mjs'
const root = new URL('../../.runtime/exness-market-data/dukascopy/',import.meta.url)
const folder = new URL('80a707af7dc77ee1/7eea866ba94c4e53b5e4e713a78f70df/',root)
const job = JSON.parse(await readFile(new URL('job.json',folder),'utf8'))
const from = Date.parse(job.from_date+'T00:00:00Z'), DAY=86400000
const hash = v=>createHash('sha256').update(v).digest('hex')
const report = {scope:'Read-only integrity audit of owner paused cache; at most one source request after persisted cooldown. No job mutation, no API restart.',cache:{},source:{}}
const started=performance.now()
let rows=0,bytes=0,days=0
for(let index=0;index<job.total_days;index++) {
  const date=new Date(from+index*DAY),url=`https://jetta.dukascopy.com/v1/candles/minute/EUR-USD/BID/${date.getUTCFullYear()}/${date.getUTCMonth()+1}/${date.getUTCDate()}`
  const rawPath=new URL(`raw/${hash(url)}.json`,folder)
  let receipt
  try{receipt=JSON.parse(await readFile(new URL(rawPath.href+'.receipt.json'),'utf8'))}catch(error){if(error.code==='ENOENT'){report.source.url=url;report.source.date=date.toISOString().slice(0,10);break}throw error}
  const buffer=await readFile(rawPath)
  assert.equal(hash(buffer),receipt.sha256)
  const candles=originalCandles(url,buffer,from+index*DAY,from+(index+1)*DAY)
  assert.equal(candles.length,receipt.row_count)
  bytes+=buffer.length;rows+=candles.length;days++
}
report.cache={days,rows,bytes,elapsed_seconds:(performance.now()-started)/1000,receipt_files:(await readdir(new URL('raw/',folder))).filter(v=>v.endsWith('.receipt.json')).length}
assert.equal(days,job.completed_days)
if(process.argv.includes('--probe')) {
  const policy=JSON.parse(await readFile(new URL('cooldown.json',root),'utf8'))
  const remaining=Math.max(0,Math.ceil((policy.until*1000-Date.now())/1000))
  if(remaining){report.source.skipped='persisted_cooldown';report.source.retry_after_seconds=remaining}
  else {
    const attempt=performance.now()
    try {
      // One request only: no retries even if the source is temporarily unavailable.
      const buffer=await fetchRaw(report.source.url,fetch,()=>{},{canRetry:()=>false})
      const day=Date.parse(report.source.date+'T00:00:00Z')
      report.source={...report.source,http_status:200,bytes:buffer.length,rows:originalCandles(report.source.url,buffer,day,day+DAY).length}
    }catch(error){report.source={...report.source,error:error.message,...error.diagnostic,retry_seconds:error.retryAfter}}
    report.source.elapsed_seconds=(performance.now()-attempt)/1000
    report.source.checked_at_utc=new Date().toISOString()
  }
}
await writeFile(new URL(process.argv.includes('--probe')?'source-probe.json':'cache-audit.json',import.meta.url),JSON.stringify(report,null,2))
console.log(JSON.stringify(report))
