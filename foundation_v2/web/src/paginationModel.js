export function paginationWindow(page, pages) {
  const count = Math.min(5, pages)
  const start = Math.min(Math.max(1, page - 2), pages - count + 1)
  const result = Array.from({ length: count }, (_, index) => start + index)
  if (start > 1) result.unshift('gap')
  if (start + count - 1 < pages) result.push('gap')
  return result
}
