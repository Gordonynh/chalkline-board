import { launchHeadlessBrowser } from './playwright-browser.mjs'

const targetUrl = process.argv[2] ?? 'http://127.0.0.1:5175/?perf=1'
const moveCount = Number(process.env.WHITEBOARD_PERF_MOVES ?? 160)
const strokeCount = Number(process.env.WHITEBOARD_PERF_STROKES ?? 1)
const maxAverageLiveDrawMs = Number(process.env.WHITEBOARD_PERF_MAX_AVG_LIVE_DRAW_MS ?? Number.POSITIVE_INFINITY)
const maxAverageInputToDrawMs = Number(process.env.WHITEBOARD_PERF_MAX_AVG_INPUT_TO_DRAW_MS ?? Number.POSITIVE_INFINITY)
const maxAverageCommittedRenderMs = Number(
  process.env.WHITEBOARD_PERF_MAX_AVG_COMMITTED_RENDER_MS ?? Number.POSITIVE_INFINITY,
)

const browser = await launchHeadlessBrowser()
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
const errors = []
page.setDefaultNavigationTimeout(90000)
page.setDefaultTimeout(60000)

page.on('pageerror', (error) => errors.push(String(error)))

await page.goto(targetUrl, { waitUntil: 'domcontentloaded' })
await waitForWhiteboardReady(page)
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
const interruptedSwitch = await verifyToolSwitchCommitsActiveStroke(page)
await browser.close()

console.log(JSON.stringify({ errors, moveCount, strokeCount, stats, interruptedSwitch }, null, 2))

if (errors.length) process.exitCode = 1
if (!stats?.liveDraws) process.exitCode = 1
if (stats?.averageLiveDrawMs > maxAverageLiveDrawMs) process.exitCode = 1
if (stats?.averageInputToDrawMs > maxAverageInputToDrawMs) process.exitCode = 1
if (stats?.averageCommittedRenderMs > maxAverageCommittedRenderMs) process.exitCode = 1
if (!interruptedSwitch.ok) process.exitCode = 1

async function waitForWhiteboardReady(page) {
  await page.waitForSelector('.whiteboard-app', { timeout: 60000 })
  await page.waitForSelector('.board-stage canvas', { state: 'attached', timeout: 60000 })
}

async function verifyToolSwitchCommitsActiveStroke(page) {
  await page.evaluate(() => window.__whiteboardPerf?.reset())
  await page.evaluate(() => {
    const stage = document.querySelector('.konvajs-content')
    if (!(stage instanceof HTMLElement)) throw new Error('board stage not found for interrupted switch')
    const bounds = stage.getBoundingClientRect()
    const pointerId = 90001
    const startX = bounds.left + bounds.width * 0.35
    const startY = bounds.top + bounds.height * 0.35
    dispatchPointer(stage, 'pointerdown', startX, startY, pointerId, 0.7)
    for (let index = 1; index <= 20; index += 1) {
      dispatchPointer(stage, 'pointerrawupdate', startX + index * 4, startY + Math.sin(index / 3) * 12, pointerId, 0.7)
      dispatchPointer(stage, 'pointermove', startX + index * 4, startY + Math.sin(index / 3) * 12, pointerId, 0.7)
    }
    const eraserButton = Array.from(document.querySelectorAll('button')).find((button) => {
      const text = button.textContent ?? ''
      const title = button.getAttribute('title') ?? ''
      return text.includes('\u6a61\u76ae') || title.includes('\u6a61\u76ae') || /eraser/i.test(text) || /eraser/i.test(title)
    })
    if (!(eraserButton instanceof HTMLButtonElement)) throw new Error('eraser button was not found')
    eraserButton.click()

    function dispatchPointer(target, type, clientX, clientY, pointerId, pressure) {
      target.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          clientX,
          clientY,
          pointerId,
          pointerType: 'pen',
          isPrimary: true,
          pressure,
          buttons: 1,
          button: type === 'pointerdown' ? 0 : -1,
        }),
      )
    }
  })
  await page.waitForTimeout(250)
  const result = await page.evaluate(() => {
    const stats = window.__whiteboardPerf?.snapshot()
    const eraserActive = Array.from(document.querySelectorAll('button')).some((button) => {
      const text = button.textContent ?? ''
      const title = button.getAttribute('title') ?? ''
      const isEraser = text.includes('\u6a61\u76ae') || title.includes('\u6a61\u76ae') || /eraser/i.test(text) || /eraser/i.test(title)
      return isEraser && (button.classList.contains('active') || button.getAttribute('aria-pressed') === 'true')
    })
    return {
      stats,
      eraserActive,
      ok: Boolean(stats && stats.committedRenders > 0 && eraserActive),
    }
  })
  return result
}
