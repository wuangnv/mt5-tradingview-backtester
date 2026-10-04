import React from 'react'

const paths = {
  cross: 'M12 3v18M3 12h18M9 9h6v6H9z',
  level: 'M3 12h18M5 9v6M19 9v6',
  trendline: 'M4 20 20 4M3 17v4h4M17 3h4v4',
  zone: 'M4 6h16v12H4zM4 12h16',
  text: 'M5 5h14M12 5v15M8 20h8',
  measure: 'm4 17 13-13 3 3L7 20zM9 12l3 3M13 8l3 3',
  objects: 'M9 5h12M9 12h12M9 19h12M3 4h2v2H3zM3 11h2v2H3zM3 18h2v2H3z',
  fit: 'M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5',
  play: 'm9 5 11 7-11 7z', pause: 'M8 5v14M16 5v14',
  step: 'm6 5 10 7-10 7zM19 5v14', back: 'm16 5-10 7 10 7zM4 5v14',
  order: 'M12 4v16M4 12h16', journal: 'M6 3h13v18H6zM3 7h5M3 12h5M3 17h5M11 8h4M11 12h4',
  analytics: 'M4 4v16h16M8 15v-4M12 15V7M16 15V9',
  data: 'M3 5h18v14H3zM3 9h18M9 5v14',
  info: 'M12 11v6M12 7h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',
  pin: 'm8 3 8 0-1 6 4 4H5l4-4zM12 13v8',
  collapse: 'm8 5 7 7-7 7', expand: 'm15 5-7 7 7 7', close: 'm6 6 12 12M18 6 6 18',
  grip: 'M8 6h.01M16 6h.01M8 12h.01M16 12h.01M8 18h.01M16 18h.01',
  candles: 'M6 3v18M3 7h6v8H3zM17 3v18M14 10h6v8h-6z',
}

export default function ChartIcon({ name, ...props }) {
  return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...props}><path d={paths[name] || paths.info} /></svg>
}
