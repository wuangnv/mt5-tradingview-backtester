import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
