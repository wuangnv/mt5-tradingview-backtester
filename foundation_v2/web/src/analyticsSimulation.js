import { known, number } from './tradingAnalyticsModel.js'
export function monteCarlo(config, ledger = []) {
  const simulations = Number(config.simulations), trades = Number(config.trades), capital = Number(config.capital), seed = Number(config.seed)
  if (!Number.isInteger(simulations) || simulations < 1 || simulations > 1000 || !Number.isInteger(trades) || trades < 1 || trades > 1000 || simulations * trades > 250000 || !known(capital) || capital <= 0 || !Number.isInteger(seed) || seed < 0 || seed > 4294967295) throw new Error('Giới hạn: 1–1.000 lượt, 1–1.000 lệnh, tối đa 250.000 bước; vốn > 0 và seed 0–4.294.967.295.')
  const samples = ledger.map(row => number(row.net_pnl))
  const bootstrap = config.method === 'ledger'
  if (bootstrap && (!samples.length || samples.some(value => value === null))) throw new Error('Ledger phải có Net P/L đầy đủ để lấy mẫu.')
  const win = Number(config.averageWin), loss = Number(config.averageLoss), rate = Number(config.winRate)
  if (!bootstrap && (![win, loss, rate].every(Number.isFinite) || win < 0 || loss < 0 || rate < 0 || rate > 100)) throw new Error('Lãi/lỗ trung bình phải ≥ 0; win rate từ 0 đến 100%.')
  const random = seededRandom(seed), paths = [], endings = [], drawdowns = []
  let ruined = 0
  for (let run = 0; run < simulations; run++) {
    let balance = capital, peak = capital, maxDD = 0
    const path = [balance]
    for (let index = 0; index < trades; index++) {
      if (balance > 0) balance += bootstrap ? samples[Math.floor(random() * samples.length)] : random() < rate / 100 ? win : -loss
      balance = Math.max(0, balance); peak = Math.max(peak, balance); maxDD = Math.max(maxDD, peak - balance)
      path.push(balance)
    }
    if (balance === 0) ruined++
    endings.push(balance); drawdowns.push(maxDD)
    if (run < 30) paths.push(path)
  }
  const sorted = [...endings].sort((a, b) => a - b)
  const percentile = p => { const at = (sorted.length - 1) * p; return sorted[Math.floor(at)] + (sorted[Math.ceil(at)] - sorted[Math.floor(at)]) * (at % 1) }
  return { paths, average: endings.reduce((sum, value) => sum + value, 0) / simulations, p05: percentile(.05), median: percentile(.5), p95: percentile(.95), min: sorted[0], max: sorted.at(-1), maxDD: Math.max(...drawdowns), ruinRate: ruined / simulations * 100, probabilityProfit: endings.filter(value => value > capital).length / simulations * 100, config: { ...config }, sampleCount: samples.length }
}

function seededRandom(seed) {
  let value = Number(seed) >>> 0
  return () => { value += 0x6D2B79F5; let n = value; n = Math.imul(n ^ n >>> 15, n | 1); n ^= n + Math.imul(n ^ n >>> 7, n | 61); return ((n ^ n >>> 14) >>> 0) / 4294967296 }
}
