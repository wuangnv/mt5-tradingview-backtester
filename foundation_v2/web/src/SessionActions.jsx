import React, { useEffect, useId, useRef, useState } from 'react'
import './session-actions.css'
import './dashboard-session.css'

export function SessionActions({ item, onAction, disabled = false }) {
  return <div className="fxs-actions" aria-label={`Thao tác ${item.name || item.record_id}`}>
    <button type="button" className="fxs-action-button" aria-label={`${item.archived ? 'Khôi phục' : 'Lưu trữ'} ${item.name || item.record_id}`} title={item.archived ? 'Khôi phục phiên' : 'Lưu trữ phiên'} disabled={disabled} onClick={() => onAction('archive', item)}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="4" rx="1" /><path d="M5 8v12h14V8M9 12h6" />{item.archived && <path d="m9 16 3-3 3 3m-3-3v5" />}</svg></button>
    <button type="button" className="fxs-action-button is-danger" aria-label={`Xóa ${item.name || item.record_id}`} title="Xóa phiên" disabled={disabled} onClick={() => onAction('delete', item)}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7" /></svg></button>
  </div>
}

export function SessionActionDialog({ mode, item, onClose, onSubmit, pending, blocked, error, preview = false }) {
  const dialog = useRef(null), opener = useRef(document.activeElement), messageId = useId()
  const [confirmation, setConfirmation] = useState('')
  const name = item.name || item.record_id, deleting = mode === 'delete'
  const title = deleting ? 'Xóa phiên' : mode === 'duplicate' ? 'Tạo bản sao phiên' : item.archived ? 'Khôi phục phiên' : 'Lưu trữ phiên'
  useEffect(() => {
    const element = dialog.current
    element.showModal()
    element.querySelector('input')?.focus({ preventScroll: true })
    return () => { element.close(); if (opener.current?.isConnected) opener.current.focus({ preventScroll: true }) }
  }, [])
  return <dialog className="fx-dashboard-dialog fxs-action-dialog" ref={dialog} aria-label={title} aria-describedby={messageId} onCancel={event => { event.preventDefault(); if (!pending) onClose() }} onKeyDown={event => {
    if (event.key !== 'Tab') return
    const controls = [...event.currentTarget.querySelectorAll('button, input')].filter(element => !element.disabled && element.tabIndex >= 0)
    const first = controls[0], last = controls.at(-1)
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
  }} onClick={event => { if (event.target !== event.currentTarget || pending) return; const bounds = event.currentTarget.getBoundingClientRect(); if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose() }}>
    <header><h2>{title}</h2><button type="button" aria-label="Đóng hộp thoại phiên" disabled={pending} onClick={onClose}>×</button></header>
    {preview && <small className="fx-dashboard-dialog-preview">Bản xem thử · thay đổi chỉ ở chế độ demo</small>}
    <form onSubmit={event => { event.preventDefault(); if (!pending && !blocked && (!deleting || confirmation === name)) onSubmit(mode, item, confirmation) }}>
      <p id={messageId}>{deleting ? <>Xóa “{name}” khỏi workspace cùng kết quả của phiên. Không thể khôi phục bằng giao diện. Dataset trong Market Data và các phiên khác vẫn được giữ.</> : mode === 'duplicate' ? `Tạo bản sao “${name}” ở vị trí replay hiện tại.` : item.archived ? `Khôi phục “${name}” vào danh sách phiên đang hoạt động.` : `Chuyển “${name}” sang Đã lưu trữ. Dữ liệu và lịch sử vẫn được giữ.`}</p>
      {deleting && <label>Nhập tên phiên để xác nhận<strong>{name}</strong><input autoFocus autoComplete="off" aria-label="Tên phiên xác nhận xóa" value={confirmation} disabled={pending} onChange={event => setConfirmation(event.target.value)} /></label>}
      {error && <p role="alert">{error}</p>}
      <footer><button className="fxr-button fxr-button-secondary" type="button" disabled={pending} onClick={onClose}>Hủy</button><button className={`fxr-button ${deleting ? 'fxs-delete-confirm' : 'fxr-button-primary'}`} type="submit" disabled={pending || blocked || deleting && confirmation !== name}>{pending ? deleting ? 'Đang xóa…' : 'Đang lưu…' : deleting ? 'Xóa phiên' : mode === 'duplicate' ? 'Tạo bản sao' : item.archived ? 'Khôi phục' : 'Lưu trữ'}</button></footer>
    </form>
  </dialog>
}
