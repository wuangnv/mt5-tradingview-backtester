import React, { useEffect, useLayoutEffect, useId, useRef, useState } from 'react'
import './session-actions.css'
import './dashboard-session.css'

export function SessionActionsMenu({ item, onAction, disabled = false }) {
  const [open, setOpen] = useState(false), [position, setPosition] = useState({})
  const root = useRef(null), trigger = useRef(null), menu = useRef(null), id = useId()
  const close = () => { setOpen(false); trigger.current?.focus() }
  useLayoutEffect(() => {
    if (!open) return
    const anchor = trigger.current.getBoundingClientRect(), popup = menu.current.getBoundingClientRect()
    setPosition({ left: Math.max(16, Math.min(anchor.right - popup.width, window.innerWidth - popup.width - 16)), top: Math.max(16, anchor.bottom + 8 + popup.height > window.innerHeight - 16 ? anchor.top - popup.height - 8 : anchor.bottom + 8) })
  }, [open])
  useEffect(() => {
    if (!open) return
    menu.current?.querySelector('button')?.focus({ preventScroll: true })
    const outside = event => { if (!root.current?.contains(event.target)) setOpen(false) }
    const reposition = () => setOpen(false)
    document.addEventListener('pointerdown', outside)
    window.addEventListener('resize', reposition); window.addEventListener('wheel', reposition, { passive: true })
    return () => { document.removeEventListener('pointerdown', outside); window.removeEventListener('resize', reposition); window.removeEventListener('wheel', reposition) }
  }, [open])
  return <div className="fxs-actions" ref={root} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false) }} onKeyDown={event => {
    if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); close() }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    if (!open) { setOpen(true); return }
    const entries = [...menu.current.querySelectorAll('button')], current = entries.indexOf(document.activeElement)
    entries[event.key === 'Home' ? 0 : event.key === 'End' ? entries.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + entries.length) % entries.length]?.focus()
  }}>
    <button type="button" className="fxs-actions-trigger" aria-label={`Thao tác ${item.name || item.record_id}`} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined} disabled={disabled} ref={trigger} onClick={() => setOpen(!open)}><svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><circle cx="5" cy="12" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="19" cy="12" r="1.5" /></svg></button>
    {open && <div className="fxs-actions-menu" role="menu" aria-label="Thao tác phiên" id={id} ref={menu} style={position}>
      <button type="button" role="menuitem" onClick={() => { close(); onAction('archive', item) }}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><rect x="3" y="4" width="18" height="4" rx="1" /><path d="M5 8v12h14V8M9 12h6" /></svg>{item.archived ? 'Khôi phục phiên' : 'Lưu trữ phiên'}</button>
      <button type="button" role="menuitem" className="is-danger" onClick={() => { close(); onAction('delete', item) }}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7" /></svg>Xóa phiên</button>
    </div>}
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
