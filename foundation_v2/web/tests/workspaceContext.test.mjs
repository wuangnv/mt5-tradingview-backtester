import test from 'node:test'
import assert from 'node:assert/strict'
import { buildWorkspaceHref, readWorkspaceContext } from '../src/workspaceContext.js'

test('legacy Data Desk links use the unified library while preserving workspace and dataset', () => {
  const href = buildWorkspaceHref('data', 'desk-1', '?dataset=eurusd&mode=Practice&demo=1&job=stale', { area:'testing', section:'market-data' })
  const params = new URL(href, 'http://localhost').searchParams
  assert.equal(params.get('view'), 'market-data')
  assert.equal(params.get('workspace'), 'desk-1')
  assert.equal(params.get('dataset'), 'eurusd')
  assert.equal(params.get('mode'), 'Practice')
  assert.equal(params.get('demo'), '1')
  assert.equal(params.get('area'), 'testing')
  assert.equal(params.get('section'), 'market-data')
  assert.equal(params.has('data_tab'), false)
  assert.equal(params.has('job'), false)
})

test('readWorkspaceContext normalizes canonical values and legacy aliases', () => {
  const context = readWorkspaceContext('?workspace=desk-1&replay_session=abc&dataset_id=eurusd&cursor_index=12&decision_cutoff=2026-09-29T12%3A00%3A00Z&mode=Practice')
  assert.deepEqual(context, {
    workspaceId: 'desk-1',
    sessionId: 'abc',
    datasetId: 'eurusd',
    cursorIndex: 12,
    decisionCutoff: '2026-09-29T12:00:00Z',
    mode: 'Practice',
    playbookId: '',
    playbookRevision: '',
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

test('playbook context survives the journal deep link and rejects unsafe revisions', () => {
  const href = buildWorkspaceHref(
    'journal',
    'desk-1',
    '?session=abc&playbook=breakout&playbook_revision=3',
  )
  assert.equal(href, '/?workspace=desk-1&view=journal&session=abc&playbook=breakout&playbook_revision=3')
  assert.equal(
    buildWorkspaceHref('journal', 'desk-1', '?playbook=breakout&playbook_revision=0'),
    '/?workspace=desk-1&view=journal&playbook=breakout',
  )
})
