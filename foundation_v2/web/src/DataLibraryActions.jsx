import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTestingLocale } from './testingLocale.jsx'
import TestingIcon from './TestingIcon.jsx'

export default function DataLibraryActions({ asset, onDetails, onImport, onDownload, canDownload = false, disabled }) {
  const { t } = useTestingLocale()
  const [open, setOpen] = useState(false), [position, setPosition] = useState({left:0,top:0})
  const trigger = useRef(null), menu = useRef(null), id = useId()
  const close = (restore = true) => { setOpen(false); if (restore) trigger.current?.focus({preventScroll:true}) }
  useLayoutEffect(() => {
    if (!open) return
    const positionMenu = () => {
      const rect = trigger.current.getBoundingClientRect(), popup = menu.current.getBoundingClientRect()
      setPosition({ left:Math.max(8,Math.min(rect.right-popup.width,innerWidth-popup.width-8)), top:Math.max(8,Math.min(innerHeight-popup.height-8,rect.bottom+8+popup.height > innerHeight ? rect.top-popup.height-8 : rect.bottom+8)) })
    }
    positionMenu()
    menu.current.querySelector('button:not(:disabled)')?.focus({preventScroll:true})
    window.addEventListener('resize', positionMenu)
    window.addEventListener('scroll', positionMenu, true)
    return () => { window.removeEventListener('resize',positionMenu); window.removeEventListener('scroll',positionMenu,true) }
  }, [open])
  useEffect(() => {
    if (!open) return
    const outside = event => { if (!menu.current?.contains(event.target) && !trigger.current?.contains(event.target)) close(false) }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown',outside)
  }, [open])
  useEffect(() => { if (disabled) setOpen(false) }, [disabled])
  return <>
    <button ref={trigger} type="button" className="data-library-more" aria-label={t('Thao tác dữ liệu {asset}',{asset:asset.instrument_id})} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined} disabled={disabled} onClick={() => setOpen(!open)} onKeyDown={event => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setOpen(true) } }}><svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" /></svg></button>
    {open && createPortal(<div ref={menu} id={id} role="menu" className="data-library-action-menu" aria-label={t('Thao tác dữ liệu {asset}',{asset:asset.instrument_id})} style={{...position}} onKeyDown={event => {
      const buttons = [...menu.current.querySelectorAll('button:not(:disabled)')], index = buttons.indexOf(document.activeElement)
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close() }
      else if (event.key === 'Tab') close()
      else if (['ArrowDown','ArrowUp','Home','End'].includes(event.key)) { event.preventDefault(); buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length-1 : (index+(event.key === 'ArrowDown' ? 1 : buttons.length-1))%buttons.length]?.focus() }
    }}>
      <button type="button" role="menuitem" disabled={!asset.downloaded} onClick={() => { close(); onDetails(asset) }}><TestingIcon kind="info" />{t('Xem chi tiết')}</button>
      {asset.downloaded && <button type="button" role="menuitem" disabled={!canDownload} onClick={() => { close(); onDownload(asset) }}><TestingIcon kind="download" />{t('Tải khoảng khác')}</button>}
      <button type="button" role="menuitem" onClick={() => { close(); onImport(asset) }}><TestingIcon kind="upload" />{t(asset.downloaded ? 'Nhập bản cập nhật' : 'Nhập CSV cho tài sản')}</button>
    </div>, trigger.current.closest('.fx-app') || document.body)}
  </>
}
