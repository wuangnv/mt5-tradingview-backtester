import React, { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { createChart, LineSeries } from 'lightweight-charts'
import './styles.css'

function formatNumber(value, digits = 2) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return 'Chua co du lieu'
  return new Intl.NumberFormat('vi-VN', { maximumFractionDigits: digits }).format(Number(value))
}

function EquityChart({ points }) {
  const hostRef = useRef(null)

  useEffect(() => {
    if (!hostRef.current || !points?.length) return undefined
    const host = hostRef.current
    const chart = createChart(host, {
      width: host.clientWidth,
      height: 220,
      layout: { background: { color: '#101214' }, textColor: '#aeb4bc' },
      grid: { vertLines: { color: '#252a2f' }, horzLines: { color: '#252a2f' } },
      rightPriceScale: { borderColor: '#343a40' },
      timeScale: { borderColor: '#343a40', visible: false },
    })
    const series = chart.addSeries(LineSeries, { lineWidth: 2 })
    series.setData(points.map((point) => ({
      time: Number(point.sequence) + 1,
      value: Number(point.closed_trade_balance),
    })))
    chart.timeScale().fitContent()
    const observer = new ResizeObserver(() => chart.applyOptions({ width: host.clientWidth }))
    observer.observe(host)
    return () => {
      observer.disconnect()
      chart.remove()
    }
  }, [points])

  return <div className="chart" ref={hostRef} aria-label="Duong von research" />
}

function App() {
  const query = new URLSearchParams(window.location.search)
  const workspace = query.get('workspace') || 'tenant-a'
  const jobId = query.get('job') || ''
  const [state, setState] = useState({ status: 'loading', payload: null, error: null })

  useEffect(() => {
    if (!jobId) {
      setState({ status: 'error', payload: null, error: 'Thieu job id' })
      return
    }
    let cancelled = false
    fetch(`/api/v2/research/jobs/${encodeURIComponent(jobId)}`, {
      headers: { 'X-Workspace-Id': workspace },
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return response.json()
      })
      .then((payload) => {
        if (!cancelled) setState({ status: 'ready', payload, error: null })
      })
      .catch((error) => {
        if (!cancelled) setState({ status: 'error', payload: null, error: String(error.message || error) })
      })
    return () => { cancelled = true }
  }, [jobId, workspace])

  const result = state.payload?.result
  const metrics = result?.metrics || {}
  const completed = state.payload?.status === 'completed'

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <div className="eyebrow">FOUNDATION V2 / REFERENCE SLICE</div>
          <h1>Nghien cuu</h1>
        </div>
        <div className="safety" data-testid="safety-lock">Khong co quyen gui lenh broker</div>
      </header>

      <section className="statusbar" aria-label="Trang thai run">
        <span>Workspace <strong>{workspace}</strong></span>
        <span>Job <code>{jobId || 'unknown'}</code></span>
        <span className={`state state-${state.payload?.status || state.status}`}>
          {completed ? 'Hoan tat' : state.payload?.status || state.status}
        </span>
      </section>

      {state.status === 'loading' && <div className="message">Dang doc ket qua research...</div>}
      {state.status === 'error' && <div className="message error">Khong doc duoc ket qua: {state.error}</div>}

      {result && (
        <>
          <section className="metrics" aria-label="Chi so research">
            <article><span>So lenh</span><strong>{result.trade_count}</strong></article>
            <article><span>Net P/L</span><strong>{formatNumber(metrics.net_pnl)}</strong></article>
            <article><span>Win rate</span><strong>{formatNumber(metrics.win_rate_pct)}%</strong></article>
            <article><span>Max DD</span><strong>{formatNumber(metrics.closed_trade_balance_max_drawdown)}</strong></article>
          </section>

          <section className="workspace-grid">
            <div className="chart-panel">
              <div className="section-head">
                <div>
                  <span>Closed-trade balance</span>
                  <strong>{result.metrics_schema_version}</strong>
                </div>
                <code>{result.dataset_sha256.slice(0, 12)}</code>
              </div>
              <EquityChart points={metrics.closed_trade_balance_curve || []} />
            </div>
            <aside className="details">
              <h2>Provenance</h2>
              <dl>
                <div><dt>Dataset</dt><dd>{result.dataset_id}</dd></div>
                <div><dt>Strategy</dt><dd>{result.strategy_version}</dd></div>
                <div><dt>Contract</dt><dd>{result.contract_version}</dd></div>
                <div><dt>Mode</dt><dd>Research / local</dd></div>
                <div><dt>Broker send</dt><dd>Locked</dd></div>
              </dl>
            </aside>
          </section>
        </>
      )}
    </main>
  )
}

createRoot(document.getElementById('root')).render(<App />)
