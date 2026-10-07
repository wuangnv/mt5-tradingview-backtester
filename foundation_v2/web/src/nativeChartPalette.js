// Legacy reference: neutral black pane and chrome, with standard trading candles.
export function nativeChartPalette(theme) {
  return {
    canvas: theme === 'light' ? '#FFFFFF' : '#0F0F0F',
    surface: theme === 'light' ? '#FFFFFF' : '#000000',
    grid: theme === 'light' ? '#EFEFEF' : '#202020',
    border: theme === 'light' ? '#DADADA' : '#303030',
    text: theme === 'light' ? '#131313' : '#DBDBDB',
    positive: '#26A69A', negative: '#EF5350', primary: '#2962FF', highlight: '#FF6D00',
  }
}
