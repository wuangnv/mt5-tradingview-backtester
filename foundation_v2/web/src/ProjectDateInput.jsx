import { useEffect, useRef, useState } from 'react'
import { dateFieldDisplay, parseDateField } from './dateFormat.js'
import { useTestingLocale } from './testingLocale.jsx'
import './project-date-input.css'

// Keep ISO at the form boundary while the editable text is independent of OS locale.
export default function ProjectDateInput({ value = '', onChange, type = 'date', min, max, step, utc = false, ...props }) {
  const { t } = useTestingLocale()
  const [draft, setDraft] = useState(() => dateFieldDisplay(value, type))
  const emitted = useRef(value), picker = useRef(null), text = useRef(null)
  useEffect(() => {
    if (value !== emitted.current) { emitted.current = value; setDraft(dateFieldDisplay(value, type)); text.current?.setCustomValidity('') }
  }, [value, type])
  useEffect(() => {
    const parsed = parseDateField(draft, type)
    if (parsed) text.current?.setCustomValidity((!min || parsed >= min.replace(/Z$/, '')) && (!max || parsed <= max.replace(/Z$/, '')) ? '' : t('Ngày giờ không hợp lệ'))
  }, [min, max, draft, type, t])
  const publish = (event, raw) => {
    const parsed = parseDateField(raw, type)
    const valid = parsed !== null && (!parsed || ((!min || parsed >= min.replace(/Z$/, '')) && (!max || parsed <= max.replace(/Z$/, ''))))
    text.current?.setCustomValidity(valid ? '' : t('Ngày giờ không hợp lệ'))
    const next = valid && parsed ? `${parsed}${utc ? 'Z' : ''}` : ''
    if (next === emitted.current) return
    emitted.current = next
    onChange?.({ ...event, target: { name: props.name, value: next }, currentTarget: { name: props.name, value: next } })
  }
  return <span className="project-date-input">
    <input {...props} ref={text} type="text" inputMode="text" value={draft} placeholder={type === 'date' ? 'dd/mm/yyyy' : type === 'time' ? 'HH:mm' : 'dd/mm/yyyy HH:mm'} onChange={event => { setDraft(event.target.value); publish(event, event.target.value) }} onBlur={event => {
      if (!text.current.validity.valid && draft) { setDraft(''); publish(event, '') }
      else setDraft(dateFieldDisplay(value, type))
      props.onBlur?.(event)
    }} />
    <input ref={picker} className="project-date-native" aria-hidden="true" tabIndex={-1} type={type} value={value.replace(/Z$/, '')} min={min?.replace(/Z$/, '')} max={max?.replace(/Z$/, '')} step={step} disabled={props.disabled} onChange={event => { setDraft(dateFieldDisplay(event.target.value, type)); publish(event, dateFieldDisplay(event.target.value, type)) }} />
    <button type="button" className="project-date-picker" aria-label={t('Chọn ngày')} disabled={props.disabled} onClick={() => picker.current?.showPicker?.()}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M8 3v4m8-4v4M4 10h16" /></svg></button>
  </span>
}
