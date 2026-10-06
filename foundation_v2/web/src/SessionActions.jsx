import { useTestingLocale } from './testingLocale.jsx'
import { useEffect, useId, useRef, useState } from 'react'
import './session-actions.css'
import './dashboard-session.css'

export function SessionActions({ item, onAction, disabled = false, text = false }) {
  const { t } = useTestingLocale()

  return <div className="fxs-actions" aria-label={t("Thao tác {name}", { name: item.name || item.record_id })}>
    <button type="button" className={`${text ? 'fxr-button fxr-button-secondary' : 'fxs-action-button'} is-danger`} aria-label={text ? t("Xóa phiên") : t("Xóa {name}", { name: item.name || item.record_id })} title={t("Xóa phiên")} disabled={disabled} onClick={() => onAction('delete', item)}>{text ? t("Xóa phiên") : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7" /></svg>}</button>
  </div>
}

export function SessionActionDialog({ mode, item, onClose, onSubmit, pending, blocked, error, preview = false }) {
  const { t } = useTestingLocale()

  const dialog = useRef(null), opener = useRef(document.activeElement), messageId = useId()
  const [confirmation, setConfirmation] = useState('')
  const name = item.name || item.record_id, deleting = mode === 'delete'
  const title = deleting ? 'Xóa phiên' : 'Tạo bản sao phiên'
  useEffect(() => {
    const element = dialog.current
    element.showModal()
    element.querySelector('input')?.focus({ preventScroll: true })
    return () => { element.close(); if (opener.current?.isConnected) opener.current.focus({ preventScroll: true }) }
  }, [])
  return <dialog className="fx-dashboard-dialog fxs-action-dialog" ref={dialog} aria-label={t(title)} aria-describedby={messageId} onCancel={event => { event.preventDefault(); if (!pending) onClose() }} onKeyDown={event => {
    if (event.key !== 'Tab') return
    const controls = [...event.currentTarget.querySelectorAll('button, input')].filter(element => !element.disabled && element.tabIndex >= 0)
    const first = controls[0], last = controls.at(-1)
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
  }} onClick={event => { if (event.target !== event.currentTarget || pending) return; const bounds = event.currentTarget.getBoundingClientRect(); if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose() }}>
    <header><h2>{t(title)}</h2><button type="button" aria-label={t("Đóng hộp thoại phiên")} disabled={pending} onClick={onClose}>×</button></header>
    {preview && <small className="fx-dashboard-dialog-preview">{t("Bản xem thử · thay đổi chỉ ở chế độ demo")}</small>}
    <form onSubmit={event => { event.preventDefault(); if (!pending && !blocked && (!deleting || confirmation === name)) onSubmit(mode, item, confirmation) }}>
      <p id={messageId}>{deleting ? t('Xóa “{name}” khỏi workspace cùng kết quả của phiên. Không thể khôi phục bằng giao diện. Dataset trong Market Data và các phiên khác vẫn được giữ.', { name }) : t("Tạo bản sao “{name}” ở vị trí replay hiện tại.", { name })}</p>
      {deleting && <label>{t("Nhập tên phiên để xác nhận")}<strong>{name}</strong><input autoFocus autoComplete="off" aria-label={t("Tên phiên xác nhận xóa")} value={confirmation} disabled={pending} onChange={event => setConfirmation(event.target.value)} /></label>}
      {error && <p role="alert">{t(error)}</p>}
      <footer><button className="fxr-button fxr-button-secondary" type="button" disabled={pending} onClick={onClose}>{t("Hủy")}</button><button className={`fxr-button ${deleting ? 'fxs-delete-confirm is-danger' : 'fxr-button-primary'}`} type="submit" disabled={pending || blocked || deleting && confirmation !== name}>{pending ? deleting ? t("Đang xóa…") : t("Đang lưu…") : deleting ? t("Xóa phiên") : t("Tạo bản sao")}</button></footer>
    </form>
  </dialog>
}
