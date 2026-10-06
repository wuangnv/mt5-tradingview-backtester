export function projectOrder(levels, chart, series) {
  if (!levels || !chart || !series) return null
  const result = { width: chart.timeScale().width(), height: chart.panes()[0].getHeight() }
  for (const key of ['entry', 'stop', 'target']) {
    if (!Number.isFinite(levels[key])) return null
    result[key] = series.priceToCoordinate(levels[key])
    if (!Number.isFinite(result[key])) return null
  }
  const anchor = chart.timeScale().timeToCoordinate(Number(levels.timestamp))
  result.left = Math.max(0, Math.min(Number.isFinite(anchor) ? anchor : result.width * .6, result.width - 120))
  return result
}

export class ReplayOrderPrimitive {
  constructor(onProject) {
    this.onProject = onProject
    this.levels = null
    this.attachment = null
    this.palette = null
    this.views = [{ zOrder: () => 'normal', renderer: () => ({ draw: target => this.draw(target) }) }]
  }
  attached(attachment) { this.attachment = attachment; attachment.requestUpdate() }
  detached() { this.attachment = null }
  paneViews() { return this.views }
  setPalette(palette) { this.palette = palette; this.attachment?.requestUpdate() }
  autoscaleInfo() {
    if (!this.levels || !['entry', 'stop', 'target'].every(key => Number.isFinite(this.levels[key]) && this.levels[key] > 0)) return null
    return { priceRange: { minValue: Math.min(this.levels.entry, this.levels.stop, this.levels.target), maxValue: Math.max(this.levels.entry, this.levels.stop, this.levels.target) } }
  }
  setLevels(levels) { this.levels = levels; this.attachment?.requestUpdate() }
  draw(target) {
    const projection = this.attachment ? projectOrder(this.levels, this.attachment.chart, this.attachment.series) : null
    this.onProject(projection)
    if (!projection || !this.palette) return
    const { entry, stop, target: profit, left, width } = projection
    target.useMediaCoordinateSpace(({ context, mediaSize }) => {
      context.save()
      context.beginPath(); context.rect(0, 0, mediaSize.width, mediaSize.height); context.clip()
      context.fillStyle = `${this.palette.positive}1F`
      context.fillRect(left, Math.min(profit, entry), width - left, Math.abs(profit - entry))
      context.fillStyle = `${this.palette.negative}1F`
      context.fillRect(left, Math.min(stop, entry), width - left, Math.abs(stop - entry))
      for (const [y, color] of [[entry, this.palette.primary], [stop, this.palette.negative], [profit, this.palette.positive]]) {
        context.strokeStyle = color; context.lineWidth = 1; context.setLineDash(['draft', 'edit'].includes(this.levels.state) ? [4, 4] : [])
        context.beginPath(); context.moveTo(left, y); context.lineTo(width, y); context.stroke()
      }
      context.restore()
    })
  }
}
