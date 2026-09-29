import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import './fx-shell-story.css'
import './fx-shell-preferences.css'
import { buildWorkspaceHref, readWorkspaceContext } from './workspaceContext.js'

export { buildWorkspaceHref, readWorkspaceContext }

const LANGUAGE_STORAGE_KEY = 'tw-language'
const THEME_STORAGE_KEY = 'tw-theme'

const SHELL_COPY = {
  vi: {
    language: 'VI',
    switchLanguage: 'Chuyển ngôn ngữ sang English',
    themeDark: 'Đang dùng giao diện tối. Chuyển sang sáng',
    themeLight: 'Đang dùng giao diện sáng. Chuyển sang tối',
    themeDarkName: 'Giao diện tối',
    themeLightName: 'Giao diện sáng',
    themeDarkShort: 'Tối',
    themeLightShort: 'Sáng',
    product: 'WMREPLAY',
    workspaceAria: 'Điều hướng WMREPLAY',
    contentAria: 'Nội dung WMREPLAY',
    contextAria: 'Ngữ cảnh workspace',
    brokerLocked: 'Broker khóa',
    sourcePrefix: 'Nguồn',
    cutoffPrefix: 'Cutoff',
    emptyInstrument: 'Chưa chọn instrument',
    emptyTimeframe: 'TF chưa chọn',
    unknownData: 'Chưa xác định',
    unconfirmedSource: 'Chưa xác nhận',
    chartCutoff: 'Xem trong chart',
    unopenedCutoff: 'Chưa mở',
    openPractice: 'Mở Practice',
    workspaceOwner: 'Chủ workspace',
    dataContract: 'HỢP ĐỒNG DỮ LIỆU',
    sourcePending: 'Đang chờ nguồn',
    dataQuality: 'Trạng thái chất lượng từ dataset hiện tại',
    noDataset: 'Chưa có dataset trong context',
    groups: { workspace: 'KHU VỰC', workflow: 'QUY TRÌNH', review: 'ĐÁNH GIÁ', tools: 'CÔNG CỤ' },
    nav: {
      overview: ['Tổng quan', 'Phiên đang làm và điểm tiếp theo'],
      data: ['Data desk', 'Dataset, provenance và QA'],
      replay: ['Practice', 'Replay chart và quyết định'],
      research: ['Research', 'Backtest và kết quả'],
      journal: ['Journal', 'Ghi chú theo phiên'],
      analytics: ['Analytics', 'Hiệu suất và thống kê'],
      risk: ['Risk', 'Giới hạn và mô phỏng rủi ro'],
      playbook: ['Playbook', 'Version và lineage của setup'],
      trade: ['Trade desk', 'Demo simulator'],
      learn: ['Learn', 'Course và glossary'],
      settings: ['Settings', 'Workspace và kết nối'],
    },
  },
  en: {
    language: 'EN',
    switchLanguage: 'Switch language to Vietnamese',
    themeDark: 'Dark theme is active. Switch to light',
    themeLight: 'Light theme is active. Switch to dark',
    themeDarkName: 'Dark theme',
    themeLightName: 'Light theme',
    themeDarkShort: 'Dark',
    themeLightShort: 'Light',
    product: 'WMREPLAY',
    workspaceAria: 'WMREPLAY navigation',
    contentAria: 'WMREPLAY content',
    contextAria: 'Workspace context',
    brokerLocked: 'Broker locked',
    sourcePrefix: 'Source',
    cutoffPrefix: 'Cutoff',
    emptyInstrument: 'No instrument selected',
    emptyTimeframe: 'No timeframe selected',
    unknownData: 'Unknown',
    unconfirmedSource: 'Unconfirmed',
    chartCutoff: 'See chart',
    unopenedCutoff: 'Not opened',
    openPractice: 'Open Practice',
    workspaceOwner: 'Workspace owner',
    dataContract: 'DATA CONTRACT',
    sourcePending: 'Source pending',
    dataQuality: 'Quality status from the current dataset',
    noDataset: 'No dataset in context',
    groups: { workspace: 'WORKSPACE', workflow: 'WORKFLOW', review: 'REVIEW', tools: 'TOOLS' },
    nav: {
      overview: ['Overview', 'Current session and next action'],
      data: ['Data desk', 'Dataset, provenance and QA'],
      replay: ['Practice', 'Replay chart and decisions'],
      research: ['Research', 'Backtest and results'],
      journal: ['Journal', 'Session notes'],
      analytics: ['Analytics', 'Performance and statistics'],
      risk: ['Risk', 'Limits and risk simulation'],
      playbook: ['Playbook', 'Setup versions and lineage'],
      trade: ['Trade desk', 'Demo simulator'],
      learn: ['Learn', 'Course and glossary'],
      settings: ['Settings', 'Workspace and connections'],
    },
  },
}

const NAV_ITEMS = [
  { id: 'overview', short: 'OV', group: 'workspace' },
  { id: 'data', short: 'DT', group: 'workflow' },
  { id: 'replay', short: 'RP', group: 'workflow' },
  { id: 'research', short: 'RS', group: 'review' },
  { id: 'journal', short: 'JR', group: 'review' },
  { id: 'analytics', short: 'AN', group: 'review' },
  { id: 'risk', short: 'RK', group: 'review' },
  { id: 'playbook', short: 'PB', group: 'review' },
  { id: 'trade', short: 'TD', group: 'review' },
]

const UTILITY_ITEMS = [
  { id: 'learn', short: 'LE', group: 'tools' },
  { id: 'settings', short: 'SE', group: 'tools' },
]

const NAV_GROUPS = [
  { id: 'workspace', items: NAV_ITEMS.filter((item) => item.group === 'workspace') },
  { id: 'workflow', items: NAV_ITEMS.filter((item) => item.group === 'workflow') },
  { id: 'review', items: NAV_ITEMS.filter((item) => item.group === 'review') },
  { id: 'tools', items: UTILITY_ITEMS },
]

const FxReplayContext = createContext(null)

function WMReplayWordmark() {
  return (
    <svg className="fx-wordmark-svg" viewBox="0 0 242 30" role="img" aria-label="WMREPLAY" focusable="false">
      <path d="M0 0h5l4 21 4-11 4 11 4-21h5l-6 30h-5l-4-10-2 10H4L0 0Z" />
      <path d="M31 30V0h6l6 12 6-12h6v30h-6V10l-4 10h-4L37 10v20h-6Z" />
      <path fillRule="evenodd" d="M62 30V0h14c8 0 12 4 12 10 0 5-3 8-7 9l8 11h-7l-7-10h-7v10h-6Zm6-25v10h7c5 0 7-2 7-5s-2-5-7-5h-7Z" />
      <path d="M94 0h23v5h-17v7h14v5h-14v8h17v5H94V0Z" />
      <path fillRule="evenodd" d="M122 30V0h14c8 0 12 4 12 10s-4 10-12 10h-8v10h-6Zm6-25v10h7c5 0 7-2 7-5s-2-5-7-5h-7Z" />
      <path d="M153 0h6v25h17v5h-23V0Z" />
      <path fillRule="evenodd" d="M177 30 188 0h7l12 30h-7l-3-8h-12l-3 8h-7Zm10-13h8l-4-11-4 11Z" />
      <path d="M209 0h7l7 11 7-11h7l-11 16v14h-6V16L209 0Z" />
    </svg>
  )
}

export function useFxReplayContext() {
  return useContext(FxReplayContext) || { updateMarketContext: () => {} }
}

function hrefFor(id, workspace, query) {
  return buildWorkspaceHref(id, workspace, query)
}

function NavItem({ item, active, workspace, query, copy }) {
  const [label, description] = copy.nav[item.id]
  return (
    <a
      className={`fx-nav-item ${active ? 'is-active' : ''}`}
      href={hrefFor(item.id, workspace, query)}
      aria-current={active ? 'page' : undefined}
      aria-label={`${label}: ${description}`}
      data-nav-label={label}
      title={description}
    >
      <span className="fx-nav-icon" aria-hidden="true">{item.short}</span>
      <span className="fx-nav-label">{label}</span>
    </a>
  )
}

function ShellTopbar({ activeItem, workspace, query, marketContext, copy, language, setLanguage, theme, setTheme }) {
  const marketLabel = [marketContext.instrument, marketContext.timeframe].filter(Boolean).join(' · ')
  const dataStatus = marketContext.dataStatus || copy.unknownData
  const statusTone = dataStatus === 'verified' ? 'is-live' : dataStatus ? 'is-warn' : 'is-muted'
  return (
    <header className="fx-topbar">
      <div className="fx-topbar-brand" aria-label={copy.product} title={copy.product}>
        <span className="fx-wordmark" aria-hidden="true"><WMReplayWordmark /></span>
        <span className="fx-wordmark-compact" aria-hidden="true">WM</span>
      </div>
      <div className="fx-context-area">
        <div className="fx-context-strip" aria-label={copy.contextAria}>
          {marketLabel && <span className="fx-context-chip fx-context-market" title={`Instrument and timeframe: ${marketLabel}`}><i className={`fx-status-dot ${statusTone}`} />{marketLabel}</span>}
        </div>
        <span className="fx-context-chip fx-context-lock" title="Broker execution is disabled">{copy.brokerLocked}</span>
      </div>
      <div className="fx-topbar-actions">
        {activeItem?.id !== 'overview' && activeItem?.id !== 'replay' && (
          <a className="fx-shell-primary" href={hrefFor('replay', workspace, query)}>{copy.openPractice}</a>
        )}
        <button className="fx-shell-toggle fx-language-toggle" type="button" onClick={() => setLanguage(language === 'vi' ? 'en' : 'vi')} aria-label={copy.switchLanguage} title={copy.switchLanguage} data-testid="language-toggle">
          {language === 'vi' ? 'EN' : 'VI'}
        </button>
        <button className="fx-shell-toggle fx-theme-toggle" type="button" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-pressed={theme === 'light'} aria-label={theme === 'dark' ? copy.themeDarkName : copy.themeLightName} title={theme === 'dark' ? copy.themeDark : copy.themeLight} data-testid="theme-toggle">
          <span className="fx-theme-icon" aria-hidden="true">{theme === 'dark' ? '☀' : '☾'}</span>
          <span className="fx-theme-label">{theme === 'dark' ? copy.themeLightShort : copy.themeDarkShort}</span>
        </button>
        <span className="fx-workspace-name">{workspace || 'tenant-a'}</span>
        <span className="fx-avatar" aria-label={copy.workspaceOwner}>A</span>
      </div>
    </header>
  )
}

function currentQuery() {
  return typeof window === 'undefined' ? new URLSearchParams() : new URLSearchParams(window.location.search)
}

export default function FxReplayShell({ children, workspace, query = currentQuery(), activeView = 'overview', mode = 'Replay' }) {
  const activeItem = [...NAV_ITEMS, ...UTILITY_ITEMS].find((item) => item.id === activeView) || NAV_ITEMS[0]
  const routeContext = useMemo(() => readWorkspaceContext(query), [query])
  const [language, setLanguage] = useState(() => {
    try {
      return window.localStorage.getItem(LANGUAGE_STORAGE_KEY) === 'en' ? 'en' : 'vi'
    } catch {
      return 'vi'
    }
  })
  const [theme, setTheme] = useState(() => {
    try {
      const saved = window.localStorage.getItem(THEME_STORAGE_KEY)
      if (saved === 'light' || saved === 'dark') return saved
      // Trading review opens in the dark chart-oriented mode by default. The
      // explicit toggle remains the source of truth when a user prefers light.
      return 'dark'
    } catch {
      return 'dark'
    }
  })
  const [marketContext, setMarketContext] = useState({
    instrument: '',
    timeframe: '',
    dataStatus: '',
    source: '',
    cutoff: '',
  })
  const updateMarketContext = useCallback((next) => {
    setMarketContext((current) => ({ ...current, ...next }))
  }, [])
  const contextValue = useMemo(() => ({
    updateMarketContext,
    routeContext,
    buildHref: (view, overrides) => buildWorkspaceHref(view, workspace, query, overrides),
  }), [query, routeContext, updateMarketContext, workspace])
  const copy = SHELL_COPY[language]
  const handleLanguage = useCallback((next) => {
    setLanguage(next)
    try { window.localStorage.setItem(LANGUAGE_STORAGE_KEY, next) } catch { /* private browsing */ }
  }, [])
  const handleTheme = useCallback((next) => {
    setTheme(next)
    try { window.localStorage.setItem(THEME_STORAGE_KEY, next) } catch { /* private browsing */ }
  }, [])
  useEffect(() => {
    const root = document.documentElement
    const previous = root.getAttribute('lang')
    root.setAttribute('lang', language)
    return () => {
      if (previous === null) root.removeAttribute('lang')
      else root.setAttribute('lang', previous)
    }
  }, [language])
  useEffect(() => {
    const root = document.documentElement
    const body = document.body
    root.dataset.twTheme = theme
    body.dataset.twTheme = theme
    root.style.colorScheme = theme
    return () => {
      delete root.dataset.twTheme
      delete body.dataset.twTheme
      root.style.removeProperty('color-scheme')
    }
  }, [theme])

  return (
    <FxReplayContext.Provider value={contextValue}>
      <div className="fx-app fx-shell-story" data-testid="fxreplay-shell" data-theme={theme} lang={language}>
        <ShellTopbar activeItem={activeItem} workspace={workspace} query={query} marketContext={marketContext} copy={copy} language={language} setLanguage={handleLanguage} theme={theme} setTheme={handleTheme} />
        <aside className="fx-rail" aria-label={copy.workspaceAria}>
          {NAV_GROUPS.map((group, groupIndex) => (
            <React.Fragment key={group.id}>
              {groupIndex > 0 && <div className="fx-rail-divider" />}
              <div className="fx-rail-caption">{copy.groups[group.id]}</div>
              <nav className="fx-nav" aria-label={copy.groups[group.id]}>
                {group.items.map((item) => <NavItem key={item.id} item={item} active={activeView === item.id} workspace={workspace} query={query} copy={copy} />)}
              </nav>
            </React.Fragment>
          ))}
          <div className="fx-rail-spacer" />
          <div className="fx-rail-footer">
            <span className="fx-rail-footer-label">{copy.dataContract}</span>
            <strong><i className={`fx-status-dot ${marketContext.dataStatus === 'verified' ? 'is-live' : marketContext.dataStatus ? 'is-warn' : 'is-muted'}`} /> {marketContext.dataStatus || copy.sourcePending}</strong>
            <small>{marketContext.dataStatus ? copy.dataQuality : copy.noDataset}</small>
          </div>
        </aside>
        <section className="fx-main" aria-label={copy.contentAria}>
          <div className="fx-content">{children}</div>
        </section>
      </div>
    </FxReplayContext.Provider>
  )
}

