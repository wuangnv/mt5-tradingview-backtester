import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import ChartIcon from './ChartIcon.jsx'
import LegacyPopover from './LegacyPopover.jsx'
import LegacyLayoutMenu from './LegacyLayoutMenu.jsx'
import { useTestingLocale } from './testingLocale.jsx'

export const intervalLabel = value => ({ '60': '1h', '120': '2h', '240': '4h', '1D': 'D', '1W': 'W', '1M': 'M' })[value] || (/^\d+$/.test(value) ? `${value}m` : value)

// Only FX-specific extensions render here. The chart library renders its native toolbar.
export default function LegacyChartHeader({ controls, symbol, name, backHref, theme, onTheme, onOpenTool, onFullscreen }) {
  const { t } = useTestingLocale()
  const [menu, setMenu] = useState(false)
  const [popup, setPopup] = useState(null)
  const opener = useRef(null), menuRef = useRef(null)
  useEffect(() => {
    if (!controls?.market) return
    const shortcut = event => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 's' || (!event.altKey && !event.shiftKey)) return
      event.preventDefault(); controls.capture(event.shiftKey ? 'copy' : 'download')
    }
    const docs = [document, controls.market.ownerDocument]
    docs.forEach(doc => doc.addEventListener('keydown', shortcut, true))
    return () => docs.forEach(doc => doc.removeEventListener('keydown', shortcut, true))
  }, [controls?.market, controls?.capture])
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
    const focusOutside = event => { if (!menuRef.current?.contains(event.target) && !opener.current?.contains(event.target)) setMenu(false) }
    const blur = event => { if (!menuRef.current?.contains(event.relatedTarget) && !opener.current?.contains(event.relatedTarget)) setMenu(false) }
    const navigate = event => {
      if (!menuRef.current?.contains(event.target) || !['ArrowDown','ArrowUp','Home','End'].includes(event.key)) return
      event.preventDefault(); event.stopPropagation()
      const entries = [...menuRef.current.querySelectorAll('button:not(:disabled)')], index = entries.indexOf(event.target)
      entries[event.key === 'Home' ? 0 : event.key === 'End' ? entries.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : entries.length - 1)) % entries.length]?.focus()
    }
    docs.forEach(doc => { doc.addEventListener('pointerdown', close); doc.addEventListener('keydown', close); doc.addEventListener('keydown', navigate); doc.addEventListener('focusin', focusOutside) })
    const node = menuRef.current
    node?.addEventListener('focusout', blur)
    return () => { node?.removeEventListener('focusout', blur); docs.forEach(doc => { doc.removeEventListener('pointerdown', close); doc.removeEventListener('keydown', close); doc.removeEventListener('keydown', navigate); doc.removeEventListener('focusin', focusOutside) }) }
  }, [menu, controls?.market])
  useEffect(() => {
    setMenu(false)
    setPopup(null)
    if (menu || popup) [popup?.anchor, opener.current, controls?.layout?.querySelector('button'), controls?.market?.querySelector('.legacy-symbol')].find(element => element?.isConnected && element.getBoundingClientRect().width > 0)?.focus()
  }, [controls?.compact, controls?.market])
  if (!controls?.market) return null
  const button = (label, icon, action, extra = {}) => <button type="button" aria-label={t(label)} title={t(label)} onClick={action} {...extra}><ChartIcon name={icon} /></button>
  const open = tool => event => onOpenTool(tool, event.currentTarget)
  const show = kind => event => {
    // React clears currentTarget after dispatch; retain the node before a queued updater runs.
    const anchor = event.currentTarget
    setMenu(false); setPopup(current => current?.kind === kind ? null : { kind, anchor })
  }
  const closePopup = () => {
    [popup?.anchor, controls.layout?.querySelector('button'), controls.market?.querySelector('.legacy-symbol')].find(element => element?.isConnected && element.getBoundingClientRect().width > 0)?.focus()
    setPopup(null)
  }
  const saved = controls.saveState === 'saved', saving = controls.saveState === 'saving'
  const saveLabel = saved ? 'Đã lưu mọi thay đổi' : saving ? 'Đang lưu…' : controls.saveState === 'error' ? 'Thử lưu lại chart' : 'Lưu chart'
  const saveAction = () => { controls.save(); closePopup() }
  return <>
    {createPortal(<div className="legacy-native-extension legacy-native-market" data-testid="legacy-native-market">
      <a href={backHref} target="_top" aria-label={t('Trở về Sessions')} title={t('Trở về Sessions')}><ChartIcon name="arrow-left" /></a>
      <button type="button" className="legacy-symbol" onClick={open('data')} title={t('Chọn dataset local')}><ChartIcon name="search" /><strong>{symbol}</strong></button>
      {button('So sánh mã', 'compare', open('compare'), { className: 'legacy-compare' })}
    </div>, controls.market)}
    {createPortal(<div className="legacy-native-extension"><button type="button" onClick={show('layout')}>New Layout</button></div>, controls.layout)}
    {createPortal(<div className="legacy-native-extension legacy-native-session">
      <span className="legacy-session-name" title={name}>{name}</span>
      {button('Bố cục chart', 'single-pane', show('layout'), { 'aria-expanded': popup?.kind === 'layout' })}
      <button type="button" className="legacy-save-layout" data-save-state={controls.saveState} aria-label={t(saveLabel)} title={`${t(saveLabel)} · ${t('Lưu trên trình duyệt này')}`} disabled={saved || saving} onClick={controls.save}><span>{name}</span><small>{t(saving ? 'Đang lưu…' : 'Save')}</small></button>
      {button('Quản lý layout', 'down', show('manage'), { 'aria-expanded': popup?.kind === 'manage' })}
    </div>, controls.session)}
    {createPortal(<div className="legacy-native-extension">{button('Quick Search', 'quick-search', open('search'))}</div>, controls.search)}
    {createPortal(<div className="legacy-native-extension legacy-native-tools" data-testid="legacy-native-tools">
      {button('Chụp chart PNG', 'camera', show('capture'), { className: 'legacy-wide-action', 'aria-expanded': popup?.kind === 'capture' })}
      <span className="legacy-divider legacy-wide-action" />
      <button type="button" className="legacy-editor legacy-wide-action" aria-label="Editor" title="Editor" onClick={open('editor')}><ChartIcon name="editor" /><span>Editor</span></button>
      {button('AI Mentor', 'mentor', open('mentor'), { className: 'legacy-mentor' })}
      {button('Đổi giao diện', theme === 'dark' ? 'moon' : 'sun', onTheme, { className: 'legacy-wide-action', 'data-testid': 'theme-toggle' })}
      {button('Toàn màn hình', 'fit', onFullscreen, { className: 'legacy-wide-action' })}
      {button('Công cụ chart', 'more', event => { opener.current = event.currentTarget; setMenu(value => !value) }, { className: 'chart-header-overflow', 'aria-expanded': menu })}
    </div>, controls.tools)}
    {menu && <div ref={menuRef} className="legacy-native-menu" role="group" aria-label={t('Công cụ chart')}>
      <button type="button" onClick={() => { setMenu(false); setPopup({kind:'layout',anchor:opener.current}) }}>New Layout</button>
      {[['compare', 'So sánh mã'], ['data', 'Dữ liệu'], ['context', 'Chi tiết và nhánh'], ['search', 'Quick Search'], ['editor', 'Editor'], ['mentor', 'AI Mentor']].map(([tool, label]) => <button key={tool} type="button" onClick={() => { setMenu(false); onOpenTool(tool, opener.current) }}>{t(label)}</button>)}
      {[['insertIndicator', 'Indicators'], ['undo', 'Hoàn tác'], ['redo', 'Làm lại']].map(([action, label]) => <button key={action} type="button" onClick={() => { setMenu(false); controls.action(action); opener.current?.focus() }}>{t(label)}</button>)}
      <button type="button" disabled={saved || saving} onClick={() => { setMenu(false); controls.save(); opener.current?.focus() }}>{t(saveLabel)}</button>
      <button type="button" onClick={() => { setMenu(false); setPopup({kind:'capture',anchor:opener.current}) }}>{t('Chụp chart PNG')}</button>
      <button type="button" onClick={() => { setMenu(false); onTheme(); opener.current?.focus() }}>{t('Đổi giao diện')}</button>
      <button type="button" onClick={() => { setMenu(false); onFullscreen(); opener.current?.focus() }}>{t('Toàn màn hình')}</button>
    </div>}
    {popup && <LegacyPopover anchor={popup.anchor} theme={theme} label={t(({layout:'Bố cục chart',manage:'Quản lý layout',capture:'Ảnh chart'})[popup.kind])} wide={popup.kind === 'layout'} onClose={() => setPopup(null)} onAnchorLost={closePopup}>
      {popup.kind === 'layout' && <LegacyLayoutMenu onClose={closePopup} />}
      {popup.kind === 'manage' && <>
        <button type="button" disabled={saved || saving} onClick={saveAction}><span>{t('Lưu layout')}</span><kbd>Ctrl + S</kbd></button>
        <button type="button" disabled>{t('Tạo bản sao…')}</button><button type="button" disabled>{t('Đổi tên…')}</button><hr /><button type="button" disabled>{t('Mở layout…')}<kbd>.</kbd></button>
        <p className="legacy-menu-note">{t('Layout lưu trên trình duyệt này. Quản lý nhiều layout chưa khả dụng.')}</p>
      </>}
      {popup.kind === 'capture' && <><h3>{t('Ảnh chart')}</h3><button type="button" onClick={() => { controls.capture('download'); closePopup() }}><ChartIcon name="download" /><span>{t('Tải ảnh')}</span><kbd>Ctrl + Alt + S</kbd></button><button type="button" onClick={() => { controls.capture('copy'); closePopup() }}><ChartIcon name="copy" /><span>{t('Sao chép ảnh')}</span><kbd>Ctrl + Shift + S</kbd></button></>}
    </LegacyPopover>}
  </>
}
