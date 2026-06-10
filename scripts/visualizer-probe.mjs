import { chromium } from '@playwright/test'

const targetUrl = process.argv[2] ?? 'http://127.0.0.1:5176/?perf=1'
const maxAverageFirstDrawMs = Number(process.env.VISUALIZER_MAX_AVG_FIRST_DRAW_MS ?? 16)
const maxAverageLiveDrawMs = Number(process.env.VISUALIZER_MAX_AVG_LIVE_DRAW_MS ?? 8)
const maxAverageCaptureMs = Number(process.env.VISUALIZER_MAX_AVG_CAPTURE_MS ?? 350)
const maxAverageCompositionMs = Number(process.env.VISUALIZER_MAX_AVG_COMPOSITION_MS ?? 500)
const moveCount = Number(process.env.VISUALIZER_MOVES ?? 120)

const label = {
  projector: '\u5c55\u53f0',
  select: '\u9009\u62e9',
  pen: '\u6279\u6ce8',
  eraser: '\u6a61\u76ae',
  pan: '\u6f2b\u6e38',
  undo: '\u64a4\u9500',
  redo: '\u91cd\u505a',
  capture: '\u62cd\u7167',
  album: '\u76f8\u518c',
  tools: '\u5de5\u5177',
  rotate: '\u65cb\u8f6c',
  insert: '\u63d2\u5165\u767d\u677f',
  minimize: '\u6700\u5c0f\u5316',
  close: '\u9000\u51fa',
  camera: '\u6444\u50cf\u5934',
  photo: '\u7167\u7247',
  captured: '\u5df2\u62cd\u7167',
}

const byTitle = (text) => `button[title="${text}"]`
const byButtonText = (text) => `button:has-text("${text}")`

const browser = await chromium.launch({
  headless: true,
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
})
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } })
const errors = []

page.on('pageerror', (error) => errors.push(String(error)))

try {
  await page.goto(targetUrl, { waitUntil: 'networkidle' })
  await page.waitForSelector(byTitle(label.projector), { timeout: 15000 })
  await page.click(byTitle(label.projector))
  await page.waitForSelector('.visualizer-shell', { timeout: 15000 })
  await page.waitForFunction(() => {
    const video = document.querySelector('video')
    return video instanceof HTMLVideoElement && video.videoWidth > 0 && video.videoHeight > 0
  })
  const initialTransform = await page.locator('.visualizer-content').evaluate((element) => getComputedStyle(element).transform)
  const initialFrameBox = await page.locator('[data-testid="visualizer-frame"]').boundingBox()
  const viewport = page.viewportSize()
  if (!initialFrameBox || !viewport) throw new Error('visualizer frame or viewport not available')
  if (Math.abs(initialFrameBox.x) > 1 || Math.abs(initialFrameBox.y) > 1) throw new Error('visualizer frame is not aligned to fullscreen origin')
  if (Math.abs(initialFrameBox.width - viewport.width) > 1 || Math.abs(initialFrameBox.height - viewport.height) > 1) {
    throw new Error(`visualizer frame is not fullscreen: ${initialFrameBox.width}x${initialFrameBox.height}`)
  }
  await page.waitForTimeout(900)
  const stableTransform = await page.locator('.visualizer-content').evaluate((element) => getComputedStyle(element).transform)
  if (stableTransform !== initialTransform) throw new Error('visualizer camera view drifted after initial metadata fit')

  const toolbarTitles = await page.locator('.visualizer-toolbar button').evaluateAll((buttons) => buttons.map((button) => button.getAttribute('title')))
  const expectedToolbarTitles = [
    label.pen,
    label.eraser,
    label.rotate,
    label.capture,
    label.insert,
    label.album,
    label.tools,
    label.minimize,
    label.close,
  ]
  if (JSON.stringify(toolbarTitles) !== JSON.stringify(expectedToolbarTitles)) {
    throw new Error(`visualizer toolbar titles changed: ${toolbarTitles.join(',')}`)
  }

  await page.click(byTitle(label.capture))
  await page.waitForFunction((captured) => document.querySelector('.visualizer-status')?.textContent?.includes(captured), label.captured)
  await page.waitForSelector('.visualizer-album-panel', { timeout: 15000 })
  await page.waitForSelector('.visualizer-album-grid button', { timeout: 15000 })
  const transformAfterCapture = await page.locator('.visualizer-content').evaluate((element) => getComputedStyle(element).transform)
  if (transformAfterCapture !== stableTransform) throw new Error('visualizer switched away from camera after capture')

  if ((await page.locator('.visualizer-album-actions').count()) !== 0) throw new Error('visualizer album still exposes import/camera actions')
  await page.click('.visualizer-album-grid button')
  await page.waitForFunction((photo) => document.querySelector('.visualizer-status')?.textContent?.includes(photo), label.photo)

  await page.click(byTitle(label.tools))
  await page.click(byButtonText(label.pan))
  const transformBeforePan = await page.locator('.visualizer-content').evaluate((element) => getComputedStyle(element).transform)
  const frameBox = await page.locator('[data-testid="visualizer-frame"]').boundingBox()
  if (!frameBox) throw new Error('visualizer frame not visible')
  await page.mouse.move(frameBox.x + frameBox.width * 0.5, frameBox.y + frameBox.height * 0.5)
  await page.mouse.wheel(0, -260)
  await page.mouse.down()
  await page.mouse.move(frameBox.x + frameBox.width * 0.58, frameBox.y + frameBox.height * 0.56, { steps: 8 })
  await page.mouse.up()
  const transformAfterPan = await page.locator('.visualizer-content').evaluate((element) => getComputedStyle(element).transform)
  if (transformAfterPan === transformBeforePan) throw new Error('visualizer pan/zoom did not change the view transform')
  await page.mouse.move(frameBox.x + 4, frameBox.y + 4)
  await page.mouse.down()
  await page.mouse.move(Math.max(0, frameBox.x - 60), Math.max(0, frameBox.y - 40), { steps: 8 })
  await page.mouse.up()
  const transformAfterCapturedPan = await page.locator('.visualizer-content').evaluate((element) => getComputedStyle(element).transform)
  if (transformAfterCapturedPan === transformAfterPan) throw new Error('visualizer pan did not continue from frame edge with pointer capture')
  await page.click(byTitle(label.pen))

  const box = await page.locator('[data-testid="visualizer-canvas"]').boundingBox()
  if (!box) throw new Error('visualizer canvas not visible')
  await page.mouse.move(box.x + box.width * 0.22, box.y + box.height * 0.38)
  await page.mouse.down()
  for (let index = 0; index < moveCount; index += 1) {
    await page.mouse.move(
      box.x + box.width * (0.22 + (index / moveCount) * 0.56),
      box.y + box.height * (0.38 + Math.sin(index / 8) * 0.12),
      { steps: 1 },
    )
  }
  await page.mouse.up()

  await page.click(byTitle(label.tools))
  await page.click(byButtonText(label.select))
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.38)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * 0.56, box.y + box.height * 0.46, { steps: 8 })
  await page.mouse.up()

  await page.click(byTitle(label.rotate))
  await page.click(byTitle(label.insert))
  await page.waitForSelector('.visualizer-shell', { state: 'detached', timeout: 15000 })
  await page.waitForTimeout(250)

  const stats = await page.evaluate(() => window.__visualizerPerf?.snapshot())
  const pageCountText = await page.locator('.page-count-button').textContent()
  console.log(JSON.stringify({ errors, moveCount, pageCountText, stats }, null, 2))

  if (errors.length) process.exitCode = 1
  if (!stats?.firstDraws || !stats.liveDraws || !stats.captures || !stats.compositions) process.exitCode = 1
  if (stats?.averageFirstInputToDrawMs > maxAverageFirstDrawMs) process.exitCode = 1
  if (stats?.averageLiveDrawMs > maxAverageLiveDrawMs) process.exitCode = 1
  if (stats?.averageCaptureMs > maxAverageCaptureMs) process.exitCode = 1
  if (stats?.averageCompositionMs > maxAverageCompositionMs) process.exitCode = 1
} finally {
  await browser.close()
}
