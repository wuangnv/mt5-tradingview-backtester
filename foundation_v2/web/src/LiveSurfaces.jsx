import { displayDate } from './dateFormat.js'
import { useEffect, useRef, useState } from 'react'
import { useTestingLocale } from './testingLocale.jsx'
import FxSelect from './FxSelect.jsx'
import TestingIcon from './TestingIcon.jsx'
import { DateFilter, timezoneOptions } from './AnalyticsFilterControls.jsx'
import LiveBrokerSnapshot from './LiveBrokerSnapshot.jsx'
import { LIVE_FILTERS, calendarWeeks, cumulativeDealSeries, dayKey, dealNet, filterLiveDeals, summarizeDeals } from './liveWorkspaceModel.js'

function Action({ children, icon, primary, compact, onClick, label, ...props }) {
  const { t } = useTestingLocale()
  return <button type="button" className={`fxa-button${primary ? ' is-primary' : ''}${compact ? ' fxa-icon-button' : ''}`} aria-label={label ? t(label) : undefined} onClick={onClick} {...props}>{icon && <TestingIcon kind={icon} />}{children}</button>
}

function Empty({ title, copy, icon = 'chart', action, onAction }) {
  const { t } = useTestingLocale()
  return <div className="live-empty" data-testid="live-empty"><div className="live-empty-art" aria-hidden="true"><TestingIcon kind={icon} size={72} /></div><h2>{t(title)}</h2>{copy && <p>{t(copy)}</p>}{action && <Action primary icon="plus" onClick={onAction}>{t(action)}</Action>}</div>
}

function PreviewDialog({ action, onClose }) {
  const { t } = useTestingLocale(), ref = useRef(null)
  useEffect(() => {
    const dialog = ref.current, opener = document.activeElement
    dialog.showModal()
    return () => { if (dialog.open) dialog.close(); if (opener?.isConnected) opener.focus({ preventScroll: true }) }
  }, [])
  const form = ['New note', 'Add trade', 'Manual account'].includes(action)
  return <dialog ref={ref} className="live-preview-dialog" aria-labelledby="live-preview-title" onCancel={onClose} onClose={onClose}>
    <div className="live-section-heading"><h2 id="live-preview-title">{t(action)}</h2><Action compact label="Đóng" onClick={onClose}>×</Action></div>
    <span className="live-preview-badge">{t('Interface preview')}</span>
    <p>{t('This layout is a preview. Changes are not saved and no connection is made.')}</p>
    {form && <div className="live-preview-fields"><label>{t(action === 'Add trade' ? 'Asset' : 'Name')}<input autoComplete="off" /></label>{action === 'Add trade' ? <label>{t('Quantity')}<input type="number" min="0" /></label> : <label>{t('Description')}<textarea rows="4" /></label>}</div>}
    {action === 'Upload file' && <div className="live-upload"><TestingIcon kind="upload" size={32} /><strong>{t('CSV file import')}</strong><span>{t('Import settings will be added later.')}</span></div>}
    <div className="live-dialog-footer"><Action onClick={onClose}>{t('Đóng')}</Action></div>
  </dialog>
}

function Search({ label, value, onChange }) {
  const { t } = useTestingLocale()
  return <label className="live-search"><TestingIcon kind="search" /><input type="search" aria-label={t(label)} placeholder={t(label)} value={value} onChange={event => onChange(event.target.value)} /></label>
}

function FilterFields({ draft, setDraft, payload, onPreview }) {
  const { t } = useTestingLocale()
  const change = patch => setDraft(current => ({ ...current, ...patch }))
  const assets = [...new Set((payload?.deals || []).map(deal => deal.symbol).filter(Boolean))].sort()
  const select = (key, label, options, extra = {}) => <FxSelect label={label} triggerContent={label} value={draft[key]} onChange={value => change({ [key]: value })} options={options} {...extra} />
  return <>
    {select('asset', 'Assets', [{ value: 'all', label: 'All assets' }, ...assets.map(value => ({ value, label: value, localize: false }))], { searchable: true })}
    {select('side', 'Side', [{ value: 'all', label: 'All sides' }, { value: '0', label: 'Buy' }, { value: '1', label: 'Sell' }])}
    {select('outcome', 'Deal result', [{ value: 'all', label: 'All results' }, { value: 'gain', label: 'Positive P/L' }, { value: 'loss', label: 'Negative P/L' }, { value: 'flat', label: 'Zero P/L' }])}
    <Action icon="tags" onClick={() => onPreview('Tags')}>{t('Tags')}</Action>
    {select('account', 'Accounts', [{ value: 'all', label: 'All accounts' }, ...(payload?.account ? [{ value: payload.account.account_ref, label: String(payload.account.account_ref), localize: false }] : [])])}
    {select('day', 'Day', [{ value: 'all', label: 'All days' }, ...['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((label, i) => ({ value: String(i), label }))])}
    {select('timezone', 'Timezone', timezoneOptions.map(option => ({ ...option, localize: false })), { searchable: true })}
    <DateFilter value={draft} onChange={change} label="Date range" title="Date range" calendarLabel="Date range" />
  </>
}

function FilterBar({ section, payload, draft, setDraft, applied, onApply, onClear, onPreview, onRefresh }) {
  const { t } = useTestingLocale(), [show, setShow] = useState(false)
  const chips = Object.entries(applied).filter(([key, value]) => value !== LIVE_FILTERS[key] && value !== '')
  const labels = { asset: 'Assets', side: 'Side', outcome: 'Deal result', account: 'Accounts', day: 'Day', timezone: 'Timezone', from: 'Start', to: 'End' }
  const values = { side: { 0: 'Buy', 1: 'Sell' }, outcome: { gain: 'Positive P/L', loss: 'Negative P/L', flat: 'Zero P/L' }, day: ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'] }
  const fields = <><FilterFields draft={draft} setDraft={setDraft} payload={payload} onPreview={onPreview} /><Action primary onClick={() => onApply()}>{t('Áp dụng')}</Action></>
  return <section className="live-filters" aria-label={t('Filters')}>
    {section === 'analytics' ? <div className="live-filter-fields">{fields}</div> : <>
      <div className="live-toolbar"><FxSelect label="Accounts" value={draft.account} onChange={account => { setDraft(current => ({ ...current, account })); onApply({ ...applied, account }) }} options={[{ value: 'all', label: 'All accounts' }, ...(payload?.account ? [{ value: payload.account.account_ref, label: String(payload.account.account_ref), localize: false }] : [])]} />
        <div className="live-toolbar-actions">{section === 'trades' && <Action compact icon="columns" label="Cột hiển thị" onClick={() => onPreview('Table columns')} />}
          <span className="live-filter-divider" aria-hidden="true" /><span>{t('Filter by')}</span><Action aria-expanded={show} onClick={() => setShow(!show)}>{t('Basic')}</Action><Action onClick={() => onPreview(section === 'tag-analytics' ? 'Advanced filters' : 'Tags')}>{t(section === 'tag-analytics' ? 'Advanced' : 'Tags')}</Action>
        </div>
      </div>{show && <div className="live-filter-fields">{fields}</div>}
    </>}
    {chips.length > 0 && <div className="live-filter-chips">{chips.map(([key, value]) => <span key={key}>{t(labels[key])}: {['from', 'to'].includes(key) ? displayDate(value) : values[key]?.[value] ? t(values[key][value]) : value}</span>)}<button type="button" className="fxa-clear-filters" onClick={onClear}><TestingIcon kind="delete" />{t('Clear filters')}</button></div>}
    {draft.from && draft.to && draft.from > draft.to && <p role="alert">{t('Start date must not be after end date.')}</p>}
  </section>
}

function Summary({ payload, deals, sidebar = false }) {
  const { t, fmt } = useTestingLocale(), available = Boolean(payload?.account && Array.isArray(payload.deals))
  const summary = summarizeDeals(deals, available), currency = payload?.account?.currency || ''
  const metrics = [['Net deal P/L', summary.net, currency], ['Filled deals', summary.count, ''], ['Return (%)', null, '']]
  return <section className={sidebar ? 'live-analytics-side' : 'live-metrics'} aria-label={t('Analytics')}>
    {sidebar && <h2><TestingIcon kind="chart" />{t('Analytics')}</h2>}
    {!available || !deals.length ? <Empty title="No analytics yet" copy={available ? 'No deals in this selection.' : 'Select a connected account to view analytics.'} /> : <>
      <dl>{metrics.map(([label, value, suffix]) => <div key={label}><dt>{t(label)}</dt><dd className={label === 'Net deal P/L' ? summary.net < 0 ? 'is-loss' : summary.net > 0 ? 'is-gain' : '' : ''}>{fmt(value, suffix ? ` ${suffix}` : '', label === 'Filled deals' ? 0 : 2)}</dd></div>)}</dl>
    </>}
  </section>
}

function PnlCurve({ deals, currency, emptyTitle = 'No analytics yet' }) {
  const { t, fmt } = useTestingLocale(), series = cumulativeDealSeries(deals), known = series.filter(point => point.value !== null)
  const values = [0, ...known.map(point => point.value)], min = Math.min(...values), max = Math.max(...values), range = max - min || 1
  const x = i => 70 + i / Math.max(1, series.length - 1) * 700, y = value => 240 - (value - min) / range * 180
  const path = series.map((point, i) => point.value === null ? '' : `${i === 0 || series[i - 1].value === null ? 'M' : 'L'}${x(i)},${y(point.value)}`).join(' ')
  return <section className="live-pnl-curve"><div className="live-section-heading"><h2>{t('Cumulative deal P/L')}</h2><span className="live-muted">{currency || '—'}</span></div>
    {known.length ? <><svg viewBox="0 0 800 290" role="img" aria-label={t('Cumulative deal P/L')} preserveAspectRatio="xMidYMid meet">
      {[0, 1, 2, 3].map(i => { const value = min + range * i / 3; return <g key={i}><line x1="70" x2="770" y1={y(value)} y2={y(value)} /><text x="60" y={y(value)} textAnchor="end" dominantBaseline="middle">{fmt(value)}</text></g> })}
      <path d={path} className="live-pnl-line" />{known.length === 1 && <circle cx={x(0)} cy={y(known[0].value)} r="4" className="live-pnl-point" />}
    </svg><div className="live-curve-range"><span>{dayKey(series[0].time)}</span><span>{dayKey(series.at(-1).time)} · UTC</span></div>{series.some(point => point.value === null) && <p className="live-muted">{t('Curve stops where deal costs are incomplete.')}</p>}</> : <Empty title={emptyTitle} copy="P/L will appear when complete deal data is available." />}
  </section>
}

function Calendar({ payload, deals, filters, onPreview }) {
  const { t, fmt, locale } = useTestingLocale()
  const [month, setMonth] = useState(() => dayKey(Date.parse(payload?.captured_at_utc) || Date.now(), filters.timezone).slice(0, 7)), [selected, setSelected] = useState('')
  const first = new Date(`${month}-01T00:00:00Z`), weeks = calendarWeeks(month, payload, deals, filters)
  const shift = delta => { setSelected(''); setMonth(new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + delta, 1)).toISOString().slice(0, 7)) }
  const rows = deals.filter(deal => dayKey(deal.time_msc, filters.timezone).startsWith(month))
  const total = summarizeDeals(rows, Boolean(payload?.account && Array.isArray(payload.deals) && weeks.flat().some(day => day.count !== null)))
  const currency = payload?.account?.currency || ''
  return <div className="live-split"><section className="live-calendar-section">
    <div className="live-calendar-toolbar"><div className="live-month-nav"><div className="live-month-step"><Action compact label="Previous month" onClick={() => shift(-1)}>‹</Action><h2 aria-live="polite">{first.toLocaleDateString(locale, { month: 'long', timeZone: 'UTC' })}</h2><Action compact label="Next month" onClick={() => shift(1)}>›</Action></div><div className="live-month-step"><Action compact label="Previous year" onClick={() => shift(-12)}>‹</Action><strong>{first.getUTCFullYear()}</strong><Action compact label="Next year" onClick={() => shift(12)}>›</Action></div></div>
      <div className="live-toolbar-actions"><span className="live-money-mode">{currency || t('Amount')}</span><Action disabled title={t('Percentage requires opening capital.')}>%</Action><Action onClick={() => onPreview('Share')}>{t('Share')}</Action><Action icon="plus" onClick={() => onPreview('Monthly review')}>{t('Monthly review')}</Action></div>
    </div>
    <div className="live-calendar-scroll" role="region" aria-label={`${t('P/L calendar')} · ${filters.timezone}`} tabIndex={0}><div className="live-calendar-grid">
      {['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su', 'Total'].map(day => <div className="live-calendar-dayname" key={day}>{t(day)}</div>)}
      {weeks.map((week, index) => <div className="live-calendar-week" key={week[0].key}>{week.map(day => <button type="button" key={day.key} className={`live-calendar-cell${!day.inMonth ? ' is-outside' : ''}${day.net > 0 ? ' is-gain' : day.net < 0 ? ' is-loss' : ''}`} disabled={!day.inMonth} aria-pressed={selected === day.key} aria-label={`${displayDate(day.key)} · ${fmt(day.net, currency ? ` ${currency}` : '')}`} onClick={() => setSelected(selected === day.key ? '' : day.key)}>
        <span className="live-day-number">{day.date.getUTCDate()}</span><strong>{day.inMonth ? fmt(day.net) : ''}</strong>{day.count !== null && day.count > 0 && <small>{t('{count} filled deals', { count: day.count })}</small>}
      </button>)}<div className="live-week-total"><span>{t('Week {count}', { count: index + 1 })}</span><strong>{fmt(week.filter(day => day.inMonth).every(day => day.net !== null) ? week.filter(day => day.inMonth).reduce((sum, day) => sum + day.net, 0) : null)}</strong></div></div>)}
    </div></div>
    <div className="live-month-total"><span>{t('Month total')}</span><strong>{fmt(total.net, currency ? ` ${currency}` : '')}</strong><span>{total.count !== null ? t('{count} filled deals', { count: total.count }) : '—'}</span></div>
    {selected && <div className="live-day-detail"><h3>{displayDate(selected)}</h3>{deals.filter(deal => dayKey(deal.time_msc, filters.timezone) === selected).length ? <ul>{deals.filter(deal => dayKey(deal.time_msc, filters.timezone) === selected).map(deal => <li key={deal.ticket}><span>{deal.symbol} · #{deal.ticket}</span><strong>{fmt(dealNet(deal), currency ? ` ${currency}` : '')}</strong></li>)}</ul> : <p>{t(weeks.flat().find(day => day.key === selected)?.covered ? 'No deals recorded for this day.' : 'Data for this day is unavailable or incomplete.')}</p>}</div>}
  </section><Summary payload={payload} deals={rows} sidebar /></div>
}

function Notes({ onPreview }) {
  const { t } = useTestingLocale(), [search, setSearch] = useState(''), [group, setGroup] = useState('all')
  return <section className="live-notes"><div className="live-toolbar"><Action primary icon="plus" onClick={() => onPreview('New note')}>{t('New note')}</Action><div className="live-toolbar-actions"><Action compact icon="journal" label="Edit notes" onClick={() => onPreview('Edit notes')} /><Search label="Search notes" value={search} onChange={setSearch} /><FxSelect label="Group by" value={group} onChange={setGroup} options={[{ value: 'all', label: 'All' }, { value: 'account', label: 'Accounts' }, { value: 'tag', label: 'Tags' }]} /><Action icon="settings" onClick={() => onPreview('Note filters')}>{t('Filters')}</Action></div></div>
    <div className="live-notes-groups"><span><TestingIcon kind="journal" />{t('All')}</span><Action compact icon="plus" label="Add note group" onClick={() => onPreview('Add note group')} /></div>
    <Empty title="No notes yet" copy="Keep your observations and review notes here." icon="journal" action="Add note" onAction={() => onPreview('New note')} />
  </section>
}

function Tags({ onPreview }) {
  const { t } = useTestingLocale(), [search, setSearch] = useState(''), [list, setList] = useState(true)
  return <section className="live-tag-analysis"><div className={`live-tag-grid${list ? '' : ' is-hidden'}`}><section className="live-tag-chart"><div className="live-section-heading"><h2>{t('P/L by tag')}</h2><Action onClick={() => setList(!list)}>{t(list ? 'Hide tag list' : 'Show tag list')}</Action></div><Empty title="No tag analysis yet" copy="Synced broker deals do not include journal tags." icon="tags" /></section>{list && <section className="live-tag-list" aria-label={t('Tag list')}><Search label="Search tags" value={search} onChange={setSearch} /><p className="live-muted">{t('No tags available.')}</p></section>}</div>
    <div className="live-table-scroll" tabIndex={0} role="region" aria-label={t('Tag summary')}><table><thead><tr>{['Tag group', 'Trades', 'Win rate', 'Net P/L'].map(label => <th key={label}>{t(label)}</th>)}</tr></thead><tbody><tr><td>{t('Overall')}</td><td>—</td><td>—</td><td>—</td></tr></tbody></table></div>
    <details className="live-smart-picks"><summary>{t('Smart Picks')}</summary><p>{t('Interface preview')}</p><Action icon="plus" onClick={() => onPreview('Smart Picks')}>{t('Explore')}</Action></details>
  </section>
}

function AddAccount({ onPreview }) {
  const { t } = useTestingLocale()
  return <section className="live-add-account" aria-labelledby="live-add-account-title"><h2 id="live-add-account-title">{t('Add account')}</h2><p className="live-muted">{t('Format your file before importing.')}</p><Action icon="download" onClick={() => onPreview('CSV template')}>{t('CSV template')}</Action>
    <button type="button" className="live-upload" onClick={() => onPreview('Upload file')}><TestingIcon kind="upload" size={32} /><strong>{t('Upload file')}</strong><span>{t('Import your trade history')}</span></button>
    <span className="live-or">{t('or')}</span><button type="button" className="live-manual-account" onClick={() => onPreview('Manual account')}><span><strong>{t('Manual')}</strong><small>{t('Create a manual account')}</small></span><TestingIcon kind="plus" /></button>
    <span className="live-or">{t('or')}</span><h3>{t('Sync with broker')}</h3><div className="live-provider-grid">{['Tradovate', 'NinjaTrader', 'Alpaca', 'Webull', 'MetaTrader', 'TradeLocker', 'cTrader'].map(name => <button key={name} type="button" onClick={() => onPreview(name)}><span aria-hidden="true">{name.slice(0, 2)}</span><small>{name}</small></button>)}</div><p className="live-muted">{t('Connection options · interface preview')}</p>
  </section>
}

function Accounts({ payload, query, onPreview }) {
  const { t } = useTestingLocale(), [search, setSearch] = useState(''), [filter, setFilter] = useState('all')
  const transactions = query.get('account_tab') === 'transactions', match = payload?.account && `${payload.source} ${payload.account.account_ref}`.toLowerCase().includes(search.toLowerCase())
  return <div className="live-accounts-layout"><section><div className="live-toolbar"><span>{t(transactions ? 'Transactions' : 'Connected accounts')}</span><div className="live-toolbar-actions"><Search label="Search accounts" value={search} onChange={setSearch} /><FxSelect label="Account filter" value={filter} onChange={setFilter} options={[{ value: 'all', label: 'All accounts' }, { value: 'connected', label: 'Connected accounts' }]} /></div></div>
    {match ? <LiveBrokerSnapshot payload={payload} section={transactions ? 'transactions' : 'trading-accounts'} /> : <Empty title={payload?.account ? 'No matching accounts' : 'No accounts yet'} copy="Add an account to keep your trade history in one place." icon="account" />}
  </section><AddAccount onPreview={onPreview} /></div>
}

export default function LiveSurfaces({ section, payload, query, preview, onRefresh }) {
  const { t } = useTestingLocale(), [draft, setDraft] = useState({ ...LIVE_FILTERS }), [applied, setApplied] = useState({ ...LIVE_FILTERS }), [action, setAction] = useState(null)
  const deals = filterLiveDeals(payload, applied), clear = () => { setDraft({ ...LIVE_FILTERS }); setApplied({ ...LIVE_FILTERS }) }
  const apply = override => { const next = override || draft; if (!next.from || !next.to || next.from <= next.to) setApplied({ ...next }) }
  return <>
    <header className="live-topbar"><h1 className="sr-only">{t('Live')}</h1><div className="live-toolbar-actions"><Action primary icon="plus" onClick={() => setAction('Add trade')}>{t('Add trade')}</Action><Action compact icon="upload" label="Upload file" onClick={() => setAction('Upload file')} /></div></header>
    {!['notes', 'trading-accounts'].includes(section) && <FilterBar section={section} payload={payload} draft={draft} setDraft={setDraft} applied={applied} onApply={apply} onClear={clear} onPreview={setAction} onRefresh={onRefresh} />}
    {section === 'calendar' && <Calendar payload={payload} deals={deals} filters={applied} onPreview={setAction} />}
    {section === 'trades' && <div className="live-split"><section>{payload?.account && Array.isArray(payload.deals) ? <LiveBrokerSnapshot payload={payload} section="trades" deals={deals} filterKey={JSON.stringify(applied)} /> : <Empty title="No trades yet" copy="Your synced deals will appear here." icon="journal" />}</section><Summary payload={payload} deals={deals} sidebar /></div>}
    {section === 'notes' && <Notes onPreview={setAction} />}
    {section === 'tag-analytics' && <Tags onPreview={setAction} />}
    {section === 'analytics' && <><Summary payload={payload} deals={deals} />{deals.length > 0 && <PnlCurve deals={deals} currency={payload?.account?.currency} />}</>}
    {section === 'trading-accounts' && <Accounts payload={payload} query={query} onPreview={setAction} />}
    {action && <PreviewDialog action={action} onClose={() => setAction(null)} />}
  </>
}
