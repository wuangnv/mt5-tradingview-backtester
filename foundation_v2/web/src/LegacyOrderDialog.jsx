import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import ChartIcon from './ChartIcon.jsx'
import ChartOrderPanel from './ChartOrderPanel.jsx'
import { useTestingLocale } from './testingLocale.jsx'

export default function LegacyOrderDialog({ order, blockedReason, theme, onClose, onJournal, chartDocument }) {
  const { t } = useTestingLocale(), ref = useRef(null), callbacks = useRef({onClose,onJournal})
  callbacks.current = {onClose,onJournal}
  useEffect(() => {
    const panel = ref.current
    panel.querySelector('button:not(:disabled),input:not(:disabled)')?.focus()
    const keyboard = event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); callbacks.current.onClose() }
      if (event.key !== 'Tab') return
      const nodes = [...panel.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),summary')].filter(e => e.getBoundingClientRect().width)
      const first = nodes[0], last = nodes.at(-1)
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    const docs = [...new Set([document,chartDocument].filter(Boolean))]
    docs.forEach(doc => doc.addEventListener('keydown', keyboard, true))
    const app = document.querySelector('.fx-app'), wasInert = app?.inert
    if (app) app.inert = true
    return () => { if (app) app.inert = wasInert; docs.forEach(doc => doc.removeEventListener('keydown', keyboard, true)) }
  }, [chartDocument])
  return createPortal(<div className={`legacy-order-overlay ${theme === 'light' ? 'is-light' : ''}`} onPointerDown={event => { if (event.target === event.currentTarget) onClose() }}><section ref={ref} className="legacy-order-modal" role="dialog" aria-modal="true" aria-labelledby="legacy-order-title"><header><h2 id="legacy-order-title">{t('Đặt lệnh')}</h2><button type="button" disabled title={t('Chưa hỗ trợ preset')}>{t('Preset')}</button><button type="button" className="wm-dialog-close" aria-label={t('Đóng panel')} onClick={onClose}><ChartIcon name="close" /></button></header><ChartOrderPanel order={order} blockedReason={blockedReason} legacy onClose={onClose} onJournal={onJournal} /></section></div>, document.body)
}
