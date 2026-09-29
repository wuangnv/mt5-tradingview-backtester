import React from 'react'

const NAV_ITEMS = [
  { id: 'overview', label: 'Tổng quan', short: 'OV', description: 'Phiên đang làm và điểm tiếp theo' },
  { id: 'data', label: 'Data desk', short: 'DT', description: 'Dataset, provenance và QA' },
  { id: 'replay', label: 'Practice', short: 'RP', description: 'Replay chart và quyết định' },
  { id: 'research', label: 'Research', short: 'RS', description: 'Backtest và kết quả' },
  { id: 'journal', label: 'Journal', short: 'JR', description: 'Ghi chú theo phiên' },
  { id: 'analytics', label: 'Analytics', short: 'AN', description: 'Hiệu suất và thống kê' },
  { id: 'risk', label: 'Risk', short: 'RK', description: 'Giới hạn và mô phỏng rủi ro' },
  { id: 'trade', label: 'Trade desk', short: 'TD', description: 'Demo simulator' },
]

const UTILITY_ITEMS = [
  { id: 'learn', label: 'Learn', short: 'LE', description: 'Course và glossary' },
  { id: 'settings', label: 'Settings', short: 'SE', description: 'Workspace và kết nối' },
]

function hrefFor(id, workspace) {
  const params = new URLSearchParams({ workspace })
  params.set('view', id)
  return `/?${params.toString()}`
}

function NavItem({ item, active, workspace }) {
  return (
    <a
      className={`fx-nav-item ${active ? 'is-active' : ''}`}
      href={hrefFor(item.id, workspace)}
      aria-current={active ? 'page' : undefined}
      title={item.description}
    >
      <span className="fx-nav-icon" aria-hidden="true">{item.short}</span>
      <span className="fx-nav-label">{item.label}</span>
    </a>
  )
}

function ShellTopbar({ activeItem, mode }) {
  return (
    <header className="fx-topbar">
      <div className="fx-breadcrumb">
        <span className="fx-product-mark">TW</span>
        <span className="fx-breadcrumb-separator">/</span>
        <strong>{activeItem?.label || 'Tổng quan'}</strong>
      </div>
      <div className="fx-context-strip" aria-label="Ngữ cảnh workspace">
        <span className="fx-context-chip"><i className="fx-status-dot is-live" />EURUSD</span>
        <span className="fx-context-chip">H1</span>
        <span className="fx-context-chip fx-context-mode">{mode}</span>
        <span className="fx-context-chip fx-context-lock">Broker locked</span>
      </div>
      <div className="fx-topbar-actions">
        <span className="fx-workspace-name">tenant-a</span>
        <button type="button" className="fx-avatar" aria-label="Workspace owner">A</button>
      </div>
    </header>
  )
}

export default function FxReplayShell({ children, workspace, activeView = 'overview', mode = 'Replay' }) {
  const activeItem = [...NAV_ITEMS, ...UTILITY_ITEMS].find((item) => item.id === activeView) || NAV_ITEMS[0]
  return (
    <div className="fx-app" data-testid="fxreplay-shell">
      <aside className="fx-rail" aria-label="Điều hướng Trading Workspace">
        <div className="fx-brand">
          <div className="fx-brand-symbol">TW</div>
          <div className="fx-brand-copy"><strong>Trading</strong><span>Workspace</span></div>
        </div>
        <div className="fx-rail-caption">WORKSPACE</div>
        <nav className="fx-nav" aria-label="Khu vực chính">
          {NAV_ITEMS.map((item) => <NavItem key={item.id} item={item} active={activeView === item.id} workspace={workspace} />)}
        </nav>
        <div className="fx-rail-divider" />
        <div className="fx-rail-caption">TOOLS</div>
        <nav className="fx-nav" aria-label="Công cụ">
          {UTILITY_ITEMS.map((item) => <NavItem key={item.id} item={item} active={activeView === item.id} workspace={workspace} />)}
        </nav>
        <div className="fx-rail-spacer" />
        <div className="fx-rail-footer">
          <span className="fx-rail-footer-label">DATA STATUS</span>
          <strong><i className="fx-status-dot is-warn" /> Local cache</strong>
          <small>Verified range chưa bật</small>
        </div>
      </aside>
      <section className="fx-main">
        <ShellTopbar activeItem={activeItem} mode={mode} />
        <div className="fx-content">{children}</div>
      </section>
    </div>
  )
}

