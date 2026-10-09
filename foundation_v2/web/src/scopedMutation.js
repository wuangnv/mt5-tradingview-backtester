import { invalidateWorkspaceMetadata } from './workspaceQuery.js'

const unresolved = new Map()
const METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE'])
const PENDING = new Set(['command_pending', 'command_commit_outcome_unknown'])
const RECEIPT_TTL = 24 * 60 * 60 * 1000
const MAX_RECEIPTS = 32

function readReceipts(workspace) {
  try {
    const values = JSON.parse(sessionStorage.getItem(`tw:commands:v1:${workspace}`) || '[]')
    return Array.isArray(values) ? values.filter(value => value?.workspace === workspace
      && /^[a-f0-9]{64}$/.test(value.hash) && typeof value.idempotencyKey === 'string' && value.idempotencyKey.length <= 128
      && value.expiresAt > Date.now() && value.expiresAt <= Date.now() + RECEIPT_TTL
      && (!value.commandId || receiptTarget(value.commandId, value.statusUrl))).slice(0, MAX_RECEIPTS) : []
  } catch { return [] }
}

function persistReceipt(entry, remove = false) {
  if (!entry.hash) return
  try {
    const records = readReceipts(entry.workspace).filter(value => value.hash !== entry.hash)
    if (!remove) records.push({ workspace: entry.workspace, hash: entry.hash,
      idempotencyKey: entry.idempotencyKey, commandId: entry.commandId || null,
      statusUrl: entry.statusUrl || null, expiresAt: entry.expiresAt })
    if (records.length) sessionStorage.setItem(`tw:commands:v1:${entry.workspace}`, JSON.stringify(records.slice(-MAX_RECEIPTS)))
    else sessionStorage.removeItem(`tw:commands:v1:${entry.workspace}`)
  } catch { /* Storage availability cannot authorize a second command. Memory retains the receipt. */ }
}

async function fingerprint(value) {
  if (!globalThis.crypto?.subtle) return null
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

export class CommandOutcomeUnknownError extends Error {
  constructor(entry, cause) {
    super('Chưa xác nhận được kết quả thao tác. Không gửi lại thao tác mới khi kết quả còn chưa rõ.', { cause })
    this.name = cause?.name === 'AbortError' ? 'AbortError' : 'CommandOutcomeUnknownError'
    this.code = 'command_outcome_unknown'
    this.outcomeKnown = false
    this.commandId = entry.commandId || null
    this.statusUrl = entry.statusUrl || null
    this.idempotencyKey = entry.idempotencyKey
  }
}

function abortableWait(ms, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(signal.reason) }
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve() }, ms)
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
  })
}

function receiptTarget(commandId, path) {
  return typeof commandId === 'string' && /^[a-zA-Z0-9-]+$/.test(commandId)
    && path === `/api/v2/commands/${commandId}`
}

function terminalResponse(receipt) {
  if (!Number.isInteger(receipt.result_status) || receipt.result_status < 200 || receipt.result_status > 599) return null
  const headers = new Headers(receipt.result_headers || {})
  const text = receipt.result_text
  const body = [204, 205, 304].includes(receipt.result_status) ? null
    : typeof text === 'string' ? text : JSON.stringify(receipt.result_body)
  if (typeof text !== 'string' && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  return new Response(body, { status: receipt.result_status, headers })
}

async function execute(path, workspace, options, entry, timeoutMs, pollMs, fetchImpl) {
  const controller = new AbortController()
  const callerAbort = () => controller.abort(options.signal.reason || new DOMException('Aborted', 'AbortError'))
  options.signal?.addEventListener('abort', callerAbort, { once: true })
  const timer = setTimeout(() => controller.abort(new DOMException('Command receipt timed out', 'TimeoutError')), timeoutMs)
  try {
    if (options.signal?.aborted) callerAbort()
    if (!entry.submitted) {
      entry.submitted = true
      persistReceipt(entry)
      let response
      try {
        const received = await fetchImpl(path, { ...options, headers: entry.headers, signal: controller.signal })
        // Keep the key if the connection dies after headers but before the body.
        const body = await received.arrayBuffer()
        response = new Response([204, 205, 304].includes(received.status) ? null : body,
          { status: received.status, statusText: received.statusText, headers: received.headers })
      }
      catch (error) { entry.submitted = false; throw error }
      const payload = [503, 504].includes(response.status) ? await response.clone().json().catch(() => null) : null
      if (payload?.detail === 'command_outcome_unknown') throw new CommandOutcomeUnknownError(entry)
      if (![503, 504].includes(response.status)) return response
      if (!PENDING.has(payload?.detail)) return response
      if (!receiptTarget(payload.command_id, payload.status_url)) throw new CommandOutcomeUnknownError(entry)
      entry.commandId = payload.command_id
      entry.statusUrl = payload.status_url
      persistReceipt(entry)
    }
    if (!entry.statusUrl) throw new CommandOutcomeUnknownError(entry)
    while (!controller.signal.aborted) {
      const response = await fetchImpl(entry.statusUrl, {
        method: 'GET', headers: { 'X-Workspace-Id': workspace },
        credentials: options.credentials || 'same-origin', signal: controller.signal,
      })
      if ([401, 403].includes(response.status)) throw new CommandOutcomeUnknownError(entry)
      if (response.ok) {
        const receipt = await response.json()
        if (receipt.contract_version !== 'api-command-v1' || receipt.command_id !== entry.commandId || receipt.workspace_id !== workspace) throw new CommandOutcomeUnknownError(entry)
        if (['completed', 'failed'].includes(receipt.status)) {
          if (receipt.result_body?.detail === 'command_outcome_unknown') throw new CommandOutcomeUnknownError(entry)
          const result = terminalResponse(receipt)
          if (!result) throw new CommandOutcomeUnknownError(entry)
          return result
        }
        if (!['queued', 'running'].includes(receipt.status)) throw new CommandOutcomeUnknownError(entry)
      }
      await abortableWait(pollMs, controller.signal)
    }
    throw controller.signal.reason
  } catch (error) {
    throw error instanceof CommandOutcomeUnknownError ? error : new CommandOutcomeUnknownError(entry, error)
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', callerAbort)
  }
}

// A lost response is not permission to issue another mutation. Retain its receipt
// until reconciliation proves a terminal outcome; only GETs may be repeated here.
export async function scopedMutation(path, workspace, options = {}, { timeoutMs = 30_000, pollMs = 250, fetchImpl = globalThis.fetch } = {}) {
  const method = String(options.method || '').toUpperCase()
  if (!METHODS.has(method) || !workspace || !String(path).startsWith('/api/v2/') || String(path).startsWith('//')) throw new Error('invalid_scoped_mutation')
  if (options.signal?.aborted) throw options.signal.reason || new DOMException('Aborted', 'AbortError')
  const headers = Object.fromEntries(new Headers(options.headers))
  const suppliedKey = headers['idempotency-key']
  delete headers['idempotency-key']; delete headers['x-workspace-id']
  const requestKey = JSON.stringify([workspace, method, path, options.body ?? null, headers, suppliedKey || null])
  const digest = await fingerprint(requestKey)
  const key = digest || requestKey
  const hash = String(path).includes('/oauth/') ? null : digest
  if (options.signal?.aborted) throw options.signal.reason || new DOMException('Aborted', 'AbortError')
  for (const [storedKey, value] of unresolved) if (value.expiresAt <= Date.now() && !value.promise) unresolved.delete(storedKey)
  let entry = unresolved.get(key)
  if (!entry) {
    const records = hash ? readReceipts(workspace) : []
    const stored = records.find(value => value.hash === hash)
    if (!stored && (records.length >= MAX_RECEIPTS || [...unresolved.values()].filter(value => value.workspace === workspace).length >= MAX_RECEIPTS)) throw new Error('command_receipt_limit_reached')
    entry = { ...stored, hash, workspace, idempotencyKey: stored?.idempotencyKey || suppliedKey || crypto.randomUUID(),
      submitted: Boolean(stored?.commandId), expiresAt: stored?.expiresAt || Date.now() + RECEIPT_TTL }
    entry.headers = { ...headers, 'X-Workspace-Id': workspace, 'Idempotency-Key': entry.idempotencyKey }
    unresolved.set(key, entry)
  }
  if (!entry.promise) {
    entry.promise = execute(path, workspace, { ...options, method }, entry, timeoutMs, pollMs, fetchImpl)
      .then(response => {
        unresolved.delete(key); persistReceipt(entry, true)
        if (response.ok && /^\/api\/v2\/(?:data|market-data)(?:\/|\?|$)/.test(String(path))) invalidateWorkspaceMetadata(workspace)
        return response
      })
      .finally(() => { entry.promise = null })
  }
  if (!options.signal) return (await entry.promise).clone()
  return new Promise((resolve, reject) => {
    const abort = () => reject(options.signal.reason || new DOMException('Aborted', 'AbortError'))
    options.signal.addEventListener('abort', abort, { once: true })
    entry.promise.then(response => resolve(response.clone()), reject)
      .finally(() => options.signal.removeEventListener('abort', abort))
    if (options.signal.aborted) abort()
  })
}
