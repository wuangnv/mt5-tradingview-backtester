import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { download, originalCandles, fetchRaw } from '../index.mjs'

const start = Date.parse('2026-01-05T00:00:00Z')
const url = 'https://jetta.dukascopy.com/v1/candles/minute/EUR-USD/BID/2026/1/5'
const raw = {timestamp:start,multiplier:0.00001,shift:60000,open:1.1,high:1.1,low:1.1,close:1.1,
  times:[0,2],opens:[0,0],highs:[0,0],lows:[0,0],closes:[0,0],volumes:[1,0]}

test('only source timestamps survive; original zero-volume candles are kept', () => {
  const rows = originalCandles(url,Buffer.from(JSON.stringify(raw)),start,start+86400000)
  assert.equal(rows.length,2)
  assert.deepEqual(rows.map(row => row[0]),[start,start+120000])
  assert.equal(rows[1][5],0)
})
test('bad deltas, duplicate times, wrong bucket and impossible OHLC fail closed', () => {
  for (const data of [{...raw,times:[0,0]}, {...raw,times:[0,Infinity]}, {...raw,timestamp:start+60000}, {...raw,high:1}, {...raw,opens:[0]}]) {
    assert.throws(() => originalCandles(url,Buffer.from(JSON.stringify(data)),start,start+86400000))
  }
})
test('429 is explicit with cooldown, redirects and oversized bodies are not data', async () => {
  let calls = 0
  await assert.rejects(fetchRaw(url,async () => { calls++; return new Response('',{status:429,headers:{'retry-after':'600'}}) }),error => error.message === 'source_rate_limited' && error.retryAfter === 600)
  assert.equal(calls,1)
  await assert.rejects(fetchRaw(url,async () => new Response('',{status:302})),/source_unavailable/)
  await assert.rejects(fetchRaw(url,async () => new Response('x'.repeat(2*1024*1024+1))),/invalid_source_data/)
  await assert.rejects(fetchRaw('https://example.com/',async () => { throw Error('should never run') }),/invalid_source_url/)
})

test('temporary transport and 503 failures retry the same bucket; persistent and 429 errors stop', async () => {
  for (const failure of [() => { throw new TypeError('network offline') }, () => new Response('',{status:503})]) {
    let calls = 0
    const waits = []
    const result = await fetchRaw(url,async () => ++calls < 3 ? failure() : new Response(JSON.stringify(raw)),()=>{},{sleepFn:async ms=>waits.push(ms)})
    assert.deepEqual(JSON.parse(result.toString()),raw)
    assert.equal(calls,3)
    assert.deepEqual(waits,[1000,2000])
  }
  let calls = 0
  await assert.rejects(fetchRaw(url,async()=>{ calls++;throw new TypeError('offline') },()=>{},{sleepFn:async()=>{}}),error=>error.message==='source_unavailable'&&error.diagnostic.attempts===3&&error.diagnostic.url===url)
  assert.equal(calls,3)
  for (const status of [429,403,404,302]) {
    calls = 0
    await assert.rejects(fetchRaw(url,async()=>{calls++;return new Response('',{status})},()=>{},{sleepFn:async()=>assert.fail('must not retry')}),error=>error.diagnostic.http_status===status&&error.diagnostic.attempts===1)
    assert.equal(calls,1)
  }
})

test('transient retries honor Retry-After without sleeping through a long server cooldown', async () => {
  let calls = 0
  const waits = []
  await fetchRaw(url,async()=>++calls===1?new Response('',{status:503,headers:{'retry-after':'3'}}):new Response(JSON.stringify(raw)),()=>{},{sleepFn:async ms=>waits.push(ms)})
  assert.deepEqual(waits,[3000])
  calls = 0
  await assert.rejects(fetchRaw(url,async()=>{calls++;return new Response('',{status:503,headers:{'retry-after':'120'}})},()=>{},{sleepFn:async()=>assert.fail('leave long cooldown to the API')}),error=>error.retryAfter===120)
  assert.equal(calls,1)
})

test('AWS WAF challenge is distinct from throttling/network errors and never retried automatically', async () => {
  for(const [status,action] of [[202,'challenge'],[405,'captcha'],[429,'challenge']]) {
    let calls=0
    await assert.rejects(fetchRaw(url,async()=>{calls++;return new Response('',{status,headers:{'x-amzn-waf-action':action,'server':'CloudFront'}})},()=>{},{sleepFn:async()=>assert.fail('access challenge must stop')}),error=>error.message==='source_access_challenge'&&error.diagnostic.waf_action===action&&error.diagnostic.http_status===status)
    assert.equal(calls,1)
  }
})

test('CLI persists bounded source diagnostics and never labels HTTP errors as empty successful days', async () => {
  const root=await mkdtemp(join(tmpdir(),'tw-dukascopy-diagnostic-'))
  try {
    const request=join(root,'request.json')
    await writeFile(request,JSON.stringify({instrument_id:'EUR/USD',from_date:'2026-01-05',to_date:'2026-01-05'}))
    const preload='data:text/javascript,'+encodeURIComponent("globalThis.fetch=async()=>new Response('',{status:429,headers:{'retry-after':'600','server':'fixture','set-cookie':'must-not-log'}})")
    let failure
    try {await promisify(execFile)(process.execPath,['--import',preload,fileURLToPath(new URL('../index.mjs',import.meta.url)),request])} catch(error) {failure=error}
    assert.equal(failure.code,1)
    assert.equal(JSON.parse(failure.stdout.trim()).error,'source_rate_limited')
    const diagnostic=JSON.parse(await readFile(join(root,'last-source-error.json'),'utf8'))
    assert.equal(diagnostic.http_status,429);assert.equal(diagnostic.url,url);assert.equal(diagnostic.retry_after,'600');assert.equal(diagnostic.attempts,1)
    assert(!JSON.stringify(diagnostic).includes('must-not-log'))
    await assert.rejects(readFile(join(root,'candles.csv')),error=>error.code==='ENOENT')
  } finally {await rm(root,{recursive:true,force:true})}
})

test('persisted pacing controls network batches, while cached resume has no artificial pause', async () => {
  const root = await mkdtemp(join(tmpdir(),'tw-dukascopy-paced-'))
  try {
    const request = join(root,'request.json')
    const input = {instrument_id:'EUR/USD',from_date:'2026-01-05',to_date:'2026-01-08',pacing:{concurrency:1,pause_ms:4000}}
    await writeFile(request,JSON.stringify(input))
    const waits=[],calls=[]
    await download(request,{notify:()=>{},sleepFn:async ms=>waits.push(ms),fetchFn:async url=>{
      const day=Number(url.split('/').at(-1));calls.push(day)
      return new Response(JSON.stringify({...raw,timestamp:start+(day-5)*86400000}))
    }})
    assert.deepEqual(calls,[5,6,7,8]);assert.deepEqual(waits,[4000,4000,4000])
    const csv=await readFile(join(root,'candles.csv'),'utf8')
    await writeFile(request,JSON.stringify({...input,completed_days:4}))
    const events=[]
    await download(request,{notify:event=>events.push(event),fetchFn:async()=>assert.fail('cached buckets must not refetch'),sleepFn:async()=>assert.fail('cached batches must not wait')})
    assert(events.filter(event=>event.event==='progress').every(event=>event.completed_days===4&&event.network_days===0),'cached resume must retain saved progress without estimating network throughput')
    assert.equal(await readFile(join(root,'candles.csv'),'utf8'),csv)
    for (const pacing of [{concurrency:0,pause_ms:4000},{concurrency:1,pause_ms:-1},{concurrency:1,pause_ms:30001}]) {
      await writeFile(request,JSON.stringify({...input,pacing}))
      await assert.rejects(download(request,{fetchFn:async()=>assert.fail('invalid pacing must not fetch'),notify:()=>{}}),/invalid_concurrency|invalid_pause/)
    }
  } finally {await rm(root,{recursive:true,force:true})}
})

test('a failed batch honors the longest Retry-After and never sleeps or schedules another batch', async () => {
  const root = await mkdtemp(join(tmpdir(),'tw-dukascopy-backoff-'))
  try {
    const request = join(root,'request.json')
    await writeFile(request,JSON.stringify({instrument_id:'EUR/USD',from_date:'2026-01-05',to_date:'2026-01-10'}))
    let calls=0
    await assert.rejects(download(request,{notify:()=>{},sleepFn:async()=>assert.fail('429 must stop'),fetchFn:async()=>{
      calls++
      return new Response('',{status:429,headers:{'retry-after':String(1200/calls)}})
    }}),error=>error.message==='source_rate_limited'&&error.retryAfter===1200)
    assert.equal(calls,3)
  } finally {await rm(root,{recursive:true,force:true})}
})
test('resume reuses raw checksummed completed buckets and refuses tampering', async () => {
  const root = await mkdtemp(join(tmpdir(),'tw-dukascopy-'))
  try {
    const request = join(root,'request.json')
    await writeFile(request,JSON.stringify({instrument_id:'EUR/USD',from_date:'2026-01-05',to_date:'2026-01-05'}))
    let calls=0
    const events=[]
    const fetchFn=async () => { calls++; return new Response(JSON.stringify(raw)) }
    assert.equal(await download(request,{fetchFn,notify:event=>events.push(event),pauseMs:0}),2)
    assert.equal(await download(request,{fetchFn,notify:()=>{},pauseMs:0}),2)
    assert.equal(calls,1)
    assert.equal(events.at(-1).event,'complete')
    const csv=await readFile(join(root,'candles.csv'),'utf8')
    assert.equal(csv.trim().split('\n').length,3)
    const receipt=JSON.parse(await readFile(join(root,'buckets.json'),'utf8'))
    await writeFile(join(root,Object.values(receipt.buckets)[0].file),'bad')
    await assert.rejects(download(request,{fetchFn,notify:()=>{},pauseMs:0}),/invalid_source_data/)
    assert.equal(calls,1)
  } finally { await rm(root,{recursive:true,force:true}) }
})

test('multi-year M1 range is bounded by real metadata and UTC, with actual bytes separated from cache', async () => {
  const root = await mkdtemp(join(tmpdir(),'tw-dukascopy-full-'))
  try {
    const request = join(root,'request.json')
    const input = {instrument_id:'EUR/USD',from_date:'2025-01-01',to_date:'2026-01-02',transferred_bytes:100}
    await writeFile(request,JSON.stringify(input))
    let calls=0, actualBytes=0
    const events=[]
    const fetchFn=async url => {
      calls++
      const parts=url.split('/').slice(-3).map(Number)
      const body=JSON.stringify({...raw,timestamp:Date.UTC(parts[0],parts[1]-1,parts[2])})
      actualBytes+=Buffer.byteLength(body)
      return new Response(body)
    }
    assert.equal(await download(request,{fetchFn,notify:event=>events.push(event),pauseMs:0}),734)
    assert.equal(calls,367)
    assert.equal(events.at(-1).transferred_bytes,100+actualBytes)
    assert.equal(events.at(-1).cached_bytes,0)
    assert.equal(events.at(-1).stage,'processing')
    await writeFile(request,JSON.stringify({...input,transferred_bytes:100+actualBytes}))
    const resumed=[]
    assert.equal(await download(request,{fetchFn:async()=>assert.fail('cache must avoid network'),notify:event=>resumed.push(event),pauseMs:0}),734)
    assert.equal(resumed.at(-1).transferred_bytes,100+actualBytes)
    assert.equal(resumed.at(-1).cached_bytes,actualBytes)
    for (const dates of [{from_date:'2000-01-01',to_date:'2000-01-02'},{from_date:'2026-02-30',to_date:'2026-03-02'},{from_date:'2099-01-01',to_date:'2099-01-02'}]) {
      await writeFile(request,JSON.stringify({...input,...dates}))
      await assert.rejects(download(request,{fetchFn:async()=>assert.fail('invalid date must not fetch'),notify:()=>{},pauseMs:0}),/invalid_date_range/)
    }
  } finally {await rm(root,{recursive:true,force:true})}
})

test('interrupted multi-day download resumes checksummed per-bucket receipts before final index exists', async () => {
  const root=await mkdtemp(join(tmpdir(),'tw-dukascopy-paused-'))
  try {
    const request=join(root,'request.json')
    await writeFile(request,JSON.stringify({instrument_id:'EUR/USD',from_date:'2026-01-05',to_date:'2026-01-06'}))
    let calls=0
    await assert.rejects(download(request,{fetchFn:async()=>{calls++; return calls===1 ? new Response(JSON.stringify(raw)) : new Response('',{status:429})},notify:()=>{},pauseMs:0}),/source_rate_limited/)
    const body=JSON.stringify({...raw,timestamp:start+86400000})
    const events=[]
    assert.equal(await download(request,{fetchFn:async()=>{calls++; return new Response(body)},notify:event=>events.push(event),pauseMs:0}),4)
    assert.equal(calls,3,'completed first bucket must be cached after interruption')
    assert.equal(events.at(-1).cached_bytes,Buffer.byteLength(JSON.stringify(raw)))
    assert.equal(events.at(-1).transferred_bytes,Buffer.byteLength(body))
  } finally {await rm(root,{recursive:true,force:true})}
})

test('empty and one-bar update tails are allowed only when parent is identified; first download stays min-two', async () => {
  const root=await mkdtemp(join(tmpdir(),'tw-dukascopy-tail-'))
  try {
    const request=join(root,'request.json')
    const input={instrument_id:'EUR/USD',from_date:'2026-01-05',to_date:'2026-01-05'}
    const empty={...raw,times:[],opens:[],highs:[],lows:[],closes:[],volumes:[]}
    await writeFile(request,JSON.stringify(input))
    await assert.rejects(download(request,{fetchFn:async()=>new Response(JSON.stringify(empty)),notify:()=>{},pauseMs:0}),/empty_range/)
    await writeFile(request,JSON.stringify({...input,parent_dataset_id:'dataset-'+ 'a'.repeat(64)}))
    assert.equal(await download(request,{fetchFn:async()=>assert.fail('empty tail completed bucket cached'),notify:()=>{},pauseMs:0}),0)
    const oneFolder=join(root,'one')
    const {mkdir}=await import('node:fs/promises')
    await mkdir(oneFolder)
    const oneRequest=join(oneFolder,'request.json')
    await writeFile(oneRequest,JSON.stringify({...input,parent_dataset_id:'dataset-'+ 'a'.repeat(64)}))
    const one={...raw,times:[0],opens:[0],highs:[0],lows:[0],closes:[0],volumes:[1]}
    assert.equal(await download(oneRequest,{fetchFn:async()=>new Response(JSON.stringify(one)),notify:()=>{},pauseMs:0}),1)
  } finally {await rm(root,{recursive:true,force:true})}
})

test('bounded concurrent buckets commit candles in date order and cache avoids requests', async () => {
  const root=await mkdtemp(join(tmpdir(),'tw-dukascopy-order-'))
  try {
    const request=join(root,'request.json')
    await writeFile(request,JSON.stringify({instrument_id:'EUR/USD',from_date:'2026-01-05',to_date:'2026-01-10'}))
    let active=0, maxActive=0, calls=0
    const completion=[]
    const fetchFn=async url=> {
      const day=Number(url.split('/').at(-1))
      active++; calls++; maxActive=Math.max(maxActive,active)
      await new Promise(resolve=>setTimeout(resolve,(11-day)*5))
      active--; completion.push(day)
      return new Response(JSON.stringify({...raw,timestamp:start+(day-5)*86400000}))
    }
    const events=[]
    assert.equal(await download(request,{fetchFn,notify:event=>events.push(event),pauseMs:0}),12)
    assert.equal(maxActive,3)
    assert.deepEqual(completion.slice(0,3),[7,6,5])
    const csv=await readFile(join(root,'candles.csv'),'utf8')
    const timestamps=csv.trim().split('\n').slice(1).map(line=>Number(line.split(',')[0]))
    assert.deepEqual(timestamps,[...timestamps].sort((a,b)=>a-b))
    assert.deepEqual(events.filter(event=>event.event==='progress').map(event=>event.completed_days).filter(days=>days>0),[1,2,3,4,5,6])
    assert.equal(await download(request,{fetchFn:async()=>assert.fail('all buckets cached'),notify:()=>{},pauseMs:0}),12)
    assert.equal(calls,6)
    assert.equal(await readFile(join(root,'candles.csv'),'utf8'),csv)
    await assert.rejects(download(request,{concurrency:5}),/invalid_concurrency/)
  } finally {await rm(root,{recursive:true,force:true})}
})

test('failed batch drains inflight work, preserves successful receipts, stops scheduling and prioritizes 429', async () => {
  const root=await mkdtemp(join(tmpdir(),'tw-dukascopy-failed-batch-'))
  try {
    const request=join(root,'request.json')
    await writeFile(request,JSON.stringify({instrument_id:'EUR/USD',from_date:'2026-01-05',to_date:'2026-01-10'}))
    const calls=[]
    let active=0
    await assert.rejects(download(request,{fetchFn:async url=> {
      const day=Number(url.split('/').at(-1))
      calls.push(day); active++
      await new Promise(resolve=>setTimeout(resolve,(day-4)*10))
      active--
      if(day===5) return new Response('',{status:503})
      if(day===6) return new Response('',{status:429,headers:{'retry-after':'700'}})
      return new Response(JSON.stringify({...raw,timestamp:start+(day-5)*86400000}))
    },notify:()=>{},pauseMs:0}),error=>error.message==='source_rate_limited'&&error.retryAfter===700)
    assert.equal(active,0)
    assert.deepEqual(calls,[5,6,7])
    assert.equal((await readdir(join(root,'raw'))).filter(name=>name.endsWith('.receipt.json')).length,1)
    await assert.rejects(readFile(join(root,'candles.csv')),error=>error.code==='ENOENT')
    const resumed=[]
    assert.equal(await download(request,{fetchFn:async url=> {
      const day=Number(url.split('/').at(-1)); resumed.push(day)
      assert.notEqual(day,7,'success from failed batch must resume from durable receipt')
      return new Response(JSON.stringify({...raw,timestamp:start+(day-5)*86400000}))
    },notify:()=>{},pauseMs:0}),12)
    assert.deepEqual(resumed.sort((a,b)=>a-b),[5,6,8,9,10])
  } finally {await rm(root,{recursive:true,force:true})}
})

test('byte progress is throttled without losing exact transfer counts or final day events', async () => {
  const root=await mkdtemp(join(tmpdir(),'tw-dukascopy-progress-'))
  try {
    const request=join(root,'request.json')
    await writeFile(request,JSON.stringify({instrument_id:'EUR/USD',from_date:'2026-01-05',to_date:'2026-01-05'}))
    const body=Buffer.from(JSON.stringify(raw)), events=[]
    const fetchFn=async()=>new Response(new ReadableStream({start(controller){
      for(const byte of body) controller.enqueue(Uint8Array.of(byte))
      controller.close()
    }}))
    assert.equal(await download(request,{fetchFn,notify:event=>events.push(event),pauseMs:0,progressIntervalMs:60000}),2)
    assert.deepEqual(events.map(event=>[event.event,event.completed_days]),[['progress',0],['progress',1],['complete',undefined]])
    assert.equal(events.at(-1).transferred_bytes,body.length)
    assert.equal(events[1].transferred_bytes,body.length)
  } finally {await rm(root,{recursive:true,force:true})}
})
