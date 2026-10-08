import { displayDate } from './dateFormat.js'
import { useState } from 'react'
import ChartIcon from './ChartIcon.jsx'
import { closedChartTrades } from './legacyChartTrades.js'
import { useTestingLocale } from './testingLocale.jsx'

function Month({ date, trades, compact, onDay, locale, t, fmt }) {
  const year = date.getUTCFullYear(), month = date.getUTCMonth(), count = new Date(Date.UTC(year,month+1,0)).getUTCDate(), offset = (new Date(Date.UTC(year,month,1)).getUTCDay()+6)%7
  return <section className={`legacy-calendar-month ${compact ? 'is-mini' : ''}`}><h3>{new Intl.DateTimeFormat(locale,{month:'long',timeZone:'UTC'}).format(date)}</h3><div className="legacy-calendar-grid">{Array.from({length:7},(_,i) => <span className="legacy-calendar-weekday" key={`w${i}`}>{new Intl.DateTimeFormat(locale,{weekday:'short',timeZone:'UTC'}).format(new Date(Date.UTC(2026,9,5+i)))}</span>)}{Array.from({length:offset},(_,i) => <span key={`b${i}`} />)}{Array.from({length:count},(_,i) => {
    const day = i+1, key = `${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`, rows = trades.filter(row => Number.isFinite(row.closed_time_utc) && new Date(row.closed_time_utc*1000).toISOString().slice(0,10) === key)
    const pnl = rows.reduce((sum,row) => sum+Number(row.realized || 0),0)
    return <button type="button" key={key} className={rows.length ? pnl>=0 ? 'is-profit' : 'is-loss' : ''} aria-label={`${displayDate(key)} · ${rows.length} ${t('giao dịch')}`} onClick={() => onDay(key)}><span>{day}</span>{rows.length>0 && !compact && <small>{fmt(pnl)}</small>}</button>
  })}</div></section>
}
export default function LegacyJournal({ execution, symbol, cutoff, onClose, onOpenJournal }) {
  const { t, fmt, locale } = useTestingLocale(), [tab,setTab] = useState('trades'), [mode,setMode] = useState('month'), [search,setSearch] = useState(''), [day,setDay] = useState('')
  const [date,setDate] = useState(() => new Date(Number(cutoff)*1000))
  const closed = closedChartTrades(execution), rows = closed.filter(row => `${symbol} ${row.side} ${row.position_id}`.toLowerCase().includes(search.toLowerCase()) && (!day || new Date(row.closed_time_utc*1000).toISOString().slice(0,10) === day))
  const changeDate = delta => setDate(value => new Date(Date.UTC(value.getUTCFullYear()+(mode==='year'?delta:0),value.getUTCMonth()+(mode==='month'?delta:0),1)))
  const selectDay = value => { setDay(value); setTab('trades') }
  return <section className="legacy-journal" aria-label={t('Journal')}>
    <header><button type="button" aria-label={t('Đóng nhật ký')} onClick={onClose}><ChartIcon name="close" /></button><div role="tablist" aria-label={t('Journal')}>{[['trades','Giao dịch'],['calendar','Lịch']].map(([key,label]) => <button type="button" role="tab" key={key} id={`journal-tab-${key}`} tabIndex={key===tab?0:-1} aria-selected={key===tab} aria-controls="legacy-journal-panel" onClick={() => setTab(key)} onKeyDown={event => {
      if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return
      event.preventDefault()
      const next=event.key==='Home'?'trades':event.key==='End'?'calendar':key==='trades'?'calendar':'trades'
      setTab(next);document.getElementById(`journal-tab-${next}`)?.focus()
    }}>{t(label)}</button>)}</div><a href={onOpenJournal} title={t('Mở trang nhật ký')} aria-label={t('Mở trang nhật ký')}><ChartIcon name="expand" /></a></header>
    <div role="tabpanel" id="legacy-journal-panel" aria-labelledby={`journal-tab-${tab}`}>
      {tab==='trades' ? <><label className="legacy-journal-search"><ChartIcon name="search" /><input type="search" aria-label={t('Tìm giao dịch')} placeholder={t('Tìm giao dịch')} value={search} onChange={event => setSearch(event.target.value)} /></label>{day && <button type="button" className="legacy-journal-day" onClick={() => setDay('')}>{displayDate(day)} ×</button>}<div className="legacy-journal-trades">
        {!execution || !rows.length ? <div className="legacy-journal-empty"><ChartIcon name="journal" /><h3>{t(!execution ? 'Chưa có dữ liệu lệnh tại cutoff này.' : search || day ? 'Không tìm thấy giao dịch' : 'Chưa có giao dịch đã đóng')}</h3></div> : rows.map(row => <article key={row.key}><div><strong>{symbol}</strong><span>{row.side} · {fmt(row.quantity, '', 8)} {t(execution.instrument_spec?.asset_class==='fx'?'lot':'quantity')}</span><time>{displayDate(new Date(row.closed_time_utc*1000), { timeStyle: 'short' })} UTC</time></div><strong className={Number(row.realized)>=0?'is-profit':'is-loss'}>{fmt(row.realized)} {execution.cost_model?.account_ccy || ''}</strong></article>)}
      </div></> : <><div className="legacy-calendar-toolbar"><button type="button" aria-label={t('Khoảng trước')} onClick={() => changeDate(-1)}>‹</button><strong>{new Intl.DateTimeFormat(locale,{year:'numeric',...(mode==='month'?{month:'long'}:{}),timeZone:'UTC'}).format(date)}</strong><button type="button" aria-label={t('Khoảng sau')} onClick={() => changeDate(1)}>›</button><div>{[['month','Tháng'],['year','Năm']].map(([key,label]) => <button type="button" key={key} aria-pressed={mode===key} onClick={() => setMode(key)}>{t(label)}</button>)}</div></div>{!execution && <p role="status">{t('Chưa có dữ liệu lệnh tại cutoff này.')}</p>}<div className={mode==='year'?'legacy-calendar-year':''}>{(mode==='year'?Array.from({length:12},(_,m) => new Date(Date.UTC(date.getUTCFullYear(),m,1))):[date]).map(item => <Month key={item.toISOString()} date={item} trades={closed} compact={mode==='year'} onDay={selectDay} locale={locale} t={t} fmt={fmt} />)}</div></>}
    </div>
  </section>
}
