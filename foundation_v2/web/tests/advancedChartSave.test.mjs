import test from 'node:test'
import assert from 'node:assert/strict'
import { createChartSave } from '../src/advancedChartSave.js'
const wait = ms => new Promise(resolve => setTimeout(resolve,ms))
function setup(options = {}) {
  const callbacks=[], states=[], writes=[], scope={generation:'a',cutoff:100}
  const controller=createChartSave({snapshot:cb=>callbacks.push(cb),persist:(cutoff,layout)=>writes.push({cutoff,layout}),context:()=>({...scope}),onState:state=>states.push(state),delay:30,timeout:60,...options})
  return {controller,callbacks,states,writes,scope}
}
test('manual save cancels debounce and a clean layout is disabled',async () => {
  const s=setup();s.controller.save();assert.equal(s.callbacks.length,0)
  s.controller.dirty();s.controller.save();assert.deepEqual(s.states,['dirty','saving'])
  s.callbacks[0]({name:'layout'});assert.equal(s.states.at(-1),'saved');assert.equal(s.writes.length,1)
  await wait(40);assert.equal(s.callbacks.length,1);s.controller.dispose()
})
test('autosave persists edits without manual action',async () => {
  const s=setup();s.controller.dirty();await wait(40);assert.equal(s.states.at(-1),'saving')
  s.callbacks[0]({});assert.equal(s.states.at(-1),'saved');s.controller.dispose()
})
test('an edit during save invalidates the older snapshot',() => {
  const s=setup();s.controller.dirty();s.controller.save();s.controller.dirty();s.callbacks[0]({old:true})
  assert.equal(s.writes.length,0);assert.equal(s.states.at(-1),'dirty')
  s.controller.save();s.callbacks[1]({new:true});assert.equal(s.writes.length,1);s.controller.dispose()
})
test('replay cutoff and generation changes cannot publish a stale layout',() => {
  for(const field of ['cutoff','generation']) {
    const s=setup();s.controller.dirty();s.controller.save();s.scope[field]=field==='cutoff'?101:'b';s.callbacks[0]({})
    assert.equal(s.writes.length,0);assert.equal(s.states.at(-1),'dirty');s.controller.dispose()
  }
})
test('storage errors remain retryable and never report success',() => {
  let failed=true
  const s=setup({persist:()=>{if(failed)throw Error('QuotaExceededError')}})
  s.controller.dirty();s.controller.save();s.callbacks[0]({});assert.equal(s.states.at(-1),'error')
  failed=false;s.controller.save();s.callbacks[1]({});assert.equal(s.states.at(-1),'saved');s.controller.dispose()
})
test('timeouts and disposal discard late vendor callbacks',async () => {
  const s=setup({timeout:10});s.controller.dirty();s.controller.save();await wait(20)
  assert.equal(s.states.at(-1),'error');s.callbacks[0]({});assert.equal(s.writes.length,0)
  s.controller.save();s.controller.dispose();s.callbacks[1]({});assert.equal(s.writes.length,0)
})
