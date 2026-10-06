import React from 'react'
import { useTestingLocale } from './testingLocale.jsx'

export function TestingSkeleton({ label = 'Đang tải dữ liệu…', rows = 4 }) {
  const { t } = useTestingLocale()
  return <div className="wm-skeleton" role="status" aria-label={t(label)} aria-busy="true"><span className="sr-only">{t(label)}</span>{Array.from({ length: rows }, (_, index) => <span key={index} aria-hidden="true" />)}</div>
}

export default function TestingReadState({ message, error = false, onRetry }) {
  const { t } = useTestingLocale()
  return <div className="wm-read-state" role={error ? 'alert' : 'status'}><p>{t(message)}</p>{onRetry && <button type="button" className="fxa-button" onClick={onRetry}>{t('Thử lại')}</button>}</div>
}

export class TestingRouteBoundary extends React.Component {
  state = { error: false }
  static getDerivedStateFromError() { return { error: true } }
  render() { return this.state.error ? <TestingReadState error message="Không tải được trang." onRetry={() => window.location.reload()} /> : this.props.children }
}
