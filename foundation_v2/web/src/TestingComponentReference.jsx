import { useState } from 'react'
import FxSelect from './FxSelect.jsx'
import { Metric } from './FxAnalytics.jsx'
import TestingReadState, { TestingSkeleton } from './TestingReadState.jsx'
import { useTestingLocale } from './testingLocale.jsx'

export default function TestingComponentReference() {
  const { t, fmt } = useTestingLocale()
  const [value, setValue] = useState('buy'), [values, setValues] = useState(['buy']), [state, setState] = useState('ready')
  const options = [{ value: 'buy', label: 'Buy' }, { value: 'sell', label: 'Sell' }, { value: 'unknown', label: 'Chưa rõ', disabled: true, detail: 'Chưa đủ dữ liệu' }]
  return <section className="wm-page wm-component-reference" aria-label={t('Bộ chuẩn Testing')}>
    <h1>{t('Bộ chuẩn Testing')}</h1>
    <section><h2>{t('Nút và bộ lọc')}</h2><div className="wm-reference-controls"><FxSelect label="Side" value={value} options={options} onChange={setValue} /><FxSelect label="Side" value={values} options={options} onChange={setValues} multiple searchable /><FxSelect label="Side" value={value} options={options} onChange={setValue} disabled /><button type="button" className="fxa-button">{t('Apply')}</button><button type="button" className="fxa-button" disabled>{t('Apply')}</button></div></section>
    <section><h2>{t('Chỉ số phiên')}</h2><div className="fxa-metrics"><Metric label="Net P/L" value={fmt(1234.5, ' USD')} /><Metric label="Net P/L" value={fmt(null, ' USD')} note="Chưa đủ dữ liệu" /><Metric label="Win rate" value={fmt(0, '%')} /><Metric label="Net P/L" value={fmt(-125, ' USD')} tone="is-negative" /></div></section>
    <section><h2>{t('Trạng thái dữ liệu')}</h2><FxSelect label="Trạng thái dữ liệu" value={state} onChange={setState} options={[['ready', 'Sẵn sàng'], ['loading', 'Đang tải'], ['empty', 'Chưa có dữ liệu.'], ['filtered', 'Không có kết quả khớp bộ lọc.'], ['error', 'Không tải được dữ liệu.'], ['stale', 'Dữ liệu chưa cập nhật.'], ['partial', 'Dữ liệu một phần.']].map(([value, label]) => ({ value, label }))} />{state === 'loading' ? <TestingSkeleton /> : <TestingReadState message={{ ready: 'Sẵn sàng', empty: 'Chưa có dữ liệu.', filtered: 'Không có kết quả khớp bộ lọc.', error: 'Không tải được dữ liệu.', stale: 'Dữ liệu chưa cập nhật.', partial: 'Dữ liệu một phần.' }[state]} error={state === 'error'} onRetry={state === 'error' ? () => setState('ready') : undefined} />}</section>
  </section>
}
