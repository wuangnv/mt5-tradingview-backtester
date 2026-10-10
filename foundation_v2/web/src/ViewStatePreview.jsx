import { Suspense, lazy } from 'react'
import FxSelect from './FxSelect.jsx'
import TestingReadState from './TestingReadState.jsx'
import { TestingPageSkeleton } from './TestingPageState.jsx'
import { previewOptions } from './demoMode.js'
import { useTestingLocale } from './testingLocale.jsx'
import './view-state-preview.css'

const DemoPreview = lazy(() => import('./DemoPreview.jsx'))

export function ViewStateSelect({ value, view, onChange }) {
  const { t } = useTestingLocale()
  const label = previewOptions(view).find(option => option.value === value)?.label || 'Dữ liệu mẫu'
  return <div className="wm-demo-action">
    {value !== 'real' && <div className="wm-view-state-note" data-testid="view-state-preview" data-preview-state={value} role="status"><span>{t('Bản xem thử')}</span><strong title={t(label)}>{t(label)}</strong></div>}
    <FxSelect className="wm-view-state-select" label="Chế độ xem dữ liệu" value={value}
    triggerContent={t(previewOptions(view).find(option => option.value === value)?.label)}
    options={previewOptions(view).map(option => ({ ...option, detail: option.disabled ? 'Chưa có mẫu trạng thái này cho trang hiện tại.' : option.detail }))}
    menuHeader={<p className="wm-view-state-menu-hint">{t('Các trạng thái xem thử dùng dữ liệu mẫu; dữ liệu thật được giữ nguyên.')}</p>}
    onChange={onChange} /></div>
}

export default function ViewStatePreview({ state, view, workspace, query, onChange }) {
  const { t } = useTestingLocale()
  if (state === 'loading') return <TestingPageSkeleton view={view} />
  if (!['overview', 'replay', 'trade', 'analytics', 'market-data'].includes(view) && ['empty', 'error', 'unavailable', 'filtered'].includes(state)) return <section className="wm-viewport-state wm-testing-welcome"><TestingReadState error={state === 'error'} message={state === 'empty' ? 'Chưa có bản ghi.' : state === 'filtered' ? 'Không có kết quả khớp bộ lọc.' : state === 'error' ? 'Không tải được dữ liệu.' : 'Tính năng chưa khả dụng.'} /></section>
  if (state === 'denied') return <section className="wm-viewport-state wm-testing-welcome"><TestingReadState error message="Không có quyền xem dữ liệu của workspace này." /></section>
  return <Suspense fallback={<TestingPageSkeleton view={view} />}><DemoPreview key={`${view}:${state}`} view={view} workspace={workspace} query={query} state={state} onChange={onChange} /></Suspense>
}
