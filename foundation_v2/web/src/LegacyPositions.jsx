import { useState } from 'react'
import { useTestingLocale } from './testingLocale.jsx'
import { closedChartTrades } from './legacyChartTrades.js'
import ChartIcon from './ChartIcon.jsx'

export default function LegacyPositions({ execution, symbol }) {
  const { t, fmt } = useTestingLocale()
  const [tab, setTab] = useState('open'), [page, setPage] = useState(0), [size, setSize] = useState(10)
  const open = execution?.position
  const pending = execution?.pending_market_order
  const closed = closedChartTrades(execution)
  const rows = tab === 'open' ? (open ? [{ ...open, key: open.position_id, unrealized: execution.floating_pl }] : []) : tab === 'pending' ? (pending ? [{ ...pending, key: pending.operation_id }] : []) : closed
  const pages = Math.max(1, Math.ceil(rows.length / size)), current = Math.min(page, pages - 1)
  return <section className="legacy-positions" aria-label={t('Lệnh trong phiên replay')}>
    <div className="legacy-position-tabs" role="tablist" aria-label={t('Trạng thái lệnh')}>
      {[['open', 'Vị thế đang mở'], ['pending', 'Lệnh chờ'], ['closed', 'Vị thế đã đóng']].map(([key, label]) => <button type="button" key={key} id={`position-tab-${key}`} role="tab" tabIndex={tab === key ? 0 : -1} aria-selected={tab === key} aria-controls="legacy-position-panel" onClick={() => { setTab(key); setPage(0) }} onKeyDown={event => {
        if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return
        event.preventDefault()
        const keys = ['open', 'pending', 'closed'], index = keys.indexOf(key)
        const next = event.key === 'Home' ? 'open' : event.key === 'End' ? 'closed' : keys[(index + (event.key === 'ArrowRight' ? 1 : 2)) % 3]
        setTab(next); setPage(0); document.getElementById(`position-tab-${next}`)?.focus()
      }}>{t(label)}</button>)}
    </div>
    <div id="legacy-position-panel" role="tabpanel" aria-labelledby={`position-tab-${tab}`}>
      <div className="legacy-position-scroll" tabIndex={0} role="region" aria-labelledby={`position-tab-${tab}`}><table><thead><tr>{['Mã giao dịch', 'Hướng', 'Khối lượng', 'Take profit', 'Stop loss', 'P/L chưa chốt', 'P/L đã chốt', 'Phí hoa hồng'].map(label => <th key={label}>{t(label)}</th>)}</tr></thead><tbody>
        {rows.slice(current * size, (current + 1) * size).map(row => <tr key={row.key}><td>{symbol}</td><td>{row.side || '—'}</td><td>{fmt(row.quantity, '', 8)}</td><td>{fmt(row.take_profit, '', 8)}</td><td>{fmt(row.stop_loss, '', 8)}</td><td>{fmt(row.unrealized)}</td><td>{fmt(row.realized)}</td><td>{fmt(row.commission)}</td></tr>)}
        {!rows.length && <tr><td colSpan="8">{t(execution ? 'Không có lệnh trong mục này.' : 'Chưa có dữ liệu lệnh tại cutoff này.')}</td></tr>}
      </tbody></table></div>
      <div className="legacy-position-paging">
        <label>{t('Số dòng mỗi trang')}<select aria-label={t('Số dòng mỗi trang')} value={size} onChange={event => { setSize(Number(event.target.value)); setPage(0) }}>{[10, 25, 50].map(value => <option key={value}>{value}</option>)}</select></label>
        <div className="legacy-position-navigation">
          <button type="button" aria-label={t('Trang trước')} disabled={!current} onClick={() => setPage(current - 1)}><ChartIcon name="expand" /></button>
          <select aria-label={t('Trang hiện tại')} value={current} onChange={event => setPage(Number(event.target.value))}>{Array.from({ length: pages }, (_, index) => <option key={index} value={index}>{index + 1}</option>)}</select>
          <span>{t('trên {total}', { total: pages })}</span>
          <button type="button" aria-label={t('Trang sau')} disabled={current >= pages - 1} onClick={() => setPage(current + 1)}><ChartIcon name="collapse" /></button>
        </div>
      </div>
    </div>
  </section>
}
