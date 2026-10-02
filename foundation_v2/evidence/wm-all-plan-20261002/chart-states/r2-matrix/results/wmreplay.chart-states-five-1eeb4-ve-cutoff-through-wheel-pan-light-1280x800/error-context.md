# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: wmreplay.chart-states.spec.mjs >> five chart types render mixed OHLC and preserve cutoff through wheel/pan
- Location: tests\visual\wmreplay.chart-states.spec.mjs:36:1

# Error details

```
Error: expect(received).toBeGreaterThan(expected)

Expected: > 10
Received:   2
```

# Page snapshot

```yaml
- generic [ref=e3]:
  - banner [ref=e4]:
    - generic [ref=e5]:
      - link "Quay lại Sessions" [ref=e6] [cursor=pointer]:
        - /url: /?workspace=visual-chart-fixture&view=replay&session=fixture-chart-ui&cursor=60&select=1
        - text: ←
      - generic [ref=e7]: WMREPLAY
    - generic "fixture-chart-ui" [ref=e8]: WMReplay · fixture-chart-ui
    - generic [ref=e9]:
      - button "Chuyển ngôn ngữ sang English" [ref=e10] [cursor=pointer]: EN⌄
      - button "Giao diện sáng" [pressed] [ref=e11] [cursor=pointer]:
        - generic [aria-hidden] [ref=e12]: ☾
      - button "Mở phím tắt và trợ giúp" [ref=e13] [cursor=pointer]: "?"
  - region "Nội dung WMREPLAY" [ref=e14]:
    - main [ref=e16]:
      - region "Ngữ cảnh replay" [ref=e17]:
        - generic [ref=e18]:
          - generic [ref=e19]: Practice context
          - strong [ref=e20]: EURUSD · 60s
          - generic [ref=e21]: visual-chart-fixture · broker locked
        - generic [ref=e22]:
          - generic [ref=e23]: Decision cutoff
          - strong [ref=e24]: "#60"
          - generic [ref=e25]: 01:00:00 1/1/24 UTC
        - generic [ref=e26]: Tạm dừng
      - generic [ref=e27]:
        - generic [ref=e28]:
          - group "Điều khiển replay" [ref=e29]:
            - generic [ref=e30]:
              - button "Phát replay" [ref=e31] [cursor=pointer]
              - button "+1 nến" [ref=e32] [cursor=pointer]
              - button "+10 nến" [ref=e33] [cursor=pointer]
            - group "Hiển thị chart" [ref=e34]:
              - generic [ref=e35]:
                - text: Chart
                - combobox "Kiểu chart" [ref=e36]:
                  - option "Candles" [selected]
                  - option "Bars"
                  - option "Line"
                  - option "Area"
                  - option "Baseline"
              - generic [ref=e37]:
                - checkbox "Volume" [checked] [ref=e38]
                - text: Volume
              - generic "Trung bình giá đóng của 20 nến đã mở" [ref=e39]:
                - checkbox "SMA 20" [checked] [ref=e40]
                - text: SMA 20
              - button "Chi tiết & nhánh" [ref=e41] [cursor=pointer]
            - group "Tốc độ replay" [ref=e42]:
              - generic [ref=e43]: Tốc độ
              - combobox "Tốc độ replay" [ref=e44]:
                - option "0.5×"
                - option "1×" [selected]
                - option "2×"
                - option "4×"
            - generic [ref=e45]: "Phím tắt: → +1 nến · Shift + → +10 nến"
          - generic [ref=e47]:
            - navigation "Công cụ chart" [ref=e48]:
              - button "Chỉ xem crosshair" [ref=e49] [cursor=pointer]: ＋
              - button "Chọn đường giá local" [pressed] [ref=e50] [cursor=pointer]: ＝
              - button "Vẽ đường xu hướng" [ref=e51] [cursor=pointer]: ╱
              - button "Vẽ vùng giá" [ref=e52] [cursor=pointer]: ▱
              - button "Thêm ghi chú chart" [ref=e53] [cursor=pointer]: T
              - button "Đo giá giữa hai mốc" [ref=e54] [cursor=pointer]: ↔
              - button "Mở danh sách đối tượng" [ref=e55] [cursor=pointer]: ☷
              - button "Vừa toàn bộ nến đã mở" [active] [ref=e56] [cursor=pointer]: ⛶
            - generic [ref=e57]:
              - group "Thông tin symbol":
                - strong: EURUSD
                - generic: 60s · UTC
                - generic: O 1,1034 · H 1,1043 · L 1,1031 · C 1,104 · V 280
              - 'group "Biểu đồ replay với 61 nến đã mở. Nến cuối: 01:00:00 1/1/24 UTC, mở 1,1034, cao 1,1043, thấp 1,1031, đóng 1,104. Cuộn để zoom, kéo để pan; bấm nến để chọn mốc giá. Dùng điều khiển phía dưới hoặc thanh chọn nến để đọc OHLC ở từng cutoff." [ref=e58]':
                - table [ref=e60]:
                  - row [ref=e61]:
                    - cell
                    - cell [ref=e62]:
                      - link "Charting by TradingView" [ref=e66] [cursor=pointer]:
                        - /url: https://www.tradingview.com/?utm_medium=lwc-link&utm_campaign=lwc-chart&utm_source=127.0.0.1/
                    - cell [ref=e71]
                  - row [ref=e75]:
                    - cell
                    - cell [ref=e76]
                    - cell [ref=e80]
            - navigation "Tiện ích replay" [ref=e83]:
              - link "Trade draft trong simulator" [ref=e84] [cursor=pointer]:
                - /url: /?workspace=visual-chart-fixture&view=trade&session=fixture-chart-ui&dataset=fixture-chart-synthetic&cursor=60&cutoff=1704070800&surface=workspace&intent=order
                - text: ＋
              - link "Journal tại cutoff này" [ref=e85] [cursor=pointer]:
                - /url: /?workspace=visual-chart-fixture&view=journal&session=fixture-chart-ui&dataset=fixture-chart-synthetic&cursor=60&cutoff=1704070800
                - text: ▣
              - link "Analytics của session" [ref=e86] [cursor=pointer]:
                - /url: /?workspace=visual-chart-fixture&view=analytics&session=fixture-chart-ui&dataset=fixture-chart-synthetic&cursor=60&cutoff=1704070800&surface=workspace
                - text: ▥
          - group "Điều khiển replay phía dưới chart" [ref=e87]:
            - group "Khoảng thời gian chart" [ref=e88]:
              - button "1D" [ref=e89] [cursor=pointer]
              - button "5D" [ref=e90] [cursor=pointer]
              - button "1M" [ref=e91] [cursor=pointer]
              - button "All" [pressed] [ref=e92] [cursor=pointer]
              - button "Tới cutoff" [ref=e93] [cursor=pointer]
              - link "Học & thuật ngữ" [ref=e94] [cursor=pointer]:
                - /url: /?workspace=visual-chart-fixture&view=learn&session=fixture-chart-ui&dataset=fixture-chart-synthetic&cursor=60&cutoff=1704070800&from=replay
            - generic [ref=e95]:
              - button "Về nến đầu tiên" [ref=e96] [cursor=pointer]: "|‹"
              - button "Lùi một nến" [ref=e97] [cursor=pointer]: ‹
              - generic [ref=e98]: "#60 / #60 · UTC"
            - generic [ref=e99]:
              - text: Paper replay
              - strong [ref=e101]: EURUSD
        - text: +
```

# Test source

```ts
  38  |   page.on('pageerror', error => errors.push(String(error)))
  39  |   await page.addInitScript(theme => { localStorage.setItem('tw-theme', theme); localStorage.setItem('tw-language', 'vi'); localStorage.setItem('tw-shell-rail-collapsed', 'false') }, testInfo.project.metadata.theme)
  40  |   await context.routeWebSocket('**/*', socket => socket.close())
  41  |   await context.route('**/*', async route => {
  42  |     const request = route.request(), url = new URL(request.url())
  43  |     if (url.origin !== origin || !['GET', 'HEAD'].includes(request.method())) { unexpected.push(`${request.method()} ${url.href}`); return route.abort() }
  44  |     if (!url.pathname.startsWith('/api/')) return route.continue()
  45  |     if (request.headers()['x-workspace-id'] !== variant.workspace) { unexpected.push('Wrong workspace'); return route.abort() }
  46  |     let body
  47  |     if (url.pathname === '/api/v2/data/datasets') body = variant.datasets
  48  |     else if (url.pathname === '/api/v2/chart/annotations') body = variant.annotations
  49  |     else if (url.pathname === `/api/v2/replay/sessions/${variant.session}`) {
  50  |       const cursor = url.searchParams.get('cursor_index')
  51  |       if (cursor !== null && !['20', '60'].includes(cursor)) { unexpected.push('Unexpected cursor ' + cursor); return route.abort() }
  52  |       body = cursor === '20' ? variant.history : variant.latest
  53  |       observations.push({ cursor: body.view_cursor_index, canonicalCursor: body.payload.cursor_index, rows: body.visible_rows.length, cutoff: body.cutoff_timestamp })
  54  |     } else { unexpected.push(url.pathname); return route.abort() }
  55  |     return route.fulfill({ status: 200, json: body })
  56  |   })
  57  |   const chart = page.getByTestId('replay-chart')
  58  |   const range = () => chart.evaluate(node => ({ from: Number(node.dataset.rangeFrom), to: Number(node.dataset.rangeTo) }))
  59  |   const fit = async () => {
  60  |     await page.getByRole('button', { name: 'Vừa toàn bộ nến đã mở', exact: true }).click()
  61  |     await expect.poll(async () => (await range()).to).toBeGreaterThan(59)
  62  |     await chart.scrollIntoViewIfNeeded()
  63  |   }
  64  |   const url = cursor => `${origin}/?workspace=${variant.workspace}&view=replay&surface=workspace&session=${variant.session}&cursor=${cursor}`
  65  |   const destination = path.join(output, testInfo.project.name)
  66  |   await mkdir(destination, { recursive: true })
  67  |   await page.goto(url(60))
  68  |   await expect(chart).toHaveAttribute('data-visible-row-count', '61')
  69  |   await expect(chart).toHaveAttribute('data-visible-object-count', '0')
  70  |   await page.evaluate(() => document.fonts.ready)
  71  |   await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important;scroll-behavior:auto!important}' })
  72  |   await page.getByRole('checkbox', { name: 'Volume', exact: true }).uncheck()
  73  |   let previousPan = null
  74  |   for (const type of ['candles', 'bars', 'line', 'area', 'baseline']) {
  75  |     await page.getByRole('combobox', { name: 'Kiểu chart', exact: true }).selectOption(type)
  76  |     if (previousPan) {
  77  |       await expect.poll(async () => Math.abs((await range()).from - previousPan.from)).toBeLessThan(.01)
  78  |       await expect.poll(async () => Math.abs((await range()).to - previousPan.to)).toBeLessThan(.01)
  79  |     }
  80  |     await fit()
  81  |     const fitted = await range()
  82  |     expect(fitted.from).toBeLessThan(1)
  83  |     expect(fitted.to).toBeLessThan(64)
  84  |     const box = await chart.locator('canvas').first().boundingBox()
  85  |     const sampleIndex = 31, sample = variant.latest.visible_rows[sampleIndex]
  86  |     await page.mouse.move(box.x + (sampleIndex - fitted.from + .5) / (fitted.to - fitted.from + 1) * box.width, box.y + box.height * .4)
  87  |     await expect(page.locator('.bar-readout-label')).toHaveText(`Crosshair #${sampleIndex}`)
  88  |     await expect(page.locator('.bar-readout strong')).toHaveText([sample.open, sample.high, sample.low, sample.close].map(price))
  89  |     await page.mouse.move(0, 0)
  90  |     await expect(page.locator('.bar-readout-label')).toHaveText('Nến hiện tại #60')
  91  |     const colors = await chart.locator('canvas').evaluateAll(nodes => {
  92  |       const totals = { green: 0, red: 0, gold: 0 }
  93  |       for (const canvas of nodes) {
  94  |         const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
  95  |         for (let i = 0; i < pixels.length; i += 4) {
  96  |           if (pixels[i] === 99 && pixels[i + 1] === 185 && pixels[i + 2] === 130) totals.green++
  97  |           if (pixels[i] === 223 && pixels[i + 1] === 118 && pixels[i + 2] === 118) totals.red++
  98  |           if (pixels[i] === 214 && pixels[i + 1] === 181 && pixels[i + 2] === 111) totals.gold++
  99  |         }
  100 |       }
  101 |       return totals
  102 |     })
  103 |     if (['candles', 'bars', 'baseline'].includes(type)) { expect(colors.green).toBeGreaterThan(10); expect(colors.red).toBeGreaterThan(10) }
  104 |     else expect(colors[type === 'line' ? 'gold' : 'green']).toBeGreaterThan(10)
  105 |     const screenshot = await chart.screenshot({ path: path.join(destination, `${type}.png`), animations: 'disabled', scale: 'css' })
  106 |     await page.mouse.move(box.x + box.width * .55, box.y + box.height * .4)
  107 |     await page.mouse.wheel(0, -350)
  108 |     await expect.poll(async () => { const current = await range(); return current.to - current.from }).toBeLessThan(fitted.to - fitted.from - 1)
  109 |     const zoomed = await range()
  110 |     await page.mouse.down()
  111 |     await page.mouse.move(box.x + box.width * .70, box.y + box.height * .4, { steps: 12 })
  112 |     await page.mouse.up()
  113 |     await expect.poll(async () => Math.abs((await range()).from - zoomed.from)).toBeGreaterThan(.5)
  114 |     const panned = await range()
  115 |     previousPan = panned
  116 |     await expect(chart).toHaveAttribute('data-visible-row-count', '61')
  117 |     await expect(page.getByTestId('replay-jump')).toHaveValue('60')
  118 |     states.push({ type, fitted, zoomed, panned, sampleIndex, sample, colors, captureSha256: sha(screenshot) })
  119 |   }
  120 |   expect(new Set(states.map(state => state.captureSha256)).size).toBe(5)
  121 |   await page.getByRole('combobox', { name: 'Kiểu chart', exact: true }).selectOption('candles')
  122 |   await page.getByRole('checkbox', { name: 'Volume', exact: true }).check()
  123 |   await page.getByRole('checkbox', { name: 'SMA 20', exact: true }).check()
  124 |   await fit()
  125 |   await page.mouse.move(0, 0)
  126 |   const overlays = await chart.locator('canvas').evaluateAll(nodes => {
  127 |     const totals = { sma: 0, upVolume: 0, downVolume: 0 }
  128 |     for (const canvas of nodes) {
  129 |       const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
  130 |       for (let i = 0; i < pixels.length; i += 4) {
  131 |         if (pixels[i] === 227 && pixels[i + 1] === 186 && pixels[i + 2] === 105) totals.sma++
  132 |         if (pixels[i] === 38 && pixels[i + 1] === 76 && pixels[i + 2] === 57) totals.upVolume++
  133 |         if (pixels[i] === 96 && pixels[i + 1] === 55 && pixels[i + 2] === 55) totals.downVolume++
  134 |       }
  135 |     }
  136 |     return totals
  137 |   })
> 138 |   for (const count of Object.values(overlays)) expect(count).toBeGreaterThan(10)
      |                                                              ^ Error: expect(received).toBeGreaterThan(expected)
  139 |   await chart.screenshot({ path: path.join(destination, 'candles-volume-sma.png'), animations: 'disabled', scale: 'css' })
  140 |   await page.goto(url(20))
  141 |   await expect(chart).toHaveAttribute('data-visible-row-count', '21')
  142 |   await expect(chart).toHaveAttribute('data-visible-object-count', '0')
  143 |   await expect(page.getByTestId('step-1')).toBeDisabled()
  144 |   await expect(page.getByTestId('play-toggle')).toBeDisabled()
  145 |   await expect(page.getByTestId('replay-jump')).toHaveValue('20')
  146 |   await page.reload()
  147 |   await expect(chart).toHaveAttribute('data-visible-row-count', '21')
  148 |   const last = variant.history.visible_rows.at(-1)
  149 |   await expect(page.locator('.bar-readout strong')).toHaveText([last.open, last.high, last.low, last.close].map(price))
  150 |   for (const view of observations) { expect(view.rows).toBe(view.cursor + 1); expect(view.canonicalCursor).toBe(60); expect(view.cutoff).toBe(variant.latest.visible_rows[view.cursor].timestamp) }
  151 |   const geometry = await page.evaluate(() => ({ pageOverflow: document.documentElement.scrollWidth - innerWidth, contentOverflow: document.querySelector('.fx-content').scrollWidth - document.querySelector('.fx-content').clientWidth }))
  152 |   expect(geometry.pageOverflow).toBeLessThanOrEqual(1)
  153 |   expect(geometry.contentOverflow).toBeLessThanOrEqual(1)
  154 |   expect(errors).toEqual([])
  155 |   expect(unexpected).toEqual([])
  156 |   expect(sourceHash()).toBe(before)
  157 |   expect(sha(readFileSync(path.join(here, 'chart-fixture.json')))).toBe(sha(fixtureBytes))
  158 |   const receipt = { status: 'SCOPED_BEHAVIOR_PASS_VISUAL_REVIEW_PENDING', scope: variant.scope, sourceHash: before, canonicalFixtureSha256: sha(fixtureBytes), variantSha256: sha(JSON.stringify(variant)), project: testInfo.project.name, browser: browser.version(), viewport: testInfo.project.use.viewport, states, overlays, preservesViewportOnTypeSwitch: true, observations, geometry, errors, unexpected, excluded: ['touch/pinch', 'keyboard-only chart pan', 'backend persistence', 'performance', 'independent visual approval', 'golden promotion', 'full W8'] }
  159 |   await writeFile(path.join(destination, 'receipt.json'), JSON.stringify(receipt, null, 2))
  160 |   await testInfo.attach('chart-states-provenance', { body: JSON.stringify(receipt, null, 2), contentType: 'application/json' })
  161 | })
  162 | 
```