import React, { useEffect, useMemo, useState } from 'react'
import './learnIntegration.css'

function normalizeError(response, payload) {
  const detail = String(payload?.detail || `HTTP ${response.status}`)
  const error = new Error(detail)
  if (response.status === 403) error.kind = 'denied'
  else if (response.status === 404) error.kind = 'unavailable'
  else error.kind = 'error'
  return error
}

async function fetchLearnJson(url, workspace) {
  const response = await fetch(url, {
    method: 'GET',
    headers: { 'X-Workspace-Id': workspace },
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw normalizeError(response, payload)
  return payload
}

function StateMessage({ kind, children, testId }) {
  return (
    <div className={`learn-message learn-message-${kind}`} role={kind === 'error' || kind === 'denied' ? 'alert' : 'status'} data-testid={testId}>
      {children}
    </div>
  )
}

function resourceIdFromHref(href) {
  const prefix = '/api/v2/learn/resources/'
  if (typeof href !== 'string' || !href.startsWith(prefix)) return null
  try {
    return decodeURIComponent(href.slice(prefix.length))
  } catch {
    return null
  }
}

function returnTarget(query, workspace) {
  const from = query?.get('from')
  const params = new URLSearchParams({ workspace })

  if (from === 'research') {
    const jobId = query.get('job')
    if (jobId) params.set('job', jobId)
    return { href: `/?${params.toString()}`, label: 'Về Research' }
  }

  if (from === 'replay') {
    params.set('view', 'replay')
    const sessionId = query.get('session')
    const datasetId = query.get('dataset')
    const start = query.get('start')
    if (sessionId) {
      params.set('session', sessionId)
    } else if (datasetId) {
      params.set('dataset', datasetId)
      if (start) params.set('start', start)
    }
    return { href: `/?${params.toString()}`, label: 'Về Replay' }
  }

  return { href: `/?${params.toString()}`, label: 'Research' }
}

function LearnUtilityLinks({ workspace, query, returnLink }) {
  const practiceParams = new URLSearchParams({ workspace, view: 'replay' })
  const from = query?.get('from')
  if (from === 'replay') {
    const sessionId = query.get('session')
    const datasetId = query.get('dataset')
    const start = query.get('start')
    if (sessionId) practiceParams.set('session', sessionId)
    else if (datasetId) {
      practiceParams.set('dataset', datasetId)
      if (start) practiceParams.set('start', start)
    }
  }
  const settingsParams = new URLSearchParams({ workspace, view: 'settings', from: 'learn' })
  return (
    <div className="learn-utility-links" aria-label="Điều hướng workspace">
      <a className="context-link" href={returnLink.href}>{returnLink.label}</a>
      <a className="context-link" href={`/?${practiceParams.toString()}`}>Practice</a>
      <a className="context-link" href={`/?${settingsParams.toString()}`}>Settings</a>
    </div>
  )
}

function ResourceButton({ resourceId, label, selectedResourceId, onOpen }) {
  return (
    <button
      type="button"
      className={`learn-resource-button ${selectedResourceId === resourceId ? 'is-active' : ''}`}
      onClick={() => onOpen(resourceId, label)}
      aria-pressed={selectedResourceId === resourceId}
    >
      {label}
    </button>
  )
}

export default function LearnWorkspace({ workspace, query }) {
  const [overview, setOverview] = useState({ status: 'loading', payload: null, error: null })
  const [glossary, setGlossary] = useState({ status: 'loading', payload: null, error: null })
  const [resource, setResource] = useState({ status: 'idle', payload: null, error: null, id: '', label: '' })
  const [glossaryQuery, setGlossaryQuery] = useState('')

  useEffect(() => {
    let cancelled = false

    fetchLearnJson('/api/v2/learn/overview', workspace)
      .then((payload) => {
        if (!cancelled) setOverview({ status: 'ready', payload, error: null })
      })
      .catch((error) => {
        if (!cancelled) setOverview({ status: error.kind || 'error', payload: null, error: error.message })
      })

    fetchLearnJson('/api/v2/learn/glossary', workspace)
      .then((payload) => {
        if (!cancelled) setGlossary({ status: 'ready', payload, error: null })
      })
      .catch((error) => {
        if (!cancelled) setGlossary({ status: error.kind || 'error', payload: null, error: error.message })
      })

    return () => { cancelled = true }
  }, [workspace])

  const openResource = async (resourceId, label) => {
    setResource({ status: 'loading', payload: null, error: null, id: resourceId, label })
    try {
      const payload = await fetchLearnJson(`/api/v2/learn/resources/${encodeURIComponent(resourceId)}`, workspace)
      setResource({
        status: String(payload?.content || '').trim() ? 'ready' : 'empty',
        payload,
        error: null,
        id: resourceId,
        label,
      })
    } catch (error) {
      setResource({ status: error.kind || 'error', payload: null, error: error.message, id: resourceId, label })
    }
  }

  const course = overview.payload?.course
  const progress = overview.payload?.progress
  const safety = overview.payload?.safety
  const completedLessons = progress?.completed_lessons?.length || 0
  const lessonCount = Number(course?.lesson_count || 0)
  const completionPercent = lessonCount > 0 ? Math.round((completedLessons / lessonCount) * 100) : 0
  const currentLesson = useMemo(() => {
    const id = progress?.current_lesson_id
    if (!id) return null
    for (const module of course?.modules || []) {
      const lesson = (module.lessons || []).find((item) => item.id === id)
      if (lesson) return { ...lesson, moduleTitle: module.title }
    }
    return { id, title: null, moduleTitle: null }
  }, [course?.modules, progress?.current_lesson_id])

  const glossaryItems = useMemo(() => {
    const query = glossaryQuery.trim().toLocaleLowerCase('vi')
    const items = glossary.payload?.items || []
    if (!query) return items
    return items.filter((item) =>
      `${item.term || ''} ${item.meaning_vi || ''}`.toLocaleLowerCase('vi').includes(query)
    )
  }, [glossary.payload?.items, glossaryQuery])
  const returnLink = useMemo(() => returnTarget(query, workspace), [query, workspace])
  const linkedResources = useMemo(() => {
    const links = overview.payload?.links || {}
    return [
      { id: resourceIdFromHref(links.course), label: 'Tổng quan course' },
      { id: resourceIdFromHref(links.workbook), label: 'Workbook' },
      { id: resourceIdFromHref(links.pending_activity), label: 'Bài đang chờ' },
    ].filter((item) => item.id)
  }, [overview.payload?.links])

  if (overview.status === 'loading') {
    return (
      <main className="learn-shell">
        <header className="learn-topbar">
          <div><div className="eyebrow">HỌC / COURSE OWNER</div><h1>Học & thuật ngữ</h1></div>
          <LearnUtilityLinks workspace={workspace} query={query} returnLink={returnLink} />
        </header>
        <StateMessage kind="loading" testId="learn-loading">Đang đọc course và tiến độ thật…</StateMessage>
      </main>
    )
  }

  if (overview.status === 'denied') {
    return (
      <main className="learn-shell">
        <header className="learn-topbar"><div><div className="eyebrow">HỌC / COURSE OWNER</div><h1>Học & thuật ngữ</h1></div><LearnUtilityLinks workspace={workspace} query={query} returnLink={returnLink} /></header>
        <StateMessage kind="denied" testId="learn-denied">Workspace này không có quyền đọc Learn.</StateMessage>
      </main>
    )
  }

  if (overview.status === 'unavailable') {
    return (
      <main className="learn-shell">
        <header className="learn-topbar"><div><div className="eyebrow">HỌC / COURSE OWNER</div><h1>Học & thuật ngữ</h1></div><LearnUtilityLinks workspace={workspace} query={query} returnLink={returnLink} /></header>
        <StateMessage kind="unavailable" testId="learn-unavailable">Learn chưa được cấu hình cho workspace này.</StateMessage>
      </main>
    )
  }

  if (overview.status === 'error') {
    return (
      <main className="learn-shell">
        <header className="learn-topbar"><div><div className="eyebrow">HỌC / COURSE OWNER</div><h1>Học & thuật ngữ</h1></div><LearnUtilityLinks workspace={workspace} query={query} returnLink={returnLink} /></header>
        <StateMessage kind="error" testId="learn-error">Không đọc được Learn: {overview.error}</StateMessage>
      </main>
    )
  }

  if (safety?.read_only !== true || safety?.answer_keys_exposed !== false || safety?.auto_completion_enabled !== false) {
    return (
      <main className="learn-shell">
        <header className="learn-topbar"><div><div className="eyebrow">HỌC / COURSE OWNER</div><h1>Học & thuật ngữ</h1></div><LearnUtilityLinks workspace={workspace} query={query} returnLink={returnLink} /></header>
        <StateMessage kind="error" testId="learn-safety-error">Learn đang trả về safety contract không hợp lệ nên nội dung đã được khóa.</StateMessage>
      </main>
    )
  }

  return (
    <main className="learn-shell">
      <header className="learn-topbar">
        <div>
          <div className="eyebrow">HỌC / COURSE OWNER</div>
          <h1>Học & thuật ngữ</h1>
          <p>Tiến độ lấy trực tiếp từ course hiện có, không tự thay đổi khi mở bài.</p>
        </div>
        <div className="learn-topbar-actions">
          <LearnUtilityLinks workspace={workspace} query={query} returnLink={returnLink} />
          <div className="learn-readonly" data-testid="learn-readonly">
            <strong>READ ONLY</strong>
            <span>Không ghi tiến độ · không lộ answer key</span>
          </div>
        </div>
      </header>

      <div className="learn-context-strip" data-testid="learn-context-strip" aria-label="Trạng thái Learn">
        <span><strong>Local course</strong> · đọc từ workspace</span>
        <span>Progress owner <code>{safety?.progress_owner || 'education/progress.json'}</code></span>
        <span>OAuth <strong className="is-warn">PREP_ONLY</strong></span>
        <span>Broker <strong className="is-warn">Locked</strong></span>
      </div>

      <section className="learn-summary" aria-label="Tổng quan course">
        <div><span>Course</span><strong>{course?.title || 'Chưa có tên'}</strong></div>
        <div><span>Version</span><strong>{course?.version || 'N/A'}</strong></div>
        <div><span>Tiến độ</span><strong>{completedLessons}/{lessonCount || 0} bài</strong></div>
        <div><span>Trạng thái</span><strong>{progress?.status || progress?.phase || 'Chưa rõ'}</strong></div>
      </section>

      <section className="learn-progress" aria-label="Tiến độ hiện tại">
        <div>
          <span>Bài hiện tại</span>
          <strong>{currentLesson?.id || 'Chưa có'}</strong>
          <small>{currentLesson?.title || currentLesson?.moduleTitle || 'Không có tiêu đề'}</small>
        </div>
        <progress max="100" value={completionPercent} aria-label={`Đã hoàn thành ${completionPercent}% course`} />
        <div className="learn-progress-meta">
          <span>{completionPercent}%</span>
          <span>Cập nhật {progress?.updated_on || 'chưa rõ'}</span>
        </div>
      </section>

      <section className="learn-workspace">
        <aside className="learn-course" aria-label="Nội dung course">
          <div className="learn-pane-heading">
            <div><span>Course map</span><strong>{course?.module_count || 0} module</strong></div>
          </div>

          <nav className="learn-quick-resources" aria-label="Tài liệu course">
            {linkedResources.map((item) => (
              <ResourceButton
                key={item.id}
                resourceId={item.id}
                label={item.label}
                selectedResourceId={resource.id}
                onOpen={openResource}
              />
            ))}
          </nav>

          {(course?.modules || []).length === 0 && (
            <StateMessage kind="empty" testId="learn-course-empty">Course chưa có module để hiển thị.</StateMessage>
          )}

          <div className="learn-modules">
            {(course?.modules || []).map((module) => {
              const moduleResourceId = resourceIdFromHref(module.href)
              const hasCurrentLesson = (module.lessons || []).some((lesson) => lesson.id === progress?.current_lesson_id)
              return (
                <section className={`learn-module ${hasCurrentLesson ? 'is-current' : ''}`} key={module.id || module.title}>
                  <div className="learn-module-head">
                    <div><span>{module.id || 'Module'}</span><strong>{module.title || 'Chưa có tên'}</strong></div>
                    {moduleResourceId && (
                      <button type="button" className="learn-open-module" onClick={() => openResource(moduleResourceId, module.title || module.id)}>
                        Mở
                      </button>
                    )}
                  </div>
                  <ul>
                    {(module.lessons || []).map((lesson) => (
                      <li className={lesson.id === progress?.current_lesson_id ? 'is-current' : ''} key={lesson.id || lesson.title}>
                        <span>{lesson.id}</span>
                        <strong>{lesson.title || 'Chưa có tên'}</strong>
                      </li>
                    ))}
                  </ul>
                </section>
              )
            })}
          </div>
        </aside>

        <article className="learn-reader" aria-label="Tài liệu Learn">
          <div className="learn-pane-heading">
            <div><span>Tài liệu</span><strong>{resource.label || 'Chưa chọn'}</strong></div>
            {resource.id && <code>{resource.id}</code>}
          </div>

          {resource.status === 'idle' && <StateMessage kind="empty">Chọn course, workbook hoặc một module để đọc.</StateMessage>}
          {resource.status === 'loading' && <StateMessage kind="loading" testId="learn-resource-loading">Đang tải tài liệu…</StateMessage>}
          {resource.status === 'empty' && <StateMessage kind="empty" testId="learn-resource-empty">Tài liệu này đang trống.</StateMessage>}
          {resource.status === 'denied' && <StateMessage kind="denied" testId="learn-resource-denied">Bạn không có quyền đọc tài liệu này.</StateMessage>}
          {resource.status === 'unavailable' && <StateMessage kind="unavailable" testId="learn-resource-unavailable">Tài liệu này không có trong danh mục Learn được phép.</StateMessage>}
          {resource.status === 'error' && <StateMessage kind="error" testId="learn-resource-error">Không đọc được tài liệu: {resource.error}</StateMessage>}
          {resource.status === 'ready' && (
            <pre className="learn-resource-copy" data-testid="learn-resource-content">{resource.payload?.content}</pre>
          )}
        </article>

        <aside className="learn-glossary" aria-label="Glossary Anh Việt">
          <div className="learn-pane-heading">
            <div><span>Glossary Anh–Việt</span><strong>{glossary.payload?.count ?? '—'} thuật ngữ</strong></div>
          </div>
          <label className="learn-search">
            <span>Tìm thuật ngữ</span>
            <input
              type="search"
              value={glossaryQuery}
              onChange={(event) => setGlossaryQuery(event.target.value)}
              placeholder="Bid / ask, RR…"
            />
          </label>

          {glossary.status === 'loading' && <StateMessage kind="loading" testId="learn-glossary-loading">Đang đọc glossary…</StateMessage>}
          {glossary.status === 'denied' && <StateMessage kind="denied" testId="learn-glossary-denied">Không có quyền đọc glossary.</StateMessage>}
          {glossary.status === 'unavailable' && <StateMessage kind="unavailable">Glossary chưa được cấu hình.</StateMessage>}
          {glossary.status === 'error' && <StateMessage kind="error">Không đọc được glossary: {glossary.error}</StateMessage>}
          {glossary.status === 'ready' && glossaryItems.length === 0 && (
            <StateMessage kind="empty" testId="learn-glossary-empty">
              {glossaryQuery ? 'Không tìm thấy thuật ngữ phù hợp.' : 'Glossary chưa có mục nào.'}
            </StateMessage>
          )}
          {glossary.status === 'ready' && glossaryItems.length > 0 && (
            <dl className="learn-glossary-list" data-testid="learn-glossary-list">
              {glossaryItems.map((item) => (
                <div key={`${item.term}-${item.meaning_vi}`}>
                  <dt>{item.term}</dt>
                  <dd>{item.meaning_vi}</dd>
                </div>
              ))}
            </dl>
          )}
        </aside>
      </section>

      <footer className="learn-footnote">
        <span>Workspace <strong>{workspace}</strong></span>
        <span>Progress owner <code>{safety?.progress_owner || 'education/progress.json'}</code></span>
        <span>Auto completion <strong>{safety?.auto_completion_enabled ? 'Bật' : 'Tắt'}</strong></span>
        <span>Provider sync <strong className="is-warn">PREP_ONLY</strong></span>
      </footer>
    </main>
  )
}
