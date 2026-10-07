import { useEffect, useRef, useState } from 'react'
import ChartIcon from './ChartIcon.jsx'
import { useTestingLocale } from './testingLocale.jsx'

export const intervalLabel = value => ({ '60': '1h', '120': '2h', '240': '4h', '1D': 'D', '1W': 'W', '1M': 'M' })[value] || (/^\d+$/.test(value) ? `${value}m` : value)

// One application-owned row spans the viewport. The vendor API still owns chart actions.
export default function LegacyChartHeader({ controls, symbol, name, backHref, theme, onTheme, onOpenTool, onError }) {
  const { t } = useTestingLocale()
  const [menu, setMenu] = useState(null), [full, setFull] = useState(Boolean(document.fullscreenElement))
  const host = useRef(null), opener = useRef(null)
  const focusOpener = () => [opener.current, host.current?.querySelector('.chart-header-overflow'), host.current?.querySelector('.legacy-interval-menu')].find(element => element?.isConnected && element.getBoundingClientRect().width > 0)?.focus()
  useEffect(() => {
    const changed = () => setFull(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', changed)
    return () => document.removeEventListener('fullscreenchange', changed)
  }, [])
  useEffect(() => {
    if (!menu) return undefined
    host.current?.querySelector('.legacy-header-menu button')?.focus()
    const dismiss = event => { if (!host.current?.contains(event.target)) setMenu(null) }
    const escape = event => { if (event.key === 'Escape') { setMenu(null); focusOpener() } }
    const docs = [document]
    for (const frame of document.querySelectorAll('.advanced-chart-host iframe')) {
      try { if (frame.contentDocument) docs.push(frame.contentDocument) } catch { /* Same-origin chart normally. */ }
    }
    docs.forEach(doc => { doc.addEventListener('pointerdown', dismiss); doc.addEventListener('keydown', escape) })
    return () => docs.forEach(doc => { doc.removeEventListener('pointerdown', dismiss); doc.removeEventListener('keydown', escape) })
  }, [menu])
  const show = (key, event) => { opener.current = event.currentTarget; setMenu(current => current === key ? null : key) }
  const open = (tool, event) => { setMenu(null); onOpenTool(tool, event.currentTarget) }
  const run = action => { setMenu(null); focusOpener(); action() }
  const fullscreen = async () => {
    try { if (document.fullscreenElement) await document.exitFullscreen(); else await host.current.closest('.fx-app').requestFullscreen() }
    catch { onError(t('Không mở được chế độ toàn màn hình.')) }
  }
  const button = (label, icon, action, extra = {}) => <button type="button" aria-label={t(label)} title={t(label)} onClick={action} {...extra}><ChartIcon name={icon} /></button>
  return <nav ref={host} className="legacy-chart-header" aria-label={t('Thanh công cụ chart')} data-testid="legacy-chart-header">
    <div className="legacy-header-market">
      <a href={backHref} aria-label={t('Trở về Sessions')} title={t('Trở về Sessions')}><ChartIcon name="arrow-left" /></a>
      <button type="button" className="legacy-symbol" onClick={event => open('data', event)} title={t('Chọn dataset local')}><ChartIcon name="search" /><strong>{symbol}</strong></button>
      {button('So sánh mã', 'compare', event => open('compare', event))}
    </div>
    <div className="legacy-header-intervals" role="group" aria-label={t('Khung thời gian')}>
      {controls?.intervals.map(value => <button key={value} type="button" aria-pressed={controls.interval === value} onClick={() => controls.setInterval(value)}>{intervalLabel(value)}</button>)}
    </div>
    <button type="button" className="legacy-interval-menu" aria-label={t('Khung thời gian')} aria-expanded={menu === 'interval'} onClick={event => show('interval', event)} disabled={!controls}>{intervalLabel(controls?.interval || '1')}<ChartIcon name="down" /></button>
    <div className="legacy-header-chart-tools">
      {button('Kiểu biểu đồ', 'candles', event => show('style', event), { disabled: !controls, 'aria-expanded': menu === 'style' })}
      <button type="button" className="legacy-new-layout" onClick={event => open('layout', event)}>New Layout</button>
      <button type="button" onClick={() => controls.action('insertIndicator')} disabled={!controls}><ChartIcon name="indicators" /><span>{t('Các chỉ báo')}</span></button>
      {button('Hoàn tác', 'undo', () => controls.action('undo'), { disabled: !controls })}
      {button('Làm lại', 'redo', () => controls.action('redo'), { disabled: !controls })}
    </div>
    <div className="legacy-header-layout">
      <button type="button" className="legacy-session-name" title={name} aria-label={t('Chi tiết và nhánh')} onClick={event => open('context', event)}>{name}</button>
      {button('Bố cục chart', 'single-pane', event => open('layout', event))}
      <button type="button" className="legacy-save-layout" aria-label={t('Lưu chart')} title={t('Lưu chart')} disabled={!controls} onClick={() => controls.save()}><span>{name}</span></button>
      {button('Quản lý layout', 'down', event => open('layout', event))}
    </div>
    <div className="legacy-header-actions">
      {button('Quick Search', 'quick-search', event => open('search', event), { className: 'legacy-wide-action' })}
      {button('Cài đặt biểu đồ', 'settings', () => controls.action('chartProperties'), { disabled: !controls, className: 'legacy-wide-action' })}
      {button('Chụp chart PNG', 'camera', () => controls.capture(), { disabled: !controls, className: 'legacy-wide-action' })}
      <button type="button" className="legacy-editor legacy-wide-action" aria-label="Editor" title="Editor" onClick={event => open('editor', event)}><ChartIcon name="editor" /><span>Editor</span></button>
      {button('AI Mentor', 'mentor', event => open('mentor', event), { className: 'legacy-mentor' })}
      {button('Đổi giao diện', theme === 'dark' ? 'moon' : 'sun', onTheme, { className: 'legacy-wide-action', 'data-testid': 'theme-toggle' })}
      {button(full ? 'Thoát toàn màn hình' : 'Toàn màn hình', 'fit', fullscreen, { className: 'legacy-wide-action', 'aria-pressed': full })}
      {button('Công cụ chart', 'more', event => show('tools', event), { className: 'chart-header-overflow', 'aria-expanded': menu === 'tools' })}
    </div>
    {menu && <div className="legacy-header-menu" role="group" aria-label={t('Công cụ chart')}>
      {menu === 'interval' && controls?.intervals.map(value => <button key={value} type="button" aria-pressed={controls.interval === value} onClick={() => run(() => controls.setInterval(value))}>{intervalLabel(value)}</button>)}
      {menu === 'style' && [['Nến', 1], ['Thanh', 0], ['Đường', 2], ['Vùng', 3], ['Heikin Ashi', 8]].map(([label, value]) => <button key={value} type="button" disabled={!controls} aria-pressed={controls?.chartType === value} onClick={() => run(() => controls.setType(value))}>{t(label)}</button>)}
      {menu === 'tools' && <>
        {[['compare', 'So sánh mã'], ['layout', 'New Layout'], ['data', 'Dữ liệu'], ['context', 'Chi tiết và nhánh'], ['search', 'Quick Search'], ['editor', 'Editor'], ['mentor', 'AI Mentor']].map(([tool, label]) => <button key={tool} type="button" onClick={event => { setMenu(null); onOpenTool(tool, opener.current) }}>{t(label)}</button>)}
        <button type="button" disabled={!controls} onClick={() => run(() => controls.action('insertIndicator'))}>{t('Các chỉ báo')}</button>
        <button type="button" disabled={!controls} onClick={() => setMenu('style')}>{t('Kiểu biểu đồ')}</button>
        <button type="button" disabled={!controls} onClick={() => run(() => controls.action('undo'))}>{t('Hoàn tác')}</button>
        <button type="button" disabled={!controls} onClick={() => run(() => controls.action('redo'))}>{t('Làm lại')}</button>
        <button type="button" disabled={!controls} onClick={() => run(() => controls.action('chartProperties'))}>{t('Cài đặt biểu đồ')}</button>
        <button type="button" disabled={!controls} onClick={() => run(controls.save)}>{t('Lưu chart')}</button>
        <button type="button" disabled={!controls} onClick={() => run(controls.capture)}>{t('Chụp chart PNG')}</button>
        <button type="button" onClick={() => run(onTheme)}>{t('Đổi giao diện')}</button>
        <button type="button" onClick={() => run(fullscreen)}>{t(full ? 'Thoát toàn màn hình' : 'Toàn màn hình')}</button>
      </>}
    </div>}
  </nav>
}
