import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'

const out=process.env.TW_COMPACT_EVIDENCE || '../evidence/compact-system-20261009', base='http://127.0.0.1:5180'
await mkdir(out,{recursive:true})
const browser=await chromium.launch({headless:true,ignoreDefaultArgs:['--hide-scrollbars']})
const results=[], errors=[]
const reference=`${base}/?workspace=tenant-a&view=overview&area=testing&ui_reference=1`
const css = async (locator,key) => locator.evaluate((e,key) => getComputedStyle(e)[key],key)
const box = locator => locator.evaluate(e => {const b=e.getBoundingClientRect(); return {width:Math.round(b.width),height:Math.round(b.height)}})
const luminance = rgb => rgb.slice(0,3).map(n => { const s=n/255; return s<=.04045 ? s/12.92 : ((s+.055)/1.055)**2.4 }).reduce((n,v,i) => n+v*[.2126,.7152,.0722][i],0)
const contrast = (a,b) => { const x=luminance(a),y=luminance(b); return (Math.max(x,y)+.05)/(Math.min(x,y)+.05) }
async function setup(options={}) {
  const page=await browser.newPage(options)
  page.setDefaultTimeout(12000)
  await page.addInitScript(theme => {localStorage.setItem('tw-theme',theme);localStorage.setItem('tw-language','vi')},options.theme||'dark')
  await page.route('**/api/**',route => route.request().method()==='GET' ? route.continue() : route.abort())
  page.on('pageerror',e=>errors.push(e.message))
  return page
}
try {
  for(const theme of ['dark','light']) {
    const page=await setup({viewport:{width:1710,height:987},theme})
    await page.goto(reference)
    await page.locator('#controls').waitFor()
    const neutral=page.locator('#controls .wm-reference-controls > .wm-button').nth(1)
    assert.equal((await box(neutral)).height,36)
    assert.equal(await css(neutral,'fontSize'),'13px')
    const initial=await box(neutral), rest=await css(neutral,'backgroundColor')
    await neutral.hover()
    await page.waitForFunction(e=>!e.getAnimations().some(a=>a.playState==='running'),await neutral.elementHandle())
    assert.notEqual(await css(neutral,'backgroundColor'),rest)
    assert.deepEqual(await box(neutral),initial)
    assert.equal(await css(neutral,'transitionDuration'),'0.12s, 0.12s, 0.12s, 0.12s')
    const row=page.locator('.wm-reference-row-sample tbody tr.is-selected'), action=row.locator('button')
    await action.hover()
    await page.waitForFunction(e=>!e.getAnimations().some(a=>a.playState==='running'),await action.elementHandle())
    assert.notEqual(await css(row,'backgroundColor'),await css(action,'backgroundColor'))
    assert.equal(await css(row,'backgroundColor'),theme==='dark'?'rgb(28, 28, 28)':'rgb(240, 240, 240)')
    assert.equal(await css(row.locator('td').first(),'boxShadow'),'none')
    const toggle=page.getByRole('switch')
    const blue=theme==='dark'?'rgb(112, 181, 255)':'rgb(36, 102, 172)'
    assert.equal(await css(toggle,'backgroundColor'),blue)
    const nativeCheck=page.locator('.wm-reference-choices input[type=checkbox]:not([role=switch])')
    await page.locator('#controls .fx-select-trigger').nth(1).click()
    const menuCheck=page.locator('.fx-select-all .fx-select-checkbox')
    assert.equal(await menuCheck.evaluate(e=>e.classList.contains('is-mixed')),true)
    await page.getByRole('checkbox',{name:'Chọn tất cả',exact:true}).click()
    await page.waitForFunction(e=>!e.getAnimations().some(a=>a.playState==='running'),await menuCheck.elementHandle())
    for(const key of ['width','height','borderRadius','backgroundColor','transitionDuration']) assert.equal(await css(nativeCheck,key),await css(menuCheck,key),`checkbox ${key}`)
    const mark=locator=>locator.evaluate(e=>getComputedStyle(e,'::after').maskImage)
    assert.equal(await mark(nativeCheck),await mark(menuCheck))
    await page.keyboard.press('Escape')
    await nativeCheck.focus();await page.keyboard.press('Space');assert.equal(await nativeCheck.isChecked(),false);await page.keyboard.press('Space');assert.equal(await nativeCheck.isChecked(),true)
    const referenceField=page.locator('.wm-reference-form-grid .wm-field').first()
    await referenceField.focus()
    assert.equal(await css(referenceField,'outlineStyle'),'none');assert.equal(await css(referenceField,'boxShadow'),'none')
    await page.waitForFunction(({element,color})=>getComputedStyle(element).borderColor===color,{element:await referenceField.elementHandle(),color:blue})
    await toggle.uncheck(); await page.waitForFunction(({element,color})=>getComputedStyle(element).backgroundColor!==color,{element:await toggle.elementHandle(),color:blue})
    await toggle.check(); await page.waitForFunction(({element,color})=>getComputedStyle(element).backgroundColor===color,{element:await toggle.elementHandle(),color:blue})
    await page.keyboard.press('Tab');await action.focus()
    assert.equal(await css(action,'outlineWidth'),'2px')
    const disabled=page.getByRole('button',{name:'Không khả dụng',exact:true})
    assert.equal(await disabled.isDisabled(),true)
    const palette=await page.locator('.fx-app').evaluate(el => {
      const style=getComputedStyle(el),result={}
      const keys=['canvas','surface','raised','control','hover','row-hover','row-selected','text','muted','primary','positive','negative','warning','action','on-action','danger-action','danger-hover','on-danger']
      for(const key of keys) {const probe=document.createElement('span');probe.style.color=`var(--project-${key})`;el.appendChild(probe);result[key]=getComputedStyle(probe).color.match(/[\d.]+/g).map(Number);probe.remove()}
      return result
    })
    for(const bg of ['canvas','surface','raised','control','hover','row-selected']) {
      for(const fg of ['text','muted']) assert.ok(contrast(palette[fg],palette[bg])>=4.5,`${theme} ${fg}/${bg}`)
    }
    for(const [fg,bg] of [['on-action','action'],['on-danger','danger-action'],['on-danger','danger-hover']]) assert.ok(contrast(palette[fg],palette[bg])>=4.5,`${theme} ${fg}/${bg}`)
    for(const fg of ['primary','positive','negative','warning']) assert.ok(contrast(palette[fg],palette.canvas)>=4.5,`${theme} ${fg}/canvas`)
    const open=page.getByRole('button',{name:'Mở dialog mẫu',exact:true})
    await open.click();const close=page.getByRole('button',{name:'Đóng dialog mẫu'})
    assert.equal(await css(page.locator('.wm-reference-dialog'),'animationDuration'),'0.22s')
    await close.hover();assert.equal(await css(close,'backgroundColor'),'rgba(0, 0, 0, 0)')
    await page.keyboard.press('Escape');assert.equal(await open.evaluate(e=>e===document.activeElement),true)
    await page.locator('#controls .fx-select-trigger').first().click()
    assert.equal(await css(page.locator('.fx-select-menu'),'animationDuration'),'0.16s')
    await page.keyboard.press('ArrowDown');await page.keyboard.press('Escape')
    await page.screenshot({path:`${out}/reference-${theme}.png`,animations:'disabled'})
    const flow=page.getByTestId('reference-data-flow')
    const selectFlow=async name=>{await page.getByRole('button',{name:'Luồng Tổng quan minh hoạ',exact:true}).click();await page.getByRole('option',{name,exact:true}).click()}
    assert.equal(await flow.getByRole('status').count(),1)
    assert.equal(await flow.locator('h3').count(),0)
    await selectFlow('Đang đọc phiên');assert.equal(await flow.getAttribute('aria-busy'),'true');assert.equal(await flow.getByRole('status').count(),1)
    await selectFlow('Có phiên, chưa giao dịch');assert.ok((await flow.innerText()).includes('Phiên mẫu'));assert.equal(await flow.getByRole('status').count(),1)
    await selectFlow('Một biểu đồ lỗi riêng');assert.ok((await flow.innerText()).includes('Kết quả chung'));assert.equal(await flow.getByRole('alert').count(),1)
    await flow.getByRole('button',{name:'Thử lại'}).click();assert.equal(await flow.getByRole('alert').count(),0)
    await selectFlow('Nguồn phiên lỗi');assert.equal(await flow.getByRole('alert').count(),1);assert.equal(await flow.locator('h3').count(),0)
    await page.screenshot({path:`${out}/flow-${theme}.png`,animations:'disabled'})
    await page.locator('#report-patterns').screenshot({path:`${out}/report-patterns-${theme}.png`,animations:'disabled'})
    results.push({case:'labeled shared-source and independent-source state journeys',theme,pass:true})
    // A theme switch updates the displayed hex values as well as surfaces.
    const before=await page.locator('.wm-reference-colors code').nth(1).innerText()
    await page.getByTestId('theme-toggle').click()
    await page.waitForFunction(before=>document.querySelectorAll('.wm-reference-colors code')[1].textContent!==before,before)
    results.push({case:'states, motion, no layout shift, keyboard, contrast, theme switch',theme,pass:true})
    await page.close()
  }
  for(const width of [360,768,1440]) {
    const page=await setup({viewport:{width,height:987},hasTouch:width===360})
    for(const [view,extra] of [['overview','&ui_reference=1'],['overview','&demo=1'],['analytics','&demo=1'],['market-data',''],['settings','']]) {
      await page.goto(`${base}/?workspace=tenant-a&view=${view}&area=testing${extra}`)
      await page.locator('.fx-content > :not(.wm-skeleton)').first().waitFor()
      await page.waitForLoadState('networkidle',{timeout:8000}).catch(()=>{})
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`${view} ${width}`)
      if(view==='overview' && extra==='&ui_reference=1') {
        const b=await box(page.getByRole('button',{name:'Mở dialog mẫu',exact:true}))
        assert.equal(b.height,width===360?44:36)
        if(width===360) assert.ok((await box(page.locator('.wm-reference-choices label').first())).height>=44)
      }
      if(view==='overview' && extra==='&demo=1') {
        await page.goto(`${base}/?workspace=tenant-a&view=overview&area=testing`)
        await page.locator('.fx-dashboard-quick-action').first().click()
        await page.getByRole('dialog').waitFor()
        const strategy=page.locator('.quick-session-strategy .fx-select-trigger')
        await page.waitForFunction(e=>!e.disabled,await strategy.elementHandle())
        await page.keyboard.press('Tab'); await strategy.focus()
        assert.equal(await css(strategy,'outlineStyle'),'none')
        const strategyBlue=await strategy.evaluate(e=>{const p=document.createElement('i');p.style.color='var(--wm-focus)';e.parentNode.appendChild(p);const c=getComputedStyle(p).color;p.remove();return c})
        await page.waitForFunction(({element,color})=>getComputedStyle(element).borderColor===color,{element:await strategy.elementHandle(),color:strategyBlue})
        const focus=await strategy.evaluate(e=>getComputedStyle(e).getPropertyValue('--wm-focus').trim())
        assert.ok(focus)
        assert.equal(await strategy.evaluate(e=>e.matches(':focus-visible')),true)
        const asset=page.locator('.dataset-asset-select .fx-select-tag-field .fx-select-trigger')
        await page.waitForFunction(e=>!e.disabled,await asset.elementHandle())
        await asset.focus()
        assert.equal(await css(asset,'outlineStyle'),'none')
        const assetField=page.locator('.dataset-asset-select .fx-select-tag-field')
        const assetBlue=await assetField.evaluate(e=>{const p=document.createElement('i');p.style.color='var(--wm-focus)';e.appendChild(p);const c=getComputedStyle(p).color;p.remove();return c})
        await page.waitForFunction(({element,color})=>getComputedStyle(element).borderColor===color,{element:await assetField.elementHandle(),color:assetBlue})
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
        await page.screenshot({path:`${out}/create-${width}.png`,animations:'disabled'})
        await page.keyboard.press('Escape')
      }
      results.push({case:'reflow and geometry',view,width,pass:true})
    }
    await page.close()
  }
  const reduced=await setup({viewport:{width:1440,height:987},reducedMotion:'reduce'})
  await reduced.goto(reference);await reduced.getByRole('button',{name:'Mở dialog mẫu',exact:true}).click()
  assert.equal(await css(reduced.locator('.wm-reference-dialog'),'animationName'),'none')
  assert.equal(await css(reduced.getByRole('button',{name:'Đóng dialog mẫu'}),'transitionDuration'),'0s')
  results.push({case:'reduced motion',pass:true});await reduced.close()
  for(const theme of ['dark','light']) {
    const page=await setup({viewport:{width:1440,height:987},theme})
    await page.goto(`${base}/?workspace=tenant-a&view=overview&area=testing&demo=1`)
    await page.locator('.fx-dashboard-card-icon[title="Sửa tên và mô tả"]').first().click()
    const field=page.locator('.fxs-settings-drawer input:not([readonly])').first()
    await field.waitFor();await page.keyboard.press('Tab');await field.focus()
    assert.equal((await box(field)).height,36)
    assert.equal(await css(field,'borderRadius'),'8px')
    assert.equal(await css(field,'fontSize'),'13px')
    const blue=await field.evaluate(e=>{const p=document.createElement('i');p.style.color='var(--wm-focus)';e.parentNode.appendChild(p);const c=getComputedStyle(p).color;p.remove();return c})
    await page.waitForFunction(({element,color})=>getComputedStyle(element).borderColor===color,{element:await field.elementHandle(),color:blue})
    assert.equal(await css(field,'borderColor'),blue)
    await page.keyboard.press('Escape')
    results.push({case:'session settings fields geometry and keyboard focus',theme,pass:true})
    await page.close()
  }
  assert.deepEqual(errors,[])
} finally {
  await browser.close()
  await writeFile(`${out}/acceptance.json`,JSON.stringify({results,errors},null,2))
}
console.log(JSON.stringify({passed:results.length,errors}))
