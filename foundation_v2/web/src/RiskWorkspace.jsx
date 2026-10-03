import React, { useMemo, useState } from 'react'
import './RiskWorkspace.css'

function optionalNumber(value) {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function formatMoney(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return 'N/A'
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(Number(value))
}

async function readJson(response) {
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(String(payload?.detail || `HTTP ${response.status}`))
  return payload
}

const DEFAULT_FORM = {
  profileId: 'generic-practice-v1',
  termsVersion: 'ui-practice-v1',
  effectiveFrom: '2026-01-01',
  totalAmount: '1000',
  totalType: 'static',
  totalBasis: 'equity',
  dailyAmount: '500',
  dailyBasis: 'equity',
  startingBalance: '10000',
  balance: '10000',
  equity: '10000',
  highWaterMark: '10000',
  dailyStart: '10000',
  costsTotal: '0',
  costsToday: '0',
  costBasis: 'included',
  breachAtBoundary: true,
}

function Metric({ label, value, sub, status }) {
  return <div className="risk-metric"><span>{label}</span><strong className={status ? `is-${status}` : ''}>{value}</strong>{sub && <small>{sub}</small>}</div>
}

function EvaluationResult({ result }) {
  if (!result) return null
  if (result.status === 'blocked_by_data') {
    return <section className="risk-result risk-result-blocked" data-testid="risk-blocked"><div><span className="risk-eyebrow">EVALUATION / BLOCKED</span><h2>Chưa đủ dữ liệu để kết luận</h2><p>Risk engine không tự đoán số còn thiếu. Bổ sung đúng các giá trị được nêu dưới đây rồi đánh giá lại.</p></div><ul>{(result.blocked_by_data || []).map((item) => <li key={item}><code>{item}</code></li>)}</ul></section>
  }
  const breached = result.status === 'breached'
  const total = result.total_drawdown
  const daily = result.daily_loss
  return <section className={`risk-result ${breached ? 'is-breached' : 'is-within'}`} data-testid="risk-result">
    <div className="risk-result-head"><div><span className="risk-eyebrow">EVALUATION / CURRENT SNAPSHOT</span><h2>{breached ? 'Đã chạm giới hạn' : 'Đang trong giới hạn'}</h2><p>Đây là phép đánh giá trên snapshot hiện tại, không phải xác suất payout hay cam kết broker.</p></div><strong className="risk-status-chip">{breached ? 'BREACHED' : 'WITHIN LIMITS'}</strong></div>
    <div className="risk-evaluation-grid">
      <Metric label="Overall floor" value={formatMoney(total?.floor)} sub={`Current ${formatMoney(total?.current)} · còn ${formatMoney(total?.remaining)}`} status={total?.breached ? 'danger' : 'ok'} />
      <Metric label="Daily floor" value={formatMoney(daily?.floor)} sub={`Current ${formatMoney(daily?.current)} · còn ${formatMoney(daily?.remaining)}`} status={daily?.breached ? 'danger' : 'ok'} />
      <Metric label="Total reference" value={formatMoney(total?.reference)} sub={`${total?.basis || 'N/A'} basis`} />
      <Metric label="Daily reference" value={formatMoney(daily?.reference)} sub={`${daily?.basis || 'N/A'} basis`} />
    </div>
    <dl className="risk-assumption-list"><div><dt>Cost basis</dt><dd>{result.assumptions?.cost_basis || 'N/A'}</dd></div><div><dt>Cashflow</dt><dd>{result.assumptions?.cashflow_adjustment || 'N/A'}</dd></div><div><dt>Payout estimate</dt><dd>{result.assumptions?.payout_probability || 'N/A'}</dd></div></dl>
  </section>
}

export default function RiskWorkspace({ workspace, initialSnapshot = null }) {
  const [form, setForm] = useState(DEFAULT_FORM)
  const [result, setResult] = useState(null)
  const [state, setState] = useState({ status: 'idle', error: null })

  const update = (field, value) => setForm((current) => ({ ...current, [field]: value }))
  const snapshot = useMemo(() => ({
    starting_balance: optionalNumber(initialSnapshot?.starting_balance ?? form.startingBalance),
    balance: optionalNumber(initialSnapshot?.balance ?? form.balance),
    equity: optionalNumber(initialSnapshot?.equity ?? form.equity),
    high_water_mark: optionalNumber(initialSnapshot?.high_water_mark ?? form.highWaterMark),
    daily_start_equity: optionalNumber(initialSnapshot?.daily_start_equity ?? form.dailyStart),
    daily_start_balance: optionalNumber(initialSnapshot?.daily_start_balance ?? form.dailyStart),
    costs_total: optionalNumber(initialSnapshot?.costs_total ?? form.costsTotal),
    costs_today: optionalNumber(initialSnapshot?.costs_today ?? form.costsToday),
  }), [form, initialSnapshot])

  const profile = useMemo(() => ({
    profile_id: form.profileId.trim() || 'generic-practice-v1',
    terms_version: form.termsVersion.trim() || 'ui-practice-v1',
    effective_from: form.effectiveFrom,
    reset_timezone: 'UTC',
    total_drawdown: { type: form.totalType, amount: optionalNumber(form.totalAmount), basis: form.totalBasis },
    daily_loss: { amount: optionalNumber(form.dailyAmount), basis: form.dailyBasis },
    cost_basis: form.costBasis,
    breach_at_boundary: Boolean(form.breachAtBoundary),
  }), [form])

  const evaluate = async (event) => {
    event.preventDefault()
    const missingProfile = [
      ['missing_total_drawdown_amount', profile.total_drawdown.amount],
      ['missing_daily_loss_amount', profile.daily_loss.amount],
    ].filter(([, value]) => !Number.isFinite(value)).map(([key]) => key)
    if (missingProfile.length) {
      setResult({ status: 'blocked_by_data', blocked_by_data: missingProfile })
      setState({ status: 'ready', error: null })
      return
    }
    setState({ status: 'loading', error: null })
    try {
      const response = await fetch('/api/v2/analytics/prop/evaluate', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Workspace-Id': workspace },
        body: JSON.stringify({ profile, snapshot }),
      })
      setResult(await readJson(response))
      setState({ status: 'ready', error: null })
    } catch (error) {
      setState({ status: 'error', error: error.message })
    }
  }

  return <main className="risk-workspace wm-page" data-testid="risk-workspace">
    <header className="risk-heading wm-page-header"><div><h1>Risk & giới hạn</h1></div><div className="risk-mode-lock"><strong>SIMULATION ONLY</strong><span>Không có broker action</span></div></header>
    <div className="risk-safety-banner"><strong>Risk Lab không mở live trading</strong><span>Kết quả chỉ đánh giá profile + snapshot bạn nhập, giữ nguyên các giới hạn local/replay.</span></div>
    <section className="risk-layout">
      <form className="risk-form" onSubmit={evaluate}>
        <div className="risk-form-head"><span className="risk-eyebrow">INPUT / PROFILE</span><h2>Profile giới hạn</h2></div>
        <div className="risk-form-grid">
          <label>Profile ID<input value={form.profileId} onChange={(event) => update('profileId', event.target.value)} /></label>
          <label>Terms version<input value={form.termsVersion} onChange={(event) => update('termsVersion', event.target.value)} /></label>
          <label>Effective from<input type="date" value={form.effectiveFrom} onChange={(event) => update('effectiveFrom', event.target.value)} /></label>
          <label>Total drawdown<input type="number" min="0" step="0.01" value={form.totalAmount} onChange={(event) => update('totalAmount', event.target.value)} /></label>
          <label>Type<select value={form.totalType} onChange={(event) => update('totalType', event.target.value)}><option value="static">Static</option><option value="trailing">Trailing</option></select></label>
          <label>Overall basis<select value={form.totalBasis} onChange={(event) => update('totalBasis', event.target.value)}><option value="equity">Equity</option><option value="balance">Balance</option></select></label>
          <label>Daily loss<input type="number" min="0" step="0.01" value={form.dailyAmount} onChange={(event) => update('dailyAmount', event.target.value)} /></label>
          <label>Daily basis<select value={form.dailyBasis} onChange={(event) => update('dailyBasis', event.target.value)}><option value="equity">Equity</option><option value="balance">Balance</option></select></label>
          <label>Cost basis<select value={form.costBasis} onChange={(event) => update('costBasis', event.target.value)}><option value="included">Included</option><option value="separate">Separate</option></select></label>
        </div>
        <div className="risk-form-head is-snapshot"><span className="risk-eyebrow">INPUT / SNAPSHOT</span><h2>Trạng thái tài khoản</h2></div>
        <div className="risk-form-grid">
          <label>Starting balance<input type="number" min="0" step="0.01" value={form.startingBalance} onChange={(event) => update('startingBalance', event.target.value)} /></label>
          <label>Balance<input type="number" min="0" step="0.01" value={form.balance} onChange={(event) => update('balance', event.target.value)} /></label>
          <label>Equity<input type="number" min="0" step="0.01" value={form.equity} onChange={(event) => update('equity', event.target.value)} /></label>
          <label>High-water mark<input type="number" min="0" step="0.01" value={form.highWaterMark} onChange={(event) => update('highWaterMark', event.target.value)} /></label>
          <label>Daily start equity<input type="number" min="0" step="0.01" value={form.dailyStart} onChange={(event) => update('dailyStart', event.target.value)} /></label>
          {form.costBasis === 'separate' && <><label>Costs total<input type="number" min="0" step="0.01" value={form.costsTotal} onChange={(event) => update('costsTotal', event.target.value)} /></label><label>Costs today<input type="number" min="0" step="0.01" value={form.costsToday} onChange={(event) => update('costsToday', event.target.value)} /></label></>}
        </div>
        <label className="risk-checkbox"><input type="checkbox" checked={form.breachAtBoundary} onChange={(event) => update('breachAtBoundary', event.target.checked)} /><span>Chạm đúng floor cũng tính là breach</span></label>
        <button className="risk-primary" type="submit" disabled={state.status === 'loading'}>{state.status === 'loading' ? 'Đang đánh giá…' : 'Đánh giá snapshot'}</button>
        {state.status === 'error' && <div className="risk-form-error" role="alert">Không đánh giá được: {state.error}</div>}
      </form>
      <aside className="risk-side"><div className="risk-side-title"><span className="risk-eyebrow">READ BEFORE PROMOTION</span><h2>Cách đọc kết quả</h2></div><ul><li><strong>Floor</strong><span>Mức thấp nhất cho phép theo profile hiện tại.</span></li><li><strong>Remaining</strong><span>Khoảng còn lại trước khi chạm giới hạn.</span></li><li><strong>Blocked</strong><span>Thiếu dữ liệu nên chưa được phép kết luận.</span></li><li><strong>Simulation</strong><span>Không nói lên khả năng payout hay edge.</span></li></ul></aside>
    </section>
    <EvaluationResult result={result} />
  </main>
}

export { DEFAULT_FORM, EvaluationResult }
