import TestingReadState from './TestingReadState.jsx'
import TestingIcon from './TestingIcon.jsx'
import { useTestingLocale } from './testingLocale.jsx'
import './testing-page-state.css'

export function TestingWelcome({ onBacktest, propHref, backtestHref, preview = false }) {
  const { t } = useTestingLocale()
  const Backtest = backtestHref ? 'a' : 'button'
  return <section className="wm-viewport-state wm-testing-welcome" data-testid="testing-welcome">
    <div><h1>{t('Welcome to Testing')}</h1>
      <p>{t('Choose how you want to test your strategy — by building data, or testing under prop firm rules')}</p>
      <div className="wm-welcome-actions">
        <Backtest className="wm-welcome-action" href={backtestHref} onClick={onBacktest} disabled={preview} type={backtestHref ? undefined : 'button'}><TestingIcon kind="plus" /><strong>{t('Backtesting session')}</strong><span>{t('Build data to refine your strategy')}</span></Backtest>
        {preview ? <button className="wm-welcome-action" disabled type="button"><TestingIcon kind="trophy" /><strong>{t('Prop firm session')}</strong><span>{t('Test your strategy against prop firm rules')}</span></button>
          : <a className="wm-welcome-action" href={propHref}><TestingIcon kind="trophy" /><strong>{t('Prop firm session')}</strong><span>{t('Test your strategy against prop firm rules')}</span></a>}
      </div>
    </div>
  </section>
}

export function TestingPageSkeleton({ view = 'overview', label = 'Đang tải dữ liệu…' }) {
  const { t } = useTestingLocale()
  const table = ['trade', 'market-data'].includes(view)
  return <section className={`wm-viewport-state wm-page-skeleton is-${view}`} role="status" aria-label={t(label)} aria-busy="true">
    <span className="sr-only">{t(label)}</span>
    <div className="wm-skeleton-toolbar" aria-hidden="true"><i /><i /><i /></div>
    <div className={table ? 'wm-skeleton-table' : 'wm-skeleton-panels'} aria-hidden="true">
      {Array.from({ length: table ? 12 : view === 'overview' ? 9 : 6 }, (_, index) => <i key={index} />)}
    </div>
  </section>
}

export function TestingResourceNotice({ state, resource, onRetry }) {
  const messages = {
    error: `Không tải được ${resource}.`,
    refreshing: `Đang cập nhật ${resource}…`,
    stale: `Chưa cập nhật được ${resource}. Đang giữ bản đã đọc trước đó.`,
    partial: `${resource}: chỉ tính trên phần dữ liệu đã đọc được.`,
  }
  return messages[state] ? <div data-resource-state={state} aria-busy={state === 'refreshing'}><TestingReadState error={state === 'error'} message={messages[state]} onRetry={onRetry} /></div> : null
}
