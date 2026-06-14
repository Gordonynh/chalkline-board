import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'
import pptxgen from 'pptxgenjs'
import { launchHeadlessBrowser } from './playwright-browser.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const node = process.execPath
const viteBin = path.join('node_modules', 'vite', 'bin', 'vite.js')
const host = process.env.WHITEBOARD_PRESENTATION_HOST ?? '127.0.0.1'
const port = process.env.WHITEBOARD_PRESENTATION_PORT ?? '5181'
const url = `http://${host}:${port}/`
const maxFirstAnimationMs = Number(process.env.WHITEBOARD_PRESENTATION_MAX_ANIMATION_MS ?? 2500)
const maxSlideAdvanceMs = Number(process.env.WHITEBOARD_PRESENTATION_MAX_SLIDE_ADVANCE_MS ?? 3500)
const maxAutoPlayFirstStepMs = Number(process.env.WHITEBOARD_PRESENTATION_MAX_AUTOPLAY_FIRST_STEP_MS ?? 3200)

await assertPortIsFree(url)

const server = spawnInRoot(node, [viteBin, '--mode', 'blank', '--host', host, '--port', port, '--strictPort'], {
  stdio: ['ignore', 'pipe', 'pipe'],
})

server.stdout.on('data', (chunk) => process.stdout.write(chunk))
server.stderr.on('data', (chunk) => process.stderr.write(chunk))

let browser
const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'chalkline-presentation-gate-'))

try {
  await waitForServer(url)
  const pptxPath = path.join(tempRoot, 'presentation-gate.pptx')
  await createPptxSample(pptxPath)

  browser = await launchHeadlessBrowser()
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  const errors = []
  page.setDefaultNavigationTimeout(90000)
  page.setDefaultTimeout(60000)
  page.on('pageerror', (error) => errors.push(String(error)))

  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.whiteboard-app', { timeout: 60000 })
  await page.waitForSelector('input[type="file"][multiple]', { state: 'attached', timeout: 60000 })
  await page.locator('input[type="file"][multiple]').setInputFiles(pptxPath)
  await waitForWhiteboardPageCount(page, 3, 20000)

  await page.locator('.teaching-toolbar button').filter({ hasText: /Play|播放/ }).first().click()
  await page.waitForFunction(() => document.querySelectorAll('canvas[data-presentation-overlay="true"]').length > 0, null, { timeout: 12000 })
  await waitForPresentationNumberAtLeast(page, 'data-presentation-slide-cache-size', 2)

  const firstAnimationStarted = Date.now()
  await clickPresentationOverlay(page)
  await clickPresentationOverlay(page)
  await waitForPresentationAttribute(page, 'data-presentation-animation-click', '3')
  await waitForPresentationAttribute(page, 'data-presentation-navigation-busy', 'false')
  const firstAnimationMs = Date.now() - firstAnimationStarted
  const afterAnimationState = await currentPresentationState(page)

  const slideAdvanceStarted = Date.now()
  await page.locator('[data-presentation-action="next"]').click()
  await waitForPresentationAttribute(page, 'data-presentation-slide-index', '1')
  await waitForPresentationAttribute(page, 'data-presentation-animation-click', '0')
  await waitForPresentationAttribute(page, 'data-presentation-navigation-busy', 'false')
  const slideAdvanceMs = Date.now() - slideAdvanceStarted
  const afterSlideAdvanceState = await currentPresentationState(page)

  await page.keyboard.press('Home')
  await waitForPresentationAttribute(page, 'data-presentation-slide-index', '0')
  await waitForPresentationAttribute(page, 'data-presentation-animation-click', '0')

  const autoPlayStarted = Date.now()
  await page.locator('[data-presentation-action="autoplay"]').click()
  await waitForPresentationAttribute(page, 'data-presentation-autoplay', 'true')
  await waitForPresentationNumberAtLeast(page, 'data-presentation-animation-click', 1)
  const autoPlayFirstStepMs = Date.now() - autoPlayStarted
  const afterAutoPlayState = await currentPresentationState(page)
  await page.locator('[data-presentation-action="autoplay"]').click()
  await waitForPresentationAttribute(page, 'data-presentation-autoplay', 'false')
  const afterAutoPlayPauseState = await currentPresentationState(page)
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => document.querySelectorAll('canvas[data-presentation-overlay="true"]').length === 0, null, { timeout: 12000 })

  const result = {
    errors,
    firstAnimationMs,
    slideAdvanceMs,
    autoPlayFirstStepMs,
    afterAnimationState,
    afterSlideAdvanceState,
    afterAutoPlayState,
    afterAutoPlayPauseState,
  }
  console.log(JSON.stringify(result, null, 2))

  if (errors.length) process.exitCode = 1
  if (afterAnimationState.slideIndex !== '0' || afterAnimationState.animationClick !== '3') process.exitCode = 1
  if (afterSlideAdvanceState.slideIndex !== '1' || afterSlideAdvanceState.animationClick !== '0') process.exitCode = 1
  if (afterAutoPlayState.slideIndex !== '0' || Number(afterAutoPlayState.animationClick ?? 0) < 1) process.exitCode = 1
  if (afterAutoPlayState.autoPlaying !== 'true' || afterAutoPlayPauseState.autoPlaying !== 'false') process.exitCode = 1
  if (firstAnimationMs > maxFirstAnimationMs) process.exitCode = 1
  if (slideAdvanceMs > maxSlideAdvanceMs) process.exitCode = 1
  if (autoPlayFirstStepMs > maxAutoPlayFirstStepMs) process.exitCode = 1
} finally {
  await browser?.close().catch(() => {})
  await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {})
  stopProcessTree(server)
}

async function assertPortIsFree(targetUrl) {
  try {
    await fetch(targetUrl, { signal: AbortSignal.timeout(1000) })
    throw new Error(`Presentation gate target is already serving before Vite starts: ${targetUrl}`)
  } catch (error) {
    if (error instanceof Error && error.message.includes('already serving')) throw error
  }
}

async function waitForServer(targetUrl) {
  const deadline = Date.now() + 30000
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`Vite exited early with ${server.exitCode}`)
    try {
      const response = await fetch(targetUrl)
      if (response.ok) return
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
  }
  throw new Error(`Timed out waiting for ${targetUrl}`)
}

async function waitForWhiteboardPageCount(page, pageCount, timeout = 15000) {
  await page.waitForFunction(
    (pageCount) => {
      const text = document.querySelector('.page-count-button')?.textContent ?? ''
      return text.includes(`/${pageCount}`)
    },
    pageCount,
    { timeout },
  )
}

async function waitForPresentationAttribute(page, name, value) {
  await page.waitForFunction(
    ({ name, value }) =>
      document.querySelector('canvas[data-presentation-overlay="true"]')?.getAttribute(name) === value,
    { name, value },
    { timeout: 12000 },
  )
}

async function waitForPresentationNumberAtLeast(page, name, value) {
  await page.waitForFunction(
    ({ name, value }) => {
      const raw = document.querySelector('canvas[data-presentation-overlay="true"]')?.getAttribute(name)
      return Number(raw ?? 0) >= value
    },
    { name, value },
    { timeout: 12000 },
  )
}

async function currentPresentationState(page) {
  return page.evaluate(() => {
    const overlay = document.querySelector('canvas[data-presentation-overlay="true"]')
    return {
      slideIndex: overlay?.getAttribute('data-presentation-slide-index') ?? null,
      animationClick: overlay?.getAttribute('data-presentation-animation-click') ?? null,
      animationMax: overlay?.getAttribute('data-presentation-animation-max') ?? null,
      animationCacheSize: overlay?.getAttribute('data-presentation-animation-cache-size') ?? null,
      slideCacheSize: overlay?.getAttribute('data-presentation-slide-cache-size') ?? null,
      navigationQueueSize: overlay?.getAttribute('data-presentation-navigation-queue-size') ?? null,
      autoPlaying: overlay?.getAttribute('data-presentation-autoplay') ?? null,
    }
  })
}

async function clickPresentationOverlay(page) {
  const box = await page.locator('canvas[data-presentation-overlay="true"]').boundingBox()
  if (!box) throw new Error('presentation overlay canvas not found')
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.45)
}

async function createPptxSample(filePath) {
  const pptx = new pptxgen()
  pptx.layout = 'LAYOUT_WIDE'
  const slide1 = pptx.addSlide()
  slide1.background = { color: 'FFFFFF' }
  slide1.addShape(pptx.ShapeType.rect, {
    x: 0.8,
    y: 1.6,
    w: 4.8,
    h: 1.2,
    fill: { color: 'DFF7F4' },
    line: { color: '139F9B', width: 2 },
  })
  slide1.addShape(pptx.ShapeType.triangle, {
    x: 6.2,
    y: 1.7,
    w: 1.1,
    h: 1.1,
    fill: { color: 'F59E0B' },
    line: { color: 'B45309', width: 2 },
  })

  const slide2 = pptx.addSlide()
  slide2.background = { color: 'FFFFFF' }
  slide2.addShape(pptx.ShapeType.rect, {
    x: 1,
    y: 1,
    w: 5,
    h: 2.2,
    fill: { color: 'DBEAFE' },
    line: { color: '2563EB', width: 2 },
  })

  const slide3 = pptx.addSlide()
  slide3.background = { color: 'FFFFFF' }
  slide3.addShape(pptx.ShapeType.roundRect, {
    x: 1,
    y: 1,
    w: 5,
    h: 2.2,
    rectRadius: 0.14,
    fill: { color: 'FEE2E2' },
    line: { color: 'EF4444', width: 2 },
  })

  await pptx.writeFile({ fileName: filePath })
  await injectClickAnimation(filePath)
}

async function injectClickAnimation(filePath) {
  const buffer = await fs.readFile(filePath)
  const zip = await JSZip.loadAsync(buffer)
  const slidePath = 'ppt/slides/slide1.xml'
  const slide = zip.file(slidePath)
  if (!slide) throw new Error('generated PPTX has no slide1.xml')
  const xml = await slide.async('string')
  const shapeId = xml.match(/<p:cNvPr id="([0-9]+)" name="Shape 0"/)?.[1] ?? '2'
  const animationClick = (clickId, animationId) => [
    '<p:par>',
    `<p:cTn id="${clickId}" nodeType="clickEffect">`,
    '<p:childTnLst>',
    '<p:animEffect type="in" filter="fade">',
    '<p:cBhvr>',
    `<p:cTn id="${animationId}" dur="450"/>`,
    `<p:tgt><p:spTgt spid="${shapeId}"/></p:tgt>`,
    '</p:cBhvr>',
    '</p:animEffect>',
    '</p:childTnLst>',
    '</p:cTn>',
    '</p:par>',
  ].join('')
  const timing = [
    '<p:timing>',
    '<p:tnLst>',
    '<p:seq>',
    '<p:cTn id="1" dur="indefinite" nodeType="mainSeq"/>',
    '<p:childTnLst>',
    animationClick(3, 4),
    animationClick(5, 6),
    '</p:childTnLst>',
    '</p:seq>',
    '</p:tnLst>',
    '</p:timing>',
  ].join('')
  zip.file(slidePath, xml.replace('</p:sld>', `${timing}</p:sld>`))
  await fs.writeFile(filePath, await zip.generateAsync({ type: 'nodebuffer' }))
}

function spawnInRoot(command, args, options) {
  if (process.platform !== 'win32') {
    return spawn(command, args, { cwd: root, ...options })
  }
  if (!root.startsWith('\\\\')) {
    return spawn(command, args, { cwd: root, ...options })
  }
  return spawn('cmd.exe', ['/d', '/c', `pushd ${quotePushdPath(root)} && ${quoteCmd(command)} ${args.map(quoteCmd).join(' ')}`], {
    cwd: process.env.SystemRoot ?? 'C:\\Windows',
    ...options,
  })
}

function stopProcessTree(child) {
  if (process.platform === 'win32' && child.pid) {
    spawn('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' })
    return
  }
  child.kill()
}

function quoteCmd(value) {
  const raw = String(value)
  return /\s|"/.test(raw) ? `"${raw.replaceAll('"', '""')}"` : raw.replace(/[&|<>^]/g, '^$&')
}

function quotePushdPath(value) {
  const pathValue = String(value)
  return pathValue.startsWith('\\\\') && !pathValue.includes(' ') ? pathValue : quoteCmd(pathValue)
}
