import { useEffect, useId, useRef, useState } from 'react'
import { useTestingLocale } from './testingLocale.jsx'
import FxSelect from './FxSelect.jsx'
import { readDashboardDatasets } from './dashboardModel.js'
import { createPlaybookDraft, fetchPlaybooks } from './playbookApi.js'
import { createReplaySession, rememberSession, sessionNavigationHref } from './sessionCatalog.js'
import { buildWorkspaceHref } from './workspaceContext.js'
import './quick-session.css'

export default function QuickSessionDialog({ workspace, query, onClose }) {
  const { t } = useTestingLocale(), id = useId()
  const dialog = useRef(null), nameInput = useRef(null), opener = useRef(document.activeElement), submitLock = useRef(false)
  const [mode, setMode] = useState('backtest'), [advanced, setAdvanced] = useState(false)
  const [draft, setDraft] = useState({ name: '', balance: '100000', dataset: '', strategy: '', description: '', start: '0' })
  const [data, setData] = useState({ status: 'loading', items: [], error: '' })
  const [strategies, setStrategies] = useState({ items: [], error: '', status: 'loading' })
  const [addingStrategy, setAddingStrategy] = useState(false), [strategyName, setStrategyName] = useState('')
  const [strategyPending, setStrategyPending] = useState(false), [strategyProblem, setStrategyProblem] = useState(null)
  const strategyLock = useRef(false)
  const strategyInput = useRef(null), strategyOpener = useRef(null), wasAddingStrategy = useRef(false)
  const [reload, setReload] = useState(0), [pending, setPending] = useState(false), [problem, setProblem] = useState(null)
  const selected = data.items.find(item => item.dataset_id === draft.dataset)
  const currency = selected?.instrument_spec?.account_ccy || 'USD'
  const selectedStrategy = strategies.items.find(item => item.record_id === draft.strategy)
  const start = advanced ? Number(draft.start) : 0
  const valid = draft.name.trim() && Number(draft.balance) > 0 && Number.isFinite(Number(draft.balance)) && selected && Number.isInteger(start) && start >= 0 && start < selected.row_count
  const change = (key, value) => setDraft(current => ({ ...current, [key]: value }))
  useEffect(() => {
    if (addingStrategy) strategyInput.current?.focus()
    else if (wasAddingStrategy.current) strategyOpener.current?.focus()
    wasAddingStrategy.current = addingStrategy
  }, [addingStrategy])
  useEffect(() => {
    dialog.current.showModal()
    nameInput.current?.focus()
    return () => { dialog.current?.close(); if (opener.current?.isConnected) opener.current.focus({ preventScroll: true }) }
  }, [])
  useEffect(() => {
    const controller = new AbortController()
    setData(current => ({ ...current, status: 'loading', error: '' }))
    readDashboardDatasets(workspace, controller.signal).then(items => {
      if (!controller.signal.aborted) setData({ status: 'ready', items, error: '' })
    }).catch(error => { if (!controller.signal.aborted) setData({ status: 'error', items: [], error: error.message }) })
    fetchPlaybooks(workspace, controller.signal).then(items => {
      if (!controller.signal.aborted) setStrategies({ items, status: 'ready', error: '' })
    }).catch(error => { if (!controller.signal.aborted) setStrategies({ items: [], status: 'error', error: error.message }) })
    return () => controller.abort()
  }, [workspace, reload])
  const busy = pending || strategyPending
  const close = () => { if (!submitLock.current && !strategyLock.current) onClose() }
  const addStrategy = async () => {
    if (!strategyName.trim() || strategyLock.current || strategyProblem?.uncertain) return
    strategyLock.current = true; setStrategyPending(true); setStrategyProblem(null)
    try {
      const record = await createPlaybookDraft(workspace, strategyName.trim())
      if (!record.record_id || !Number.isInteger(record.revision) || !record.payload?.name) throw new Error('Invalid strategy response')
      setStrategies(current => ({ ...current, items: [...current.items, record] }))
      change('strategy', record.record_id); setAddingStrategy(false); setStrategyName('')
    } catch (error) { setStrategyProblem({ text: error.message, uncertain: !error.status || error.status >= 500 }) }
    finally { strategyLock.current = false; setStrategyPending(false) }
  }
  const create = async event => {
    event.preventDefault()
    if (!valid || busy || addingStrategy || problem?.uncertain || submitLock.current || mode !== 'backtest') return
    submitLock.current = true; setPending(true); setProblem(null)
    try {
      const record = await createReplaySession(workspace, {
        name: draft.name.trim(), dataset_id: selected.dataset_id, starting_balance: draft.balance,
        chart_engine: 'legacy', start_index: start, description: advanced ? draft.description : '',
        ...(selectedStrategy ? { playbook_id: selectedStrategy.record_id, playbook_revision: selectedStrategy.revision } : {}),
      })
      if (!record.record_id || !record.payload || record.payload.dataset_id !== selected.dataset_id || !Number.isInteger(record.revision)) throw new Error('Phản hồi tạo phiên không đúng định dạng.')
      rememberSession(workspace, record.record_id)
      window.location.assign(sessionNavigationHref('replay', workspace, query, { record_id: record.record_id, dataset_id: selected.dataset_id }, { select: null, surface: 'workspace', chart_iframe: query.get('chart_iframe') || 'srcdoc', chart_engine: null, fresh: null }))
    } catch (error) {
      setProblem({ text: error.message, uncertain: !error.status || error.status >= 500 })
      submitLock.current = false; setPending(false)
    }
  }
  return <dialog ref={dialog} className="quick-session-dialog" aria-labelledby={`${id}-title`} onCancel={event => { event.preventDefault(); close() }} onClick={event => {
    if (event.target !== event.currentTarget) return
    const r = event.currentTarget.getBoundingClientRect()
    if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) close()
  }}>
    <header className="quick-session-header"><h2 id={`${id}-title`}>{t(advanced ? 'Tạo phiên nâng cao' : 'Tạo phiên nhanh')}</h2><button type="button" className="quick-session-advanced" disabled={busy} onClick={() => setAdvanced(value => !value)}>{t(advanced ? 'Tạo nhanh' : 'Phiên nâng cao')}</button><button type="button" className="quick-session-close" aria-label={t('Đóng tạo phiên')} disabled={busy} onClick={close}>×</button></header>
    <form onSubmit={create} className="quick-session-form">
      <div className="quick-session-body">
        <div className="quick-session-tabs" role="tablist" aria-label={t('Loại phiên')}>{[['backtest','Backtesting Session'],['prop','Prop Firm Session']].map(([key,label]) => <button key={key} id={`${id}-${key}`} role="tab" type="button" aria-selected={mode === key} aria-controls={`${id}-panel`} tabIndex={mode === key ? 0 : -1} disabled={busy} onClick={() => setMode(key)} onKeyDown={event => {
          if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return
          event.preventDefault(); const next = event.key === 'Home' ? 'backtest' : event.key === 'End' ? 'prop' : mode === 'backtest' ? 'prop' : 'backtest'; setMode(next); document.getElementById(`${id}-${next}`).focus()
        }}>{t(label)}</button>)}</div>
        <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-${mode}`} className="quick-session-fields">
          {mode === 'prop' ? <p>{t('Thiết lập thử thách với quy tắc, mục tiêu và giới hạn rủi ro ở trang Prop Firm.')}</p> : <>
            <label>{t('Name')} *<input ref={nameInput} required maxLength={160} placeholder={t('Đặt tên phiên của bạn')} value={draft.name} disabled={busy} onChange={event => change('name', event.target.value)} /></label>
            <label>{t('Account Balance')} *<div className="quick-session-balance"><span className="quick-session-money-icon" aria-hidden="true">$</span><input required type="number" min="0.01" step="0.01" style={{ width: `${Math.max(1, draft.balance.length) + 0.5}ch` }} aria-label={t('Account Balance')} aria-describedby={`${id}-currency`} value={draft.balance} disabled={busy} onChange={event => change('balance',event.target.value)} /><span id={`${id}-currency`}>{currency}</span></div></label>
            <div className="quick-session-field quick-session-strategy"><span>{t('Strategy')}</span><FxSelect searchable={strategies.items.length > 0} label={t('Strategy')} value={draft.strategy} disabled={busy || strategies.status === 'loading'} onChange={value => change('strategy',value)} className={draft.strategy ? '' : 'is-placeholder'} triggerContent={selectedStrategy?.payload?.name || t('Chọn chiến lược hoặc tạo mới')} localizeOptions={false} placeholder={t('Tìm chiến lược…')} emptyLabel={t('Không tìm thấy kết quả')} options={strategies.items.map(item => ({ value:item.record_id, label:item.payload?.name || item.record_id, localize:false }))} />{draft.strategy && <button type="button" className="quick-session-text-action" disabled={busy} onClick={() => change('strategy','')}>{t('Bỏ chọn chiến lược')}</button>}{!addingStrategy ? <button type="button" ref={strategyOpener} className="quick-session-text-action quick-session-new-strategy" disabled={busy || strategies.status === 'loading'} onClick={() => setAddingStrategy(true)}>{t('+ Tạo chiến lược mới')}</button> : <div className="quick-session-strategy-create"><label>{t('Tên chiến lược')}<input ref={strategyInput} maxLength={160} value={strategyName} disabled={strategyPending} onChange={event => setStrategyName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); addStrategy() } }} /></label><div><button type="button" disabled={!strategyName.trim() || strategyPending || strategyProblem?.uncertain} onClick={addStrategy}>{t(strategyPending ? 'Đang tạo…' : 'Tạo chiến lược')}</button><button type="button" disabled={strategyPending} onClick={() => setAddingStrategy(false)}>{t('Cancel')}</button></div>{strategyProblem && <small role="alert">{strategyProblem.uncertain ? t('Chưa xác định chiến lược đã tạo hay chưa. Kiểm tra danh sách chiến lược trước khi thử lại.') : strategyProblem.text}{strategyProblem.uncertain && <a aria-disabled={busy || undefined} onClick={event => { if (busy) event.preventDefault() }} href={buildWorkspaceHref('playbook',workspace,query)}>{t('Quản lý chiến lược')}</a>}</small>}</div>}{strategies.error && <small>{t('Chưa đọc được chiến lược. Bạn vẫn có thể tạo phiên không gắn chiến lược.')}</small>}</div>
            <div className="quick-session-field"><div className="quick-session-field-title"><span>{t('Assets')} *</span><a aria-disabled={busy || undefined} onClick={event => { if (busy) event.preventDefault() }} href={buildWorkspaceHref('data',workspace,query)}>{t('Kho dữ liệu')}</a></div><FxSelect selectionField searchable label={t('Chọn tài sản')} value={draft.dataset} disabled={busy || data.status !== 'ready'} onChange={value => change('dataset',value)} placeholder={t('Tìm tài sản…')} options={[{value:'',label:'Chọn tài sản'}, ...data.items.map(item => ({value:item.dataset_id,label:item.instrument_id || item.dataset_id,localize:false,detail:`${item.timeframe || item.timeframe_seconds + 's'} · ${item.source?.provider || 'Local'} · ${item.row_count} ${t('nến')}`}))]} />{data.status === 'loading' ? <small role="status">{t('Đang đọc danh mục dữ liệu…')}</small> : data.status === 'error' ? <div role="alert">{t('Không đọc được danh mục:')} {data.error}<button type="button" onClick={() => setReload(value => value + 1)}>{t('Thử lại')}</button></div> : !data.items.length && <small>{t('Chưa có dataset local trong workspace này.')}</small>}</div>
            <div className="quick-session-field"><span>{t('Select Chart Layout (Optional)')}</span><FxSelect label={t('Chart Layout')} value="default" disabled options={[{value:'default',label:'Bố cục mặc định'}]} onChange={() => {}} /></div>
            {advanced && <><label>{t('Description')}<textarea rows={3} maxLength={2000} disabled={busy} value={draft.description} onChange={event => change('description',event.target.value)} /></label><label>{t('Nến bắt đầu')}<input type="number" min="0" max={selected ? selected.row_count - 1 : undefined} step="1" required disabled={busy} value={draft.start} onChange={event => change('start',event.target.value)} /></label></>}
            <section className="quick-session-engine" aria-label={t('Charting engine')}><h3>{t('Charting engine')}</h3><p>{t('Chọn một lần cho phiên này.')}</p><div role="radiogroup" aria-label={t('Charting engine')}><button type="button" role="radio" aria-checked="false" disabled>New Chart <small>{t('Chưa khả dụng')}</small></button><button type="button" role="radio" aria-checked="true" disabled={busy}>Legacy Chart</button></div></section>
          </>}
          {problem && <div role="alert" className="quick-session-error">{problem.uncertain ? t('Chưa xác định phiên đã tạo hay chưa. Kiểm tra danh sách phiên trước khi tạo lại.') : t('Không tạo được phiên: {error}', {error:problem.text})}{problem.uncertain && <a aria-disabled={busy || undefined} onClick={event => { if (busy) event.preventDefault() }} href={buildWorkspaceHref('replay',workspace,query,{select:'1',surface:null,fresh:null})}>{t('Xem danh sách phiên')}</a>}</div>}
        </div>
      </div>
      <footer className="quick-session-footer"><button type="button" disabled={busy} onClick={close}>{t('Cancel')}</button>{mode === 'prop' ? <a className="quick-session-submit" aria-disabled={busy || undefined} onClick={event => { if (busy) event.preventDefault() }} href={buildWorkspaceHref('testing',workspace,query)}>{t('Thiết lập Prop Firm')}</a> : <button type="submit" className="quick-session-submit" disabled={!valid || busy || addingStrategy || data.status !== 'ready' || problem?.uncertain}>{t(pending ? 'Đang tạo…' : 'Create session')}</button>}</footer>
    </form>
  </dialog>
}
