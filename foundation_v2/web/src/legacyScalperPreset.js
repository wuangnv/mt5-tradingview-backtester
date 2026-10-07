import { finiteNumber } from './replayOrderModel.js'

export const defaultScalperPreset = () => ({ enabled: false, stop: { enabled: true, value: '20', unit: 'pips' }, target: { enabled: true, value: '40', unit: 'pips' } })

export function scalperProtection(preset, entryValue, side, instrument) {
  if (!preset.enabled) return {}
  const entry = finiteNumber(entryValue), tick = finiteNumber(instrument?.tick_size)
  if (!(entry > 0) || !(tick > 0) || !['BUY', 'SELL'].includes(side)) throw new Error('Chưa có giá hoặc bước giá để áp dụng preset.')
  const result = {}
  for (const [kind, key] of [['stop', 'stopLoss'], ['target', 'takeProfit']]) {
    const setting = preset[kind]
    if (!setting.enabled) continue
    const value = finiteNumber(setting.value)
    const unit = setting.unit === 'percent' ? entry / 100 : setting.unit === 'pips' ? finiteNumber(instrument?.pip_size) : setting.unit === 'ticks' ? tick : null
    if (!(value > 0) || !(unit > 0)) throw new Error('Nhập khoảng cách dương với đơn vị được hỗ trợ.')
    const direction = (side === 'BUY' ? 1 : -1) * (kind === 'stop' ? -1 : 1)
    // Round away from entry so a protection never collapses onto its tick.
    const raw = entry + direction * value * unit, units = raw / tick, nearest = Math.round(units)
    const exact = Math.abs(units - nearest) <= Number.EPSILON * Math.max(1, Math.abs(units)) * 4
    const rounded = exact ? nearest : direction > 0 ? Math.ceil(units) : Math.floor(units)
    const price = Number((rounded * tick).toFixed(8))
    if (!Number.isFinite(price) || !(price > 0) || (price - entry) * direction <= 0) throw new Error('Khoảng cách SL/TP không hợp lệ tại giá hiện tại.')
    result[key] = String(price)
  }
  return result
}
