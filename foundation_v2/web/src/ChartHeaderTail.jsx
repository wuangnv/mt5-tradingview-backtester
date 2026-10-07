import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import ChartIcon from './ChartIcon.jsx'
import { useTestingLocale } from './testingLocale.jsx'

export default function ChartHeaderTail({ height, compact, onError, onOpenTool, onSave, onCapture, onTheme }) {
  const { t } = useTestingLocale()
  const [full, setFull] = useState(Boolean(document.fullscreenElement))
  const [open, setOpen] = useState(false)
  const host = useRef(null), trigger = useRef(null), menu = useRef(null)
  useEffect(() => {
    const changed = () => setFull(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', changed)
    return () => document.removeEventListener('fullscreenchange', changed)
  }, [])
  useEffect(() => {
    if (!open) return undefined
    menu.current?.querySelector('button')?.focus()
    const dismiss = event => { if (!host.current?.contains(event.target) && !menu.current?.contains(event.target)) setOpen(false) }
    const escape = event => { if (event.key === 'Escape') { setOpen(false); trigger.current?.focus() } }
    const resize = () => setOpen(false)
    document.addEventListener('pointerdown', dismiss)
    document.addEventListener('keydown', escape)
    const chartDocuments = []
    for (const frame of document.querySelectorAll('.advanced-chart-host iframe')) {
      try { if (frame.contentDocument) { chartDocuments.push(frame.contentDocument); frame.contentDocument.addEventListener('pointerdown', dismiss); frame.contentDocument.addEventListener('keydown', escape) } }
      catch { /* The chart normally uses a same-origin iframe. */ }
    }
    window.addEventListener('resize', resize)
    return () => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('keydown', escape); chartDocuments.forEach(doc => { doc.removeEventListener('pointerdown', dismiss); doc.removeEventListener('keydown', escape) }); window.removeEventListener('resize', resize) }
  }, [open])
  const toggle = async event => {
    setOpen(false)
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
      else await event.currentTarget.closest('.fx-app').requestFullscreen()
    } catch { onError(t('Không mở được chế độ toàn màn hình.')) }
  }
  const choose = tool => { setOpen(false); onOpenTool(tool, trigger.current) }
  const run = action => { setOpen(false); trigger.current?.focus(); action() }
  return <div ref={host} className={`chart-header-tail${compact ? ' is-compact' : ''}`} style={{ height }} data-testid="chart-header-tail">
    <button type="button" className="chart-header-fullscreen" aria-label={t(full ? 'Thoát toàn màn hình' : 'Toàn màn hình')} title={t(full ? 'Thoát toàn màn hình' : 'Toàn màn hình')} aria-pressed={full} onClick={toggle}><ChartIcon name="fit" /></button>
    <button ref={trigger} type="button" className="chart-header-overflow" aria-label={t('Công cụ chart')} aria-expanded={open} aria-controls={open ? 'chart-header-menu' : undefined} onClick={() => setOpen(value => !value)}><ChartIcon name="more" /></button>
    {open && createPortal(<div ref={menu} id="chart-header-menu" className="chart-header-menu" style={{ top: height + 4 }} role="group" aria-label={t('Công cụ chart')}>
      {[['compare', 'So sánh mã', 'compare'], ['layout', 'New Layout', 'layout'], ['alerts', 'Alerts', 'alert'], ['editor', 'Editor', 'editor'], ['context', 'Chi tiết và nhánh', 'info']].map(([tool, label, icon]) => <button key={tool} type="button" onClick={() => choose(tool)}><ChartIcon name={icon} />{t(label)}</button>)}
      <button type="button" onClick={() => run(onSave)}><ChartIcon name="save" />{t('Lưu chart')}</button>
      <button type="button" onClick={() => run(onCapture)}><ChartIcon name="camera" />{t('Chụp chart PNG')}</button>
      <button type="button" onClick={() => run(onTheme)}><ChartIcon name="moon" />{t('Đổi giao diện')}</button>
      <button type="button" onClick={toggle}><ChartIcon name="fit" />{t(full ? 'Thoát toàn màn hình' : 'Toàn màn hình')}</button>
    </div>, host.current.closest('.chart-frame'))}
  </div>
}
