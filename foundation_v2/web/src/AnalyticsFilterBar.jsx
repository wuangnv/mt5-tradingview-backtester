import { useTestingLocale } from './testingLocale.jsx'
import React, { useEffect, useState } from 'react'
import FxSelect from './FxSelect.jsx'
import { DEFAULT_EXTRA_FILTERS, WEEKDAYS, filterValues } from './tradingAnalyticsModel.js'

import { DateFilter, TimeFilter, timezoneOptions } from './AnalyticsFilterControls.jsx'

export default function AnalyticsFilterBar({ filters, onChange, extra, onExtra, rows, onExport, pending, sessionControl, persistInUrl = true, sourceType = 'Backtesting' }) {
  const { t } = useTestingLocale()

  const [draft, setDraft] = useState({ ...filters })
  const [draftExtra, setDraftExtra] = useState({ ...extra })
  const sessionProps = sessionControl?.props
  const [draftSession, setDraftSession] = useState(sessionProps?.value)
  useEffect(() => setDraft({ ...filters }), [filters])
  useEffect(() => setDraftExtra({ ...extra }), [extra])
  useEffect(() => setDraftSession(sessionProps?.value), [sessionProps?.value])
  const unique = key => [...new Set(rows.flatMap(row => key === 'tags' ? row.tags || [] : row[key] ? [row[key]] : []))].sort()
  const change = patch => setDraft(value => ({ ...value, ...patch }))
  const changeExtra = patch => setDraftExtra(value => ({ ...value, ...patch }))
  const apply = (next = draft, nextExtra = draftExtra, nextSession = draftSession) => {
    // A session change remounts its report: persist the entire applied scope first.
    if (persistInUrl) {
      const url = new URL(window.location.href)
      url.searchParams.delete('from_close_utc'); url.searchParams.delete('to_close_utc')
      for (const key of ['side', 'outcome', 'from', 'to']) next[key] && next[key] !== 'all' ? url.searchParams.set(key, next[key]) : url.searchParams.delete(key)
      for (const [key, value] of Object.entries(nextExtra)) {
        const param = key === 'source' ? 'analytics_trade_source' : `analytics_${key}`
        value !== DEFAULT_EXTRA_FILTERS[key] ? url.searchParams.set(param, value) : url.searchParams.delete(param)
      }
      window.history.replaceState({}, '', url)
    }
    onChange(next); onExtra(nextExtra)
    if (sessionProps && nextSession !== sessionProps.value) sessionProps.onChange(nextSession)
  }
  const options = (allLabel, values) => [{ value: 'all', label: allLabel }, ...values.map(value => ({ value, label: value, localize: false }))]
  const pill = (label, key, values, server = false, searchable = false) => <FxSelect key={key} label={label} triggerContent={label} value={(server ? draft : draftExtra)[key]} options={values} searchable={searchable} onChange={value => server ? change({ [key]: value }) : changeExtra({ [key]: value })} />
  const sessionName = sessionProps?.items.find(item => item.record_id === sessionProps.value)?.name
  const chips = [
    ['asset', 'Assets', extra.asset, false], ['side', 'Side', filters.side, true], ['outcome', 'Outcome', filters.outcome, true],
    ['tag', 'Tags', extra.tag, false], ['strategy', 'Strategy', extra.strategy, false],
    ['weekday', 'Day', extra.weekday === 'all' ? 'all' : WEEKDAYS[Number(extra.weekday)], false],
    ['hour', 'Time', extra.hour === 'all' ? 'all' : `${String(extra.hour).padStart(2, '0')}:00–${String(extra.hour).padStart(2, '0')}:59`, false],
    ['reportKinds', 'Type', extra.reportKinds === '' ? 'all' : filterValues(extra.reportKinds).join(', ') || 'None', false],
    ['timeStart', 'Start', extra.timeStart || 'all', false], ['timeEnd', 'End', extra.timeEnd || 'all', false],
    ['timezone', 'Timezone', extra.timezone === 'UTC' ? 'all' : extra.timezone, false],
    ['search', 'Search', extra.search || 'all', false],
  ].filter(([, , value]) => value && value !== 'all')
  const chipValue = (key, value) => key === 'side' ? t(value === 'buy' ? 'Buy' : 'Sell') : key === 'outcome' ? t({ win: 'Thắng', loss: 'Thua', breakeven: 'Hòa vốn' }[value] || 'Chưa rõ') : key === 'weekday' ? t(value) : key === 'reportKinds' ? filterValues(extra.reportKinds).map(kind => t({ app: 'App', prop: 'Prop Firm', research: 'Research' }[kind] || kind)).join(', ') || t('None') : value
  const allKinds = sourceType === 'Research' ? ['app', 'prop', 'research'] : ['app', 'prop']
  const invalidDates = draft.from && draft.to && draft.from > draft.to
  return <section className="fxa-filters fxa-analytics-filters" aria-label={t("Bộ lọc analytics")} data-testid="analytics-filters">
    <div className="fxa-analytics-filter-row">
      <FxSelect className="is-filter" label={t("Type")} triggerContent={t("Type")} menuTitle={t("Type filter")} selectionField searchable multiple selectAllLabel={t("All")} clearValue={allKinds} value={draftExtra.reportKinds === '' ? allKinds : filterValues(draftExtra.reportKinds)} options={[{ value: 'app', label: 'App' }, { value: 'battles', label: 'Battles', disabled: true, detail: 'Chưa có nguồn dữ liệu Battles' }, { value: 'prop', label: 'Prop Firm' }, ...(sourceType === 'Research' ? [{ value: 'research', label: 'Research' }] : [])]} onChange={values => changeExtra({ reportKinds: JSON.stringify(values) })} />
      {pill('Assets', 'asset', options('Tất cả assets', unique('symbol')), false, true)}
      {pill('Side', 'side', [{ value: 'all', label: 'Tất cả sides' }, { value: 'buy', label: 'Buy' }, { value: 'sell', label: 'Sell' }], true)}
      {pill('Outcome', 'outcome', [{ value: 'all', label: 'Tất cả kết quả' }, { value: 'win', label: 'Thắng' }, { value: 'loss', label: 'Thua' }, { value: 'breakeven', label: 'Hòa vốn' }], true)}
      {pill('Tags', 'tag', options('Tất cả tags', unique('tags')), false, true)}
      {sessionControl && React.cloneElement(sessionControl, { value: draftSession, onChange: setDraftSession, triggerContent: 'Session', compact: true })}
      {pill('Strategy', 'strategy', options('Tất cả strategies', unique('playbook_id')), false, true)}
      {pill('Day', 'weekday', [{ value: 'all', label: 'Mọi thứ' }, ...WEEKDAYS.map((label, i) => ({ value: String(i), label }))])}
      <TimeFilter value={draftExtra} onChange={changeExtra} />
      <FxSelect className="is-filter" label={t("Timezone")} triggerContent={t("Timezone")} menuTitle={t("Select timezone")} selectionField clearValue="UTC" searchable placeholder={t("Search timezone…")} value={draftExtra.timezone} options={timezoneOptions} onChange={timezone => changeExtra({ timezone })} />
      <DateFilter value={draft} onChange={change} />
      <button type="button" className="fxa-button fxa-apply-button" disabled={Boolean(invalidDates)} onClick={() => apply()}>{t("Apply")}</button>
      <button className="fxa-button fxa-icon-button fxa-export-button" type="button" aria-label={t("Xuất CSV")} disabled={pending} onClick={onExport}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M12 3v12m-4-4 4 4 4-4M4 16v5h16v-5" /></svg></button>
    </div>
    {invalidDates && <p role="alert" className="fxa-error">{t("Ngày kết thúc phải từ ngày bắt đầu trở đi.")}</p>}
    <div className="fxa-filter-chips" aria-label={t("Bộ lọc đã áp dụng")}><span className="fxa-filter-chip">{t(sourceType)}</span>{sessionName && <span className="fxa-filter-chip" title={sessionName}>{t("Session")} · {sessionName}</span>}{chips.map(([key, label, value, server]) => <button key={key} type="button" className="fxa-filter-chip" aria-label={t("Bỏ lọc {label}", { label: t(label) })} onClick={() => apply(server ? { ...filters, [key]: 'all' } : filters, server ? extra : { ...extra, [key]: DEFAULT_EXTRA_FILTERS[key] }, sessionProps?.value)}>{t(label)} · {chipValue(key, value)}<span aria-hidden="true">×</span></button>)}{(filters.from || filters.to) && <button type="button" className="fxa-filter-chip" aria-label={t("Bỏ lọc Backtesting Date")} onClick={() => apply({ ...filters, from: '', to: '' }, extra, sessionProps?.value)}>{filters.from || '…'} → {filters.to || '…'}<span aria-hidden="true">×</span></button>}<button type="button" className="fxa-clear-filters" onClick={() => apply({ ...filters, side: 'all', outcome: 'all', from: '', to: '' }, { ...DEFAULT_EXTRA_FILTERS }, sessionProps?.value)}>{t("Clear filters")}</button></div>
  </section>
}
