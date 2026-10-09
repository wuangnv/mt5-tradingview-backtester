import { useEffect, useRef, useState } from 'react'
import ChartIcon from './ChartIcon.jsx'
import LegacyPositions from './LegacyPositions.jsx'
import LegacyPopover from './LegacyPopover.jsx'
import { useTestingLocale } from './testingLocale.jsx'
import { finiteNumber } from './replayOrderModel.js'
import { defaultScalperPreset, scalperProtection } from './legacyScalperPreset.js'
import './LegacyTradingBar.css'

export default function LegacyTradingBar({ order, quotes, onBeginOrder, analyticsHref, symbol, theme, sessionId, workspace }) {
  const { t, fmt, locale } = useTestingLocale()
  const [positionsOpen, setPositionsOpen] = useState(false), [maximized, setMaximized] = useState(false), [height, setHeight] = useState(230)
  const [overflowReserve, setOverflowReserve] = useState(null)
  const [balanceHidden, setBalanceHidden] = useState(false), [balanceAnchor, setBalanceAnchor] = useState(null)
  const storageKey = `tw:legacy-scalper:v1:${workspace}:${sessionId}`
  const [preset, setPreset] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey))
      if (typeof saved?.enabled === 'boolean' && ['stop', 'target'].every(key => typeof saved[key]?.enabled === 'boolean' && ['pips', 'percent', 'ticks'].includes(saved[key].unit) && finiteNumber(saved[key].value) > 0)) return saved
    } catch { /* Optional local preset. */ }
    return defaultScalperPreset()
  }), [draft, setDraft] = useState(defaultScalperPreset), [scalperAnchor, setScalperAnchor] = useState(null), [error, setError] = useState('')
  const workspaceRef = useRef(null), drag = useRef(null), hideBalance = useRef(null)
  const resizeFrame = useRef(null), pendingResize = useRef(null)
  const positionsLayout = useRef(null)
  positionsLayout.current = { open: positionsOpen, maximized, height }
  useEffect(() => () => { clearTimeout(hideBalance.current); cancelAnimationFrame(resizeFrame.current) }, [])
  useEffect(() => { try { localStorage.setItem(storageKey, JSON.stringify(preset)) } catch { /* The confirmation flow works without browser storage. */ } }, [storageKey, preset])
  const execution = order.execution, account = order.account, disabled = order.disabled || Boolean(order.active), currency = execution?.cost_model?.account_ccy || order.configuredCurrency || order.costs?.account_ccy
  const money = value => {
    const amount = finiteNumber(value)
    if (amount === null) return '—'
    if (!currency) return fmt(amount)
    try { return new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 2 }).format(amount) } catch { return fmt(amount, ' ' + currency) }
  }
  const realized = finiteNumber(account?.balance) !== null && finiteNumber(account?.starting_balance) !== null ? Number(account.balance) - Number(account.starting_balance) : null
  const openOrder = side => {
    try {
      const protection = scalperProtection(preset, side === 'BUY' ? quotes.ask : quotes.bid, side, order.instrument)
      setError(''); onBeginOrder(side)
      if (preset.enabled) order.setDraft(current => ({ ...current, ...protection }))
    } catch (failure) { setError(failure.message) }
  }
  const quantityStep = direction => {
    const current = finiteNumber(order.draft.quantity), step = finiteNumber(order.instrument?.quantity_step), minimum = finiteNumber(order.instrument?.quantity_min), maximum = finiteNumber(order.instrument?.quantity_max)
    if (disabled || current === null || !(step > 0)) return
    const next = Number((current + direction * step).toFixed(8))
    if ((minimum !== null && next < minimum) || (maximum !== null && next > maximum)) return
    order.setDraft(value => ({ ...value, quantity: String(next) }))
  }
  const resizeBounds = () => {
    const main = workspaceRef.current?.closest('.replay-main')
    const available = main?.clientHeight || 600
    const barHeight = workspaceRef.current?.querySelector('.legacy-trading-bar')?.offsetHeight || 48
    const chart = main?.querySelector('.chart-frame')
    const chartMinimum = chart ? parseFloat(getComputedStyle(chart).minHeight) || 240 : 240
    return { normal: Math.max(0, available - barHeight - chartMinimum - 2), full: available - barHeight, barHeight }
  }
  const resize = (value, bounds = resizeBounds()) => {
    if (value >= bounds.full) { setPositionsOpen(true); setMaximized(true); return }
    const next = Math.max(0, value)
    // Keep the native chart at its minimum size while the table slides over it.
    setOverflowReserve(next > bounds.normal ? bounds.normal + bounds.barHeight : null)
    setMaximized(false)
    setPositionsOpen(next > 48); if (next > 48) setHeight(Math.max(130, next))
  }
  const finishResize = commit => {
    cancelAnimationFrame(resizeFrame.current); resizeFrame.current = null
    if (commit && drag.current?.value !== undefined) resize(drag.current.value)
    else if (drag.current && positionsLayout.current.open && !positionsLayout.current.maximized) resize(positionsLayout.current.height)
    pendingResize.current = null; drag.current = null
  }
  useEffect(() => {
    const main = workspaceRef.current?.closest('.replay-main')
    if (!main) return
    const observer = new ResizeObserver(() => {
      const layout = positionsLayout.current
      if (drag.current || !layout.open || layout.maximized) return
      resize(layout.height)
    })
    observer.observe(main)
    return () => observer.disconnect()
  }, [])
  const dismissBalance = () => { hideBalance.current = setTimeout(() => setBalanceAnchor(null), 160) }
  const showBalance = anchor => { clearTimeout(hideBalance.current); setBalanceAnchor(anchor) }
  return <div ref={workspaceRef} className={`legacy-trading-workspace ${maximized ? 'is-maximized' : positionsOpen && overflowReserve !== null ? 'is-expanded' : ''}`} style={!maximized && positionsOpen && overflowReserve !== null ? { height: overflowReserve, '--positions-height': `${height}px` } : undefined}>
    <div className="chart-trading-bar legacy-trading-bar" role="group" aria-label={t('Giao dịch mô phỏng')}>
      <div className="chart-trading-actions">
        {['BUY', 'SELL'].map(side => <button key={side} type="button" className={side.toLowerCase()} disabled={disabled} onClick={() => openOrder(side)} title={t('Mở lệnh mô phỏng để xác nhận')}>{t(side === 'BUY' ? 'Buy' : 'Sell')}</button>)}
        <div className="legacy-quantity-control"><input aria-label={t('Khối lượng nhanh')} type="number" min={order.instrument?.quantity_min || '0'} max={order.instrument?.quantity_max || undefined} step={order.instrument?.quantity_step || 'any'} value={order.draft.quantity} disabled={disabled} onChange={event => order.setDraft(current => ({ ...current, quantity: event.target.value }))} /><div><button type="button" aria-label={t('Tăng khối lượng')} disabled={disabled || !(Number(order.instrument?.quantity_step) > 0)} onClick={() => quantityStep(1)}><ChartIcon name="down" style={{ transform: 'rotate(180deg)' }} /></button><button type="button" aria-label={t('Giảm khối lượng')} disabled={disabled || !(Number(order.instrument?.quantity_step) > 0)} onClick={() => quantityStep(-1)}><ChartIcon name="down" /></button></div></div>
        <button type="button" className={`legacy-scalper-button ${preset.enabled ? 'is-enabled' : ''}`} aria-label="Scalper mode" title="Scalper mode" aria-expanded={Boolean(scalperAnchor)} aria-pressed={preset.enabled} onClick={event => {
          const next = structuredClone(preset)
          for (const key of ['stop', 'target']) {
            if (!preset.enabled) next[key].enabled = false
            if (next[key].unit === 'pips' && !(Number(order.instrument?.pip_size) > 0) && order.instrument?.asset_class && order.instrument.asset_class !== 'fx' && Number(order.instrument.tick_size) > 0) next[key].unit = 'ticks'
          }
          setDraft(next); setError(''); setScalperAnchor(event.currentTarget)
        }}><ChartIcon name="rocket" /></button>
      </div>
      <button type="button" className="legacy-positions-grip" aria-label={t('Kéo để chỉnh chiều cao danh sách lệnh')} title={t('Kéo để chỉnh chiều cao danh sách lệnh')} aria-expanded={positionsOpen}
        onPointerDown={event => {
          if (event.button !== 0) return
          event.currentTarget.setPointerCapture(event.pointerId)
          const bounds = resizeBounds()
          drag.current = { y: event.clientY, height: maximized ? bounds.full : positionsOpen ? height : 0, bounds }
          event.preventDefault()
        }}
        onPointerMove={event => {
          if (!drag.current || Math.abs(drag.current.y - event.clientY) <= 3) return
          drag.current.value = drag.current.height + drag.current.y - event.clientY
          pendingResize.current = { value: drag.current.value }
          if (resizeFrame.current !== null) return
          resizeFrame.current = requestAnimationFrame(() => {
            resizeFrame.current = null
            if (pendingResize.current && drag.current) resize(pendingResize.current.value, drag.current.bounds)
            pendingResize.current = null
          })
        }} onPointerUp={() => finishResize(true)} onPointerCancel={() => finishResize(false)} onLostPointerCapture={() => finishResize(false)}
        onKeyDown={event => { if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return; event.preventDefault(); event.stopPropagation(); resize(event.key === 'Home' ? 0 : event.key === 'End' ? 10000 : (maximized ? resizeBounds().full : positionsOpen ? height : 100) + (event.key === 'ArrowUp' ? 30 : -30)) }}><ChartIcon name="grip-horizontal" /></button>
      <div className="chart-trading-account">
        <a className="legacy-analytics-link" href={analyticsHref}><ChartIcon name="analytics" />{t('Analytics')}</a>
        <button type="button" className="legacy-balance-pill" aria-label={t('Thông tin tài khoản')} aria-expanded={Boolean(balanceAnchor)} onPointerEnter={event => showBalance(event.currentTarget)} onPointerLeave={dismissBalance} onFocus={event => showBalance(event.currentTarget)} onBlur={dismissBalance} onClick={event => balanceAnchor ? setBalanceAnchor(null) : showBalance(event.currentTarget)}><ChartIcon name="wallet" /><strong>{balanceHidden ? '••••••' : money(account?.balance ?? order.configuredBalance)}</strong></button>
        <button type="button" aria-label={t(balanceHidden ? 'Hiện số dư' : 'Ẩn số dư')} aria-pressed={balanceHidden} onClick={() => setBalanceHidden(value => !value)}><ChartIcon name={balanceHidden ? 'eye' : 'eye-off'} /></button>
        <button type="button" aria-label={t(positionsOpen ? 'Thu gọn danh sách lệnh' : 'Mở danh sách lệnh')} aria-expanded={positionsOpen} onClick={() => {
          if (positionsOpen) { setMaximized(false); setPositionsOpen(false); return }
          const bounds = resizeBounds()
          resize(Math.min(bounds.normal, Math.max(height, 260, Math.round(bounds.full * 0.4))), bounds)
        }}><ChartIcon name="down" style={{ transform: positionsOpen ? '' : 'rotate(180deg)' }} /></button>
        <button type="button" aria-label={t(maximized ? 'Thu nhỏ danh sách lệnh' : 'Mở rộng danh sách lệnh')} aria-pressed={maximized} onClick={() => { setPositionsOpen(true); setMaximized(value => !value) }}><ChartIcon name={maximized ? 'contract-corners' : 'fit'} /></button>
      </div>
    </div>
    {positionsOpen && <div className="legacy-resizable-positions" style={maximized ? undefined : { height }}><LegacyPositions execution={execution} assetStates={order.assetStates} symbol={symbol} /></div>}
    {error && !scalperAnchor && <p className="legacy-preset-error" role="alert">{t(error)}<button type="button" onClick={() => setError('')} aria-label={t('Đóng thông báo')}>×</button></p>}
    {balanceAnchor && <LegacyPopover anchor={balanceAnchor} theme={theme} label={t('Thông tin tài khoản')} onClose={() => { clearTimeout(hideBalance.current); setBalanceAnchor(null) }}><dl className="legacy-account-details" onPointerEnter={() => clearTimeout(hideBalance.current)} onPointerLeave={dismissBalance}>{(account ? [['Equity', account.equity], ['Realized PnL', realized], ['Unrealized PnL', account.floating_pl]] : [['Account Balance', order.configuredBalance]]).map(([label, value]) => <div key={label}><dt>{t(label)}</dt><dd>{balanceHidden ? '••••••' : money(value)}</dd></div>)}</dl></LegacyPopover>}
    {scalperAnchor && <LegacyPopover anchor={scalperAnchor} theme={theme} label="Scalper mode" wide onClose={() => { setScalperAnchor(null); setError('') }}><form className="legacy-scalper-settings" onSubmit={event => {
      event.preventDefault()
      try {
        const next = { ...draft, enabled: draft.stop.enabled || draft.target.enabled }
        if (next.enabled) scalperProtection(next, quotes.ask, 'BUY', order.instrument)
        setPreset(next); setScalperAnchor(null); setError('')
      } catch (failure) { setError(failure.message) }
    }}><h2>Scalper mode</h2>
      {[['stop', 'Stop loss'], ['target', 'Take profit']].map(([key, label]) => <fieldset key={key}><label className="legacy-scalper-toggle"><span>{t(label)}</span><input type="checkbox" role="switch" checked={draft[key].enabled} onChange={event => setDraft(current => ({ ...current, [key]: { ...current[key], enabled: event.target.checked } }))} /></label><div className={`legacy-scalper-distance ${!draft[key].enabled ? 'is-off' : ''}`}><input aria-label={t('Khoảng cách {name}', { name: label })} type="number" min="0.00000001" step="any" required disabled={!draft[key].enabled} value={draft[key].value} onChange={event => setDraft(current => ({ ...current, [key]: { ...current[key], value: event.target.value } }))} /><div className="legacy-scalper-units" role="group" aria-label={t('Đơn vị {name}', { name: label })}>{[['percent', '%'], ['pips', 'Pips'], ...(order.instrument?.asset_class && order.instrument.asset_class !== 'fx' && Number(order.instrument.tick_size) > 0 ? [['ticks', 'Ticks']] : [])].map(([unit, caption]) => <button key={unit} type="button" aria-pressed={draft[key].unit === unit} disabled={!draft[key].enabled || (unit === 'pips' && !(Number(order.instrument?.pip_size) > 0)) || (unit === 'ticks' && !(Number(order.instrument?.tick_size) > 0))} onClick={() => setDraft(current => ({ ...current, [key]: { ...current[key], unit } }))}>{caption}</button>)}</div></div></fieldset>)}
      <label className="legacy-scalper-toggle is-unavailable" title={t('Chưa hỗ trợ tự dời SL về hòa vốn')}><span>Auto Break-even</span><input type="checkbox" role="switch" disabled /></label>
      <label>{t('Chiến lược')}<select disabled><option>{t('Mặc định của phiên')}</option></select></label>
      <p>{t('Preset áp dụng vào lệnh nháp; bạn vẫn xác nhận trước khi đặt lệnh.')}</p>
      {error && <p role="alert">{t(error)}</p>}
      <footer><button type="button" onClick={() => { setScalperAnchor(null); setError('') }}>{t('Discard')}</button><button type="submit" className="legacy-scalper-save" disabled={order.disabled}>{t('Save')}</button></footer>
    </form></LegacyPopover>}
  </div>
}
