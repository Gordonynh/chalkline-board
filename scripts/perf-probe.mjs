import { chromium } from '@playwright/test'

const targetUrl = process.argv[2] ?? 'http://127.0.0.1:5175/?perf=1'
const moveCount = Number(process.env.WHITEBOARD_PERF_MOVES ?? 160)
const strokeCount = Number(process.env.WHITEBOARD_PERF_STROKES ?? 1)
const maxAverageLiveDrawMs = Number(process.env.WHITEBOARD_PERF_MAX_AVG_LIVE_DRAW_MS ?? Number.POSITIVE_INFINITY)
const maxAverageInputToDrawMs = Number(process.env.WHITEBOARD_PERF_MAX_AVG_INPUT_TO_DRAW_MS ?? Number.POSITIVE_INFINITY)
const maxAverageCommittedRenderMs = Number(
  process.env.WHITEBOARD_PERF_MAX_AVG_COMMITTED_RENDER_MS ?? Number.POSITIVE_INFINITY,
)

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
const errors = []

page.on('pageerror', (error) => errors.push(String(error)))

await page.goto(targetUrl, { waitUntil: 'networkidle' })
await page.waitForSelector('.board-stage canvas', { timeout: 15000 })
await page.evaluate(() => window.__whiteboardPerf?.reset())

for (let stroke = 0; stroke < strokeCount; stroke += 1) {
  const startX = 220
  const startY = 220 + stroke * 42
  await page.mouse.move(startX, startY)
  await page.mouse.down()
  for (let i = 0; i < moveCount; i += 1) {
    await page.mouse.move(startX + i * 3, startY + Math.sin(i / 8) * 28, { steps: 1 })
  }
  await page.mouse.up()
}
await page.waitForTimeout(250)

const stats = await page.evaluate(() => window.__whiteboardPerf?.snapshot())
await browser.close()

console.log(JSON.stringify({ errors, moveCount, strokeCount, stats }, null, 2))

if (errors.length) process.exitCode = 1
if (!stats?.liveDraws) process.exitCode = 1
if (stats?.averageLiveDrawMs > maxAverageLiveDrawMs) process.exitCode = 1
if (stats?.averageInputToDrawMs > maxAverageInputToDrawMs) process.exitCode = 1
if (stats?.averageCommittedRenderMs > maxAverageCommittedRenderMs) process.exitCode = 1
