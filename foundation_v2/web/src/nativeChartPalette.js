// The trading chart uses TradingView's standard colors, independently of app chrome.
export function nativeChartPalette(theme) {
  return {
    canvas: theme === 'light' ? '#FFFFFF' : '#131722',
    surface: theme === 'light' ? '#FFFFFF' : '#1E222D',
    grid: theme === 'light' ? '#F0F3FA' : '#2A2E39',
    border: theme === 'light' ? '#E0E3EB' : '#2A2E39',
    text: theme === 'light' ? '#131722' : '#B2B5BE',
    positive: '#26A69A', negative: '#EF5350', primary: '#2962FF', highlight: '#FF6D00',
  }
}
