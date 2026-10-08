import { useState } from 'react'
import FxSelect from './FxSelect.jsx'
import { CATEGORIES, categoryLabel } from './dataLibraryModel.js'
import { datasetAssetOptions } from './datasetAssetOptions.js'
import { useTestingLocale } from './testingLocale.jsx'
import './dataset-asset-select.css'

export default function DatasetAssetSelect({ datasets, instruments, sessions, value, onChange, disabled }) {
  const { t } = useTestingLocale()
  const [category, setCategory] = useState('all')
  const options = datasetAssetOptions(datasets, instruments, sessions)
  const selected = options.find(option => option.value === value)
  const categories = [...CATEGORIES, ...(options.some(option => !option.category) ? [['', 'Chưa phân loại']] : [])]
  return <FxSelect searchable label="Chọn tài sản" value={value} onChange={onChange} disabled={disabled}
    className={`dataset-asset-select${selected ? '' : ' is-placeholder'}`} localizeOptions={false}
    triggerContent={selected ? `${selected.label} · ${selected.summary}` : t('Chọn tài sản')}
    placeholder="Tìm mã hoặc tên tài sản…" emptyLabel="Không có dữ liệu đã tải phù hợp."
    options={options} filterOption={option => category === 'all' || option.category === category}
    menuHeader={<div className="dataset-asset-categories" role="group" aria-label={t('Nhóm tài sản')}>
      {[['all', 'Tất cả'], ...categories].map(([key, label]) => <button key={key} type="button"
        aria-pressed={category === key} onClick={() => setCategory(key)}>{t(label)}</button>)}
    </div>}
    renderOption={option => <>
      <span className="dataset-asset-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19h16M5 15l4-5 4 3 6-8M15 5h4v4" /></svg></span>
      <span className="dataset-asset-identity"><strong>{option.label}</strong><span>{option.name || option.summary}</span>{option.name && <small>{option.summary}</small>}</span>
      <span className="dataset-asset-category">{t(categoryLabel(option.category))}</span>
    </>} />
}
