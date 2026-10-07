// Chart surfaces stay a shade lighter than the black trading footer.
export function nativeChartPalette(theme) {
  return {
    canvas: theme === 'light' ? '#FFFFFF' : '#0F0F0F',
    surface: theme === 'light' ? '#FFFFFF' : '#0F0F0F',
    grid: theme === 'light' ? '#EFEFEF' : '#202020',
    border: theme === 'light' ? '#DADADA' : '#303030',
    text: theme === 'light' ? '#131313' : '#DBDBDB',
    positive: '#26A69A', negative: '#EF5350', primary: '#2962FF', highlight: '#FF6D00',
  }
}
