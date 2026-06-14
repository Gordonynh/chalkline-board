import { launchHeadlessBrowser } from './playwright-browser.mjs'

const targetUrl = process.argv[2] ?? 'http://127.0.0.1:5176/?perf=1'
const label = {
  select: '\u9009\u62e9',
  pen: '\u8f6f\u7b14',
  eraser: '\u6a61\u76ae',
  laser: '\u6fc0\u5149',
  pan: '\u6f2b\u6e38',
  undo: '\u64a4\u9500',
  rotate: '\u65cb\u8f6c',
  capture: '\u62cd\u7167',
  album: '\u76f8\u518c',
  minimize: '\u6700\u5c0f\u5316',
  close: '\u5173\u95ed',
}

const byTitle = (text) => `button[title="${text}"]`
const browser = await launchHeadlessBrowser({
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
})
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } })
const errors = []
page.setDefaultNavigationTimeout(90000)
page.setDefaultTimeout(60000)

page.on('pageerror', (error) => errors.push(String(error)))

try {
  await page.addInitScript(() => {
    const makeStream = () => {
      const canvas = document.createElement('canvas')
      canvas.width = 640
      canvas.height = 480
      const context = canvas.getContext('2d')
      let frame = 0
      const paint = () => {
        if (!context) return
        context.fillStyle = '#1f2937'
        context.fillRect(0, 0, canvas.width, canvas.height)
        context.fillStyle = '#0ea5e9'
        context.fillRect(40 + (frame % 160), 60, 220, 160)
        context.fillStyle = '#f97316'
        context.beginPath()
        context.arc(420, 240, 70 + (frame % 30), 0, Math.PI * 2)
        context.fill()
        context.fillStyle = '#ffffff'
        context.font = '42px sans-serif'
        context.fillText('Visualizer', 120, 390)
        frame += 1
      }
      paint()
      window.setInterval(paint, 100)
      return canvas.captureStream(30)
    }
    const currentMediaDevices = navigator.mediaDevices ?? {}
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        ...currentMediaDevices,
        getUserMedia: async () => makeStream(),
      },
    })
  })
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded' })
  await waitForVisualizerReady(page)
  await page.waitForFunction(() => {
    const video = document.querySelector('video')
    return video instanceof HTMLVideoElement && video.videoWidth > 0 && video.videoHeight > 0
  })

  const toolbarTitles = await page.locator('.visualizer-toolbar button').evaluateAll((buttons) => buttons.map((button) => button.getAttribute('title')))
  const expectedToolbarTitles = [
    label.select,
    label.pen,
    label.eraser,
    label.laser,
    label.pan,
    label.undo,
    label.rotate,
    label.capture,
    label.album,
    label.minimize,
    label.close,
  ]
  if (JSON.stringify(toolbarTitles) !== JSON.stringify(expectedToolbarTitles)) {
    throw new Error(`visualizer toolbar titles changed: ${toolbarTitles.join(',')}`)
  }

  const frameBox = await page.locator('[data-testid="visualizer-frame"]').boundingBox()
  const canvasBox = await page.locator('[data-testid="visualizer-canvas"]').boundingBox()
  const viewportSize = page.viewportSize()
  if (!frameBox || !canvasBox) throw new Error('visualizer frame or canvas not visible')
  if (!viewportSize) throw new Error('viewport not available')
  if (Math.abs(canvasBox.width - viewportSize.width) > 1 || Math.abs(canvasBox.height - viewportSize.height) > 1) {
    throw new Error(`visualizer canvas is not fullscreen: ${canvasBox.width}x${canvasBox.height}`)
  }
  const point = (xRatio, yRatio) => ({ x: viewportSize.width * xRatio, y: viewportSize.height * yRatio })

  await verifyInterruptedToolSwitchCommitsInk(page, point)

  await page.click(byTitle(label.pen))
  await page.mouse.move(point(0.2, 0.35).x, point(0.2, 0.35).y)
  await page.mouse.down()
  for (let index = 0; index < 60; index += 1) {
    const next = point(0.2 + index / 120, 0.35 + Math.sin(index / 6) * 0.08)
    await page.mouse.move(
      next.x,
      next.y,
      { steps: 1 },
    )
  }
  await page.mouse.up()

  await page.click(byTitle(label.eraser))
  await page.mouse.move(point(0.35, 0.35).x, point(0.35, 0.35).y)
  await page.mouse.down()
  await page.mouse.move(point(0.42, 0.35).x, point(0.42, 0.35).y, { steps: 12 })
  await page.mouse.up()

  await page.click(byTitle(label.laser))
  await page.waitForFunction((laser) => document.querySelector(`button[title="${laser}"]`)?.classList.contains('active'), label.laser)
  await page.mouse.move(point(0.3, 0.5).x, point(0.3, 0.5).y)
  const hitTarget = await page.evaluate(({ x, y }) => {
    const element = document.elementFromPoint(x, y)
    return element ? { tag: element.tagName, className: element.getAttribute('class'), testId: element.getAttribute('data-testid') } : null
  }, point(0.3, 0.5))
  await page.mouse.down()
  await page.mouse.move(point(0.44, 0.52).x, point(0.44, 0.52).y, { steps: 12 })
  const laserDebug = await page.evaluate(() => window.__projectionDebug ?? null)
  if ((laserDebug?.laserPoints ?? 0) <= 1) {
    throw new Error(`visualizer laser did not receive pointer samples: ${JSON.stringify({ laserDebug, hitTarget })}`)
  }
  await page.mouse.up()

  await page.click(byTitle(label.pan))
  await page.waitForFunction((pan) => document.querySelector(`button[title="${pan}"]`)?.classList.contains('active'), label.pan)
  const transformBeforePan = await page.locator('.visualizer-content').evaluate((element) => getComputedStyle(element).transform)
  await page.mouse.move(point(0.52, 0.52).x, point(0.52, 0.52).y)
  await page.mouse.wheel(0, -240)
  await page.mouse.down()
  await page.mouse.move(point(0.62, 0.58).x, point(0.62, 0.58).y, { steps: 10 })
  await page.mouse.up()
  const transformAfterPan = await page.locator('.visualizer-content').evaluate((element) => getComputedStyle(element).transform)
  if (transformAfterPan === transformBeforePan) throw new Error('visualizer pan/zoom did not change the view transform')

  await page.click(byTitle(label.capture))
  await page.waitForSelector('.visualizer-album-panel', { timeout: 15000 })
  await page.waitForSelector('.visualizer-album-grid button', { timeout: 15000 })
  await page.click(byTitle(label.rotate))
  const transformAfterRotate = await page.locator('.visualizer-content').evaluate((element) => getComputedStyle(element).transform)
  if (transformAfterRotate === transformAfterPan) throw new Error('visualizer rotate did not change the view transform')

  const projectionDebug = await page.evaluate(() => window.__projectionDebug ?? null)
  console.log(JSON.stringify({ errors, toolbarTitles, canvas: canvasBox, frame: frameBox, projectionDebug }, null, 2))
  if (errors.length) process.exitCode = 1
} finally {
  await browser.close()
}

async function waitForVisualizerReady(page) {
  await page.waitForSelector('.visualizer-shell', { timeout: 60000 })
  await page.waitForSelector('[data-testid="visualizer-canvas"]', { state: 'attached', timeout: 60000 })
}

async function verifyInterruptedToolSwitchCommitsInk(page, point) {
  await page.click(byTitle(label.pen))
  const beforeUndoDisabled = await page.locator(byTitle(label.undo)).evaluate((button) => button.hasAttribute('disabled'))
  if (!beforeUndoDisabled) throw new Error('visualizer undo unexpectedly enabled before interrupted stroke test')

  await page.evaluate(
    ({ start, end, eraserTitle }) => {
      const canvas = document.querySelector('[data-testid="visualizer-canvas"]')
      if (!(canvas instanceof HTMLCanvasElement)) throw new Error('visualizer canvas missing for interrupted stroke test')
      const dispatch = (type, x, y) => {
        canvas.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            pointerId: 41,
            pointerType: 'pen',
            isPrimary: true,
            button: 0,
            buttons: 1,
            clientX: x,
            clientY: y,
            pressure: 0.62,
          }),
        )
      }
      dispatch('pointerdown', start.x, start.y)
      for (let index = 0; index < 12; index += 1) {
        const t = (index + 1) / 12
        dispatch('pointermove', start.x + (end.x - start.x) * t, start.y + (end.y - start.y) * t)
      }
      const eraser = document.querySelector(`button[title="${eraserTitle}"]`)
      if (!(eraser instanceof HTMLButtonElement)) throw new Error('visualizer eraser button missing for interrupted stroke test')
      eraser.click()
    },
    {
      start: point(0.18, 0.22),
      end: point(0.42, 0.26),
      eraserTitle: label.eraser,
    },
  )

  await page.waitForFunction((eraser) => document.querySelector(`button[title="${eraser}"]`)?.classList.contains('active'), label.eraser)
  await page.waitForFunction((undo) => !document.querySelector(`button[title="${undo}"]`)?.hasAttribute('disabled'), label.undo)
}
