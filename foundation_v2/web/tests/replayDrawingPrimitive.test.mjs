import test from 'node:test'
import assert from 'node:assert/strict'
import { projectDrawing, ReplayDrawingPrimitive } from '../src/replayDrawingPrimitive.js'

const drawing = (type = 'trendline', overrides = {}) => ({
  record_id: 'annotation-1',
  payload: {
    annotation_type: type,
    anchors: [{ timestamp: 100, price: 10 }, { timestamp: 200, price: 20 }],
    label: 'Vùng giá',
  },
  ...overrides,
})

function scales() {
  const state = { timeOffset: 0, timeZoom: 1, priceOffset: 0, priceZoom: 1 }
  return {
    state,
    chart: { timeScale: () => ({ timeToCoordinate: (time) => time * state.timeZoom + state.timeOffset }) },
    series: { priceToCoordinate: (price) => price * state.priceZoom + state.priceOffset },
  }
}

function canvasTarget(width = 400, height = 240) {
  const calls = []
  const context = {
    measureText: (value) => ({ width: value.length * 6 }),
    ...Object.fromEntries(['save', 'restore', 'beginPath', 'rect', 'clip', 'setLineDash', 'moveTo', 'lineTo', 'stroke', 'fill', 'arc', 'fillRect', 'strokeRect', 'fillText'].map((name) => [name, (...args) => calls.push({ name, args, strokeStyle: context.strokeStyle, fillStyle: context.fillStyle, lineWidth: context.lineWidth })])),
  }
  return {
    calls,
    useMediaCoordinateSpace(callback) { callback({ context, mediaSize: { width, height } }) },
  }
}

test('domain anchors are projected again after pan, price drag and zoom', () => {
  const { state, chart, series } = scales()
  const item = drawing()
  const original = structuredClone(item)
  assert.deepEqual(projectDrawing(item, chart, series).points, [{ x: 100, y: 10 }, { x: 200, y: 20 }])
  Object.assign(state, { timeOffset: -80, timeZoom: 2, priceOffset: 200, priceZoom: -4 })
  assert.deepEqual(projectDrawing(item, chart, series).points, [{ x: 120, y: 160 }, { x: 320, y: 120 }])
  assert.deepEqual(item, original)
})

test('hidden, unsupported, incomplete and unmappable drawings are skipped', () => {
  const { chart, series } = scales()
  assert.equal(projectDrawing(drawing('trendline', { hidden: true }), chart, series), null)
  assert.equal(projectDrawing(drawing('unsupported'), chart, series), null)
  assert.equal(projectDrawing(drawing('toString'), chart, series), null)
  assert.equal(projectDrawing(drawing('trendline', { payload: { annotation_type: 'trendline', anchors: [{ timestamp: 100, price: 10 }] } }), chart, series), null)
  assert.equal(projectDrawing(drawing(), { timeScale: () => ({ timeToCoordinate: () => null }) }, series), null)
  assert.equal(projectDrawing(drawing(), chart, { priceToCoordinate: () => NaN }), null)
  assert.equal(projectDrawing(drawing(), chart, { priceToCoordinate: () => null }), null)
  assert.equal(projectDrawing(drawing('text', { payload: { annotation_type: 'text', anchors: [{ timestamp: 100, price: null }] } }), chart, series), null)
  assert.equal(projectDrawing(drawing(), null, series), null)
})

test('zero coordinates remain valid and labels remain bounded literal canvas text', () => {
  const { chart, series } = scales()
  const item = drawing('text', { payload: { annotation_type: 'text', anchors: [{ timestamp: 0, price: 0 }], label: '<script>\n\0' + 'x'.repeat(300) } })
  const projected = projectDrawing(item, chart, series)
  assert.deepEqual(projected.points, [{ x: 0, y: 0 }])
  assert.equal(projected.label.length, 256)
  assert.equal(projected.label.startsWith('<script>  '), true)
  assert.equal(/[\u0000-\u001f]/u.test(projected.label), false)
})

test('native renderer redraws using current scales and pane dimensions', () => {
  const { state, chart, series } = scales()
  const primitive = new ReplayDrawingPrimitive([drawing(), drawing('horizontal-line')])
  primitive.setPalette({ canvas: '#10151c', surface: '#10151c', highlight: '#f5bc62', primary: '#69d5e4' })
  primitive.attached({ chart, series, requestUpdate() {} })
  const views = primitive.paneViews()
  const renderer = views[0].renderer()
  const first = canvasTarget()
  renderer.draw(first)
  assert.deepEqual(first.calls.filter(({ name }) => name === 'lineTo').map(({ args }) => args), [[200, 20], [400, 10]])
  Object.assign(state, { timeOffset: -50, priceZoom: 3 })
  const resized = canvasTarget(600, 320)
  renderer.draw(resized)
  assert.deepEqual(resized.calls.filter(({ name }) => name === 'lineTo').map(({ args }) => args), [[150, 60], [600, 30]])
  assert.deepEqual(resized.calls.find(({ name }) => name === 'rect').args, [0, 0, 600, 320])
  assert.equal(primitive.paneViews(), views)
  assert.equal(primitive.paneViews()[0].renderer(), renderer)
})

test('renderer covers five tools, clips to pane and distinguishes local and selected state', () => {
  const { chart, series } = scales()
  const primitive = new ReplayDrawingPrimitive([
    drawing('horizontal-line'), drawing('trendline', { local: true, selected: true }),
    drawing('zone'), drawing('text'), drawing('measure'), drawing('zone', { hidden: true }),
  ])
  primitive.setPalette({ canvas: '#10151c', surface: '#10151c', highlight: '#f5bc62', primary: '#69d5e4' })
  primitive.attached({ chart, series, requestUpdate() {} })
  const target = canvasTarget()
  primitive.paneViews()[0].renderer().draw(target)
  assert.deepEqual(target.calls.slice(0, 4).map(({ name }) => name), ['save', 'beginPath', 'rect', 'clip'])
  assert.equal(target.calls.at(-1).name, 'restore')
  assert.equal(target.calls.filter(({ name }) => name === 'strokeRect').length, 2)
  assert.equal(target.calls.filter(({ name }) => name === 'fillText').length, 5)
  assert.equal(target.calls.filter(({ name }) => name === 'arc').length, 2)
  assert.ok(target.calls.some(({ name, args }) => name === 'setLineDash' && args[0].join(',') === '6,4'))
  assert.ok(target.calls.some(({ name, strokeStyle, lineWidth }) => name === 'stroke' && strokeStyle === '#f5bc62' && lineWidth === 2.5))
  assert.ok(target.calls.some(({ name, strokeStyle }) => name === 'stroke' && strokeStyle === '#69d5e4'))
})

test('measure reports signed price change without dividing a zero starting price', () => {
  const { chart, series } = scales()
  const item = drawing('measure')
  item.payload.label = ''
  assert.match(projectDrawing(item, chart, series).label, /Δ giá \+10 · \+100%/u)
  item.payload.anchors[0].price = 0
  assert.equal(projectDrawing(item, chart, series).label, 'Δ giá +20')
})

test('updates request a native repaint and detachment releases chart references', () => {
  const { chart, series } = scales()
  const primitive = new ReplayDrawingPrimitive()
  let updates = 0
  primitive.setPalette({ canvas: '#10151c', surface: '#10151c', highlight: '#f5bc62', primary: '#69d5e4' })
  primitive.attached({ chart, series, requestUpdate() { updates += 1 } })
  const items = [drawing('zone')]
  primitive.setDrawings(items)
  items.length = 0
  const target = canvasTarget()
  const renderer = primitive.paneViews()[0].renderer()
  renderer.draw(target)
  assert.equal(target.calls.filter(({ name }) => name === 'strokeRect').length, 1)
  assert.equal(updates, 2)
  primitive.detached()
  primitive.setDrawings([drawing()])
  const detached = canvasTarget()
  renderer.draw(detached)
  assert.equal(updates, 2)
  assert.deepEqual(detached.calls, [])
})

test('off-screen labels do not become floating visible labels after panning', () => {
  const { state, chart, series } = scales()
  state.timeOffset = -1000
  state.priceOffset = -1000
  const primitive = new ReplayDrawingPrimitive([drawing('text'), drawing('zone'), drawing('horizontal-line')])
  primitive.setPalette({ canvas: '#10151c', surface: '#10151c', highlight: '#f5bc62', primary: '#69d5e4' })
  primitive.attached({ chart, series, requestUpdate() {} })
  const target = canvasTarget()
  primitive.paneViews()[0].renderer().draw(target)
  assert.equal(target.calls.filter(({ name }) => name === 'fillText').length, 0)
})

test('changing the palette repaints labels and handles without changing drawing anchors', () => {
  const { chart, series } = scales()
  const item = drawing('trendline', { local: true, selected: true })
  const before = structuredClone(item)
  const primitive = new ReplayDrawingPrimitive([item])
  let updates = 0
  primitive.attached({ chart, series, requestUpdate() { updates++ } })
  const renderer = primitive.paneViews()[0].renderer()
  const dark = { canvas: '#171C20', surface: '#232B30', highlight: '#D6A07B', primary: '#8FAFC1' }
  const light = { canvas: '#F4F1EB', surface: '#FBF9F4', highlight: '#8F532F', primary: '#3E6275' }
  for (const palette of [dark, light]) {
    primitive.setPalette(palette)
    const target = canvasTarget()
    renderer.draw(target)
    assert.deepEqual(target.calls.find(c => c.name === 'lineTo').args, [200, 20])
    assert.equal(target.calls.find(c => c.name === 'fillText').fillStyle, palette.highlight)
    assert.equal(target.calls.find(c => c.name === 'fillRect').fillStyle, `${palette.surface}EB`)
    assert.equal(target.calls.find(c => c.name === 'fill').fillStyle, palette.canvas)
  }
  assert.deepEqual(item, before)
  assert.equal(updates, 3)
  assert.equal(primitive.paneViews()[0].renderer(), renderer)
})
