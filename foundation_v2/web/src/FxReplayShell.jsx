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
    workspaceAria: 'Điều hướng chính WMREPLAY',
    contentAria: 'Nội dung WMREPLAY',
    primaryNavAria: 'Khu vực chính',
    utilityNavAria: 'Công cụ',
    subnavAria: 'Điều hướng workspace',
    subnav: { overview: 'Dashboard', replay: 'Sessions', trade: 'Trades', analytics: 'Analytics' },
    nav: {
      replay: ['Testing', 'Replay và backtest'],
      trade: ['Live', 'Mô phỏng và read-only'],
      playbook: ['Strategies', 'Strategy và playbook'],
      learn: ['Education', 'Course và glossary'],
      settings: ['Settings', 'Workspace và kết nối'],
      overview: ['Dashboard', 'Phiên đang làm và điểm tiếp theo'],
      data: ['Data desk', 'Dataset, provenance và QA'],
      research: ['Research', 'Backtest và kết quả'],
      journal: ['Journal', 'Ghi chú theo phiên'],
      analytics: ['Analytics', 'Hiệu suất và thống kê'],
      risk: ['Risk', 'Giới hạn và mô phỏng rủi ro'],
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
    workspaceAria: 'WMREPLAY main navigation',
    contentAria: 'WMREPLAY content',
    primaryNavAria: 'Primary workspace',
    utilityNavAria: 'Utilities',
    subnavAria: 'Workspace navigation',
    subnav: { overview: 'Dashboard', replay: 'Sessions', trade: 'Trades', analytics: 'Analytics' },
    nav: {
      replay: ['Testing', 'Replay and backtesting'],
      trade: ['Live', 'Demo simulator and read-only'],
      playbook: ['Strategies', 'Strategies and playbooks'],
      learn: ['Education', 'Course and glossary'],
      settings: ['Settings', 'Workspace and connections'],
      overview: ['Dashboard', 'Current session and next action'],
      data: ['Data desk', 'Dataset, provenance and QA'],
      research: ['Research', 'Backtest and results'],
      journal: ['Journal', 'Session notes'],
      analytics: ['Analytics', 'Performance and statistics'],
      risk: ['Risk', 'Limits and risk simulation'],
    },
  },
}

const NAV_ITEMS = [
  { id: 'replay', short: '⌁', group: 'primary', picker: true },
  { id: 'trade', short: '◉', group: 'primary', picker: true },
  { id: 'playbook', short: '◈', group: 'primary' },
]

const UTILITY_ITEMS = [
  { id: 'learn', short: '⌂', group: 'utility' },
  { id: 'settings', short: '⚙', group: 'utility' },
]

const NAV_GROUPS = [
  { id: 'primary', items: NAV_ITEMS },
  { id: 'utility', items: UTILITY_ITEMS },
]

const SUBNAV_ITEMS = [
  { id: 'overview', route: 'overview' },
  { id: 'replay', route: 'replay', picker: true },
  { id: 'trade', route: 'trade', picker: true },
  { id: 'analytics', route: 'analytics', picker: true },
]

const RAIL_ACTIVE_VIEWS = {
  replay: ['replay', 'data'],
  trade: ['trade'],
  playbook: ['playbook', 'research', 'journal', 'risk'],
  learn: ['learn'],
  settings: ['settings'],
}

function isRailActive(itemId, activeView) {
  return RAIL_ACTIVE_VIEWS[itemId]?.includes(activeView) || false
}

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

function hrefFor(id, workspace, query, overrides = {}) {
  return buildWorkspaceHref(id, workspace, query, overrides)
}

/*
 * The source reference uses small, high-contrast line icons in the rail. Keep
 * them inline so the shell does not depend on an icon font (which would make
 * the first paint and visual QA vary with the host machine's installed fonts).
 */
function RailIcon({ id }) {
  const common = {
    className: 'fx-nav-icon-svg',
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: '1.8',
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    focusable: 'false',
  }
  if (id === 'trade') return <svg {...common}><rect x="3" y="5" width="18" height="14" rx="3" /><path d="M8 9h.01M12 9h.01M16 9h.01M8 13h.01M12 13h.01M16 13h.01M8 17h8" /></svg>
  if (id === 'playbook') return <svg {...common}><circle cx="12" cy="12" r="8.5" /><path d="m15.7 8.3-2.2 5.2-5.2 2.2 2.2-5.2 5.2-2.2Z" /></svg>
  if (id === 'learn') return <svg {...common}><path d="m3 9 9-4 9 4-9 4-9-4Z" /><path d="M7 11v4c2 2 8 2 10 0v-4M21 9v6" /></svg>
  if (id === 'settings') return <svg {...common}><path d="M12 3.5v2M12 18.5v2M3.5 12h2M18.5 12h2M6 6l1.4 1.4M16.6 16.6 18 18M18 6l-1.4 1.4M7.4 16.6 6 18" /><circle cx="12" cy="12" r="3.3" /></svg>
  return <svg {...common}><path d="M4 17V7M10 17V4M16 17V9M22 17V2" /><path d="M3 20h20" /></svg>
}

function NavItem({ item, active, workspace, query, copy }) {
  const [label, description] = copy.nav[item.id]
  return (
    <a
      className={`fx-nav-item ${active ? 'is-active' : ''}`}
      href={hrefFor(item.id, workspace, query, item.picker ? { select: '1' } : {})}
      aria-current={active ? 'page' : undefined}
      aria-label={`${label}: ${description}`}
      data-nav-label={label}
      title={description}
    >
      <span className="fx-nav-icon" aria-hidden="true"><RailIcon id={item.id} /></span>
      <span className="fx-nav-label">{label}</span>
    </a>
  )
}

function ShellSubnav({ activeView, workspace, query, copy }) {
  return (
    <nav className="fx-subnav" aria-label={copy.subnavAria}>
      {SUBNAV_ITEMS.map((item) => {
        const label = copy.subnav[item.id]
        const active = activeView === item.id
        return (
          <a
            className={`fx-subnav-link ${active ? 'is-active' : ''}`}
            href={hrefFor(item.route, workspace, query, item.picker ? { select: '1' } : {})}
            aria-current={active ? 'page' : undefined}
            key={item.id}
          >
            {label}
          </a>
        )
      })}
    </nav>
  )
}

function ShellHero({ activeView, workspace, query, copy }) {
  const title = ['overview', 'replay', 'trade', 'analytics'].includes(activeView)
    ? 'Testing'
    : (copy.nav[activeView]?.[0] || 'Workspace')
  return (
    <div className="fx-shell-hero">
      <div className="fx-shell-hero-title">
        <h1>{title}</h1>
      </div>
      <ShellSubnav activeView={activeView} workspace={workspace} query={query} copy={copy} />
    </div>
  )
}

function ShellTopbar({ copy, language, setLanguage, theme, setTheme, railCollapsed, onToggleRail }) {
  return (
    <header className="fx-topbar">
      <div className="fx-topbar-brand" role="img" aria-label={copy.product} title={copy.product}>
        <button className="fx-menu-button" type="button" onClick={onToggleRail} aria-expanded={!railCollapsed} aria-label="Toggle navigation" title="Toggle navigation">
          <svg className="fx-menu-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
            <path d="M4 7h8M4 12h16M4 17h8" />
            <path d="m8 4-4 3 4 3" />
          </svg>
        </button>
        <span className="fx-wordmark" aria-hidden="true"><WMReplayWordmark /></span>
        <span className="fx-wordmark-compact" aria-hidden="true">WM</span>
      </div>
      <div className="fx-topbar-actions">
        <button className="fx-shell-toggle fx-language-toggle" type="button" onClick={() => setLanguage(language === 'vi' ? 'en' : 'vi')} aria-label={copy.switchLanguage} title={copy.switchLanguage} data-testid="language-toggle">
          {language === 'vi' ? 'EN⌄' : 'VI⌄'}
        </button>
        <button className="fx-shell-toggle fx-theme-toggle" type="button" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-pressed={theme === 'light'} aria-label={theme === 'dark' ? copy.themeDarkName : copy.themeLightName} title={theme === 'dark' ? copy.themeDark : copy.themeLight} data-testid="theme-toggle">
          <span className="fx-theme-icon" aria-hidden="true">{theme === 'dark' ? '☼' : '☾'}</span>
        </button>
        <button className="fx-shell-toggle fx-utility-icon" type="button" aria-label="Help" title="Help">?</button>
        <button className="fx-shell-toggle fx-utility-icon fx-fullscreen-icon" type="button" aria-label="Fullscreen" title="Fullscreen">⛶</button>
      </div>
    </header>
  )
}

function currentQuery() {
  return typeof window === 'undefined' ? new URLSearchParams() : new URLSearchParams(window.location.search)
}

export default function FxReplayShell({ children, workspace, query = currentQuery(), activeView = 'overview', mode = 'Replay' }) {
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
  const [railCollapsed, setRailCollapsed] = useState(false)
  // Kept as a stable compatibility hook for workspaces that report market
  // context. The global header intentionally does not render that metadata.
  const updateMarketContext = useCallback(() => {}, [])
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
      <div className={`fx-app fx-shell-story ${railCollapsed ? 'is-rail-collapsed' : ''}`} data-testid="fxreplay-shell" data-theme={theme} lang={language}>
        <ShellTopbar copy={copy} language={language} setLanguage={handleLanguage} theme={theme} setTheme={handleTheme} railCollapsed={railCollapsed} onToggleRail={() => setRailCollapsed((value) => !value)} />
        <aside className="fx-rail" aria-label={copy.workspaceAria}>
          {NAV_GROUPS.map((group, groupIndex) => (
            <React.Fragment key={group.id}>
              {groupIndex > 0 && <div className="fx-rail-divider" />}
              <nav className="fx-nav" aria-label={group.id === 'primary' ? copy.primaryNavAria : copy.utilityNavAria}>
                {group.items.map((item) => <NavItem key={item.id} item={item} active={isRailActive(item.id, activeView)} workspace={workspace} query={query} copy={copy} />)}
              </nav>
              {groupIndex === 0 && <div className="fx-rail-spacer" />}
            </React.Fragment>
          ))}
        </aside>
        <section className="fx-main" aria-label={copy.contentAria}>
          <ShellHero activeView={activeView} workspace={workspace} query={query} copy={copy} />
          <div className="fx-content">{children}</div>
        </section>
      </div>
    </FxReplayContext.Provider>
  )
}

