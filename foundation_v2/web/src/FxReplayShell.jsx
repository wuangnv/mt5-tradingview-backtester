import React, { createContext, useCallback, useContext, useMemo, useState } from 'react'
import './fx-shell-story.css'

const NAV_ITEMS = [
  { id: 'overview', label: 'Tổng quan', short: 'OV', description: 'Phiên đang làm và điểm tiếp theo', group: 'Workspace' },
  { id: 'data', label: 'Data desk', short: 'DT', description: 'Dataset, provenance và QA', group: 'Workflow' },
  { id: 'replay', label: 'Practice', short: 'RP', description: 'Replay chart và quyết định', group: 'Workflow' },
  { id: 'research', label: 'Research', short: 'RS', description: 'Backtest và kết quả', group: 'Review' },
  { id: 'journal', label: 'Journal', short: 'JR', description: 'Ghi chú theo phiên', group: 'Review' },
  { id: 'analytics', label: 'Analytics', short: 'AN', description: 'Hiệu suất và thống kê', group: 'Review' },
  { id: 'risk', label: 'Risk', short: 'RK', description: 'Giới hạn và mô phỏng rủi ro', group: 'Review' },
  { id: 'trade', label: 'Trade desk', short: 'TD', description: 'Demo simulator', group: 'Review' },
]

const UTILITY_ITEMS = [
  { id: 'learn', label: 'Learn', short: 'LE', description: 'Course và glossary', group: 'Tools' },
  { id: 'settings', label: 'Settings', short: 'SE', description: 'Workspace và kết nối', group: 'Tools' },
]

const NAV_GROUPS = [
  { id: 'workspace', label: 'WORKSPACE', items: NAV_ITEMS.filter((item) => item.group === 'Workspace') },
  { id: 'workflow', label: 'WORKFLOW', items: NAV_ITEMS.filter((item) => item.group === 'Workflow') },
  { id: 'review', label: 'REVIEW', items: NAV_ITEMS.filter((item) => item.group === 'Review') },
  { id: 'tools', label: 'TOOLS', items: UTILITY_ITEMS },
]

const FxReplayContext = createContext(null)

export function useFxReplayContext() {
  return useContext(FxReplayContext) || { updateMarketContext: () => {} }
}

function hrefFor(id, workspace) {
  const params = new URLSearchParams({ workspace: workspace || 'tenant-a' })
  params.set('view', id)
  return `/?${params.toString()}`
}

function NavItem({ item, active, workspace }) {
  return (
    <a
      className={`fx-nav-item ${active ? 'is-active' : ''}`}
      href={hrefFor(item.id, workspace)}
      aria-current={active ? 'page' : undefined}
      aria-label={`${item.label}: ${item.description}`}
      data-nav-label={item.label}
      title={item.description}
    >
      <span className="fx-nav-icon" aria-hidden="true">{item.short}</span>
      <span className="fx-nav-label">{item.label}</span>
    </a>
  )
}

function ShellTopbar({ activeItem, mode, workspace, marketContext }) {
  const instrument = marketContext.instrument || 'Chưa chọn instrument'
  const timeframe = marketContext.timeframe || 'TF chưa chọn'
  const dataStatus = marketContext.dataStatus || 'Chưa xác định'
  const source = marketContext.source || (dataStatus === 'fixture-only' ? 'Fixture / QA only' : 'Chưa xác nhận')
  const cutoff = marketContext.cutoff || (activeItem?.id === 'replay' ? 'Xem trong chart' : 'Chưa mở')
  const statusTone = dataStatus === 'verified' ? 'is-live' : dataStatus ? 'is-warn' : 'is-muted'
  return (
    <header className="fx-topbar">
      <div className="fx-breadcrumb">
        <span className="fx-product-mark">TW</span>
        <span className="fx-breadcrumb-product">Trading Workspace</span>
        <span className="fx-breadcrumb-separator">/</span>
        <strong>{activeItem?.label || 'Tổng quan'}</strong>
      </div>
      <div className="fx-context-strip" aria-label="Ngữ cảnh workspace">
        <span className="fx-context-chip fx-context-instrument" title={`Instrument: ${instrument}`}><i className={`fx-status-dot ${statusTone}`} />{instrument}</span>
        <span className="fx-context-chip fx-context-timeframe" title={`Timeframe: ${timeframe}`}>{timeframe}</span>
        <span className="fx-context-chip fx-context-source" title={`Data source: ${source}`}>Source: {source}</span>
        <span className="fx-context-chip fx-context-cutoff" title={`Decision cutoff: ${cutoff}`}>Cutoff: {cutoff}</span>
        <span className="fx-context-chip fx-context-mode" title="Current operating mode">{mode}</span>
        <span className="fx-context-chip fx-context-lock" title="Broker execution is disabled">Broker locked</span>
      </div>
      <div className="fx-topbar-actions">
        {activeItem?.id !== 'overview' && activeItem?.id !== 'replay' && (
          <a className="fx-shell-primary" href={hrefFor('replay', workspace)}>Mở Practice</a>
        )}
        <span className="fx-workspace-name">{workspace || 'tenant-a'}</span>
        <span className="fx-avatar" aria-label="Workspace owner">A</span>
      </div>
    </header>
  )
}

export default function FxReplayShell({ children, workspace, activeView = 'overview', mode = 'Replay' }) {
  const activeItem = [...NAV_ITEMS, ...UTILITY_ITEMS].find((item) => item.id === activeView) || NAV_ITEMS[0]
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
  const contextValue = useMemo(() => ({ updateMarketContext }), [updateMarketContext])

  return (
    <FxReplayContext.Provider value={contextValue}>
      <div className="fx-app fx-shell-story" data-testid="fxreplay-shell">
        <aside className="fx-rail" aria-label="Điều hướng Trading Workspace">
          <div className="fx-brand">
            <div className="fx-brand-symbol">TW</div>
            <div className="fx-brand-copy"><strong>Trading</strong><span>Workspace</span></div>
          </div>
          {NAV_GROUPS.map((group, groupIndex) => (
            <React.Fragment key={group.id}>
              {groupIndex > 0 && <div className="fx-rail-divider" />}
              <div className="fx-rail-caption">{group.label}</div>
              <nav className="fx-nav" aria-label={group.label}>
                {group.items.map((item) => <NavItem key={item.id} item={item} active={activeView === item.id} workspace={workspace} />)}
              </nav>
            </React.Fragment>
          ))}
          <div className="fx-rail-spacer" />
          <div className="fx-rail-footer">
            <span className="fx-rail-footer-label">DATA CONTRACT</span>
            <strong><i className={`fx-status-dot ${marketContext.dataStatus === 'verified' ? 'is-live' : marketContext.dataStatus ? 'is-warn' : 'is-muted'}`} /> {marketContext.dataStatus || 'Source pending'}</strong>
            <small>{marketContext.dataStatus ? 'Quality status từ dataset hiện tại' : 'Chưa có dataset trong context'}</small>
          </div>
        </aside>
        <section className="fx-main" aria-label="Trading Workspace content">
          <ShellTopbar activeItem={activeItem} mode={mode} workspace={workspace} marketContext={marketContext} />
          <div className="fx-content">{children}</div>
        </section>
      </div>
    </FxReplayContext.Provider>
  )
}

