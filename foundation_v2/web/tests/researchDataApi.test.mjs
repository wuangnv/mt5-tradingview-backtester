import test from 'node:test'
import assert from 'node:assert/strict'
import { datasetRange, datasetWarnings, formatNumber, formatUtc, holdoutLabel, qualityLabel } from '../src/researchDataApi.js'

test('research data helpers preserve unknown values and provenance warnings', () => {
  const dataset = {
    dataset_id: 'eurusd-h1',
    quality_status: 'unverified',
    row_count: 9189,
    first_timestamp: 1710000000,
    last_timestamp: 1710036000,
    source: { provider: 'local-catalog', license_use: 'qa-only' },
    holdout_policy: { mode: 'none' },
  }
  assert.deepEqual(datasetRange(dataset), { start: 1710000000, end: 1710036000 })
  assert.equal(qualityLabel(dataset), 'Chưa xác minh')
  assert.equal(holdoutLabel(dataset), 'Holdout khóa')
  assert.match(datasetWarnings(dataset).join(' '), /chưa được xác minh/i)
  assert.match(datasetWarnings(dataset).join(' '), /instrument spec/i)
  assert.equal(formatNumber(null), 'Chưa có dữ liệu')
  assert.equal(formatUtc(null), 'Chưa có dữ liệu')
})

test('research data helpers distinguish verified and explicit holdout access', () => {
  const dataset = {
    quality_status: 'verified',
    holdout_access: true,
    holdout_policy: { mode: 'approved' },
    artifact_sha256: 'sha256',
    instrument_spec: { contract_size: 100000 },
  }
  assert.equal(qualityLabel(dataset), 'Đã xác minh')
  assert.equal(holdoutLabel(dataset), 'Có quyền holdout')
  assert.deepEqual(datasetWarnings(dataset), [])
})
