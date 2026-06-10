import { chromium } from '@playwright/test'

const targetUrl = process.argv[2] ?? 'http://127.0.0.1:5175/?perf=1'
const switchCount = Number(process.env.WHITEBOARD_NAV_SWITCHES ?? 24)
const maxAverageSwitchMs = Number(process.env.WHITEBOARD_NAV_MAX_AVG_SWITCH_MS ?? Number.POSITIVE_INFINITY)

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
const errors = []
page.on('pageerror', (error) => errors.push(String(error)))

await page.goto(targetUrl, { waitUntil: 'networkidle' })
await page.waitForSelector('.board-stage canvas', { timeout: 15000 })

const timings = []
for (let index = 0; index < switchCount; index += 1) {
  const next = index % 2 === 0
  const title = next ? '\u4e0b\u4e00\u9875' : '\u4e0a\u4e00\u9875'
  const startedAt = performance.now()
  await page.getByTitle(title).click()
  await page.waitForTimeout(0)
  timings.push({
    index,
    direction: next ? 'next' : 'previous',
    elapsedMs: performance.now() - startedAt,
    pageCountText: await page.locator('.page-count-button').textContent(),
  })
}

const pageCountText = await page.locator('.page-count-button').textContent()
await browser.close()

const elapsedValues = timings.map((timing) => timing.elapsedMs)
const averageSwitchMs = elapsedValues.reduce((total, value) => total + value, 0) / Math.max(1, elapsedValues.length)
const maxSwitchMs = Math.max(0, ...elapsedValues)
const slowest = [...timings].sort((left, right) => right.elapsedMs - left.elapsedMs).slice(0, 5)
console.log(JSON.stringify({ errors, switchCount, pageCountText, averageSwitchMs, maxSwitchMs, firstSwitches: timings.slice(0, 6), slowest }, null, 2))

if (errors.length) process.exitCode = 1
if (averageSwitchMs > maxAverageSwitchMs) process.exitCode = 1
