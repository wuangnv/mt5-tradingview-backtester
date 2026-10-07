import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import ChartIcon from './ChartIcon.jsx'
import { useTestingLocale } from './testingLocale.jsx'

export const intervalLabel = value => ({ '60': '1h', '120': '2h', '240': '4h', '1D': 'D', '1W': 'W', '1M': 'M' })[value] || (/^\d+$/.test(value) ? `${value}m` : value)

// Only FX-specific extensions render here. The chart library renders its native toolbar.
export default function LegacyChartHeader({ controls, symbol, name, backHref, theme, onTheme, onOpenTool }) {
  const { t } = useTestingLocale()
  const [menu, setMenu] = useState(false)
  const opener = useRef(null), menuRef = useRef(null)
  useEffect(() => {
    if (!menu || !controls?.market) return
    menuRef.current?.querySelector('button')?.focus()
    const close = event => {
      if (event.type === 'keydown' && event.key !== 'Escape') return
      if (event.type === 'pointerdown' && (menuRef.current?.contains(event.target) || opener.current?.contains(event.target))) return
      setMenu(false)
      if (event.type === 'keydown') opener.current?.focus()
    }
    const docs = [document, controls.market.ownerDocument]
    docs.forEach(doc => { doc.addEventListener('pointerdown', close); doc.addEventListener('keydown', close) })
    return () => docs.forEach(doc => { doc.removeEventListener('pointerdown', close); doc.removeEventListener('keydown', close) })
  }, [menu, controls?.market])
  useEffect(() => {
    setMenu(false)
    if (menu) [opener.current, controls?.market?.querySelector('.legacy-symbol')].find(element => element?.isConnected && element.getBoundingClientRect().width > 0)?.focus()
  }, [controls?.compact, controls?.market])
  if (!controls?.market) return null
  const button = (label, icon, action, extra = {}) => <button type="button" aria-label={t(label)} title={t(label)} onClick={action} {...extra}><ChartIcon name={icon} /></button>
  const open = tool => event => onOpenTool(tool, event.currentTarget)
  return <>
    {createPortal(<div className="legacy-native-extension legacy-native-market" data-testid="legacy-native-market">
      <a href={backHref} target="_top" aria-label={t('Trở về Sessions')} title={t('Trở về Sessions')}><ChartIcon name="arrow-left" /></a>
      <button type="button" className="legacy-symbol" onClick={open('data')} title={t('Chọn dataset local')}><ChartIcon name="search" /><strong>{symbol}</strong></button>
      {button('So sánh mã', 'compare', open('compare'), { className: 'legacy-compare' })}
    </div>, controls.market)}
    {createPortal(<div className="legacy-native-extension"><button type="button" onClick={open('layout')}>New Layout</button></div>, controls.layout)}
    {createPortal(<div className="legacy-native-extension legacy-native-session">
      <button type="button" className="legacy-session-name" title={name} aria-label={t('Chi tiết và nhánh')} onClick={open('context')}>{name}</button>
      {button('Bố cục chart', 'single-pane', open('layout'))}
      <button type="button" className="legacy-save-layout" aria-label={t('Lưu chart')} title={t('Lưu chart')} onClick={controls.save}><span>{name}</span><small>{t('Save')}</small></button>
      {button('Quản lý layout', 'down', open('layout'))}
    </div>, controls.session)}
    {createPortal(<div className="legacy-native-extension">{button('Quick Search', 'quick-search', open('search'))}</div>, controls.search)}
    {createPortal(<div className="legacy-native-extension legacy-native-tools" data-testid="legacy-native-tools">
      {button('Chụp chart PNG', 'camera', controls.capture, { className: 'legacy-wide-action' })}
      <button type="button" className="legacy-editor legacy-wide-action" aria-label="Editor" title="Editor" onClick={open('editor')}><ChartIcon name="editor" /><span>Editor</span></button>
      {button('AI Mentor', 'mentor', open('mentor'), { className: 'legacy-mentor' })}
      {button('Đổi giao diện', theme === 'dark' ? 'moon' : 'sun', onTheme, { className: 'legacy-wide-action', 'data-testid': 'theme-toggle' })}
      {button('Công cụ chart', 'more', event => { opener.current = event.currentTarget; setMenu(value => !value) }, { className: 'chart-header-overflow', 'aria-expanded': menu })}
    </div>, controls.tools)}
    {menu && <div ref={menuRef} className="legacy-native-menu" role="group" aria-label={t('Công cụ chart')}>
      {[['compare', 'So sánh mã'], ['layout', 'New Layout'], ['data', 'Dữ liệu'], ['context', 'Chi tiết và nhánh'], ['search', 'Quick Search'], ['editor', 'Editor'], ['mentor', 'AI Mentor']].map(([tool, label]) => <button key={tool} type="button" onClick={() => { setMenu(false); onOpenTool(tool, opener.current) }}>{t(label)}</button>)}
      {[['insertIndicator', 'Indicators'], ['undo', 'Hoàn tác'], ['redo', 'Làm lại']].map(([action, label]) => <button key={action} type="button" onClick={() => { setMenu(false); controls.action(action); opener.current?.focus() }}>{t(label)}</button>)}
      <button type="button" onClick={() => { setMenu(false); controls.save(); opener.current?.focus() }}>{t('Lưu chart')}</button>
      <button type="button" onClick={() => { setMenu(false); controls.capture(); opener.current?.focus() }}>{t('Chụp chart PNG')}</button>
      <button type="button" onClick={() => { setMenu(false); onTheme(); opener.current?.focus() }}>{t('Đổi giao diện')}</button>
    </div>}
  </>
}
