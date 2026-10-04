import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createChartAnnotation, deleteChartAnnotation, drawingIsVisibleAt, listChartAnnotations, normalizeAnnotationDraft, reviseChartAnnotation } from './chartAnnotations.js'

export const DRAWING_LABELS = Object.freeze({
  'horizontal-line': 'Đường giá', trendline: 'Đường xu hướng', zone: 'Vùng giá', text: 'Ghi chú', measure: 'Đo giá',
})

export function useReplayDrawings({ workspace, sessionId, rows, cutoff, instrument, timeframe }) {
  const [saved, setSaved] = useState({ status: 'idle', items: [], error: '' })
  const [drafts, setDrafts] = useState([])
  const [preferences, setPreferences] = useState({ hidden: [], locked: [] })
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const generation = useRef(0)
  const lock = useRef(false)
  const storageKey = `tw:replay:drawings:${workspace}:${sessionId}`
  const reload = useCallback(async (signal) => {
    const activeGeneration = generation.current
    setSaved(current => ({ ...current, status: 'loading', error: '' }))
    try {
      const items = await listChartAnnotations(workspace, { signal })
      if (!signal?.aborted && generation.current === activeGeneration) {
        setSaved({ status: 'ready', items, error: '' })
        setError('')
      }
    } catch (cause) {
      if (!signal?.aborted && generation.current === activeGeneration) setSaved(current => ({ ...current, status: 'error', error: String(cause.message || cause) }))
    }
  }, [workspace])
  useEffect(() => {
    generation.current += 1
    setDrafts([])
    setBusy('')
    lock.current = false
    setError('')
    setSaved({ status: 'idle', items: [], error: '' })
    try {
      const value = JSON.parse(localStorage.getItem(storageKey) || '{}')
      setPreferences({ hidden: Array.isArray(value.hidden) ? value.hidden : [], locked: Array.isArray(value.locked) ? value.locked : [] })
    } catch { setPreferences({ hidden: [], locked: [] }) }
    if (!sessionId) return undefined
    const controller = new AbortController()
    reload(controller.signal)
    return () => { generation.current += 1; controller.abort() }
  }, [reload, sessionId, storageKey])
  const togglePreference = (kind, id) => setPreferences(current => {
    const next = { ...current, [kind]: current[kind].includes(id) ? current[kind].filter(value => value !== id) : [...current[kind], id] }
    try { localStorage.setItem(storageKey, JSON.stringify(next)) } catch { /* Browser storage may be unavailable; API data remains authoritative. */ }
    return next
  })
  const add = useCallback((type, anchors, label) => {
    const payload = normalizeAnnotationDraft({
      annotation_type: type === 'measure' ? 'trendline' : type,
      instrument_id: instrument, timeframe, cutoff_timestamp: cutoff, anchors,
      source: 'replay', run_id: sessionId, label,
    })
    if (type === 'measure') payload.annotation_type = 'measure'
    const record = { record_id: crypto.randomUUID(), payload, local: true }
    setDrafts(current => [...current, record])
    setError('')
    return record
  }, [cutoff, instrument, sessionId, timeframe])
  const scope = useMemo(() => ({ sessionId, instrument, timeframe, cutoff, timestamps: new Set(rows.map(row => Number(row.timestamp))) }), [cutoff, instrument, rows, sessionId, timeframe])
  const objects = useMemo(() => [...saved.items, ...drafts].filter(record => drawingIsVisibleAt(record, scope)).map(record => ({
    ...record, hidden: preferences.hidden.includes(record.record_id), locked: preferences.locked.includes(record.record_id),
  })), [drafts, preferences, saved.items, scope])
  const run = async (record, operation) => {
    if (lock.current || preferences.locked.includes(record.record_id)) return
    const activeGeneration = generation.current
    lock.current = true
    setBusy(record.record_id)
    setError('')
    try { await operation(activeGeneration) } catch (cause) {
      if (activeGeneration === generation.current) setError(cause.status === 409 ? 'Đối tượng đã đổi ở nơi khác. Đối chiếu dữ liệu nguồn đối tượng trước khi sửa tiếp.' : cause.status === 404 ? 'Đối tượng đã bị xóa hoặc không còn trong workspace. Đối chiếu dữ liệu nguồn danh sách để đồng bộ.' : String(cause.message || cause))
    } finally {
      if (activeGeneration === generation.current) { lock.current = false; setBusy('') }
    }
  }
  const save = record => run(record, async activeGeneration => {
    const created = await createChartAnnotation(workspace, record.payload)
    if (activeGeneration !== generation.current) return
    setSaved(current => ({ ...current, items: [...current.items, created] }))
    setDrafts(current => current.filter(item => item.record_id !== record.record_id))
  })
  const remove = record => run(record, async activeGeneration => {
    if (!record.local) await deleteChartAnnotation(workspace, record.record_id, record.revision)
    if (activeGeneration !== generation.current) return
    setSaved(current => ({ ...current, items: current.items.filter(item => item.record_id !== record.record_id) }))
    setDrafts(current => current.filter(item => item.record_id !== record.record_id))
  })
  const rename = (record, label) => run(record, async activeGeneration => {
    const payload = { ...record.payload, label }
    if (record.local) {
      setDrafts(current => current.map(item => item.record_id === record.record_id ? { ...item, payload } : item))
      return
    }
    const revised = await reviseChartAnnotation(workspace, record.record_id, record.revision, payload)
    if (activeGeneration === generation.current) setSaved(current => ({ ...current, items: current.items.map(item => item.record_id === record.record_id ? revised : item) }))
  })
  return { objects, add, save, remove, rename, busy, error, saved, reload,
    toggleHidden: id => togglePreference('hidden', id), toggleLocked: id => togglePreference('locked', id),
  }
}
