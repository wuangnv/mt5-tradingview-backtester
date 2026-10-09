import test from 'node:test'
import assert from 'node:assert/strict'
import { staticImports } from '../frontendProductionProbe.mjs'

test('static startup graph excludes dynamic imports and preload filename references', () => {
  const code = `import{a}from"./core.js";import "./theme.js";const later=()=>import("./ReplayWorkspace.js");const names=["./ReplayWorkspace.js"];export{a}from"./shared.js";`
  assert.deepEqual(staticImports(code), ['./core.js', './theme.js', './shared.js'])
})
