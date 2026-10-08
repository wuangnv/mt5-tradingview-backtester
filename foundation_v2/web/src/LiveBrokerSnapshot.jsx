import { useEffect, useState } from 'react'
import { useTestingLocale } from './testingLocale.jsx'
import { formatUtc } from './researchDataApi.js'
import PaginationFooter from './PaginationFooter.jsx'
import TestingIcon from './TestingIcon.jsx'
import { dealNet } from './liveWorkspaceModel.js'

export default function LiveBrokerSnapshot({ payload, section, deals: filteredDeals, filterKey = '' }) {
  const { t, fmt, locale } = useTestingLocale()
  const [search, setSearch] = useState(''), [page, setPage] = useState(1), [pageSize, setPageSize] = useState(20)
  useEffect(() => setPage(1), [search, pageSize, filterKey])
  const account = payload.account
  if (!account) return null
  const currency = account.currency || '', money = value => fmt(value, currency ? ` ${currency}` : '')
  const time = value => typeof value === 'number' && Number.isFinite(value) ? formatUtc(value / 1000, locale) : '—'
  const side = value => value === 0 ? t('Buy') : value === 1 ? t('Sell') : '—'
  const entries = ['Entry', 'Exit', 'Reversal', 'Close by']
  const deals = (section === 'transactions' ? payload.cashflows || [] : filteredDeals || payload.deals || []).filter(deal => `${deal.symbol || ''} ${deal.ticket}`.toLowerCase().includes(search.toLowerCase()))
  const pages = Math.max(1, Math.ceil(deals.length / pageSize)), current = Math.min(page, pages), visible = deals.slice((current - 1) * pageSize, current * pageSize)
  const table = (label, headers, rows) => <div className="live-table-scroll" tabIndex={0} role="region" aria-label={t(label)}><table><thead><tr>{headers.map(label => <th key={label}>{t(label)}</th>)}</tr></thead><tbody>{rows}</tbody></table></div>
  return <section className="live-broker" aria-label={t('Broker snapshot')} data-testid="live-broker-snapshot">
    {section === 'trading-accounts' ? <>
      <div className="live-section-heading"><h2>{payload.source} · {account.account_ref}</h2><span className="live-badge">{t('Read only')}</span></div>
      <dl className="live-account-values">{[['Balance', account.balance], ['Equity', account.equity], ['Floating P/L', account.profit], ['Margin', account.margin], ['Free margin', account.margin_free]].map(([label, value]) => <div key={label}><dt>{t(label)}</dt><dd>{money(value)}</dd></div>)}</dl>
      <details className="live-account-detail"><summary>{t('Open positions')} ({Array.isArray(payload.positions) ? payload.positions.length : '—'})</summary>{payload.positions?.length ? table('Open positions', ['Ticket', 'Asset', 'Side', 'Lot', 'Entry price', 'SL / TP', 'P/L'], payload.positions.map(item => <tr key={item.ticket}><td>{item.ticket}</td><td>{item.symbol}</td><td>{side(item.type)}</td><td>{fmt(item.volume, '', 5)}</td><td>{fmt(item.price_open, '', 5)}</td><td>{fmt(item.sl, '', 5)} / {fmt(item.tp, '', 5)}</td><td>{money(item.profit)}</td></tr>)) : <p>{t(Array.isArray(payload.positions) ? 'No open positions in this snapshot.' : 'Position data is unavailable.')}</p>}</details>
      <details className="live-account-detail"><summary>{t('Pending orders')} ({Array.isArray(payload.orders) ? payload.orders.length : '—'})</summary>{payload.orders?.length ? table('Pending orders', ['Ticket', 'Asset', 'MT5 type', 'Lot', 'Price'], payload.orders.map(item => <tr key={item.ticket}><td>{item.ticket}</td><td>{item.symbol}</td><td>{item.type}</td><td>{fmt(item.volume_current, '', 5)}</td><td>{fmt(item.price_open, '', 5)}</td></tr>)) : <p>{t(Array.isArray(payload.orders) ? 'No pending orders in this snapshot.' : 'Order data is unavailable.')}</p>}</details>
      <details className="live-account-detail"><summary>{t('Latest broker quotes')}</summary>{payload.quotes?.length ? table('Latest broker quotes', ['Asset', 'Bid', 'Ask', 'Tick time (UTC)'], payload.quotes.map(quote => <tr key={quote.symbol}><td>{quote.symbol}</td><td>{fmt(quote.bid, '', 5)}</td><td>{fmt(quote.ask, '', 5)}</td><td>{time(quote.time_msc)}{Date.now() - quote.time_msc > 120000 && ` · ${t('Stale quote')}`}</td></tr>)) : <p>{t('No quotes in this snapshot.')}</p>}</details>
    </> : <>
      <div className="live-deals-toolbar" title={t(section === 'transactions' ? 'Deposits, withdrawals and other non-trading events are listed separately.' : 'Each row is a filled deal; entries and exits have not been paired into trades.')}><h2>{t(section === 'transactions' ? 'Transactions' : 'Filled deals')} · {deals.length}</h2><label className="live-search"><TestingIcon kind="search" /><input type="search" aria-label={t('Search symbol or ticket')} placeholder={t('Search symbol or ticket')} value={search} onChange={event => setSearch(event.target.value)} /></label></div>
      {!deals.length ? <div className="live-empty" data-testid="live-deals-empty"><TestingIcon kind={section === 'transactions' ? 'account' : 'journal'} size={48} /><h3>{t(section === 'transactions' ? 'No transactions yet' : 'No deals in this selection.')}</h3></div> : section === 'transactions' ? table('Transactions', ['Time (UTC)', 'Ticket', 'MT5 type', 'Amount', 'Comment'], visible.map(deal => <tr key={deal.ticket}><td>{time(deal.time_msc)}</td><td>{deal.ticket}</td><td>{deal.type}</td><td>{money(deal.profit)}</td><td>{deal.comment || '—'}</td></tr>)) : table('Broker deals', ['Time (UTC) / Ticket', 'Asset', 'Side / Entry', 'Lot', 'Fill price', 'Profit', 'Commission', 'Swap', 'Fee', 'Net P/L'], visible.map(deal => <tr key={deal.ticket}><td>{time(deal.time_msc)}<small>#{deal.ticket} · {t('Position')} {deal.position_id ?? '—'}</small></td><td>{deal.symbol}</td><td>{side(deal.type)} · {entries[deal.entry] ? t(entries[deal.entry]) : '—'}</td><td>{fmt(deal.volume, '', 5)}</td><td>{fmt(deal.price, '', 5)}</td><td>{fmt(deal.profit)}</td><td>{fmt(deal.commission)}</td><td>{fmt(deal.swap)}</td><td>{fmt(deal.fee)}</td><td className={dealNet(deal) > 0 ? 'is-gain' : dealNet(deal) < 0 ? 'is-loss' : ''}>{fmt(dealNet(deal))}</td></tr>))}
      {deals.length > 0 && <PaginationFooter label="Live data pagination" page={current} pages={pages} onPageChange={setPage} pageSize={pageSize} onPageSizeChange={value => { setPageSize(value); setPage(1) }} sizes={[10,20,50,100]} meta={<>{currency} · {t('Paging synced data locally')}</>} />}
    </>}
  </section>
}
