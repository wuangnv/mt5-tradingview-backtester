// Canvas engines cannot consume CSS variables; read the same roles as DOM controls.
export function readProjectPalette(host) {
  const style = getComputedStyle(host)
  return Object.fromEntries(['canvas', 'surface', 'raised', 'border', 'grid', 'text', 'muted', 'primary', 'on-primary', 'highlight', 'positive', 'negative'].map(role => [role.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()), style.getPropertyValue(`--project-${role}`).trim()]))
}

export function chartSeriesPalette(palette) {
  return {
    upColor: palette.positive, downColor: palette.negative,
    wickUpColor: palette.positive, wickDownColor: palette.negative,
    color: palette.primary, lineColor: palette.primary,
    topColor: `${palette.primary}33`, bottomColor: `${palette.primary}05`,
    topLineColor: palette.positive, bottomLineColor: palette.negative,
    topFillColor1: `${palette.positive}33`, topFillColor2: `${palette.positive}05`,
    bottomFillColor1: `${palette.negative}05`, bottomFillColor2: `${palette.negative}33`,
  }
}
