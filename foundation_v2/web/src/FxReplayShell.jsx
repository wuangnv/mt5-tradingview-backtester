import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import './fx-shell-story.css'
import './fx-shell-preferences.css'
import { buildWorkspaceHref, readWorkspaceContext } from './workspaceContext.js'

export { buildWorkspaceHref, readWorkspaceContext }

const LANGUAGE_STORAGE_KEY = 'tw-language'
const THEME_STORAGE_KEY = 'tw-theme'
const RAIL_COLLAPSED_STORAGE_KEY = 'tw-shell-rail-collapsed'

// The shell is being rebuilt before the workspace content. Keep the existing
// content routes in source so their contracts remain available for the next
// pass. The first shell pass intentionally renders no workspace content; the
// route components can be re-enabled once the frame is approved visually.
export const SHELL_SKELETON_MODE = true

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
    toggleNavigation: 'Mở hoặc thu gọn điều hướng',
    help: 'Mở phím tắt và trợ giúp',
    closeHelp: 'Đóng trợ giúp',
    shortcutsTitle: 'Phím tắt WMREPLAY',
    shortcutHelp: 'Mở trợ giúp',
    shortcutEscape: 'Đóng bảng trợ giúp',
    shortcutsHint: 'Các phím tắt chỉ điều khiển giao diện shell.',
    product: 'WMREPLAY',
    workspaceAria: 'Điều hướng chính WMREPLAY',
    contentAria: 'Nội dung WMREPLAY',
    primaryNavAria: 'Khu vực chính',
    utilityNavAria: 'Công cụ',
    subnavAria: 'Điều hướng workspace',
    subnav: { overview: 'Dashboard', replay: 'Sessions', trade: 'Trades', analytics: 'Analytics' },
    nav: {
      testing: ['Testing', 'Backtesting workspace'],
      sessions: ['Sessions', 'Chọn một phiên replay'],
      replay: ['Testing', 'Replay và backtest'],
      live: ['Live', 'Theo dõi thị trường và tài khoản'],
      calendar: ['Calendar', 'Lịch thị trường'],
      liveTrades: ['Trades', 'Giao dịch live read-only'],
      notes: ['Notes', 'Ghi chú thị trường'],
      tagAnalytics: ['Tag analytics', 'Phân tích theo tag'],
      tradingAccounts: ['Trading accounts', 'Tài khoản giao dịch'],
      strategies: ['Strategies', 'Quản lý chiến lược'],
      myStrategies: ['My strategies', 'Chiến lược của tôi'],
      trade: ['Trades', 'Giao dịch trong phiên replay'],
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
    toggleNavigation: 'Expand or collapse navigation',
    help: 'Open shortcuts and help',
    closeHelp: 'Close help',
    shortcutsTitle: 'WMREPLAY keyboard shortcuts',
    shortcutHelp: 'Open help',
    shortcutEscape: 'Close help panel',
    shortcutsHint: 'Shortcuts only control the workspace shell.',
    product: 'WMREPLAY',
    workspaceAria: 'WMREPLAY main navigation',
    contentAria: 'WMREPLAY content',
    primaryNavAria: 'Primary workspace',
    utilityNavAria: 'Utilities',
    subnavAria: 'Workspace navigation',
    subnav: { overview: 'Dashboard', replay: 'Sessions', trade: 'Trades', analytics: 'Analytics' },
    nav: {
      testing: ['Testing', 'Backtesting workspace'],
      sessions: ['Sessions', 'Choose a replay session'],
      replay: ['Testing', 'Replay and backtesting'],
      live: ['Live', 'Market and account workspace'],
      calendar: ['Calendar', 'Market calendar'],
      liveTrades: ['Trades', 'Read-only live trades'],
      notes: ['Notes', 'Market notes'],
      tagAnalytics: ['Tag analytics', 'Tag-based analytics'],
      tradingAccounts: ['Trading accounts', 'Trading accounts'],
      strategies: ['Strategies', 'Strategy workspace'],
      myStrategies: ['My strategies', 'Your strategies'],
      trade: ['Trades', 'Trades in a replay session'],
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

const SIDEBAR_SECTIONS = [
  {
    id: 'testing',
    copyKey: 'testing',
    icon: 'testing',
    defaultRoute: 'overview',
    defaultSection: 'dashboard',
    items: [
      { id: 'testing-dashboard', copyKey: 'overview', icon: 'dashboard', route: 'overview', activeViews: ['overview'], section: 'dashboard' },
      { id: 'testing-sessions', copyKey: 'sessions', icon: 'sessions', route: 'replay', picker: true, activeViews: ['replay'], section: 'sessions' },
      { id: 'testing-trades', copyKey: 'trade', icon: 'trades', route: 'trade', picker: true, activeViews: ['trade'], section: 'trades' },
      { id: 'testing-analytics', copyKey: 'analytics', icon: 'analytics', route: 'analytics', picker: true, activeViews: ['analytics'], section: 'analytics' },
    ],
  },
  {
    id: 'live',
    copyKey: 'live',
    icon: 'live',
    defaultRoute: 'live',
    defaultSection: 'calendar',
    items: [
      { id: 'live-calendar', copyKey: 'calendar', icon: 'calendar', route: 'live', activeViews: ['live'], section: 'calendar' },
      { id: 'live-trades', copyKey: 'liveTrades', icon: 'trades', route: 'live', activeViews: ['live'], section: 'trades' },
      { id: 'live-notes', copyKey: 'notes', icon: 'notes', route: 'live', activeViews: ['live'], section: 'notes' },
      { id: 'live-tag-analytics', copyKey: 'tagAnalytics', icon: 'tags', route: 'live', activeViews: ['live'], section: 'tag-analytics' },
      { id: 'live-accounts', copyKey: 'tradingAccounts', icon: 'accounts', route: 'live', activeViews: ['live'], section: 'trading-accounts' },
    ],
  },
  {
    id: 'strategies',
    copyKey: 'strategies',
    icon: 'strategies',
    defaultRoute: 'playbook',
    defaultSection: 'my-strategies',
    items: [
      { id: 'my-strategies', copyKey: 'myStrategies', icon: 'my-strategies', route: 'playbook', activeViews: ['playbook'], section: 'my-strategies' },
    ],
  },
  { id: 'education', copyKey: 'learn', icon: 'education', defaultRoute: 'learn', items: [] },
  { id: 'settings', copyKey: 'settings', icon: 'settings', defaultRoute: 'settings', items: [] },
]

const SUBNAV_GROUPS = {
  testing: SIDEBAR_SECTIONS[0].items,
  live: SIDEBAR_SECTIONS[1].items,
  strategies: SIDEBAR_SECTIONS[2].items,
}

function activeSectionId(activeView, query) {
  const area = query?.get('area')
  if (area && SIDEBAR_SECTIONS.some((section) => section.id === area)) return area
  if (['overview', 'replay', 'trade', 'analytics'].includes(activeView)) return 'testing'
  if (activeView === 'live') return 'live'
  if (activeView === 'playbook') return 'strategies'
  if (activeView === 'learn') return 'education'
  if (activeView === 'settings') return 'settings'
  return ''
}

function isNavItemActive(item, activeView, query, sectionId) {
  if (!item.activeViews?.includes(activeView)) return false
  if (sectionId !== 'testing' && query?.get('section') !== item.section) return false
  if (sectionId === 'testing' && query?.get('area') === 'live') return false
  return !query?.get('section') || query.get('section') === item.section || sectionId === 'testing'
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
  if (id === 'dashboard') return <svg {...common}><rect x="4" y="4" width="6" height="6" rx="1" /><rect x="14" y="4" width="6" height="6" rx="1" /><rect x="4" y="14" width="6" height="6" rx="1" /><rect x="14" y="14" width="6" height="6" rx="1" /></svg>
  if (id === 'sessions') return <svg {...common}><path d="M5 6h14M5 12h14M5 18h14" /><path d="M3 6h.01M3 12h.01M3 18h.01" /></svg>
  if (id === 'trades') return <svg {...common}><path d="M5 8h12M15 5l3 3-3 3M19 16H7M9 13l-3 3 3 3" /></svg>
  if (id === 'analytics' || id === 'testing') return <svg {...common}><path d="M4 19V9M10 19V5M16 19v-7M22 19V3" /><path d="M3 21h20" /></svg>
  if (id === 'live') return <svg {...common}><path d="M3 12h4l2-5 4 10 2-5h6" /><path d="M5 4a10 10 0 0 0 0 16M19 4a10 10 0 0 1 0 16" /></svg>
  if (id === 'calendar') return <svg {...common}><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M8 3v4M16 3v4M4 10h16M8 14h.01M12 14h.01M16 14h.01M8 17h.01M12 17h.01" /></svg>
  if (id === 'notes') return <svg {...common}><path d="M6 3h9l3 3v15H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" /><path d="M14 3v4h4M8 11h8M8 15h6" /></svg>
  if (id === 'tags') return <svg {...common}><path d="m4 5 7-1 9 9-6 6-9-9 1-7Z" /><circle cx="8" cy="8" r="1.2" /></svg>
  if (id === 'accounts') return <svg {...common}><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 9h18M16 14h3" /><circle cx="16" cy="14" r=".7" /></svg>
  if (id === 'strategies') return <svg {...common}><circle cx="12" cy="12" r="8.5" /><path d="m15.7 8.3-2.2 5.2-5.2 2.2 2.2-5.2 5.2-2.2Z" /></svg>
  if (id === 'my-strategies') return <svg {...common}><path d="M5 6h14M5 12h14M5 18h9" /><path d="m17 16 2 2 3-4" /></svg>
  if (id === 'education' || id === 'learn') return <svg {...common}><path d="m3 9 9-4 9 4-9 4-9-4Z" /><path d="M7 11v4c2 2 8 2 10 0v-4M21 9v6" /></svg>
  if (id === 'trade') return <svg {...common}><rect x="3" y="5" width="18" height="14" rx="3" /><path d="M8 9h.01M12 9h.01M16 9h.01M8 13h.01M12 13h.01M16 13h.01M8 17h8" /></svg>
  if (id === 'playbook') return <svg {...common}><circle cx="12" cy="12" r="8.5" /><path d="m15.7 8.3-2.2 5.2-5.2 2.2 2.2-5.2 5.2-2.2Z" /></svg>
  if (id === 'settings') return <svg {...common}><path d="M12 3.5v2M12 18.5v2M3.5 12h2M18.5 12h2M6 6l1.4 1.4M16.6 16.6 18 18M18 6l-1.4 1.4M7.4 16.6 6 18" /><circle cx="12" cy="12" r="3.3" /></svg>
  return <svg {...common}><path d="M4 17V7M10 17V4M16 17V9M22 17V2" /><path d="M3 20h20" /></svg>
}

function ShellRail({ activeView, workspace, query, copy, railId }) {
  const activeArea = activeSectionId(activeView, query)
  const primary = SIDEBAR_SECTIONS.slice(0, 3)
  const utility = SIDEBAR_SECTIONS.slice(3)
  const renderSectionLink = (section) => {
    const [label, description] = copy.nav[section.copyKey] || [section.id, '']
    const active = activeArea === section.id
    return (
      <a
        className={`fx-rail-section-heading fx-rail-top-level-item ${active ? 'is-active' : ''}`}
        key={section.id}
        href={hrefFor(section.defaultRoute, workspace, query, {
          area: section.id,
          ...(section.defaultSection ? { section: section.defaultSection } : {}),
        })}
        aria-current={active ? 'page' : undefined}
        aria-label={`${label}: ${description}`}
        title={description}
        data-nav-label={label}
      >
        <span className="fx-nav-icon" aria-hidden="true"><RailIcon id={section.icon} /></span>
        <span className="fx-rail-section-label">{label}</span>
      </a>
    )
  }
  return (
    <aside className="fx-rail" id={railId} aria-label={copy.workspaceAria}>
      <div className="fx-rail-primary">
        {primary.map((section, index) => (
          <React.Fragment key={section.id}>
            {index > 0 && <div className="fx-rail-divider" />}
            {renderSectionLink(section)}
          </React.Fragment>
        ))}
      </div>
      <div className="fx-rail-spacer" />
      <div className="fx-rail-utility">
        {utility.map(renderSectionLink)}
      </div>
    </aside>
  )
}

function ShellSubnav({ activeView, workspace, query, copy }) {
  const sectionId = activeSectionId(activeView, query)
  const items = SUBNAV_GROUPS[sectionId] || []
  if (items.length === 0) return null
  return (
    <nav className="fx-subnav" aria-label={copy.subnavAria}>
      {items.map((item) => {
        const label = copy.nav[item.copyKey || item.id]?.[0] || item.id
        const active = isNavItemActive(item, activeView, query, sectionId)
        return (
          <a
            className={`fx-subnav-link ${active ? 'is-active' : ''}`}
            href={hrefFor(item.route, workspace, query, {
              area: sectionId,
              section: item.section,
              ...(item.picker ? { select: '1' } : {}),
            })}
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

function ShellTopbar({ copy, language, setLanguage, theme, setTheme, railCollapsed, onToggleRail, chartWorkspace, query, workspace, helpOpen, onToggleHelp, helpButtonRef, railId }) {
  if (chartWorkspace) {
    const sessionLabel = query?.get('dataset') || query?.get('session') || 'WMReplay scan'
    const backHref = buildWorkspaceHref('replay', workspace, query, { select: '1', surface: '' })
    return (
      <header className="fx-topbar fx-chart-topbar">
        <div className="fx-chart-topbar-left">
          <a className="fx-chart-icon-button" href={backHref} aria-label="Quay lại Sessions" title="Quay lại Sessions">←</a>
          <span className="fx-chart-brand" aria-label={copy.product}>{copy.product}</span>
          <button className="fx-chart-icon-button" type="button" aria-label="Tiến nhanh" title="Tiến nhanh">≫</button>
          <button className="fx-chart-icon-button" type="button" aria-label="Thêm chart" title="Thêm chart">＋</button>
          <button className="fx-chart-timeframe" type="button" aria-label="Khung thời gian">{query?.get('timeframe') || '1m'}</button>
          <button className="fx-chart-tool-button" type="button" aria-label="Indicators">☷&nbsp; Indicators</button>
          <button className="fx-chart-tool-button" type="button" aria-label="Order flow">☷&nbsp; Order flow</button>
          <button className="fx-chart-tool-button" type="button" aria-label="Analytics">▥&nbsp; Analytics</button>
        </div>
        <div className="fx-chart-session-title" title={sessionLabel}>WMReplay · {sessionLabel}</div>
        <div className="fx-chart-topbar-actions">
          <button className="fx-chart-icon-button is-muted" type="button" aria-label="Undo" title="Undo">↶</button>
          <button className="fx-chart-icon-button is-muted" type="button" aria-label="Redo" title="Redo">↷</button>
          <button className="fx-shell-toggle fx-language-toggle" type="button" onClick={() => setLanguage(language === 'vi' ? 'en' : 'vi')} aria-label={copy.switchLanguage} title={copy.switchLanguage} data-testid="language-toggle">{language === 'vi' ? 'EN⌄' : 'VI⌄'}</button>
          <button className="fx-shell-toggle fx-theme-toggle" type="button" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-pressed={theme === 'light'} aria-label={theme === 'dark' ? copy.themeDarkName : copy.themeLightName} title={theme === 'dark' ? copy.themeDark : copy.themeLight} data-testid="theme-toggle"><span className="fx-theme-icon" aria-hidden="true">{theme === 'dark' ? '☼' : '☾'}</span></button>
          <button className="fx-shell-toggle fx-utility-icon" type="button" onClick={onToggleHelp} aria-expanded={helpOpen} aria-controls="fx-shell-help" aria-label={copy.help} title={copy.help} data-testid="help-toggle" ref={helpButtonRef}>?</button>
          <button className="fx-shell-toggle fx-utility-icon fx-fullscreen-icon" type="button" aria-label="Fullscreen" title="Fullscreen">⛶</button>
        </div>
      </header>
    )
  }
  return (
    <header className="fx-topbar">
      <div className="fx-topbar-brand" role="img" aria-label={copy.product} title={copy.product}>
        <button className="fx-menu-button" type="button" onClick={onToggleRail} aria-expanded={!railCollapsed} aria-controls={railId} aria-label={copy.toggleNavigation} title={copy.toggleNavigation}>
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
        <button className="fx-shell-toggle fx-utility-icon" type="button" onClick={onToggleHelp} aria-expanded={helpOpen} aria-controls="fx-shell-help" aria-label={copy.help} title={copy.help} data-testid="help-toggle" ref={helpButtonRef}>?</button>
      </div>
    </header>
  )
}

function ShellHelp({ copy, helpCloseRef, onClose }) {
  return (
    <div className="fx-shell-help-layer" onMouseDown={onClose}>
      <section className="fx-shell-help" id="fx-shell-help" role="dialog" aria-modal="true" aria-labelledby="fx-shell-help-title" aria-describedby="fx-shell-help-hint" onMouseDown={(event) => event.stopPropagation()}>
        <div className="fx-shell-help-header">
          <h2 id="fx-shell-help-title">{copy.shortcutsTitle}</h2>
          <button className="fx-shell-help-close" type="button" onClick={onClose} aria-label={copy.closeHelp} title={copy.closeHelp} data-testid="help-close" ref={helpCloseRef}>×</button>
        </div>
        <dl className="fx-shell-shortcuts">
          <div><dt><kbd>?</kbd></dt><dd>{copy.shortcutHelp}</dd></div>
          <div><dt><kbd>Esc</kbd></dt><dd>{copy.shortcutEscape}</dd></div>
        </dl>
        <p className="fx-shell-help-hint" id="fx-shell-help-hint">{copy.shortcutsHint}</p>
      </section>
    </div>
  )
}

function currentQuery() {
  return typeof window === 'undefined' ? new URLSearchParams() : new URLSearchParams(window.location.search)
}

export default function FxReplayShell({ children, workspace, query = currentQuery(), activeView = 'overview', mode = 'Replay' }) {
  const chartWorkspace = !SHELL_SKELETON_MODE && activeView === 'replay' && query.get('surface') === 'workspace' && Boolean(query.get('session'))
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
  const [railCollapsed, setRailCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false
    try {
      const saved = window.localStorage.getItem(RAIL_COLLAPSED_STORAGE_KEY)
      if (saved === 'true' || saved === 'false') return saved === 'true'
    } catch {
      // Private browsing can deny storage; use the responsive default below.
    }
    return window.matchMedia('(max-width: 1180px)').matches
  })
  const [helpOpen, setHelpOpen] = useState(false)
  const helpButtonRef = useRef(null)
  const helpCloseRef = useRef(null)
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
  const handleRail = useCallback(() => {
    setRailCollapsed((value) => {
      const next = !value
      try { window.localStorage.setItem(RAIL_COLLAPSED_STORAGE_KEY, String(next)) } catch { /* private browsing */ }
      return next
    })
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
  useEffect(() => {
    const onKeyDown = (event) => {
      const target = event.target
      const isEditable = target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName))
      if (event.key === '?' && !isEditable) {
        event.preventDefault()
        setHelpOpen((value) => !value)
        return
      }
      if (!helpOpen) return
      if (event.key === 'Escape') {
        event.preventDefault()
        setHelpOpen(false)
      }
      if (event.key === 'Tab') {
        const dialog = document.getElementById('fx-shell-help')
        const focusable = dialog ? [...dialog.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter((element) => !element.hasAttribute('disabled')) : []
        if (focusable.length > 0) {
          const first = focusable[0]
          const last = focusable[focusable.length - 1]
          if ((event.shiftKey && document.activeElement === first) || (!event.shiftKey && document.activeElement === last)) {
            event.preventDefault()
            const next = event.shiftKey ? last : first
            next.focus()
          }
        }
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [helpOpen])
  useEffect(() => {
    if (helpOpen) helpCloseRef.current?.focus()
  }, [helpOpen])
  const wasHelpOpen = useRef(false)
  useEffect(() => {
    if (!helpOpen && wasHelpOpen.current) helpButtonRef.current?.focus()
    wasHelpOpen.current = helpOpen
  }, [helpOpen])

  return (
    <FxReplayContext.Provider value={contextValue}>
      <div className={`fx-app fx-shell-story ${railCollapsed ? 'is-rail-collapsed' : ''} ${chartWorkspace ? 'is-chart-workspace' : ''}`} data-testid="fxreplay-shell" data-theme={theme} lang={language}>
        <ShellTopbar copy={copy} language={language} setLanguage={handleLanguage} theme={theme} setTheme={handleTheme} railCollapsed={railCollapsed} onToggleRail={handleRail} chartWorkspace={chartWorkspace} query={query} workspace={workspace} helpOpen={helpOpen} onToggleHelp={() => setHelpOpen((value) => !value)} helpButtonRef={helpButtonRef} railId="fxreplay-rail" />
        <ShellRail activeView={activeView} workspace={workspace} query={query} copy={copy} railId="fxreplay-rail" />
        <section className="fx-main" aria-label={copy.contentAria}>
          <ShellSubnav activeView={activeView} workspace={workspace} query={query} copy={copy} />
          {helpOpen && <ShellHelp copy={copy} helpCloseRef={helpCloseRef} onClose={() => setHelpOpen(false)} />}
          <div className="fx-content">{children}</div>
        </section>
      </div>
    </FxReplayContext.Provider>
  )
}

