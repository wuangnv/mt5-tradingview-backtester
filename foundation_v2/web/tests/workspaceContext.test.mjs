import test from 'node:test'
import assert from 'node:assert/strict'
import { buildWorkspaceHref, readWorkspaceContext } from '../src/workspaceContext.js'

test('readWorkspaceContext normalizes canonical values and legacy aliases', () => {
  const context = readWorkspaceContext('?workspace=desk-1&replay_session=abc&dataset_id=eurusd&cursor_index=12&decision_cutoff=2026-09-29T12%3A00%3A00Z&mode=Practice')
  assert.deepEqual(context, {
    workspaceId: 'desk-1',
    sessionId: 'abc',
    datasetId: 'eurusd',
    cursorIndex: 12,
    decisionCutoff: '2026-09-29T12:00:00Z',
    mode: 'Practice',
  })
})

test('buildWorkspaceHref carries shared replay context and explicit route values', () => {
  const href = buildWorkspaceHref(
    'journal',
    'desk-1',
    '?session=abc&dataset=eurusd&cursor=12&cutoff=bar-12&mode=Practice&job=stale',
    { trade: 'trade-4', from: 'replay' },
  )
  assert.equal(href, '/?workspace=desk-1&view=journal&session=abc&dataset=eurusd&cursor=12&cutoff=bar-12&mode=Practice&trade=trade-4&from=replay')
  assert.doesNotMatch(href, /stale/)
})

test('buildWorkspaceHref can clear stale session context without losing workspace', () => {
  const href = buildWorkspaceHref('replay', 'desk-1', '?session=abc&dataset=old&cursor=9', {
    session: null,
    cursor: null,
    dataset: 'new',
  })
  assert.equal(href, '/?workspace=desk-1&view=replay&dataset=new')
})

test('invalid cursor values are never emitted into a deep link', () => {
  const href = buildWorkspaceHref('replay', 'desk-1', '?session=abc&cursor=-1')
  assert.equal(href, '/?workspace=desk-1&view=replay&session=abc')
})

test('unsafe cutoff values are omitted from a deep link', () => {
  const href = buildWorkspaceHref('journal', 'desk-1', '?session=abc&cutoff=bar%2012')
  assert.equal(href, '/?workspace=desk-1&view=journal&session=abc')
})
