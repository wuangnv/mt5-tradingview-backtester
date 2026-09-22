import { chromium } from 'playwright'
import path from 'node:path'

const [baseUrl, workspace, jobId, outputDir] = process.argv.slice(2)
if (!baseUrl || !workspace || !jobId || !outputDir) {
  throw new Error('usage: node run_ui_acceptance.mjs <baseUrl> <workspace> <jobId> <outputDir>')
}

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.TW_V2_CHROME || undefined,
})
const results = []
try {
  for (const fixture of [
    { name: 'desktop', width: 1365, height: 768 },
    { name: 'mobile', width: 390, height: 844 },
  ]) {
    const page = await browser.newPage({ viewport: { width: fixture.width, height: fixture.height } })
    const url = `${baseUrl}/?workspace=${encodeURIComponent(workspace)}&job=${encodeURIComponent(jobId)}`
    await page.goto(url, { waitUntil: 'networkidle' })
    await page.getByText('Hoan tat', { exact: true }).waitFor({ timeout: 10000 })
    await page.getByTestId('safety-lock').waitFor()
    const safety = await page.getByTestId('safety-lock').textContent()
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
    const chart = await page.locator('.chart').boundingBox()
    const canvasCount = await page.locator('.chart canvas').count()
    const screenshot = path.join(outputDir, `f6-${fixture.name}.png`)
    await page.screenshot({ path: screenshot, fullPage: true })
    results.push({
      fixture: fixture.name,
      safety,
      overflow,
      chartWidth: chart?.width || 0,
      chartHeight: chart?.height || 0,
      canvasCount,
      screenshot,
    })
    await page.close()
  }
} finally {
  await browser.close()
}

const pass = results.every((item) =>
  item.safety === 'Khong co quyen gui lenh broker' &&
  item.overflow === false &&
  item.chartWidth > 200 &&
  item.chartHeight >= 200 &&
  item.canvasCount > 0
)
console.log(JSON.stringify({ pass, results }, null, 2))
process.exit(pass ? 0 : 1)
