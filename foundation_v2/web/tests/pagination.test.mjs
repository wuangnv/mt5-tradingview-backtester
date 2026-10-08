import test from 'node:test'
import assert from 'node:assert/strict'
import { paginationWindow } from '../src/paginationModel.js'

test('page windows retain the current page and reach both boundaries without duplicate or invalid pages', () => {
  for (let pages = 1; pages <= 100; pages++) for (let page = 1; page <= pages; page++) {
    const window = paginationWindow(page, pages), numbers = window.filter(value => typeof value === 'number')
    assert(numbers.includes(page))
    assert.equal(new Set(numbers).size, numbers.length)
    assert.equal(numbers.length, Math.min(5, pages))
    assert(numbers.every(value => value >= 1 && value <= pages))
    assert.deepEqual(numbers, [...numbers].sort((a,b) => a-b))
    assert.equal(window[0] === 'gap', numbers[0] > 1)
    assert.equal(window.at(-1) === 'gap', numbers.at(-1) < pages)
    if(page === 1)assert.equal(numbers[0],1)
    if(page === pages)assert.equal(numbers.at(-1),pages)
  }
})
