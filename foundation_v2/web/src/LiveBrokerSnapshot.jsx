import React, { useState } from 'react'
import { formatUtc } from './researchDataApi.js'

const number = value => typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString('vi-VN', { maximumFractionDigits: 5 }) : 'N/A'
const entry = { 0: 'Vào', 1: 'Thoát', 2: 'Đảo chiều', 3: 'Close by' }

export default function LiveBrokerSnapshot({ payload, section, preview = false }) {
  const [search, setSearch] = useState(''), [page, setPage] = useState(1)
  const account = payload.account
  if (!account) return null
  const deals = (payload.deals || []).filter(deal => `${deal.symbol} ${deal.ticket}`.toLowerCase().includes(search.toLowerCase()))
  const pages = Math.max(1, Math.ceil(deals.length / 20)), current = Math.min(page, pages)
  const visible = deals.slice((current - 1) * 20, current * 20)
  return <section className="live-broker" aria-label="Snapshot broker" data-testid="live-broker-snapshot">
    <div className="live-section-heading"><h2>{payload.source} · {account.account_ref} · Demo</h2><span className="live-badge">{preview ? 'Dữ liệu mẫu' : payload.stale ? 'Dữ liệu cũ / mất kết nối' : 'Đã đồng bộ'}</span></div>
    {!preview && <p className="live-snapshot-time">Snapshot {new Date(payload.captured_at_utc).toLocaleString('vi-VN', { timeZone: 'UTC' })} UTC · Đọc lại khoảng {payload.poll_seconds}s · Broker send đã khóa</p>}
    <dl className="live-account-values">{[['Balance', account.balance], ['Equity', account.equity], ['Floating P/L', account.profit], ['Margin', account.margin], ['Free margin', account.margin_free]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{number(value)} <small>{account.currency}</small></dd></div>)}</dl>
    {section === 'trading-accounts' && <>
      <h3>Vị thế đang mở ({payload.positions?.length || 0})</h3>
      {!payload.positions?.length ? <p>Broker không có vị thế mở tại snapshot này.</p> : <div className="live-table-scroll" tabIndex={0} role="region" aria-label="Bảng dữ liệu broker"><table><thead><tr><th>Ticket</th><th>Symbol</th><th>Side</th><th>Lot</th><th>Entry</th><th>SL / TP</th><th>P/L</th></tr></thead><tbody>{payload.positions.map(item => <tr key={item.ticket}><td>{item.ticket}</td><td>{item.symbol}</td><td>{item.type === 0 ? 'Buy' : 'Sell'}</td><td>{number(item.volume)}</td><td>{number(item.price_open)}</td><td>{number(item.sl)} / {number(item.tp)}</td><td>{number(item.profit)} {account.currency}</td></tr>)}</tbody></table></div>}
      <h3>Lệnh chờ ({payload.orders?.length || 0})</h3>
      {!payload.orders?.length ? <p>Broker không có lệnh chờ tại snapshot này.</p> : <div className="live-table-scroll" tabIndex={0} role="region" aria-label="Bảng dữ liệu broker"><table><thead><tr><th>Ticket</th><th>Symbol</th><th>Loại MT5</th><th>Lot</th><th>Giá</th></tr></thead><tbody>{payload.orders.map(item => <tr key={item.ticket}><td>{item.ticket}</td><td>{item.symbol}</td><td>{item.type}</td><td>{number(item.volume_current)}</td><td>{number(item.price_open)}</td></tr>)}</tbody></table></div>}
      <h3>Giá broker gần nhất</h3><div className="live-table-scroll" tabIndex={0} role="region" aria-label="Bảng dữ liệu broker"><table><thead><tr><th>Symbol</th><th>Bid</th><th>Ask</th><th>Thời điểm tick UTC</th></tr></thead><tbody>{(payload.quotes || []).map(quote => <tr key={quote.symbol}><td>{quote.symbol}</td><td>{number(quote.bid)}</td><td>{number(quote.ask)}</td><td>{formatUtc(quote.time_msc / 1000)}{Date.now() - quote.time_msc > 120000 && ' · Giá cũ'}</td></tr>)}</tbody></table></div>
    </>}
    {section === 'trades' && <>
      <div className="live-deals-toolbar"><h3>Broker deals ({payload.deal_count})</h3><input type="search" aria-label="Tìm deal broker" placeholder="Symbol hoặc ticket…" value={search} onChange={event => { setSearch(event.target.value); setPage(1) }} /></div>
      <p>Mỗi dòng là một deal khớp lệnh, chưa gộp thành trade. Nạp/rút tiền được tách riêng. Phạm vi đồng bộ bắt đầu {new Date(payload.history_from_utc).toLocaleDateString('vi-VN', { timeZone: 'UTC' })} UTC; giữ deals đã đọc qua các lần mở app.</p>
      {!deals.length ? <p data-testid="live-deals-empty">Chưa có deal BUY/SELL trong dữ liệu đã đồng bộ.</p> : <div className="live-table-scroll" tabIndex={0} role="region" aria-label="Bảng dữ liệu broker"><table><thead><tr><th>UTC / Ticket</th><th>Symbol</th><th>Side / Entry</th><th>Lot</th><th>Giá khớp</th><th>Profit</th><th>Commission</th><th>Swap</th><th>Fee</th></tr></thead><tbody>{visible.map(deal => <tr key={deal.ticket}><td>{formatUtc(deal.time_msc / 1000)}<small>#{deal.ticket} · Position {deal.position_id}</small></td><td>{deal.symbol}</td><td>{deal.type === 0 ? 'Buy' : 'Sell'} · {entry[deal.entry] || 'Chưa rõ'}</td><td>{number(deal.volume)}</td><td>{number(deal.price)}</td><td>{number(deal.profit)}</td><td>{number(deal.commission)}</td><td>{number(deal.swap)}</td><td>{number(deal.fee)}</td></tr>)}</tbody></table></div>}
      <div className="live-deals-toolbar"><span>Đơn vị tiền: {account.currency} · {payload.cashflows?.length || 0} sự kiện khác BUY/SELL</span><div><button type="button" disabled={current === 1} onClick={() => setPage(current - 1)}>Trước</button><span> {current} / {pages} </span><button type="button" disabled={current >= pages} onClick={() => setPage(current + 1)}>Sau</button></div></div>
    </>}
  </section>
}
