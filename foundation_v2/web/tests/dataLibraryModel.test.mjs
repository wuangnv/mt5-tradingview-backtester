import assert from 'node:assert/strict'
import test from 'node:test'
import { categoryOf, categoryLabel, filterLibrary, libraryRows, canDownloadAsset, defaultDownloadDates, downloadRangeError } from '../src/dataLibraryModel.js'

const saved = [
  { dataset_id:'old',instrument_id:'EURUSD',timeframe:'1m',source:{provider:'CSV'},instrument_spec:{asset_class:'fx'},created_at_utc:'2026-01-01Z' },
  { dataset_id:'new',instrument_id:'EURUSD',timeframe:'1m',source:{provider:'CSV'},instrument_spec:{asset_class:'fx'},created_at_utc:'2026-02-01Z' },
  { dataset_id:'gold',instrument_id:'XAUUSD',source:{provider:'CSV'},instrument_spec:{asset_class:'metal'} },
]
test('loaded versions remain distinct; matching catalog asset does not duplicate them', () => {
  const rows = libraryRows(saved,[{instrument_id:'EURUSD',provider:'CSV',provider_id:'csv'},{instrument_id:'EURUSD',provider:'Other source',provider_id:'other'}])
  assert.deepEqual(rows.map(row => row.key),['old','new','gold','other:EURUSD'])
  assert.deepEqual(rows.map(row => row.downloaded),[true,true,true,false])
  assert.equal(rows.at(-1).row_count,undefined)
})

test('downloads require supported Dukascopy metadata and are never available in preview', () => {
  const asset = {instrument_id:'EUR/USD',provider_id:'dukascopy'}
  const download = {available:true,supported_instruments:['EUR/USD']}
  assert.equal(canDownloadAsset(asset,download),true)
  assert.equal(canDownloadAsset({...asset,provider_id:'csv'},download),false)
  assert.equal(canDownloadAsset(asset,download,true),false)
  assert.equal(canDownloadAsset(asset,{...download,available:false}),false)
  assert.equal(canDownloadAsset(asset,{...download,supported_instruments:['EURUSD']}),false)
  assert.equal(categoryLabel(categoryOf({asset_class:'bonds'})),'Trái phiếu')
  assert.equal(categoryLabel(categoryOf({asset_class:'etfs'})),'ETF')
})

test('date validation uses inclusive completed UTC days without local timezone drift', () => {
  const now = new Date('2026-10-08T00:05:00Z')
  assert.deepEqual(defaultDownloadDates(now),{from_date:'2026-09-08',to_date:'2026-10-07'})
  assert.equal(downloadRangeError('2026-10-07','2026-10-07',now),'')
  assert.equal(downloadRangeError('2026-10-08','2026-10-08',now),'Chỉ tải ngày đã kết thúc theo UTC.')
  assert.equal(downloadRangeError('2025-01-01','2026-01-01',now),'')
  assert.equal(downloadRangeError('2025-01-01','2026-01-02',now),'Mỗi lần tải tối đa 366 ngày.')
  for (const [from,to] of [['2026-02-30','2026-03-01'],['2026-13-01','2026-13-02'],['',''],['2026-09-20','2026-09-01']]) assert.equal(downloadRangeError(from,to,now),'Chọn khoảng ngày hợp lệ.')
})
test('catalog category uses declared metadata, never guesses from the symbol', () => {
  assert.equal(categoryOf(saved[2]),'metal')
  assert.equal(categoryOf({instrument_id:'XAUUSD'}),'')
  assert.equal(categoryLabel(''),'Chưa phân loại')
})
test('search and category/source compose without changing the source list', () => {
  const rows = libraryRows(saved)
  assert.deepEqual(filterLibrary(rows,{category:'metal',provider:'CSV',search:' xau '}).map(row => row.key),['gold'])
  assert.equal(filterLibrary(rows,{category:'fx',provider:'Other'}).length,0)
  assert.deepEqual(rows.map(row => row.key),['old','new','gold'])
})

test('download status filters saved and catalog rows independently of sorting', () => {
  const rows = libraryRows(saved,[{instrument_id:'AUDUSD',provider:'CSV',provider_id:'csv',asset_class:'fx'}])
  assert.equal(filterLibrary(rows,{downloadStatus:'all'}).length,4)
  assert.deepEqual(filterLibrary(rows,{downloadStatus:'downloaded',sort:'newest'}).map(row => row.key),['new','old','gold'])
  assert.deepEqual(filterLibrary(rows,{downloadStatus:'not-downloaded',category:'fx',provider:'CSV'}).map(row => row.key),['csv:AUDUSD'])
  assert.equal(filterLibrary(rows,{downloadStatus:'not-downloaded',category:'metal'}).length,0)
  assert.deepEqual(filterLibrary(rows,{downloadStatus:'downloaded',category:'metal',provider:'CSV',search:'xau'}).map(row => row.key),['gold'])
  assert.equal(rows.length,4)
})
test('sorting keeps missing dates deterministic and puts downloaded assets first', () => {
  const rows = libraryRows(saved,[{instrument_id:'AUDUSD',provider:'CSV',provider_id:'csv'}])
  assert.equal(filterLibrary(rows,{sort:'downloaded'}).at(-1).downloaded,false)
  const unsavedFirst = filterLibrary(rows,{sort:'not-downloaded'})
  assert.equal(unsavedFirst[0].downloaded,false)
  assert.equal(unsavedFirst.filter(row => row.downloaded).length,saved.length)
  assert.equal(filterLibrary(rows,{sort:'newest'})[0].key,'new')
  assert.equal(filterLibrary(rows,{sort:'asset-asc'})[0].instrument_id,'AUDUSD')
  assert.equal(filterLibrary(rows,{sort:'asset-desc'})[0].instrument_id,'XAUUSD')
})

test('active jobs filter both new downloads and saved updates without mislabelling other sources', () => {
  const assets = ['A','B','C','D','E','F'].map(instrument_id => ({instrument_id,provider:'Dukascopy',provider_id:'dukascopy'}))
  const jobs = [{instrument_id:'A',status:'running'}, {instrument_id:'B',status:'pausing'}, {instrument_id:'C',status:'paused'}, {instrument_id:'D',status:'cancelled'}, {instrument_id:'E',status:'failed'}, {instrument_id:'F',status:'completed'}]
  const rows = libraryRows([{dataset_id:'update',instrument_id:'A',source:{provider:'Dukascopy'}}, {dataset_id:'csv',instrument_id:'A',source:{provider:'CSV'}}],assets,jobs)
  assert.deepEqual(filterLibrary(rows,{downloadStatus:'downloading'}).map(row=>row.instrument_id),['A','B','C','E'])
  assert.deepEqual(filterLibrary(rows,{downloadStatus:'not-downloaded'}).map(row=>row.instrument_id),['D','F'])
  assert.equal(filterLibrary(rows,{downloadStatus:'downloaded'}).length,2)
  assert.equal(filterLibrary(rows,{downloadStatus:'downloading',provider:'CSV'}).length,0)
  assert.equal(filterLibrary(libraryRows([],assets,[]),{downloadStatus:'downloading'}).length,0)
  assert.equal(rows.find(row=>row.instrument_id==='D').downloadJob,undefined)
  assert.equal(filterLibrary(rows,{downloadStatus:'downloading'}).find(row=>row.instrument_id==='C').downloadJob.status,'paused')
})
