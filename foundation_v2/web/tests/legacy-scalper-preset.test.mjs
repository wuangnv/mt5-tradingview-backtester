import test from 'node:test'
import assert from 'node:assert/strict'
import { defaultScalperPreset, scalperProtection } from '../src/legacyScalperPreset.js'

const instrument = { pip_size: '0.0001', tick_size: '0.00001' }
const preset = () => ({ ...defaultScalperPreset(), enabled: true })

test('FX preset distances create opposite protective levels on BUY and SELL', () => {
  assert.deepEqual(scalperProtection(preset(), 1.1, 'BUY', instrument), { stopLoss: '1.098', takeProfit: '1.104' })
  assert.deepEqual(scalperProtection(preset(), 1.1, 'SELL', instrument), { stopLoss: '1.102', takeProfit: '1.096' })
})
test('percent and tick distances round away from entry without collapsing a level', () => {
  const config = preset()
  config.stop = { enabled: true, value: '0.001', unit: 'percent' }
  config.target = { enabled: true, value: '0.1', unit: 'ticks' }
  assert.deepEqual(scalperProtection(config, 1.1, 'BUY', instrument), { stopLoss: '1.09998', takeProfit: '1.10001' })
  assert.deepEqual(scalperProtection(config, 1.1, 'SELL', instrument), { stopLoss: '1.10002', takeProfit: '1.09999' })
})
test('disabled preset or disabled protection preserves the engine draft defaults', () => {
  assert.deepEqual(scalperProtection(defaultScalperPreset(), null, 'BUY', null), {})
  const config = preset(); config.stop.enabled = false
  assert.deepEqual(scalperProtection(config, 1.1, 'BUY', instrument), { takeProfit: '1.104' })
})
test('preset rejects missing price, missing unit metadata, zero or negative distances', () => {
  for (const entry of [null, '', 0, NaN]) assert.throws(() => scalperProtection(preset(), entry, 'BUY', instrument))
  assert.throws(() => scalperProtection(preset(), 1.1, 'BUY', { tick_size: 0.00001 }))
  assert.throws(() => scalperProtection(preset(), 1.1, 'BUY', { pip_size: 0.0001 }))
  for (const value of ['0', '-1', 'not-a-number']) {
    const config = preset(); config.stop.value = value
    assert.throws(() => scalperProtection(config, 1.1, 'BUY', instrument))
  }
})
test('preset never emits zero, negative, or infinite protective prices', () => {
  const config = preset(); config.stop.value = '1e20'
  assert.throws(() => scalperProtection(config, 1.1, 'BUY', instrument))
  config.stop.enabled = false; config.target.value = '1e308'; config.target.unit = 'percent'
  assert.throws(() => scalperProtection(config, 100, 'BUY', instrument))
})
