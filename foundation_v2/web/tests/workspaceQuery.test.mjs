import test from 'node:test'
import assert from 'node:assert/strict'
import { createWorkspaceQueryScope, metadataKey, metadataOptions, invalidateScopeMetadata,
  registerWorkspaceQueryScope, invalidateWorkspaceMetadata, retryMetadataRead, catalogEventRevision, readWorkspaceMetadata } from '../src/workspaceQuery.js'
import { fetchDatasets, fetchProviders } from '../src/researchDataApi.js'

test('catalog cache deduplicates reads, keeps scopes/revisions separate, and invalidates exact resources', async () => {
  const fetchBefore = globalThis.fetch, calls = []
  globalThis.fetch = async (path, options) => {
    calls.push(options.headers['X-Workspace-Id'])
    return Response.json({ status: 'ready', items: [{ symbol: options.headers['X-Workspace-Id'] }] })
  }
  const a = createWorkspaceQueryScope('a'), b = createWorkspaceQueryScope('b'), rotated = createWorkspaceQueryScope('a', 'authority-2')
  try {
    const first = metadataOptions(a, 'market-assets')
    await Promise.all([a.client.fetchQuery(first), a.client.fetchQuery(first)])
    await a.client.fetchQuery(first)
    assert.equal(calls.length, 1)
    await b.client.fetchQuery(metadataOptions(b, 'market-assets'))
    await rotated.client.fetchQuery(metadataOptions(rotated, 'market-assets'))
    assert.equal(calls.length, 3)
    assert.notDeepEqual(first.queryKey, metadataKey('a', 'authority-2', 'market-assets'))
    await a.client.fetchQuery(metadataOptions(a, 'market-assets', 'revision-2'))
    assert.equal(calls.length, 4)
    await invalidateScopeMetadata(a, ['unrelated-resource'])
    await a.client.fetchQuery(first); assert.equal(calls.length, 4)
    await invalidateScopeMetadata(a, ['market-assets'])
    await a.client.fetchQuery(first); assert.equal(calls.length, 5)
    assert.equal(b.client.getQueryData(metadataOptions(b, 'market-assets').queryKey).items[0].symbol, 'b')
  } finally { a.dispose(); b.dispose(); rotated.dispose(); globalThis.fetch = fetchBefore }
})

test('denial purges retained catalogs and stops retry/read until authority is replaced', async () => {
  const fetchBefore = globalThis.fetch
  const scope = createWorkspaceQueryScope('a')
  const options = metadataOptions(scope, 'market-assets')
  let calls = 0, denied = 0
  const off = scope.subscribe(() => denied++)
  try {
    scope.client.setQueryData(options.queryKey, { items: [{ symbol: 'secret' }] })
    await invalidateScopeMetadata(scope)
    globalThis.fetch = async () => { calls++; return Response.json({ detail: 'forbidden' }, { status: 403 }) }
    await assert.rejects(scope.client.fetchQuery(options), error => error.status === 403)
    assert.equal(scope.isDenied(), true)
    assert.equal(scope.client.getQueryData(options.queryKey), undefined)
    assert.equal(denied, 1)
    await assert.rejects(scope.client.fetchQuery(options), error => error.status === 403)
    assert.equal(calls, 1)
  } finally { off(); scope.dispose(); globalThis.fetch = fetchBefore }
})

test('query cancellation aborts the last shared consumer; retained revisions are bounded', async () => {
  const fetchBefore = globalThis.fetch, scope = createWorkspaceQueryScope('a')
  let signal
  globalThis.fetch = async (path, options) => { signal = options.signal; return new Promise((resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')), { once: true })
  }) }
  try {
    const pending = scope.client.fetchQuery(metadataOptions(scope, 'market-assets'))
    await scope.client.cancelQueries()
    await assert.rejects(pending)
    assert.equal(signal.aborted, true)
    globalThis.fetch = async () => Response.json({ status: 'ready', items: [] })
    for (let i = 0; i < 30; i++) await scope.client.fetchQuery(metadataOptions(scope, 'market-assets', `r${i}`))
    assert.equal(scope.client.getQueryCache().getAll().length <= 16, true)
    assert.equal(scope.client.getDefaultOptions().queries.gcTime, 120000)
  } finally { scope.dispose(); globalThis.fetch = fetchBefore }
})

test('known-success invalidation is workspace-scoped; progress ticks do not create catalog/read feedback', async () => {
  const a = createWorkspaceQueryScope('a'), b = createWorkspaceQueryScope('b')
  const offA = registerWorkspaceQueryScope(a), offB = registerWorkspaceQueryScope(b)
  try {
    for (const scope of [a, b]) scope.client.setQueryData(metadataOptions(scope, 'market-assets').queryKey, { items: [] })
    await invalidateWorkspaceMetadata('a', ['market-assets'])
    assert.equal(a.client.getQueryState(metadataOptions(a, 'market-assets').queryKey).isInvalidated, true)
    assert.equal(b.client.getQueryState(metadataOptions(b, 'market-assets').queryKey).isInvalidated, false)
    const base = { downloads: { qdm: { jobs: [{ job_id: '1', status: 'running', downloaded_bytes: 1 }] } } }
    const tick = structuredClone(base); tick.downloads.qdm.jobs[0].downloaded_bytes = 99; tick.commands = { updated: 'new-read' }
    assert.equal(catalogEventRevision(base), catalogEventRevision(tick))
    tick.downloads.qdm.jobs[0].status = 'completed'
    assert.notEqual(catalogEventRevision(base), catalogEventRevision(tick))
  } finally { offA(); offB() }
})

test('only bounded metadata resources and transient GET errors enter the pilot', async () => {
  const scope = createWorkspaceQueryScope('a'), fetchBefore = globalThis.fetch
  try {
    assert.throws(() => metadataOptions(scope, 'ledger'), /outside/)
    globalThis.fetch = async () => Response.json({ items: Array(5001).fill({ symbol: 'x' }) })
    await assert.rejects(scope.client.fetchQuery(metadataOptions(scope, 'market-assets')), /cache contract/)
    assert.equal(retryMetadataRead(0, Object.assign(new Error(), { status: 403 })), false)
    assert.equal(retryMetadataRead(0, Object.assign(new Error(), { status: 500 })), false)
    assert.equal(retryMetadataRead(0, Object.assign(new Error(), { status: 503 })), true)
    assert.equal(retryMetadataRead(2, new TypeError('offline')), false)
    assert.equal(retryMetadataRead(0, new DOMException('', 'AbortError')), false)
  } finally { scope.dispose(); globalThis.fetch = fetchBefore }
})

test('real datasets/providers helpers use bounded scope cache and preserve independent abort ownership', async () => {
  const scope = createWorkspaceQueryScope('a'), off = registerWorkspaceQueryScope(scope), before = globalThis.fetch
  const first = new AbortController(), second = new AbortController()
  let requests = 0, transport, release
  globalThis.fetch = async (path, options) => {
    requests++; transport = options.signal
    await new Promise((resolve, reject) => {
      release = resolve
      options.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })
    })
    return Response.json({ items: [{ dataset_id: 'd', provider: 'p' }] })
  }
  try {
    const a = fetchDatasets('a', first.signal), b = fetchDatasets('a', second.signal)
    first.abort(); await assert.rejects(a, { name: 'AbortError' })
    assert.equal(transport.aborted, false)
    release(); assert.equal((await b)[0].dataset_id, 'd')
    await fetchDatasets('a'); assert.equal(requests, 1)
    globalThis.fetch = async () => { requests++; return Response.json({ items: [] }) }
    await fetchProviders('a'); await fetchProviders('a'); assert.equal(requests, 2)
    await invalidateWorkspaceMetadata('a', ['datasets'])
    await fetchDatasets('a'); assert.equal(requests, 3)
    const aborted = new AbortController(); aborted.abort()
    await assert.rejects(readWorkspaceMetadata('datasets', 'a', aborted.signal), { name: 'AbortError' })
    assert.equal(requests, 3)
  } finally { off(); globalThis.fetch = before }
})

test('last imperative consumer cancels its metadata transport, and refresh denial never returns cached data', async () => {
  const scope = createWorkspaceQueryScope('a'), off = registerWorkspaceQueryScope(scope), before = globalThis.fetch
  let transport, forbidden = false
  globalThis.fetch = async (path, options) => {
    if (forbidden) return Response.json({ detail: 'forbidden' }, { status: 403 })
    transport = options.signal
    return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true }))
  }
  try {
    const controller = new AbortController(), pending = fetchDatasets('a', controller.signal)
    controller.abort(); await assert.rejects(pending, { name: 'AbortError' })
    assert.equal(transport.aborted, true)
    scope.client.setQueryData(metadataOptions(scope, 'datasets').queryKey, { items: [{ dataset_id: 'private' }] })
    await invalidateScopeMetadata(scope)
    forbidden = true
    await assert.rejects(fetchDatasets('a'), error => error.status === 403)
    await assert.rejects(fetchDatasets('a'), error => error.status === 403)
    assert.equal(scope.client.getQueryCache().getAll().length, 0)
  } finally { off(); globalThis.fetch = before }
})
