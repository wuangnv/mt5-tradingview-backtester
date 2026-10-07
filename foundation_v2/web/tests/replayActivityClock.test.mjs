import test from 'node:test'
import assert from 'node:assert/strict'
import { ReplayActivityClock, appendActivitySegment } from '../src/replayActivityClock.js'

test('elapsed activity uses monotonic time and counts analysis while replay is paused', () => {
  const clock = new ReplayActivityClock(0, 1_000_000, true)
  assert.deepEqual(clock.sample(10_000, 1_010_000), { start: 1_000_000, end: 1_010_000 })
})

test('hidden or unfocused periods do not become practice time on return', () => {
  const clock = new ReplayActivityClock(0, 1_000_000, true)
  assert.ok(clock.sample(5000, 1_005_000))
  clock.setEligible(false)
  assert.equal(clock.sample(25_000, 1_025_000), null)
  clock.touch(25_000); clock.setEligible(true)
  assert.deepEqual(clock.sample(26_000, 1_026_000), { start: 1_025_000, end: 1_026_000 })
})

test('idle cutoff clips the last segment and new activity never fills the idle gap', () => {
  const clock = new ReplayActivityClock(0, 1_000_000, true)
  for (let tick = 20_000; tick <= 100_000; tick += 20_000) clock.sample(tick, 1_000_000 + tick)
  assert.deepEqual(clock.sample(125_000, 1_125_000), { start: 1_100_000, end: 1_120_000 })
  assert.equal(clock.sample(130_000, 1_130_000), null)
  clock.touch(130_000)
  assert.deepEqual(clock.sample(131_000, 1_131_000), { start: 1_130_000, end: 1_131_000 })
})

test('suspension and wall-clock jumps cannot inflate measured time', () => {
  const clock = new ReplayActivityClock(0, 1_000_000, true)
  assert.equal(clock.sample(60_000, 1_060_000), null)
  assert.equal(clock.sample(61_000, 2_061_000), null)
  assert.deepEqual(clock.sample(62_000, 2_062_000), { start: 2_061_000, end: 2_062_000 })
})

test('segments merge only across continuous activity and never exceed the endpoint limit', () => {
  const segments = []
  appendActivitySegment(segments, { start: 0, end: 10_000 })
  appendActivitySegment(segments, { start: 10_000, end: 30_000 })
  appendActivitySegment(segments, { start: 30_000, end: 31_000 })
  appendActivitySegment(segments, { start: 40_000, end: 41_000 })
  assert.deepEqual(segments, [{ start: 0, end: 30_000 }, { start: 30_000, end: 31_000 }, { start: 40_000, end: 41_000 }])
})
