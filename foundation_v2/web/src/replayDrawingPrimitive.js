const ANCHOR_COUNTS = Object.freeze({
  'horizontal-line': 1,
  trendline: 2,
  zone: 2,
  text: 1,
  measure: 2,
})

function safeText(value) {
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f-\u009f]/gu, ' ').slice(0, 256).trim() : ''
}

function measurementLabel(anchors) {
  const delta = anchors[1].price - anchors[0].price
  const amount = delta.toLocaleString('vi-VN', { maximumFractionDigits: 8, signDisplay: 'always' })
  const percentage = anchors[0].price === 0 ? '' : ` · ${(delta / Math.abs(anchors[0].price) * 100).toLocaleString('vi-VN', { maximumFractionDigits: 2, signDisplay: 'always' })}%`
  return `Δ giá ${amount}${percentage}`
}

/** Map domain anchors through the current chart scales; never retain pixels. */
export function projectDrawing(drawing, chart, series) {
  if (!drawing || drawing.hidden || !chart || !series) return null
  const payload = drawing.payload
  const type = payload?.annotation_type
  const count = Object.hasOwn(ANCHOR_COUNTS, type) ? ANCHOR_COUNTS[type] : 0
  if (!count || !Array.isArray(payload.anchors) || payload.anchors.length < count) return null
  const anchors = payload.anchors.slice(0, count)
  const timeScale = chart.timeScale()
  const points = []
  for (const anchor of anchors) {
    if (!anchor || !Number.isFinite(anchor.timestamp) || !Number.isFinite(anchor.price)) return null
    const x = timeScale.timeToCoordinate(anchor.timestamp)
    const y = series.priceToCoordinate(anchor.price)
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null
    points.push({ x, y })
  }
  return {
    record_id: drawing.record_id,
    type,
    points,
    label: safeText(payload.label) || (type === 'measure' ? measurementLabel(anchors) : ''),
    local: Boolean(drawing.local),
    selected: Boolean(drawing.selected),
  }
}

function drawLabel(context, label, x, y, mediaSize, color, palette) {
  if (!label) return
  // Do not pull labels for off-screen anchors back into the visible pane.
  if (x < 0 || x > mediaSize.width || y < -24 || y > mediaSize.height + 24) return
  context.font = '12px sans-serif'
  context.textBaseline = 'middle'
  const width = Math.min(context.measureText(label).width, Math.max(0, mediaSize.width - 20))
  if (width <= 0) return
  const left = Math.max(5, Math.min(x, mediaSize.width - width - 13))
  const top = Math.max(5, Math.min(y - 10, mediaSize.height - 25))
  context.fillStyle = `${palette.surface}EB`
  context.fillRect(left, top, width + 8, 20)
  context.fillStyle = color
  context.fillText(label, left + 4, top + 10, width)
}

function drawProjected(context, drawing, mediaSize, palette) {
  const { type, points, label, local, selected } = drawing
  const [first, second] = points
  if (type === 'horizontal-line' && (first.y < 0 || first.y > mediaSize.height)) return
  const color = local ? palette.highlight : palette.primary
  context.strokeStyle = color
  context.fillStyle = `${color}21`
  context.lineWidth = selected ? 2.5 : 1.5
  context.setLineDash(local ? [6, 4] : [])
  let labelX = first.x + 6
  let labelY = first.y - 12

  if (type === 'horizontal-line') {
    context.beginPath()
    context.moveTo(0, first.y)
    context.lineTo(mediaSize.width, first.y)
    context.stroke()
    labelX = 6
  } else if (type === 'trendline') {
    context.beginPath()
    context.moveTo(first.x, first.y)
    context.lineTo(second.x, second.y)
    context.stroke()
  } else if (type === 'zone' || type === 'measure') {
    const left = Math.min(first.x, second.x)
    const top = Math.min(first.y, second.y)
    const width = Math.abs(second.x - first.x)
    const height = Math.abs(second.y - first.y)
    context.fillRect(left, top, width, height)
    context.strokeRect(left, top, width, height)
    labelX = left + 6
    labelY = top - 12
    if (type === 'measure') {
      context.beginPath()
      context.moveTo(first.x, first.y)
      context.lineTo(second.x, second.y)
      context.stroke()
    }
  }

  if (selected) {
    context.setLineDash([])
    context.fillStyle = palette.canvas
    for (const point of points) {
      context.beginPath()
      context.arc(point.x, point.y, 3.5, 0, Math.PI * 2)
      context.fill()
      context.stroke()
    }
  }
  drawLabel(context, label, labelX, labelY, mediaSize, color, palette)
}

export class ReplayDrawingPrimitive {
  constructor(drawings = []) {
    this._drawings = Array.isArray(drawings) ? [...drawings] : []
    this._attachment = null
    this._palette = null
    const renderer = { draw: (target) => this._draw(target) }
    this._paneViews = [{ zOrder: () => 'normal', renderer: () => renderer }]
  }

  setDrawings(drawings) {
    this._drawings = Array.isArray(drawings) ? [...drawings] : []
    this._attachment?.requestUpdate()
  }

  setPalette(palette) {
    this._palette = palette
    this._attachment?.requestUpdate()
  }

  attached({ chart, series, requestUpdate }) {
    this._attachment = { chart, series, requestUpdate }
    requestUpdate()
  }

  detached() {
    this._attachment = null
  }

  paneViews() {
    return this._paneViews
  }

  _draw(target) {
    if (!this._attachment || !this._palette) return
    const { chart, series } = this._attachment
    target.useMediaCoordinateSpace(({ context, mediaSize }) => {
      context.save()
      try {
        context.beginPath()
        context.rect(0, 0, mediaSize.width, mediaSize.height)
        context.clip()
        for (const drawing of this._drawings) {
          // Native repaint also covers price-scale drag, pan, zoom and resize.
          const projected = projectDrawing(drawing, chart, series)
          if (projected) drawProjected(context, projected, mediaSize, this._palette)
        }
      } finally {
        context.restore()
      }
    })
  }
}
