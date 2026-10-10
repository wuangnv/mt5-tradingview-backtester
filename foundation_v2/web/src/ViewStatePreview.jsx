import { Suspense, lazy } from 'react'
import FxSelect from './FxSelect.jsx'
import TestingReadState, { TestingSkeleton } from './TestingReadState.jsx'
import { DATA_STATES } from './dataStates.js'
import { previewOptions } from './demoMode.js'
import { useTestingLocale } from './testingLocale.jsx'
import './view-state-preview.css'

const DemoPreview = lazy(() => import('./DemoPreview.jsx'))

export function ViewStateSelect({ value, view, onChange }) {
  const { t } = useTestingLocale()
  const label = DATA_STATES.find(([state]) => state === value)?.[1] || 'Dữ liệu mẫu'
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
  const label = DATA_STATES.find(([value]) => value === state)?.[1] || 'Dữ liệu mẫu'
  const hasData = ['demo', 'refreshing', 'stale', 'partial', 'unknown'].includes(state)
  const messages = {
    empty: view === 'overview' || view === 'replay' ? 'Chưa có phiên. Các kết quả và biểu đồ phụ thuộc phiên sẽ xuất hiện sau khi có dữ liệu.' : 'Chưa có bản ghi. Các kết quả phụ thuộc dữ liệu này chưa thể hiển thị.',
    error: 'Không tải được dữ liệu. Thử lại để xem trạng thái có dữ liệu.',
    denied: 'Không có quyền xem dữ liệu của workspace này.',
    unavailable: 'Nguồn dữ liệu chưa được kết nối hoặc tính năng chưa khả dụng.',
    filtered: 'Không có kết quả khớp bộ lọc. Dữ liệu gốc vẫn còn.',
    refreshing: 'Đang cập nhật… Dữ liệu đã có vẫn được giữ trên màn hình.',
    stale: 'Cập nhật thất bại. Dữ liệu đang hiển thị là bản đã đọc trước đó.',
    partial: 'Chỉ đọc được một phần số phiên mẫu. Thống kê bên dưới chỉ tính phần đã đọc.',
    unknown: 'Có phiên và giao dịch, nhưng chưa biết thời gian luyện tập và replay. Các số chưa biết hiển thị —.',
  }
  return <>
    {state === 'loading' ? <section className="wm-view-state-placeholder" aria-label={t(label)}><TestingSkeleton rows={6} /></section>
      : !hasData ? <section className="wm-view-state-placeholder"><TestingReadState error={state === 'error' || state === 'denied'} message={messages[state]} onRetry={state === 'error' ? () => onChange('demo') : undefined} />
        {['empty', 'filtered'].includes(state) && <button className="fxa-button" type="button" onClick={() => onChange('demo')}>{t(state === 'filtered' ? 'Xóa bộ lọc' : 'Xem ví dụ có dữ liệu')}</button>}
      </section> : <>
        {messages[state] && <div className="wm-view-state-update" aria-busy={state === 'refreshing'}><TestingReadState message={messages[state]} onRetry={state === 'stale' ? () => onChange('demo') : undefined} /></div>}
        <Suspense fallback={<TestingSkeleton />}><DemoPreview key={`${view}:${state}`} view={view} workspace={workspace} query={query} state={state} /></Suspense>
      </>}
  </>
}
