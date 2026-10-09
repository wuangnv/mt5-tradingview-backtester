import { useState } from 'react'
import FxSelect from './FxSelect.jsx'
import { CATEGORIES, categoryLabel } from './dataLibraryModel.js'
import { datasetAssetOptions } from './datasetAssetOptions.js'
import { useTestingLocale } from './testingLocale.jsx'
import './dataset-asset-select.css'

export default function DatasetAssetSelect({ datasets, instruments, sessions, value, onChange, disabled }) {
  const { t } = useTestingLocale()
  const [category, setCategory] = useState('all')
  const rawOptions = datasetAssetOptions(datasets, instruments, sessions)
  const currency = datasets.find(item => item.dataset_id === value[0])?.instrument_spec?.account_ccy || 'USD'
  const selectedSymbols = new Set(datasets.filter(item => value.includes(item.dataset_id)).map(item => item.instrument_id))
  const options = rawOptions.map(option => {
    const dataset = datasets.find(item => item.dataset_id === option.value)
    return { ...option, disabled:!value.includes(option.value) && (
      value.length >= 12 && !selectedSymbols.has(dataset?.instrument_id)
      || value.length > 0 && (dataset?.instrument_spec?.account_ccy || 'USD') !== currency) }
  })
  const choose = next => {
    const added = next.find(key => !value.includes(key))
    if (!added) { onChange(next); return }
    const symbol = datasets.find(item => item.dataset_id === added)?.instrument_id
    onChange(next.filter(key => key === added || datasets.find(item => item.dataset_id === key)?.instrument_id !== symbol))
  }
  const selected = options.filter(option => value.includes(option.value))
  const categories = [...CATEGORIES, ...(options.some(option => !option.category) ? [['', 'Chưa phân loại']] : [])]
  return <FxSelect searchable multiple multipleStyle="check" selectedTags={selected} label="Chọn tài sản" value={value} onChange={choose} disabled={disabled}
    className={`is-field dataset-asset-select${selected.length ? '' : ' is-placeholder'}`} localizeOptions={false}
    triggerContent={selected.length ? '' : t('Chọn tài sản')}
    placeholder="Tìm mã hoặc tên tài sản…" emptyLabel="Không có dữ liệu đã tải phù hợp."
    options={options} filterOption={option => category === 'all' || option.category === category}
    menuHeader={<div className="dataset-asset-categories" role="group" aria-label={t('Nhóm tài sản')}>
      {[['all', 'Tất cả'], ...categories].map(([key, label]) => <button key={key} type="button"
        aria-pressed={category === key} onClick={() => setCategory(key)}>{t(label)}</button>)}
    </div>}
    renderOption={option => <>
      <span className="dataset-asset-identity"><strong>{option.label}</strong><span>{option.name || option.summary}</span>{option.name && <small>{option.summary}</small>}</span>
      <span className="dataset-asset-category">{t(categoryLabel(option.category))}</span>
    </>} />
}
