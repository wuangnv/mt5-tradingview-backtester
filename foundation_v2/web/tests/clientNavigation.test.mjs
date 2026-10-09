import test from 'node:test'
import assert from 'node:assert/strict'
import { isApplicationUrl, navigate, navigationSearch, navigationSnapshot, shouldHandleLink, subscribeNavigation } from '../src/clientNavigation.js'

const base = 'http://127.0.0.1:5180/?workspace=a&view=overview'
const anchor = (href, attrs = {}) => ({ href: new URL(href, base).href, target: attrs.target, hasAttribute: key => Object.hasOwn(attrs, key) })

test('native gestures, external resources and hash-only links remain native', () => {
  const event = { button: 0 }
  assert.equal(shouldHandleLink(event, anchor('/?view=trade&workspace=a'), base), true)
  for (const key of ['ctrlKey', 'metaKey', 'shiftKey', 'altKey', 'defaultPrevented']) assert.equal(shouldHandleLink({ ...event, [key]: true }, anchor('/?view=trade'), base), false)
  for (const attrs of [{ download: '' }, { target: '_blank' }, { 'data-native-navigation': '' }]) assert.equal(shouldHandleLink(event, anchor('/?view=trade', attrs), base), false)
  for (const href of ['#report-patterns', 'https://example.com/', '/api/v2/data/datasets', '/charting_library/index.html', 'mailto:owner@example.com']) assert.equal(shouldHandleLink(event, anchor(href), base), false)
  assert.equal(isApplicationUrl('/?view=trade', base), true)
})

test('navigation preserves URL/context, replace semantics, history events and subscription cleanup', t => {
  const events = new Map(), clicks = new Map(), writes = []
  const location = new URL(base)
  const update = (state, unused, href) => { writes.push(href); location.href = new URL(href, location).href }
  globalThis.window = { location, history: { pushState: update, replaceState: update }, addEventListener: (type, fn) => events.set(type, fn), removeEventListener: type => events.delete(type) }
  globalThis.document = { addEventListener: (type, fn) => clicks.set(type, fn), removeEventListener: type => clicks.delete(type) }
  t.after(() => { delete globalThis.window; delete globalThis.document })
  let notifications = 0
  const unsubscribe = subscribeNavigation(() => notifications++)
  const initial = navigationSnapshot()
  navigate('/?workspace=b&view=replay&session=s&dataset=d&surface=workspace&cursor=12')
  assert.equal(notifications, 1)
  assert.notEqual(navigationSnapshot(), initial)
  assert.match(navigationSearch(), /workspace=b/)
  assert.match(location.search, /cursor=12/)
  navigate(location.href); assert.equal(writes.length, 1)
  location.href = base; events.get('popstate')()
  assert.equal(navigationSearch(), new URL(base).search)
  navigate('/?workspace=a&view=overview&demo=1', { replace: true })
  assert.equal(notifications, 3)
  unsubscribe(); assert.equal(events.size, 0); assert.equal(clicks.size, 0)
})
