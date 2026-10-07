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
