import { createContext, useCallback, useContext, useMemo } from 'react'
import copy from './testing-copy.json'
import enums from './testing-enums.json'

const LocaleContext = createContext('vi')
export const missingTestingCopy = new Set()
const reverseCopy = Object.fromEntries(Object.values(copy).flatMap(entry => [[entry.vi, entry], [entry.en, entry]]))
const patterns = Object.entries(copy).filter(([key]) => /\{\w+\}/.test(key)).flatMap(([key, entry]) => [key, entry.vi, entry.en].map(template => {
  const names = [...template.matchAll(/\{(\w+)\}/g)].map(match => match[1])
  const segments = template.split(/\{\w+\}/).map(text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  return { entry, names, regex: new RegExp(`^${segments.join('(.+?)')}$`) }
}))

export function TestingLocaleProvider({ language, children }) {
  return <LocaleContext.Provider value={language === 'en' ? 'en' : 'vi'}>{children}</LocaleContext.Provider>
}

export function translateTesting(text, language = 'vi', values = {}) {
  if (typeof text !== 'string') return text
  let entry = copy[text] || copy[text.trim()] || reverseCopy[text.trim()]
  if (!entry) {
    const pattern = patterns.find(pattern => pattern.regex.test(text))
    if (pattern) {
      const match = text.match(pattern.regex)
      values = { ...Object.fromEntries(pattern.names.map((name, index) => [name, match[index + 1]])), ...values }
      entry = pattern.entry
    }
  }
  if (!entry && /[A-Za-zÀ-ỹ]/u.test(text) && !reverseCopy[text]) missingTestingCopy.add(text)
  const localized = entry ? `${text.match(/^\s*/)[0]}${entry[language].trim()}${text.match(/\s*$/)[0]}` : text
  let result = localized.replace(/\{(\w+)\}/g, (match, key) => values[key] === undefined ? match : String(values[key]))
  if (language === 'en' && Number(values.count) === 1) result = result.replace(/\b(days|trades|sessions|minutes|candles)\b/g, word => word.slice(0, -1))
  return result
}

export function useTestingLocale() {
  const language = useContext(LocaleContext), locale = language === 'en' ? 'en-US' : 'vi-VN'
  const t = useCallback((text, values) => translateTesting(text, language, values), [language])
  const fmt = useCallback((value, suffix = '', digits = 2) => value !== null && value !== undefined && value !== '' && typeof value !== 'boolean' && Number.isFinite(Number(value)) ? `${new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(Number(value))}${suffix}` : '—', [locale])
  const statusLabel = useCallback((family, value) => enums[family]?.[value]?.[language] || value || '—', [language])
  return useMemo(() => ({ language, locale, t, fmt, statusLabel }), [language, locale, t, fmt, statusLabel])
}
