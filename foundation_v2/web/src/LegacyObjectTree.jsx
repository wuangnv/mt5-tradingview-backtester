import { useState } from 'react'
import ChartIcon from './ChartIcon.jsx'
import { useTestingLocale } from './testingLocale.jsx'

export default function LegacyObjectTree({ controls, symbol }) {
  const { t } = useTestingLocale(), [,refresh] = useState(0)
  const rows = controls?.objects?.() || []
  const act = (item,action) => { controls.objectAction(item,action); refresh(value => value+1) }
  return <section className="legacy-object-tree" aria-label={t('Cây đối tượng chart')}><div className="legacy-object-row is-series"><ChartIcon name="candles" /><strong>{symbol}</strong></div>{rows.map(item => <div className={`legacy-object-row ${item.visible ? '' : 'is-hidden'}`} key={item.id}><button type="button" onClick={() => act(item,'select')}><ChartIcon name={item.kind==='study'?'indicators':'trendline'} /><span>{item.name}</span></button><button type="button" aria-label={`${t(item.visible?'Ẩn':'Hiện')} ${item.name}`} onClick={() => act(item,'visibility')}><ChartIcon name={item.visible?'eye':'eye-off'} /></button><button type="button" aria-label={`${t('Xóa')} ${item.name}`} onClick={() => act(item,'remove')}><ChartIcon name="trash" /></button></div>)}{!rows.length && <p>{t('Chưa có indicator hoặc drawing')}</p>}</section>
}
