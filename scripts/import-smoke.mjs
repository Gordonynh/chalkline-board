import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import pptxgen from 'pptxgenjs'
import JSZip from 'jszip'
import { jsPDF } from 'jspdf'
import { launchHeadlessBrowser } from './playwright-browser.mjs'

const root = path.resolve('dist')
const port = 5187
const baseUrl = `http://127.0.0.1:${port}/`
const maxPresentationAnimationMs = Number(process.env.WHITEBOARD_PRESENTATION_MAX_ANIMATION_MS ?? 2500)
const maxPresentationSlideAdvanceMs = Number(process.env.WHITEBOARD_PRESENTATION_MAX_SLIDE_ADVANCE_MS ?? 3500)
const maxPresentationRapidClickMs = Number(process.env.WHITEBOARD_PRESENTATION_MAX_RAPID_CLICK_MS ?? 3500)
const maxPresentationAutoPlayFirstStepMs = Number(process.env.WHITEBOARD_PRESENTATION_MAX_AUTOPLAY_FIRST_STEP_MS ?? 3200)

async function waitForServer(process, timeoutMs = 12000) {
  const started = Date.now()
  let output = ''
  process.stdout.on('data', (chunk) => {
    output += String(chunk)
  })
  process.stderr.on('data', (chunk) => {
    output += String(chunk)
  })

  while (Date.now() - started < timeoutMs) {
    if (process.exitCode !== null) {
      throw new Error(`static server exited early with ${process.exitCode}\n${output}`)
    }
    try {
      const response = await fetch(baseUrl)
      if (response.ok) return
    } catch {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 120))
  }

  throw new Error(`static server did not start\n${output}`)
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

async function waitForWhiteboardReady(page, timeout = 15000) {
  await page.waitForSelector('.status-bar', { timeout })
  await page.waitForFunction(() => document.querySelector('.whiteboard-app') !== null, null, { timeout })
}

async function main() {
  await assertPortIsFree(baseUrl)

  const server = spawn(process.execPath, ['scripts/static-server.mjs', root, String(port)], {
    cwd: process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })

  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'chalkline-import-smoke-'))
  const sampleFiles = [
    path.join(tempRoot, 'sample.txt'),
    path.join(tempRoot, 'sample.csv'),
    path.join(tempRoot, 'sample.json'),
    path.join(tempRoot, 'sample.docx'),
    path.join(tempRoot, 'sample.xlsx'),
    path.join(tempRoot, 'sample.docm'),
    path.join(tempRoot, 'sample.xlsm'),
    path.join(tempRoot, 'sample.pdf'),
    path.join(tempRoot, 'sample.png'),
    path.join(tempRoot, 'sample.jpg'),
    path.join(tempRoot, 'sample.webp'),
    path.join(tempRoot, 'sample.bmp'),
    path.join(tempRoot, 'sample.md'),
    path.join(tempRoot, 'sample.html'),
    path.join(tempRoot, 'sample.xml'),
    path.join(tempRoot, 'sample.log'),
    path.join(tempRoot, 'vector.svg'),
    path.join(tempRoot, 'sample.tsv'),
    path.join(tempRoot, 'template.dotm'),
    path.join(tempRoot, 'template.xltm'),
    path.join(tempRoot, 'rich.rtf'),
    path.join(tempRoot, 'open.odt'),
    path.join(tempRoot, 'open.ods'),
    path.join(tempRoot, 'sample.gif'),
    path.join(tempRoot, 'sample.avif'),
  ]
  const pptxPath = path.join(tempRoot, 'sample.pptx')
  const pptmPath = path.join(tempRoot, 'sample.pptm')
  const legacyPptPath = path.join(tempRoot, 'legacy.ppt')
  const legacyPpsPath = path.join(tempRoot, 'legacy.pps')
  const legacyPotPath = path.join(tempRoot, 'legacy.pot')
  const legacyDocPath = path.join(tempRoot, 'legacy.doc')
  const legacyDotPath = path.join(tempRoot, 'legacy.dot')
  const legacyXlsPath = path.join(tempRoot, 'legacy.xls')
  const ppsxPath = path.join(tempRoot, 'sample.ppsx')
  const ppsmPath = path.join(tempRoot, 'sample.ppsm')
  const potxPath = path.join(tempRoot, 'sample.potx')
  const potmPath = path.join(tempRoot, 'sample.potm')
  const odpPath = path.join(tempRoot, 'sample.odp')
  const corruptDocxPath = path.join(tempRoot, 'corrupt.docx')
  const corruptPdfPath = path.join(tempRoot, 'corrupt.pdf')
  const corruptPptxPath = path.join(tempRoot, 'corrupt.pptx')
  const largePdfPath = path.join(tempRoot, 'large-page.pdf')
  const streamingPdfPath = path.join(tempRoot, 'streaming.pdf')
  const streamingDocxPath = path.join(tempRoot, 'streaming.docx')
  const streamingTextPath = path.join(tempRoot, 'streaming.txt')
  const notePath = path.join(tempRoot, 'sample.owbn')
  const noteJsonPath = path.join(tempRoot, 'sample-note.json')
  const textNotePath = path.join(tempRoot, 'text-note.owbn')
  const bulkTextPaths = Array.from({ length: 40 }, (_value, index) =>
    path.join(tempRoot, `bulk-${String(index + 1).padStart(2, '0')}.txt`),
  )
  let browser = null

  try {
    await Promise.all([
      fs.writeFile(sampleFiles[0], 'OpenWhiteboard import smoke test\nText file page.', 'utf8'),
      fs.writeFile(sampleFiles[1], 'name,score,note\nalpha,95,"keeps, comma"\nbeta,88,plain', 'utf8'),
      fs.writeFile(sampleFiles[2], '{\n  "kind": "json",\n  "ok": true\n}\n', 'utf8'),
      fs.writeFile(sampleFiles[12], '# Markdown import\n\n- alpha\n- beta\n', 'utf8'),
      fs.writeFile(sampleFiles[13], '<!doctype html><html><body><h1>HTML import</h1><table><tr><th>kind</th><th>status</th></tr><tr><td>rendered</td><td>visible</td></tr></table><script>throw new Error("script should not run")</script></body></html>', 'utf8'),
      fs.writeFile(sampleFiles[14], '<?xml version="1.0"?><root><item>XML import smoke test</item></root>', 'utf8'),
      fs.writeFile(sampleFiles[15], '2026-06-12 10:00:00 INFO Log import smoke test\n', 'utf8'),
      fs.writeFile(sampleFiles[16], '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="90" onload="throw new Error(&quot;svg onload should not run&quot;)"><script>throw new Error("svg script should not run")</script><rect width="160" height="90" fill="#fff"/><image href="https://example.invalid/blocked.png" width="10" height="10"/><circle cx="80" cy="45" r="30" fill="#0f7bff"/></svg>', 'utf8'),
      fs.writeFile(sampleFiles[17], 'topic\tstatus\nTSV import\tvisible', 'utf8'),
      fs.writeFile(sampleFiles[20], '{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 Arial;}}\\b RTF import smoke\\b0\\par Plain classroom notes\\par Formula: x^2 + y^2 = 1}', 'utf8'),
      fs.writeFile(legacyPptPath, 'legacy powerpoint placeholder for webview conversion request smoke', 'utf8'),
      fs.writeFile(legacyPpsPath, 'legacy powerpoint show placeholder for webview conversion request smoke', 'utf8'),
      fs.writeFile(legacyPotPath, 'legacy powerpoint template placeholder for webview conversion request smoke', 'utf8'),
      fs.writeFile(legacyDocPath, 'legacy word placeholder for webview conversion request smoke', 'utf8'),
      fs.writeFile(legacyDotPath, 'legacy word template placeholder for webview conversion request smoke', 'utf8'),
      fs.writeFile(legacyXlsPath, 'legacy excel placeholder for webview conversion request smoke', 'utf8'),
      fs.writeFile(corruptDocxPath, 'not a valid docx package', 'utf8'),
      fs.writeFile(corruptPdfPath, 'not a valid pdf document', 'utf8'),
      fs.writeFile(corruptPptxPath, 'not a valid pptx package', 'utf8'),
      fs.writeFile(
        streamingTextPath,
        Array.from({ length: 160 }, (_value, index) => `Streaming text line ${index + 1}: progressive append should stay responsive.`).join('\n'),
        'utf8',
      ),
      ...bulkTextPaths.map((filePath, index) =>
        fs.writeFile(filePath, `Bulk import page ${index + 1}\nThis checks responsive multi-file imports.`, 'utf8'),
      ),
    ])
    await createDocxSample(sampleFiles[3])
    await createStreamingDocxSample(streamingDocxPath)
    await createXlsxSample(sampleFiles[4])
    await createDocxSample(sampleFiles[5])
    await createXlsxSample(sampleFiles[6])
    await createDocxSample(sampleFiles[18])
    await createXlsxSample(sampleFiles[19])
    await createOdtSample(sampleFiles[21])
    await createOdsSample(sampleFiles[22])
    await createPdfSample(sampleFiles[7])
    await createLargePdfSample(largePdfPath)
    await createStreamingPdfSample(streamingPdfPath)
    await createPngSample(sampleFiles[8])
    await createBmpSample(sampleFiles[11])
    await createGifSample(sampleFiles[23])
    await createAvifSample(sampleFiles[24])
    await createPptxSample(pptxPath)
    await createOdpSample(odpPath)
    await createNoteSample(notePath)
    await createNoteSample(noteJsonPath)
    await createTextNoteSample(textNotePath)
    await fs.copyFile(pptxPath, pptmPath)
    await fs.copyFile(pptxPath, ppsxPath)
    await fs.copyFile(pptxPath, ppsmPath)
    await fs.copyFile(pptxPath, potxPath)
    await fs.copyFile(pptxPath, potmPath)
    console.log('sample files ready')

    await waitForServer(server)
    console.log('static server ready')

    browser = await launchHeadlessBrowser()
    console.log('browser ready')
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
    page.setDefaultNavigationTimeout(90000)
    page.setDefaultTimeout(60000)
    await createBrowserImageSample(page, sampleFiles[9], 'image/jpeg')
    await createBrowserImageSample(page, sampleFiles[10], 'image/webp')
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text())
    })

    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' })
    await installSmokeHelpers(page)
    console.log('page loaded')
    await page.locator('input[type="file"][multiple]').setInputFiles([...sampleFiles, corruptDocxPath, corruptPdfPath, corruptPptxPath])
    await waitForWhiteboardPageCount(page, 28)
    await page.waitForFunction(
      () => (document.querySelector('.status-bar')?.textContent ?? '').includes('failed 3 unreadable file'),
      null,
      { timeout: 20000 },
    )

    const result = await page.evaluate(() => ({
      pageCount: document.querySelector('.page-count-button')?.textContent?.trim() ?? '',
      importVisible: document.querySelectorAll('input[type="file"][multiple]').length === 1,
      fileInputs: Array.from(document.querySelectorAll('input[type="file"]')).map((input) => input.getAttribute('accept')),
      statusText: document.querySelector('.status-bar')?.textContent ?? '',
    }))

    if (errors.length) {
      throw new Error(`browser errors:\n${errors.join('\n')}`)
    }
    if (!result.importVisible || !result.pageCount.includes('/28')) {
      throw new Error(`unexpected import result: ${JSON.stringify(result)}`)
    }
    if (!result.statusText.includes('Imported 28 pages') || !result.statusText.includes('failed 3 unreadable file')) {
      throw new Error(`corrupt file was not reported without blocking the batch: ${JSON.stringify(result)}`)
    }
    const firstImportProject = await waitForStoredBlankProjectMinPages(page, 28)
    const docxPages = firstImportProject.pages.filter((item) => item.image?.width === 1240 && item.image?.height === 1754)
    if (docxPages.length < 4 || !docxPages.some((page) => page.image?.name === 'template-001.jpg')) {
      throw new Error(`DOCX/DOCM/HTML imports were not rendered as paged document images: ${JSON.stringify(docxPages.map((item) => item.image))}`)
    }
    const spreadsheetPages = firstImportProject.pages.filter((page) =>
      page.image?.name?.startsWith('sample-') || page.image?.name?.startsWith('template-'),
    )
    if (
      !spreadsheetPages.some((page) => page.image?.name === 'sample-CSV-001.jpg' && page.image.width === 1440) ||
      !spreadsheetPages.some((page) => page.image?.name === 'sample-TSV-001.jpg' && page.image.height === 900) ||
      !spreadsheetPages.some((page) => page.image?.name === 'sample-Sheet1-001.jpg' && page.image.width === 1440) ||
      !spreadsheetPages.some((page) => page.image?.name === 'sample-Review-001.jpg' && page.image.height === 900) ||
      !spreadsheetPages.some((page) => page.image?.name === 'template-Sheet1-001.jpg' && page.image.width === 1440) ||
      !spreadsheetPages.some((page) => page.image?.name === 'template-Review-001.jpg' && page.image.height === 900)
    ) {
      throw new Error(`spreadsheet and delimited text files did not import as table pages: ${JSON.stringify(spreadsheetPages.map((page) => page.image))}`)
    }
    const svgPage = firstImportProject.pages.find((page) => page.image?.name === 'vector-001.jpg')
    if (!svgPage?.image || svgPage.image.width !== 160 || svgPage.image.height !== 90 || !svgPage.image.src.startsWith('data:image/jpeg')) {
      throw new Error(`SVG import was not sanitized and rasterized correctly: ${JSON.stringify(svgPage?.image)}`)
    }
    const gifPage = firstImportProject.pages.find((page) => page.image?.name === 'sample.gif')
    if (!gifPage?.image || gifPage.image.width !== 2 || gifPage.image.height !== 2 || !gifPage.image.src.startsWith('data:image/gif')) {
      throw new Error(`GIF import did not preserve image data: ${JSON.stringify(gifPage?.image)}`)
    }
    const avifPage = firstImportProject.pages.find((page) => page.image?.name === 'sample.avif')
    if (!avifPage?.image || avifPage.image.width !== 8 || avifPage.image.height !== 8 || !avifPage.image.src.startsWith('data:image/avif')) {
      throw new Error(`AVIF import did not preserve image data: ${JSON.stringify(avifPage?.image)}`)
    }
    const rtfPage = firstImportProject.pages.find((page) => page.image?.name === 'rich-001.jpg')
    if (!rtfPage?.image || rtfPage.image.width !== 1280 || rtfPage.image.height !== 720) {
      throw new Error(`RTF import did not fall back to a rendered text page: ${JSON.stringify(rtfPage?.image)}`)
    }
    const odtPage = firstImportProject.pages.find((page) => page.image?.name === 'open-001.jpg')
    if (!odtPage?.image || odtPage.image.width !== 1280 || odtPage.image.height !== 720) {
      throw new Error(`ODT import did not fall back to a rendered text page: ${JSON.stringify(odtPage?.image)}`)
    }
    const odsPage = firstImportProject.pages.find((page) => page.image?.name === 'open-Data-001.jpg')
    if (!odsPage?.image || odsPage.image.width !== 1440 || odsPage.image.height !== 900) {
      throw new Error(`ODS import did not fall back to a rendered spreadsheet page: ${JSON.stringify(odsPage?.image)}`)
    }

    await resetWhiteboardStorage(page)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await installSmokeHelpers(page)
    const bulkImportStarted = Date.now()
    await page.locator('input[type="file"][multiple]').setInputFiles(bulkTextPaths)
    await waitForWhiteboardPageCount(page, bulkTextPaths.length, 30000)
    const bulkImportProject = await waitForStoredBlankProjectMinPages(page, bulkTextPaths.length)
    const bulkImportElapsedMs = Date.now() - bulkImportStarted
    const bulkTextImageCount = bulkImportProject.pages.filter((page) => /^bulk-\d{2}-001\.jpg$/.test(page.image?.name ?? '')).length
    const bulkImportResult = {
      pageCount: await page.locator('.page-count-button').textContent(),
      bulkTextImageCount,
      bulkImportElapsedMs,
    }
    if (bulkTextImageCount !== bulkTextPaths.length) {
      throw new Error(`bulk text import dropped files: ${JSON.stringify(bulkImportResult)}`)
    }

    const acceptedFormats = result.fileInputs.join(',')
    for (const extension of [
      '.ppt', '.pps', '.pot', '.pptx', '.pptm', '.ppsx', '.ppsm', '.potx', '.potm', '.odp',
      '.doc', '.dot', '.rtf', '.docx', '.docm', '.dotx', '.dotm', '.odt',
      '.xls', '.xlsx', '.xlsm', '.xltx', '.xltm', '.ods',
      '.html', '.htm', '.xml', '.log', '.svg', '.bmp', '.gif', '.avif', '.owbn',
    ]) {
      if (!acceptedFormats.includes(extension)) {
        throw new Error(`missing import accept extension: ${extension}`)
      }
    }
    console.log('text-like import passed')

    await resetWhiteboardStorage(page)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.locator('input[type="file"][multiple]').setInputFiles(largePdfPath)
    const largePdfProject = await waitForStoredProjectWithImage(page, 'large-page-001.jpg')
    const largePdfPage = largePdfProject.pages.find((item) => item.image?.name === 'large-page-001.jpg')
    if (!largePdfPage?.image || Math.max(largePdfPage.image.width, largePdfPage.image.height) > 2200) {
      throw new Error(`large PDF import was not bounded: ${JSON.stringify(largePdfPage?.image)}`)
    }
    console.log('large PDF import bound passed')

    await resetWhiteboardStorage(page)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.evaluate(() => { window.__openWhiteboardImportEvents = [] })
    await page.locator('input[type="file"][multiple]').setInputFiles(streamingPdfPath)
    await waitForWhiteboardPageCount(page, 2, 20000)
    const streamingPdfEvents = await page.evaluate(() => window.__openWhiteboardImportEvents ?? [])
    const streamingPdfPageEvents = streamingPdfEvents.filter((event) => event.pageNames?.some((name) => /^streaming-\d{3}\.jpg$/.test(name)))
    if (
      streamingPdfPageEvents.length !== 2 ||
      !streamingPdfPageEvents.every((event) => event.fileName === 'streaming.pdf') ||
      !streamingPdfPageEvents.every((event) => event.appendedPages === 1) ||
      !streamingPdfPageEvents.some((event) => event.pageNames.includes('streaming-001.jpg')) ||
      !streamingPdfPageEvents.some((event) => event.pageNames.includes('streaming-002.jpg'))
    ) {
      throw new Error(`PDF import was not appended one rendered page at a time: ${JSON.stringify(streamingPdfEvents)}`)
    }
    console.log('streaming PDF import passed')

    await resetWhiteboardStorage(page)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.evaluate(() => { window.__openWhiteboardImportEvents = [] })
    await page.locator('input[type="file"][multiple]').setInputFiles(streamingDocxPath)
    await waitForWhiteboardPageCount(page, 2, 20000)
    const streamingDocxEvents = await page.evaluate(() => window.__openWhiteboardImportEvents ?? [])
    const streamingDocxPageEvents = streamingDocxEvents.filter((event) => event.pageNames?.some((name) => /^streaming-\d{3}\.jpg$/.test(name)))
    if (
      streamingDocxPageEvents.length < 2 ||
      !streamingDocxPageEvents.every((event) => event.fileName === 'streaming.docx') ||
      !streamingDocxPageEvents.every((event) => event.appendedPages === 1) ||
      !streamingDocxPageEvents.some((event) => event.pageNames.includes('streaming-001.jpg')) ||
      !streamingDocxPageEvents.some((event) => event.pageNames.includes('streaming-002.jpg'))
    ) {
      throw new Error(`DOCX import was not appended one rendered page at a time: ${JSON.stringify(streamingDocxEvents)}`)
    }
    console.log('streaming DOCX import passed')

    await resetWhiteboardStorage(page)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.evaluate(() => { window.__openWhiteboardImportEvents = [] })
    await page.locator('input[type="file"][multiple]').setInputFiles(sampleFiles[4])
    await waitForWhiteboardPageCount(page, 2, 20000)
    const streamingXlsxEvents = await page.evaluate(() => window.__openWhiteboardImportEvents ?? [])
    const streamingXlsxPageEvents = streamingXlsxEvents.filter((event) => event.pageNames?.some((name) => /^sample-(Sheet1|Review)-001\.jpg$/.test(name)))
    if (
      streamingXlsxPageEvents.length !== 2 ||
      !streamingXlsxPageEvents.every((event) => event.fileName === 'sample.xlsx') ||
      !streamingXlsxPageEvents.every((event) => event.appendedPages === 1) ||
      !streamingXlsxPageEvents.some((event) => event.pageNames.includes('sample-Sheet1-001.jpg')) ||
      !streamingXlsxPageEvents.some((event) => event.pageNames.includes('sample-Review-001.jpg'))
    ) {
      throw new Error(`XLSX import was not appended one rendered page at a time: ${JSON.stringify(streamingXlsxEvents)}`)
    }
    console.log('streaming XLSX import passed')

    await resetWhiteboardStorage(page)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.evaluate(() => { window.__openWhiteboardImportEvents = [] })
    await page.locator('input[type="file"][multiple]').setInputFiles(streamingTextPath)
    await waitForStoredBlankProjectMinPages(page, 2)
    const streamingTextEvents = await page.evaluate(() => window.__openWhiteboardImportEvents ?? [])
    const streamingTextPageEvents = streamingTextEvents.filter((event) => event.pageNames?.some((name) => /^streaming-\d{3}\.jpg$/.test(name)))
    if (
      streamingTextPageEvents.length < 2 ||
      !streamingTextPageEvents.every((event) => event.fileName === 'streaming.txt') ||
      !streamingTextPageEvents.every((event) => event.appendedPages === 1) ||
      !streamingTextPageEvents.some((event) => event.pageNames.includes('streaming-001.jpg')) ||
      !streamingTextPageEvents.some((event) => event.pageNames.includes('streaming-002.jpg'))
    ) {
      throw new Error(`text import was not appended one rendered page at a time: ${JSON.stringify(streamingTextEvents)}`)
    }
    console.log('streaming text import passed')

    await resetWhiteboardStorage(page)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.locator('input[type="file"][multiple]').setInputFiles(odpPath)
    await waitForWhiteboardPageCount(page, 2, 20000)
    const odpProject = await waitForStoredBlankProjectMinPages(page, 2)
    const odpPages = odpProject.pages.filter((item) => item.image?.name?.startsWith('sample-'))
    if (
      odpPages.length !== 2 ||
      !odpPages.every((item) => item.image?.width === 1600 && item.image?.height === 900) ||
      !odpPages.some((item) => item.image?.name === 'sample-002.jpg')
    ) {
      throw new Error(`ODP import did not render slide pages: ${JSON.stringify(odpPages.map((item) => item.image))}`)
    }
    console.log('ODP fallback import passed')

    await resetWhiteboardStorage(page)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await dispatchHostImportMessage(
      page,
      'converted-office-file',
      path.basename(sampleFiles[3]),
      await fileToDataUrl(sampleFiles[3], 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
    )
    await waitForWhiteboardPageCount(page, 1, 20000)
    const convertedOfficeResult = await page.evaluate(() => ({
      pageCount: document.querySelector('.page-count-button')?.textContent?.trim() ?? '',
      statusText: document.querySelector('.status-bar')?.textContent ?? '',
    }))
    if (!convertedOfficeResult.pageCount.includes('/1')) {
      throw new Error(`converted Office host message did not import: ${JSON.stringify(convertedOfficeResult)}`)
    }

    await resetWhiteboardStorage(page)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await dispatchHostImportMessage(
      page,
      'open-note-file',
      path.basename(notePath),
      await fs.readFile(notePath, 'utf8'),
    )
    await page.waitForFunction(
      () => (document.querySelector('.status-bar')?.textContent ?? '').includes('Imported Note Page'),
      null,
      { timeout: 20000 },
    )
    await page.evaluate(
      ({ fileName, content }) => {
        window.dispatchEvent(new MessageEvent('message', {
          data: {
            type: 'converted-office-file',
            fileName,
            content,
            preserveCurrentPages: true,
          },
        }))
      },
      {
        fileName: path.basename(sampleFiles[0]),
        content: await fileToDataUrl(sampleFiles[0], 'text/plain'),
      },
    )
    await waitForWhiteboardPageCount(page, 2, 20000)
    await page.waitForTimeout(1800)
    await installSmokeHelpers(page)
    const convertedOfficePreserveResult = await page.evaluate(async () => {
      const project = await window.__readStoredBlankProjectForSmoke()
      return {
        pageCount: document.querySelector('.page-count-button')?.textContent?.trim() ?? '',
        firstPageName: project?.pages?.[0]?.name ?? '',
        secondPageImageName: project?.pages?.[1]?.image?.name ?? '',
      }
    })
    if (
      !convertedOfficePreserveResult.pageCount.includes('/2') ||
      convertedOfficePreserveResult.firstPageName !== 'Imported Note Page' ||
      convertedOfficePreserveResult.secondPageImageName !== 'sample-001.jpg'
    ) {
      throw new Error(`converted Office preserve import replaced existing note page: ${JSON.stringify(convertedOfficePreserveResult)}`)
    }

    await resetWhiteboardStorage(page)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await dispatchHostImportMessage(
      page,
      'open-import-file',
      path.basename(pptxPath),
      await fileToDataUrl(pptxPath, 'application/vnd.openxmlformats-officedocument.presentationml.presentation'),
    )
    await page.waitForFunction(
      () => (document.querySelector('.status-bar')?.textContent ?? '').includes('Imported 3 pages'),
      null,
      { timeout: 20000 },
    )
    const startupImportResult = await page.evaluate(() => ({
      pageCount: document.querySelector('.page-count-button')?.textContent?.trim() ?? '',
      statusText: document.querySelector('.status-bar')?.textContent ?? '',
    }))
    if (!startupImportResult.pageCount.includes('/3') && !startupImportResult.pageCount.includes('/6')) {
      throw new Error(`startup host import message did not import PPTX: ${JSON.stringify(startupImportResult)}`)
    }

    await resetWhiteboardStorage(page)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await dispatchHostImportMessage(
      page,
      'open-import-file',
      path.basename(sampleFiles[2]),
      await fileToDataUrl(sampleFiles[2], 'application/json'),
    )
    await page.waitForFunction(
      async () => {
        const project = await window.__readStoredBlankProjectForSmoke()
        return project?.pages?.[0]?.image?.name === 'sample-001.jpg'
      },
      null,
      { timeout: 20000 },
    )
    const startupJsonDocumentResult = await page.evaluate(() => ({
      pageCount: document.querySelector('.page-count-button')?.textContent?.trim() ?? '',
      statusText: document.querySelector('.status-bar')?.textContent ?? '',
    }))
    if (!startupJsonDocumentResult.pageCount.includes('/1') || startupJsonDocumentResult.statusText.includes('Imported Note Page')) {
      throw new Error(`startup host plain JSON was not imported as a document: ${JSON.stringify(startupJsonDocumentResult)}`)
    }

    await resetWhiteboardStorage(page)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await dispatchHostImportFilesMessage(page, [
      {
        fileName: path.basename(sampleFiles[0]),
        content: await fileToDataUrl(sampleFiles[0], 'text/plain'),
      },
      {
        fileName: path.basename(pptxPath),
        content: await fileToDataUrl(pptxPath, 'application/vnd.openxmlformats-officedocument.presentationml.presentation'),
      },
    ])
    await waitForWhiteboardPageCount(page, 4, 20000)
    await page.waitForFunction(
      () => (document.querySelector('.status-bar')?.textContent ?? '').includes('Imported 4 pages'),
      null,
      { timeout: 20000 },
    )
    const startupMultiImportResult = await page.evaluate(() => ({
      pageCount: document.querySelector('.page-count-button')?.textContent?.trim() ?? '',
      statusText: document.querySelector('.status-bar')?.textContent ?? '',
    }))
    if (!startupMultiImportResult.pageCount.includes('/4') || !startupMultiImportResult.statusText.includes('Imported 4 pages')) {
      throw new Error(`startup host multi-file import did not preserve every file: ${JSON.stringify(startupMultiImportResult)}`)
    }

    await resetWhiteboardStorage(page)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await installFakeWebView(page)
    const legacyOfficePaths = [legacyPptPath, legacyPpsPath, legacyPotPath, legacyDocPath, legacyDotPath, legacyXlsPath]
    const legacyOfficeNames = legacyOfficePaths.map((filePath) => path.basename(filePath))
    await page.locator('input[type="file"][multiple]').setInputFiles(legacyOfficePaths)
    await page.waitForFunction(
      (expectedCount) => (window.__openWhiteboardWebViewMessages ?? []).filter((message) => message.type === 'convert-office-file').length >= expectedCount,
      legacyOfficePaths.length,
      { timeout: 20000 },
    )
    const legacyStandaloneConversionRequestResult = await page.evaluate(() => {
      const messages = (window.__openWhiteboardWebViewMessages ?? []).filter((item) => item.type === 'convert-office-file')
      return messages.map((message) => ({
        type: message?.type ?? '',
        fileName: message?.fileName ?? '',
        preserveCurrentPages: Boolean(message?.preserveCurrentPages),
      }))
    })
    if (
      legacyStandaloneConversionRequestResult.length !== legacyOfficeNames.length ||
      !legacyOfficeNames.every((fileName) => legacyStandaloneConversionRequestResult.some((request) => request.fileName === fileName)) ||
      legacyStandaloneConversionRequestResult.some((request) => request.type !== 'convert-office-file' || request.preserveCurrentPages !== false)
    ) {
      throw new Error(`standalone legacy Office conversion requests had the wrong preserve context: ${JSON.stringify(legacyStandaloneConversionRequestResult)}`)
    }

    await resetWhiteboardStorage(page)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await installFakeWebView(page)
    await page.locator('input[type="file"][multiple]').setInputFiles(legacyPptPath)
    await page.waitForFunction(
      () => (window.__openWhiteboardWebViewMessages ?? []).some((message) => message.type === 'convert-office-file'),
      null,
      { timeout: 20000 },
    )
    const legacySingleStandaloneConversionRequestResult = await page.evaluate(() => {
      const message = (window.__openWhiteboardWebViewMessages ?? []).find((item) => item.type === 'convert-office-file')
      return {
        type: message?.type ?? '',
        fileName: message?.fileName ?? '',
        preserveCurrentPages: Boolean(message?.preserveCurrentPages),
      }
    })
    if (
      legacySingleStandaloneConversionRequestResult.type !== 'convert-office-file' ||
      legacySingleStandaloneConversionRequestResult.fileName !== 'legacy.ppt' ||
      legacySingleStandaloneConversionRequestResult.preserveCurrentPages !== false
    ) {
      throw new Error(`single legacy Office conversion request had the wrong preserve context: ${JSON.stringify(legacySingleStandaloneConversionRequestResult)}`)
    }

    await resetWhiteboardStorage(page)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await dispatchHostNoteWithFilesMessage(
      page,
      path.basename(textNotePath),
      await fs.readFile(textNotePath, 'utf8'),
      [
        {
          fileName: path.basename(sampleFiles[0]),
          content: await fileToDataUrl(sampleFiles[0], 'text/plain'),
        },
        {
          fileName: path.basename(sampleFiles[1]),
          content: await fileToDataUrl(sampleFiles[1], 'text/csv'),
        },
      ],
    )
    await waitForWhiteboardPageCount(page, 3, 20000)
    await page.waitForTimeout(1800)
    await installSmokeHelpers(page)
    const startupNotePlusImportsResult = await page.evaluate(async () => {
      const project = await window.__readStoredBlankProjectForSmoke()
      return {
        pageCount: document.querySelector('.page-count-button')?.textContent?.trim() ?? '',
        firstPageName: project?.pages?.[0]?.name ?? '',
        firstPageTextCount: project?.pages?.[0]?.texts?.length ?? 0,
        importedImageNames: project?.pages?.slice(1).map((item) => item.image?.name ?? '') ?? [],
      }
    })
    if (
      !startupNotePlusImportsResult.pageCount.includes('/3') ||
      startupNotePlusImportsResult.firstPageName !== 'Text Note Page' ||
      startupNotePlusImportsResult.firstPageTextCount !== 1 ||
      !startupNotePlusImportsResult.importedImageNames.includes('sample-001.jpg') ||
      !startupNotePlusImportsResult.importedImageNames.includes('sample-CSV-001.jpg')
    ) {
      throw new Error(`startup host note plus imports did not preserve note and files: ${JSON.stringify(startupNotePlusImportsResult)}`)
    }

    await resetWhiteboardStorage(page)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await installFakeWebView(page)
    await dispatchHostNoteWithFilesMessage(
      page,
      path.basename(notePath),
      await fs.readFile(notePath, 'utf8'),
      [
        {
          fileName: path.basename(legacyPptPath),
          content: await fileToDataUrl(legacyPptPath, 'application/vnd.ms-powerpoint'),
        },
      ],
    )
    await page.waitForFunction(
      () => (window.__openWhiteboardWebViewMessages ?? []).some((message) => message.type === 'convert-office-file'),
      null,
      { timeout: 20000 },
    )
    const legacyConversionRequestResult = await page.evaluate(() => {
      const message = (window.__openWhiteboardWebViewMessages ?? []).find((item) => item.type === 'convert-office-file')
      return {
        type: message?.type ?? '',
        fileName: message?.fileName ?? '',
        preserveCurrentPages: Boolean(message?.preserveCurrentPages),
      }
    })
    if (
      legacyConversionRequestResult.type !== 'convert-office-file' ||
      legacyConversionRequestResult.fileName !== 'legacy.ppt' ||
      legacyConversionRequestResult.preserveCurrentPages !== true
    ) {
      throw new Error(`legacy Office conversion request did not preserve note import context: ${JSON.stringify(legacyConversionRequestResult)}`)
    }

    await resetWhiteboardStorage(page)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await dispatchHostImportMessage(
      page,
      'open-note-file',
      path.basename(notePath),
      await fs.readFile(notePath, 'utf8'),
    )
    await page.waitForFunction(
      () => (document.querySelector('.status-bar')?.textContent ?? '').includes('Imported Note Page'),
      null,
      { timeout: 20000 },
    )
    const startupNoteResult = await page.evaluate(() => ({
      pageCount: document.querySelector('.page-count-button')?.textContent?.trim() ?? '',
      statusText: document.querySelector('.status-bar')?.textContent ?? '',
    }))
    if (!startupNoteResult.pageCount.includes('/1')) {
      throw new Error(`startup host note message did not open note: ${JSON.stringify(startupNoteResult)}`)
    }

    await resetWhiteboardStorage(page)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await dispatchHostImportMessage(
      page,
      'open-import-file',
      path.basename(noteJsonPath),
      await fileToDataUrl(noteJsonPath, 'application/json'),
    )
    await page.waitForFunction(
      () => (document.querySelector('.status-bar')?.textContent ?? '').includes('Imported Note Page'),
      null,
      { timeout: 20000 },
    )
    const startupJsonNoteResult = await page.evaluate(() => ({
      pageCount: document.querySelector('.page-count-button')?.textContent?.trim() ?? '',
      statusText: document.querySelector('.status-bar')?.textContent ?? '',
    }))
    if (!startupJsonNoteResult.pageCount.includes('/1')) {
      throw new Error(`startup host JSON note did not open note: ${JSON.stringify(startupJsonNoteResult)}`)
    }

    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.locator('input[type="file"][multiple]').setInputFiles(notePath)
    await page.waitForFunction(
      () => (document.querySelector('.status-bar')?.textContent ?? '').includes('Imported Note Page'),
      null,
      { timeout: 20000 },
    )
    const noteImportResult = await page.evaluate(() => ({
      pageCount: document.querySelector('.page-count-button')?.textContent?.trim() ?? '',
      statusText: document.querySelector('.status-bar')?.textContent ?? '',
    }))
    if (!noteImportResult.pageCount.includes('/1')) {
      throw new Error(`whiteboard note import through main input failed: ${JSON.stringify(noteImportResult)}`)
    }

    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.locator('input[type="file"][multiple]').setInputFiles(noteJsonPath)
    await page.waitForFunction(
      () => (document.querySelector('.status-bar')?.textContent ?? '').includes('Imported Note Page'),
      null,
      { timeout: 20000 },
    )
    const noteJsonImportResult = await page.evaluate(() => ({
      pageCount: document.querySelector('.page-count-button')?.textContent?.trim() ?? '',
      statusText: document.querySelector('.status-bar')?.textContent ?? '',
    }))
    if (!noteJsonImportResult.pageCount.includes('/1')) {
      throw new Error(`whiteboard JSON note import through main input failed: ${JSON.stringify(noteJsonImportResult)}`)
    }

    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.locator('input[type="file"][multiple]').setInputFiles([notePath, sampleFiles[0]])
    await waitForWhiteboardPageCount(page, 2, 20000)
    await page.waitForTimeout(1800)
    await installSmokeHelpers(page)
    const mixedNoteImportResult = await page.evaluate(async () => {
      const project = await window.__readStoredBlankProjectForSmoke()
      return {
        pageCount: document.querySelector('.page-count-button')?.textContent?.trim() ?? '',
        statusText: document.querySelector('.status-bar')?.textContent ?? '',
        firstPageName: project?.pages?.[0]?.name ?? '',
        secondPageImageName: project?.pages?.[1]?.image?.name ?? '',
      }
    })
    if (
      !mixedNoteImportResult.pageCount.includes('/2') ||
      mixedNoteImportResult.firstPageName !== 'Imported Note Page' ||
      mixedNoteImportResult.secondPageImageName !== 'sample-001.jpg'
    ) {
      throw new Error(`mixed note and document import dropped a file: ${JSON.stringify(mixedNoteImportResult)}`)
    }

    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.locator('input[type="file"][multiple]').setInputFiles([textNotePath, sampleFiles[0]])
    await waitForWhiteboardPageCount(page, 2, 20000)
    await page.waitForTimeout(1800)
    await installSmokeHelpers(page)
    const mixedTextNoteResult = await page.evaluate(async () => {
      const project = await window.__readStoredBlankProjectForSmoke()
      return {
        pageCount: document.querySelector('.page-count-button')?.textContent?.trim() ?? '',
        firstPageName: project?.pages?.[0]?.name ?? '',
        firstPageTextCount: project?.pages?.[0]?.texts?.length ?? 0,
        secondPageImageName: project?.pages?.[1]?.image?.name ?? '',
      }
    })
    if (
      !mixedTextNoteResult.pageCount.includes('/2') ||
      mixedTextNoteResult.firstPageName !== 'Text Note Page' ||
      mixedTextNoteResult.firstPageTextCount !== 1 ||
      mixedTextNoteResult.secondPageImageName !== 'sample-001.jpg'
    ) {
      throw new Error(`mixed text-note and document import replaced an existing text page: ${JSON.stringify(mixedTextNoteResult)}`)
    }

    await page.reload({ waitUntil: 'domcontentloaded' })
    await waitForWhiteboardReady(page)
    const noteText = await fs.readFile(noteJsonPath, 'utf8')
    await page.evaluate((noteText) => {
      const target = document.querySelector('main.whiteboard-app')
      if (!target) throw new Error('whiteboard drop target was not found')
      const transfer = new DataTransfer()
      transfer.items.add(new File([noteText], 'sample-note.json', { type: 'application/json' }))
      transfer.items.add(new File(['Dropped text page'], 'dropped.txt', { type: 'text/plain' }))
      target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }))
    }, noteText)
    await waitForWhiteboardPageCount(page, 2, 20000)
    const mixedDropImportResult = await page.evaluate(() => ({
      pageCount: document.querySelector('.page-count-button')?.textContent?.trim() ?? '',
      statusText: document.querySelector('.status-bar')?.textContent ?? '',
    }))
    if (!mixedDropImportResult.pageCount.includes('/2')) {
      throw new Error(`mixed note and document drop import dropped a file: ${JSON.stringify(mixedDropImportResult)}`)
    }

    await resetWhiteboardStorage(page)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await waitForWhiteboardReady(page)
    await page.evaluate(() => {
      const target = document.querySelector('main.whiteboard-app')
      if (!target) throw new Error('whiteboard drop target was not found')
      const fileEntry = (file) => ({
        isFile: true,
        isDirectory: false,
        name: file.name,
        file: (success) => success(file),
      })
      const directoryEntry = (entries) => {
        let readCount = 0
        return {
          isFile: false,
          isDirectory: true,
          name: 'lesson-folder',
          createReader: () => ({
            readEntries: (success) => {
              readCount += 1
              success(readCount === 1 ? entries : [])
            },
          }),
        }
      }
      const files = [
        new File(['Folder text page'], 'folder-a.txt', { type: 'text/plain' }),
        new File(['# Folder markdown page'], 'folder-b.md', { type: 'text/markdown' }),
      ]
      const dataTransfer = {
        files: [],
        items: [
          {
            kind: 'file',
            webkitGetAsEntry: () => directoryEntry(files.map(fileEntry)),
          },
        ],
      }
      const event = new Event('drop', { bubbles: true, cancelable: true })
      Object.defineProperty(event, 'dataTransfer', { value: dataTransfer })
      target.dispatchEvent(event)
    })
    await waitForWhiteboardPageCount(page, 2, 20000)
    const directoryDropImportResult = await page.evaluate(() => ({
      pageCount: document.querySelector('.page-count-button')?.textContent?.trim() ?? '',
      statusText: document.querySelector('.status-bar')?.textContent ?? '',
    }))
    if (!directoryDropImportResult.pageCount.includes('/2') || !directoryDropImportResult.statusText.includes('Imported 2 pages')) {
      throw new Error(`directory drop import did not expand files: ${JSON.stringify(directoryDropImportResult)}`)
    }

    await resetWhiteboardStorage(page)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await installSmokeHelpers(page)
    await page.evaluate(async () => {
      const canvas = document.createElement('canvas')
      canvas.width = 96
      canvas.height = 64
      const context = canvas.getContext('2d')
      if (!context) throw new Error('canvas context unavailable')
      context.fillStyle = '#ffffff'
      context.fillRect(0, 0, canvas.width, canvas.height)
      context.fillStyle = '#0f766e'
      context.fillRect(8, 8, 80, 48)
      context.fillStyle = '#ffffff'
      context.fillRect(22, 22, 52, 20)
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
      if (!blob) throw new Error('clipboard image blob was not created')
      const transfer = new DataTransfer()
      transfer.items.add(new File([blob], 'pasted-board-image.png', { type: 'image/png' }))
      const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true })
      Object.defineProperty(event, 'clipboardData', { value: transfer })
      window.dispatchEvent(event)
    })
    await page.waitForFunction(
      () => (document.querySelector('.status-bar')?.textContent ?? '').includes('Imported 1 pages'),
      null,
      { timeout: 20000 },
    )
    await page.waitForTimeout(1800)
    const pastedImageImportResult = await page.evaluate(async () => {
      const project = await window.__readStoredBlankProjectForSmoke()
      return {
        pageCount: document.querySelector('.page-count-button')?.textContent?.trim() ?? '',
        imageName: project?.pages?.[0]?.image?.name ?? '',
        imageWidth: project?.pages?.[0]?.image?.width ?? 0,
        imageHeight: project?.pages?.[0]?.image?.height ?? 0,
      }
    })
    if (
      !pastedImageImportResult.pageCount.includes('/1') ||
      pastedImageImportResult.imageName !== 'pasted-board-image.png' ||
      pastedImageImportResult.imageWidth !== 96 ||
      pastedImageImportResult.imageHeight !== 64
    ) {
      throw new Error(`clipboard image paste import failed: ${JSON.stringify(pastedImageImportResult)}`)
    }
    await installDownloadCapture(page)
    await page.locator('.teaching-toolbar .tool-button').filter({ hasText: /软笔|Pen/ }).click()
    await drawBoardStroke(page)
    await page.locator('.teaching-toolbar .tool-button').last().click()
    await page.locator('.more-panel .panel-action').filter({ hasText: /导出|Export/ }).first().click()
    await page.locator('.export-panel .panel-action').filter({ hasText: /PNG/ }).click()
    await page.waitForFunction(
      () => (window.__capturedDownloads ?? []).some((download) => download.type === 'image/png' && download.byteLength > 100),
      null,
      { timeout: 12000 },
    )
    const exportedPngResult = await page.evaluate(() => window.__capturedDownloads?.at(-1) ?? null)
    if (
      !exportedPngResult ||
      exportedPngResult.type !== 'image/png' ||
      exportedPngResult.width !== pastedImageImportResult.imageWidth * 2 ||
      exportedPngResult.height !== pastedImageImportResult.imageHeight * 2 ||
      exportedPngResult.byteLength <= 100
    ) {
      throw new Error(`PNG export did not produce a rendered page image: ${JSON.stringify(exportedPngResult)}`)
    }

    await resetWhiteboardStorage(page)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await waitForWhiteboardReady(page)
    await installSmokeHelpers(page)
    await page.evaluate(() => {
      const transfer = new DataTransfer()
      transfer.setData('text/html', '<h1>Clipboard Lesson</h1><p><strong>Rich text</strong> pasted into the whiteboard.</p>')
      transfer.setData('text/plain', 'Clipboard Lesson fallback text')
      const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true })
      Object.defineProperty(event, 'clipboardData', { value: transfer })
      window.dispatchEvent(event)
    })
    await page.waitForFunction(
      () => (document.querySelector('.status-bar')?.textContent ?? '').includes('Imported 1 pages'),
      null,
      { timeout: 20000 },
    )
    await page.waitForTimeout(1800)
    const pastedHtmlImportResult = await page.evaluate(async () => {
      const project = await window.__readStoredBlankProjectForSmoke()
      return {
        pageCount: document.querySelector('.page-count-button')?.textContent?.trim() ?? '',
        imageName: project?.pages?.[0]?.image?.name ?? '',
        imageWidth: project?.pages?.[0]?.image?.width ?? 0,
      }
    })
    if (
      !pastedHtmlImportResult.pageCount.includes('/1') ||
      pastedHtmlImportResult.imageName !== 'pasted-clipboard-001.jpg' ||
      pastedHtmlImportResult.imageWidth <= 0
    ) {
      throw new Error(`clipboard HTML paste import failed: ${JSON.stringify(pastedHtmlImportResult)}`)
    }

    await resetWhiteboardStorage(page)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await waitForWhiteboardReady(page)
    await installSmokeHelpers(page)
    await page.evaluate(() => {
      const transfer = new DataTransfer()
      transfer.setData('text/plain', 'Clipboard plain text page\nLine two for import smoke.')
      const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true })
      Object.defineProperty(event, 'clipboardData', { value: transfer })
      window.dispatchEvent(event)
    })
    await page.waitForFunction(
      () => (document.querySelector('.status-bar')?.textContent ?? '').includes('Imported 1 pages'),
      null,
      { timeout: 20000 },
    )
    await page.waitForTimeout(1800)
    const pastedTextImportResult = await page.evaluate(async () => {
      const project = await window.__readStoredBlankProjectForSmoke()
      return {
        pageCount: document.querySelector('.page-count-button')?.textContent?.trim() ?? '',
        imageName: project?.pages?.[0]?.image?.name ?? '',
        imageWidth: project?.pages?.[0]?.image?.width ?? 0,
      }
    })
    if (
      !pastedTextImportResult.pageCount.includes('/1') ||
      pastedTextImportResult.imageName !== 'pasted-clipboard-001.jpg' ||
      pastedTextImportResult.imageWidth <= 0
    ) {
      throw new Error(`clipboard text paste import failed: ${JSON.stringify(pastedTextImportResult)}`)
    }

    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.evaluate(() => { window.__openWhiteboardImportEvents = [] })
    await page.locator('input[type="file"][multiple]').setInputFiles(pptxPath)
    await waitForWhiteboardPageCount(page, 3, 20000)
    const streamingPptxEvents = await page.evaluate(() => window.__openWhiteboardImportEvents ?? [])
    const streamingPptxPageEvents = streamingPptxEvents.filter((event) => event.pageNames?.some((name) => /^sample-\d{3}\.jpg$/.test(name)))
    if (
      streamingPptxPageEvents.length !== 3 ||
      !streamingPptxPageEvents.every((event) => event.fileName === 'sample.pptx') ||
      !streamingPptxPageEvents.every((event) => event.appendedPages === 1) ||
      !streamingPptxPageEvents.some((event) => event.pageNames.includes('sample-001.jpg')) ||
      !streamingPptxPageEvents.some((event) => event.pageNames.includes('sample-003.jpg'))
    ) {
      throw new Error(`PPTX import was not appended one rendered slide at a time: ${JSON.stringify(streamingPptxEvents)}`)
    }
    const toolbarButtons = page.locator('.teaching-toolbar button')
    const buttonCount = await toolbarButtons.count()
    await toolbarButtons.nth(buttonCount - 3).click()
    console.log('presentation playback opened')
    await page.waitForFunction(() => {
      return document.querySelectorAll('canvas[data-presentation-overlay="true"]').length > 0
    }, null, { timeout: 12000 })
    const firstBlobCacheSize = await presentationAttribute(page, 'data-presentation-blob-cache-size')
    await waitForPresentationNumberAtLeast(page, 'data-presentation-slide-cache-size', 2)
    const firstSlideCacheSize = await presentationAttribute(page, 'data-presentation-slide-cache-size')

    const initialPresentationStrokeCount = await currentPresentationStrokeCount(page)
    await page.locator('[data-presentation-action="pen"]').click()
    const beforePresentationInkSave = await page.evaluate(() => localStorage.getItem('open-whiteboard-last-save'))
    const inkPath = await drawPresentationStroke(page)
    await page.waitForFunction(() => {
      return Number(document.querySelector('canvas[data-presentation-overlay="true"]')?.getAttribute('data-presentation-stroke-count') ?? 0) > 0
    }, null, { timeout: 12000 })
    await page.waitForFunction(
      (previousSave) => {
        const nextSave = localStorage.getItem('open-whiteboard-last-save')
        return Boolean(nextSave) && nextSave !== previousSave
      },
      beforePresentationInkSave,
      { timeout: 1200 },
    )
    const afterPresentationInkImmediateSave = await page.evaluate(() => localStorage.getItem('open-whiteboard-last-save'))
    const afterInkStrokeCount = await currentPresentationStrokeCount(page)
    const afterInkPointCount = await currentPresentationPointCount(page)
    const afterInkLastPoint = await currentPresentationLastPoint(page)
    const afterInkRawUpdateState = await presentationRawUpdateState(page)
    await page.keyboard.press('Escape')
    await page.waitForFunction(() => {
      return document.querySelectorAll('canvas[data-presentation-overlay="true"]').length === 0
    }, null, { timeout: 12000 })
    await toolbarButtons.nth(buttonCount - 3).click()
    await page.waitForFunction(() => {
      return Number(document.querySelector('canvas[data-presentation-overlay="true"]')?.getAttribute('data-presentation-stroke-count') ?? 0) > 0
    }, null, { timeout: 12000 })
    const reopenedBlobCacheSize = await presentationAttribute(page, 'data-presentation-blob-cache-size')
    const reopenedInkStrokeCount = await currentPresentationStrokeCount(page)
    const reopenedInkPointCount = await currentPresentationPointCount(page)
    await page.locator('[data-presentation-action="eraser"]').click()
    await erasePresentationStroke(page, inkPath)
    const afterEraserPointCount = await currentPresentationPointCount(page)
    await page.keyboard.press('Escape')
    await page.waitForFunction(() => {
      return document.querySelectorAll('canvas[data-presentation-overlay="true"]').length === 0
    }, null, { timeout: 12000 })
    await toolbarButtons.nth(buttonCount - 3).click()
    await page.waitForFunction(() => {
      return document.querySelectorAll('canvas[data-presentation-overlay="true"]').length > 0
    }, null, { timeout: 12000 })
    const reopenedAfterEraserStrokeCount = await currentPresentationStrokeCount(page)
    const reopenedAfterEraserPointCount = await currentPresentationPointCount(page)
    await page.locator('[data-presentation-action="highlighter"]').click()
    await drawPresentationStroke(page)
    await page.waitForFunction(() => {
      return Number(document.querySelector('canvas[data-presentation-overlay="true"]')?.getAttribute('data-presentation-stroke-count') ?? 0) > 0
    }, null, { timeout: 12000 })
    const afterHighlighterStrokeCount = await currentPresentationStrokeCount(page)
    const afterHighlighterPointCount = await currentPresentationPointCount(page)
    await page.keyboard.press('Escape')
    await page.waitForFunction(() => {
      return document.querySelectorAll('canvas[data-presentation-overlay="true"]').length === 0
    }, null, { timeout: 12000 })
    await toolbarButtons.nth(buttonCount - 3).click()
    await page.waitForFunction(() => {
      return Number(document.querySelector('canvas[data-presentation-overlay="true"]')?.getAttribute('data-presentation-stroke-count') ?? 0) > 0
    }, null, { timeout: 12000 })
    const reopenedHighlighterStrokeCount = await currentPresentationStrokeCount(page)
    const reopenedHighlighterPointCount = await currentPresentationPointCount(page)
    await page.keyboard.press('Escape')
    await page.waitForFunction(() => {
      return document.querySelectorAll('canvas[data-presentation-overlay="true"]').length === 0
    }, null, { timeout: 12000 })
    await page.waitForTimeout(1800)
    const savedPresentationNoteText = await readSavedProjectNoteText(page)
    const savedPresentationNotePath = path.join(tempRoot, 'saved-presentation.owbn')
    await fs.writeFile(savedPresentationNotePath, savedPresentationNoteText, 'utf8')
    await resetWhiteboardStorage(page)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.locator('input[type="file"][multiple]').setInputFiles(savedPresentationNotePath)
    await waitForWhiteboardPageCount(page, 3, 20000)
    const restoredToolbarButtons = page.locator('.teaching-toolbar button')
    const restoredButtonCount = await restoredToolbarButtons.count()
    await restoredToolbarButtons.nth(restoredButtonCount - 3).click()
    await page.waitForFunction(() => {
      return Number(document.querySelector('canvas[data-presentation-overlay="true"]')?.getAttribute('data-presentation-stroke-count') ?? 0) > 0
    }, null, { timeout: 12000 })
    const restoredSavedPresentationStrokeCount = await currentPresentationStrokeCount(page)
    const restoredSavedPresentationPointCount = await currentPresentationPointCount(page)
    await installFakeWebView(page)
    await page.locator('[data-presentation-action="pen"]').click()
    await beginPresentationStrokeWithoutPointerUp(page)
    await page.keyboard.press('Escape')
    await page.mouse.up()
    await page.waitForFunction(() => {
      return document.querySelectorAll('canvas[data-presentation-overlay="true"]').length === 0
    }, null, { timeout: 12000 })
    await page.waitForFunction(
      (previousStrokeCount) =>
        (window.__openWhiteboardWebViewMessages ?? []).some((message) => {
          if (message?.type !== 'autosave-note-file' || typeof message.content !== 'string') return false
          try {
            const note = JSON.parse(message.content)
            return note?.project?.pages?.some((page) =>
              page?.presentation?.slideIndex === 0 && Array.isArray(page.strokes) && page.strokes.length > previousStrokeCount,
            )
          } catch {
            return false
          }
        }),
      restoredSavedPresentationStrokeCount,
      { timeout: 1200 },
    )
    const presentationHostAutosaveMessage = await page.evaluate(() => {
      const message = (window.__openWhiteboardWebViewMessages ?? []).find((item) => item?.type === 'autosave-note-file')
      if (!message || typeof message.content !== 'string') return null
      const note = JSON.parse(message.content)
      const slide = note.project.pages.find((page) => page?.presentation?.slideIndex === 0)
      return {
        type: message.type,
        fileName: message.fileName,
        slideStrokeCount: slide?.strokes?.length ?? 0,
      }
    })
    await restoredToolbarButtons.nth(restoredButtonCount - 3).click()
    await page.waitForFunction(
      (previousCount) =>
        Number(document.querySelector('canvas[data-presentation-overlay="true"]')?.getAttribute('data-presentation-stroke-count') ?? 0) >
        previousCount,
      restoredSavedPresentationStrokeCount,
      { timeout: 12000 },
    )
    const interruptedCloseStrokeCount = await currentPresentationStrokeCount(page)
    await page.keyboard.press('Escape')
    await page.waitForFunction(() => {
      return document.querySelectorAll('canvas[data-presentation-overlay="true"]').length === 0
    }, null, { timeout: 12000 })
    await restoredToolbarButtons.nth(restoredButtonCount - 3).click()
    await page.waitForFunction(() => {
      return document.querySelectorAll('canvas[data-presentation-overlay="true"]').length > 0
    }, null, { timeout: 12000 })

    const firstPlaybackStatus = await page.locator('.status-bar').textContent()
    const firstAnimationStarted = Date.now()
    await clickPresentationOverlay(page)
    await clickPresentationOverlay(page)
    await waitForPresentationAttribute(page, 'data-presentation-animation-cache-size', '2')
    await waitForPresentationAttribute(page, 'data-presentation-animation-click', '3')
    await waitForPresentationAttribute(page, 'data-presentation-navigation-busy', 'false')
    await page.waitForTimeout(120)
    const firstAnimationMs = Date.now() - firstAnimationStarted
    const afterFirstAnimationState = await currentPresentationState(page)
    const secondAnimationMs = 0
    const afterSecondAnimationState = afterFirstAnimationState
    const slideAdvanceStarted = Date.now()
    await page.locator('[data-presentation-action="next"]').click()
    await waitForPresentationAttribute(page, 'data-presentation-slide-index', '1')
    await waitForPresentationAttribute(page, 'data-presentation-animation-cache-size', '3')
    await waitForPresentationAttribute(page, 'data-presentation-animation-click', '0')
    await waitForPresentationAttribute(page, 'data-presentation-animation-max', '0')
    await waitForPresentationAttribute(page, 'data-presentation-navigation-busy', 'false')
    const slideAdvanceMs = Date.now() - slideAdvanceStarted
    const afterSlideAdvanceState = await currentPresentationState(page)
    await page.keyboard.press('ArrowLeft')
    await waitForPresentationAttribute(page, 'data-presentation-slide-index', '0')
    await waitForPresentationAttribute(page, 'data-presentation-animation-max', '3')
    const afterKeyboardPreviousState = await currentPresentationState(page)
    await page.keyboard.press('End')
    await waitForPresentationAttribute(page, 'data-presentation-slide-index', '2')
    await waitForPresentationAttribute(page, 'data-presentation-animation-max', '0')
    const afterKeyboardEndState = await currentPresentationState(page)
    await page.keyboard.press('Home')
    await waitForPresentationAttribute(page, 'data-presentation-slide-index', '0')
    await waitForPresentationAttribute(page, 'data-presentation-animation-max', '3')
    const afterKeyboardHomeState = await currentPresentationState(page)
    await page.keyboard.press('Enter')
    await waitForPresentationAttribute(page, 'data-presentation-slide-index', '0')
    await waitForPresentationNumberAtLeast(page, 'data-presentation-animation-click', 1)
    const afterKeyboardEnterState = await currentPresentationState(page)
    await page.keyboard.press('n')
    await waitForPresentationAttribute(page, 'data-presentation-animation-click', '3')
    const afterKeyboardNState = await currentPresentationState(page)
    await page.locator('[data-presentation-action="next"]').click()
    await waitForPresentationAttribute(page, 'data-presentation-slide-index', '1')
    await waitForPresentationAttribute(page, 'data-presentation-animation-max', '0')
    await waitForPresentationAttribute(page, 'data-presentation-navigation-busy', 'false')
    await page.keyboard.press('p')
    await waitForPresentationAttribute(page, 'data-presentation-slide-index', '0')
    await waitForPresentationAttribute(page, 'data-presentation-animation-max', '3')
    const afterKeyboardPState = await currentPresentationState(page)
    const autoPlayStarted = Date.now()
    await page.locator('[data-presentation-action="autoplay"]').click()
    await waitForPresentationAttribute(page, 'data-presentation-autoplay', 'true')
    await waitForPresentationNumberAtLeast(page, 'data-presentation-animation-click', 1)
    const autoPlayFirstStepMs = Date.now() - autoPlayStarted
    const afterAutoPlayFirstStepState = await currentPresentationState(page)
    await page.locator('[data-presentation-action="autoplay"]').click()
    await waitForPresentationAttribute(page, 'data-presentation-autoplay', 'false')
    const afterAutoPlayPauseState = await currentPresentationState(page)
    await page.keyboard.press('End')
    await waitForPresentationAttribute(page, 'data-presentation-slide-index', '2')
    await page.keyboard.press('Home')
    await waitForPresentationAttribute(page, 'data-presentation-slide-index', '0')
    await waitForPresentationAttribute(page, 'data-presentation-animation-click', '0')
    await waitForPresentationAttribute(page, 'data-presentation-animation-max', '3')
    const rapidClickStarted = Date.now()
    await rapidPresentationOverlayClicks(page, 3)
    await waitForPresentationAttribute(page, 'data-presentation-animation-click', '3')
    await waitForPresentationAttribute(page, 'data-presentation-navigation-busy', 'false')
    await waitForPresentationAttribute(page, 'data-presentation-navigation-queue-size', '0')
    const rapidClickMs = Date.now() - rapidClickStarted
    const afterRapidClickState = await currentPresentationState(page)
    await page.keyboard.press('End')
    await waitForPresentationAttribute(page, 'data-presentation-slide-index', '2')
    await page.keyboard.press('Home')
    await waitForPresentationAttribute(page, 'data-presentation-slide-index', '0')
    await waitForPresentationAttribute(page, 'data-presentation-animation-click', '0')
    await waitForPresentationAttribute(page, 'data-presentation-animation-max', '3')
    await page.locator('[data-presentation-action="pen"]').click()
    await beginPresentationStrokeWithoutPointerUp(page)
    await page.keyboard.press('ArrowRight')
    await page.mouse.up()
    await page.waitForFunction(
      (previousCount) =>
        Number(document.querySelector('canvas[data-presentation-overlay="true"]')?.getAttribute('data-presentation-stroke-count') ?? 0) >
        previousCount,
      interruptedCloseStrokeCount,
      { timeout: 12000 },
    )
    const interruptedNavigationStrokeCount = await currentPresentationStrokeCount(page)
    await page.keyboard.press('Escape')
    await page.waitForFunction(() => {
      return document.querySelectorAll('canvas[data-presentation-overlay="true"]').length === 0
    }, null, { timeout: 12000 })

    const pptxResult = await page.evaluate(() => ({
      pageCount: document.querySelector('.page-count-button')?.textContent?.trim() ?? '',
      overlayCanvasCount: document.querySelectorAll('canvas[data-presentation-overlay="true"]').length,
      toolbarButtonCount: document.querySelectorAll('[data-presentation-toolbar="true"] button').length,
    })).then((result) => ({
      ...result,
      initialPresentationStrokeCount,
      afterInkStrokeCount,
      afterInkPointCount,
      afterPresentationInkImmediateSave,
      afterInkLastPoint,
      afterInkRawUpdateState,
      afterEraserPointCount,
      reopenedInkStrokeCount,
      reopenedInkPointCount,
      reopenedAfterEraserStrokeCount,
      reopenedAfterEraserPointCount,
      afterHighlighterStrokeCount,
      afterHighlighterPointCount,
      reopenedHighlighterStrokeCount,
      reopenedHighlighterPointCount,
      restoredSavedPresentationStrokeCount,
      restoredSavedPresentationPointCount,
      presentationHostAutosaveMessage,
      interruptedCloseStrokeCount,
      firstPlaybackStatus,
      firstBlobCacheSize,
      firstSlideCacheSize,
      reopenedBlobCacheSize,
      afterFirstAnimationState,
      afterSecondAnimationState,
      afterSlideAdvanceState,
      afterKeyboardPreviousState,
      afterKeyboardEndState,
      afterKeyboardHomeState,
      afterKeyboardEnterState,
      afterKeyboardNState,
      afterKeyboardPState,
      afterAutoPlayFirstStepState,
      afterAutoPlayPauseState,
      afterRapidClickState,
      interruptedNavigationStrokeCount,
      firstAnimationMs,
      secondAnimationMs,
      slideAdvanceMs,
      autoPlayFirstStepMs,
      rapidClickMs,
    }))

    if (!pptxResult.firstPlaybackStatus?.includes('PPTX 1/3')) {
      throw new Error(`unexpected initial playback status: ${pptxResult.firstPlaybackStatus}`)
    }
    if (pptxResult.initialPresentationStrokeCount !== 0) {
      throw new Error(`presentation test started with existing ink: ${JSON.stringify(pptxResult)}`)
    }
    if (Number(pptxResult.firstBlobCacheSize) < 1 || pptxResult.reopenedBlobCacheSize !== pptxResult.firstBlobCacheSize) {
      throw new Error(`presentation blob cache was not reused across playback sessions: ${JSON.stringify(pptxResult)}`)
    }
    if (Number(pptxResult.firstSlideCacheSize) < 2 || Number(pptxResult.afterSlideAdvanceState.slideCacheSize ?? 0) < 2) {
      throw new Error(`presentation slide render cache was not warmed: ${JSON.stringify(pptxResult)}`)
    }
    if (
      Number(pptxResult.firstSlideCacheSize) > 3 ||
      Number(pptxResult.afterSlideAdvanceState.slideCacheSize ?? 0) > 3 ||
      Number(pptxResult.afterKeyboardEndState.slideCacheSize ?? 0) > 3 ||
      Number(pptxResult.afterKeyboardHomeState.slideCacheSize ?? 0) > 3
    ) {
      throw new Error(`presentation slide render cache grew past its window: ${JSON.stringify(pptxResult)}`)
    }
    if (pptxResult.afterInkStrokeCount <= 0 || pptxResult.reopenedInkStrokeCount <= 0) {
      throw new Error(`presentation ink did not persist: ${JSON.stringify(pptxResult)}`)
    }
    if (pptxResult.afterInkRawUpdateState.enabled && pptxResult.afterInkRawUpdateState.count <= 0) {
      throw new Error(`presentation raw pointer update path was not exercised: ${JSON.stringify(pptxResult.afterInkRawUpdateState)}`)
    }
    if (pptxResult.reopenedInkPointCount !== pptxResult.afterInkPointCount) {
      throw new Error(`presentation ink point count changed after reopen: ${JSON.stringify(pptxResult)}`)
    }
    if (pptxResult.afterInkPointCount <= 1 || pptxResult.afterEraserPointCount >= pptxResult.afterInkPointCount) {
      throw new Error(`presentation eraser did not reduce ink points: ${JSON.stringify(pptxResult)}`)
    }
    if (
      !pptxResult.afterInkLastPoint ||
      Math.hypot(pptxResult.afterInkLastPoint.x - inkPath.end.x, pptxResult.afterInkLastPoint.y - inkPath.end.y) > 18
    ) {
      throw new Error(`presentation ink did not keep the pointerup endpoint: ${JSON.stringify(pptxResult.afterInkLastPoint)}`)
    }
    if (pptxResult.reopenedAfterEraserPointCount !== pptxResult.afterEraserPointCount) {
      throw new Error(`presentation eraser result did not persist: ${JSON.stringify(pptxResult)}`)
    }
    if (pptxResult.afterHighlighterStrokeCount <= 0 || pptxResult.reopenedHighlighterStrokeCount <= 0) {
      throw new Error(`presentation highlighter ink did not persist: ${JSON.stringify(pptxResult)}`)
    }
    if (pptxResult.reopenedHighlighterPointCount !== pptxResult.afterHighlighterPointCount) {
      throw new Error(`presentation highlighter point count changed after reopen: ${JSON.stringify(pptxResult)}`)
    }
    if (pptxResult.restoredSavedPresentationStrokeCount <= 0 || pptxResult.restoredSavedPresentationPointCount <= 0) {
      throw new Error(`saved presentation note did not restore ink: ${JSON.stringify(pptxResult)}`)
    }
    if (pptxResult.interruptedCloseStrokeCount <= pptxResult.restoredSavedPresentationStrokeCount) {
      throw new Error(`presentation close discarded an in-progress stroke: ${JSON.stringify(pptxResult)}`)
    }
    if (
      pptxResult.presentationHostAutosaveMessage?.type !== 'autosave-note-file' ||
      pptxResult.presentationHostAutosaveMessage.slideStrokeCount <= pptxResult.restoredSavedPresentationStrokeCount
    ) {
      throw new Error(`presentation ink was not sent to the desktop autosave host immediately: ${JSON.stringify(pptxResult)}`)
    }
    if (pptxResult.interruptedNavigationStrokeCount <= pptxResult.interruptedCloseStrokeCount) {
      throw new Error(`presentation navigation discarded an in-progress stroke: ${JSON.stringify(pptxResult)}`)
    }
    if (pptxResult.afterFirstAnimationState.slideIndex !== '0') {
      throw new Error(`first animation click advanced the slide early: ${JSON.stringify(pptxResult.afterFirstAnimationState)}`)
    }
    if (pptxResult.afterFirstAnimationState.animationClick !== '3') {
      throw new Error(`rapid presentation next did not consume queued animation groups: ${JSON.stringify(pptxResult.afterFirstAnimationState)}`)
    }
    if (pptxResult.afterSecondAnimationState.slideIndex !== '0') {
      throw new Error(`second animation click advanced the slide early: ${JSON.stringify(pptxResult.afterSecondAnimationState)}`)
    }
    if (pptxResult.afterSlideAdvanceState.slideIndex !== '1') {
      throw new Error(`slide did not advance after animation groups: ${JSON.stringify(pptxResult)}`)
    }
    if (pptxResult.afterSlideAdvanceState.animationClick !== '0' || pptxResult.afterSlideAdvanceState.animationMax !== '0') {
      throw new Error(`slide animation state did not reset after advance: ${JSON.stringify(pptxResult)}`)
    }
    if (pptxResult.afterKeyboardPreviousState.slideIndex !== '0' || pptxResult.afterKeyboardPreviousState.animationMax !== '3') {
      throw new Error(`keyboard previous did not return to animated slide: ${JSON.stringify(pptxResult)}`)
    }
    if (pptxResult.afterKeyboardEndState.slideIndex !== '2' || pptxResult.afterKeyboardEndState.animationMax !== '0') {
      throw new Error(`keyboard End did not jump to the last presentation slide: ${JSON.stringify(pptxResult)}`)
    }
    if (pptxResult.afterKeyboardHomeState.slideIndex !== '0' || pptxResult.afterKeyboardHomeState.animationMax !== '3') {
      throw new Error(`keyboard Home did not jump back to the first animated slide: ${JSON.stringify(pptxResult)}`)
    }
    if (pptxResult.afterKeyboardEnterState.slideIndex !== '0' || Number(pptxResult.afterKeyboardEnterState.animationClick ?? 0) < 1) {
      throw new Error(`keyboard Enter did not advance presentation animation: ${JSON.stringify(pptxResult)}`)
    }
    if (pptxResult.afterKeyboardNState.slideIndex !== '0' || pptxResult.afterKeyboardNState.animationClick !== '3') {
      throw new Error(`keyboard N did not continue presentation animation: ${JSON.stringify(pptxResult)}`)
    }
    if (pptxResult.afterKeyboardPState.slideIndex !== '0' || pptxResult.afterKeyboardPState.animationMax !== '3') {
      throw new Error(`keyboard P did not return to previous presentation slide: ${JSON.stringify(pptxResult)}`)
    }
    if (
      pptxResult.afterAutoPlayFirstStepState.slideIndex !== '0' ||
      Number(pptxResult.afterAutoPlayFirstStepState.animationClick ?? 0) < 1 ||
      pptxResult.afterAutoPlayFirstStepState.autoPlaying !== 'true' ||
      pptxResult.afterAutoPlayPauseState.autoPlaying !== 'false'
    ) {
      throw new Error(`presentation autoplay did not advance and pause cleanly: ${JSON.stringify(pptxResult)}`)
    }
    if (
      pptxResult.afterRapidClickState.slideIndex !== '1' ||
      pptxResult.afterRapidClickState.animationClick !== '0' ||
      pptxResult.afterRapidClickState.navigationQueueSize !== '0'
    ) {
      throw new Error(`rapid presentation clicks were not consumed in order: ${JSON.stringify(pptxResult)}`)
    }
    if (Number(pptxResult.afterFirstAnimationState.animationCacheSize ?? 0) < 1) {
      throw new Error(`presentation animation cache was not populated: ${JSON.stringify(pptxResult)}`)
    }
    if (Number(pptxResult.afterSlideAdvanceState.animationCacheSize ?? 0) < 2) {
      throw new Error(`presentation animation cache did not retain slide entries: ${JSON.stringify(pptxResult)}`)
    }
    if (
      Number(pptxResult.afterFirstAnimationState.animationCacheSize ?? 0) > 5 ||
      Number(pptxResult.afterSlideAdvanceState.animationCacheSize ?? 0) > 5 ||
      Number(pptxResult.afterKeyboardEndState.animationCacheSize ?? 0) > 5 ||
      Number(pptxResult.afterKeyboardHomeState.animationCacheSize ?? 0) > 5
    ) {
      throw new Error(`presentation animation cache grew past its window: ${JSON.stringify(pptxResult)}`)
    }
    if (
      Number(pptxResult.afterFirstAnimationState.monitorIntervalMs ?? 0) < 100 ||
      Number(pptxResult.afterFirstAnimationState.monitorIntervalMs ?? 0) > 250
    ) {
      throw new Error(`presentation overlay monitor was not throttled to a classroom-safe interval: ${JSON.stringify(pptxResult.afterFirstAnimationState)}`)
    }
    if (
      pptxResult.firstAnimationMs > maxPresentationAnimationMs ||
      pptxResult.secondAnimationMs > maxPresentationAnimationMs ||
      pptxResult.slideAdvanceMs > maxPresentationSlideAdvanceMs ||
      pptxResult.autoPlayFirstStepMs > maxPresentationAutoPlayFirstStepMs ||
      pptxResult.rapidClickMs > maxPresentationRapidClickMs
    ) {
      throw new Error(`presentation playback interaction is too slow: ${JSON.stringify(pptxResult)}`)
    }
    if (pptxResult.overlayCanvasCount !== 0 || pptxResult.toolbarButtonCount !== 0) {
      throw new Error(`presentation overlay did not close: ${JSON.stringify(pptxResult)}`)
    }

    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.locator('input[type="file"][multiple]').setInputFiles([pptmPath, ppsxPath, ppsmPath, potxPath, potmPath])
    await waitForWhiteboardPageCount(page, 15, 20000)
    const variantProject = await waitForStoredBlankProjectMinPages(page, 15)
    const presentationVariantResult = await page.evaluate(() => ({
      pageCount: document.querySelector('.page-count-button')?.textContent?.trim() ?? '',
    })).then((result) => ({
      ...result,
      presentationCount: variantProject.presentations?.length ?? 0,
      presentationNames: variantProject.presentations?.map((presentation) => presentation.name).sort() ?? [],
      slideReferenceCount: variantProject.pages.filter((page) => page.presentation?.id && Number.isInteger(page.presentation.slideIndex)).length,
      slideCounts: variantProject.presentations?.map((presentation) => presentation.slideCount).sort((left, right) => left - right) ?? [],
    }))
    if (
      !presentationVariantResult.pageCount.includes('/15') ||
      presentationVariantResult.presentationCount !== 5 ||
      presentationVariantResult.slideReferenceCount !== 15 ||
      presentationVariantResult.slideCounts.some((count) => count !== 3) ||
      !['sample.pptm', 'sample.ppsm', 'sample.ppsx', 'sample.potx', 'sample.potm'].every((name) => presentationVariantResult.presentationNames.includes(name))
    ) {
      throw new Error(`presentation variant import failed: ${JSON.stringify(presentationVariantResult)}`)
    }
    const variantToolbarButtons = page.locator('.teaching-toolbar button')
    const variantButtonCount = await variantToolbarButtons.count()
    await variantToolbarButtons.nth(variantButtonCount - 3).click()
    await page.waitForFunction(() => {
      return document.querySelectorAll('canvas[data-presentation-overlay="true"]').length > 0
    }, null, { timeout: 12000 })
    const variantPlaybackState = await currentPresentationState(page)
    if (variantPlaybackState.slideIndex !== '0' || Number(variantPlaybackState.blobCacheSize ?? 0) < 1) {
      throw new Error(`presentation variant did not open playable overlay: ${JSON.stringify({ presentationVariantResult, variantPlaybackState })}`)
    }
    await page.keyboard.press('Escape')
    await page.waitForFunction(() => {
      return document.querySelectorAll('canvas[data-presentation-overlay="true"]').length === 0
    }, null, { timeout: 12000 })

    await browser.close()
    browser = null
    console.log(JSON.stringify({
      documentImport: result,
      convertedOfficeHostImport: convertedOfficeResult,
      convertedOfficePreserveImport: convertedOfficePreserveResult,
      startupHostImport: startupImportResult,
      startupHostJsonDocument: startupJsonDocumentResult,
      startupHostMultiImport: startupMultiImportResult,
      legacyStandaloneConversionRequest: legacyStandaloneConversionRequestResult,
      legacySingleStandaloneConversionRequest: legacySingleStandaloneConversionRequestResult,
      startupHostNotePlusImports: startupNotePlusImportsResult,
      legacyConversionRequest: legacyConversionRequestResult,
      startupHostNote: startupNoteResult,
      startupHostJsonNote: startupJsonNoteResult,
      noteMainImport: noteImportResult,
      noteJsonMainImport: noteJsonImportResult,
      mixedNoteMainImport: mixedNoteImportResult,
      mixedTextNoteImport: mixedTextNoteResult,
      mixedNoteDropImport: mixedDropImportResult,
      directoryDropImport: directoryDropImportResult,
      streamingPdfImport: {
        appendEvents: streamingPdfPageEvents.length,
      },
      streamingDocxImport: {
        appendEvents: streamingDocxPageEvents.length,
      },
      streamingXlsxImport: {
        appendEvents: streamingXlsxPageEvents.length,
      },
      streamingTextImport: {
        appendEvents: streamingTextPageEvents.length,
      },
      odpImport: {
        pageCount: '1/2',
        imageNames: odpPages.map((page) => page.image?.name),
      },
      bulkTextImport: bulkImportResult,
      pastedImageImport: pastedImageImportResult,
      pastedHtmlImport: pastedHtmlImportResult,
      pastedTextImport: pastedTextImportResult,
      streamingPptxImport: {
        appendEvents: streamingPptxPageEvents.length,
      },
      pptxImport: pptxResult,
      presentationVariantImport: presentationVariantResult,
    }, null, 2))
  } finally {
    await browser?.close().catch(() => {})
    server.kill()
    await fs.rm(tempRoot, { recursive: true, force: true })
  }
}

async function assertPortIsFree(targetUrl) {
  try {
    await fetch(targetUrl, { signal: AbortSignal.timeout(1000) })
    throw new Error(`Import smoke target is already serving before the static server starts: ${targetUrl}`)
  } catch (error) {
    if (error instanceof Error && error.message.includes('already serving')) throw error
  }
}

async function createPptxSample(filePath) {
  const pptx = new pptxgen()
  pptx.layout = 'LAYOUT_WIDE'
  const slide1 = pptx.addSlide()
  slide1.background = { color: 'FFFFFF' }
  slide1.addText('PPTX Import Smoke', {
    x: 0.7,
    y: 0.6,
    w: 8,
    h: 0.6,
    fontSize: 30,
    bold: true,
    color: '1F2937',
  })
  slide1.addShape(pptx.ShapeType.rect, {
    x: 0.8,
    y: 1.6,
    w: 4.8,
    h: 1.2,
    fill: { color: 'DFF7F4' },
    line: { color: '139F9B', width: 2 },
  })
  slide1.addText('First slide', { x: 1.1, y: 1.95, w: 4, h: 0.4, fontSize: 22, color: '0F766E' })

  const slide2 = pptx.addSlide()
  slide2.background = { color: 'FFFFFF' }
  slide2.addText('Second Slide', {
    x: 0.7,
    y: 0.7,
    w: 7,
    h: 0.6,
    fontSize: 28,
    bold: true,
    color: '111827',
  })
  slide2.addText('Playback button should appear after PPTX import.', {
    x: 0.8,
    y: 1.7,
    w: 8,
    h: 0.5,
    fontSize: 20,
    color: '374151',
  })

  const slide3 = pptx.addSlide()
  slide3.background = { color: 'FFFFFF' }
  slide3.addText('Third Slide', {
    x: 0.7,
    y: 0.7,
    w: 7,
    h: 0.6,
    fontSize: 28,
    bold: true,
    color: '111827',
  })
  slide3.addShape(pptx.ShapeType.roundRect, {
    x: 0.8,
    y: 1.7,
    w: 5.4,
    h: 1.1,
    rectRadius: 0.12,
    fill: { color: 'FEE2E2' },
    line: { color: 'EF4444', width: 2 },
  })
  slide3.addText('Neighbour slide warmup target.', {
    x: 1.1,
    y: 2.02,
    w: 5,
    h: 0.4,
    fontSize: 20,
    color: '7F1D1D',
  })

  await pptx.writeFile({ fileName: filePath })
  await injectClickAnimation(filePath)
}

async function createNoteSample(filePath) {
  const now = new Date().toISOString()
  const project = {
    id: 'smoke-note-project',
    name: 'Smoke Note',
    bookId: 'blank',
    pages: [
      {
        id: 'smoke-note-page',
        name: 'Imported Note Page',
        strokes: [],
        view: { x: 0, y: 0, scale: 1 },
      },
    ],
    currentPageId: 'smoke-note-page',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
  await fs.writeFile(filePath, `${JSON.stringify({
    format: 'open-whiteboard.note',
    version: 1,
    app: 'ClearBoard Studio',
    createdAt: now,
    project,
  }, null, 2)}\n`, 'utf8')
}

async function createTextNoteSample(filePath) {
  const now = new Date().toISOString()
  const project = {
    id: 'smoke-text-note-project',
    name: 'Smoke Text Note',
    bookId: 'blank',
    pages: [
      {
        id: 'smoke-text-note-page',
        name: 'Text Note Page',
        strokes: [],
        texts: [
          {
            id: 'smoke-text-note-text',
            x: 120,
            y: 90,
            text: 'Keep this text',
            fontSize: 32,
            color: '#111827',
          },
        ],
        view: { x: 0, y: 0, scale: 1 },
      },
    ],
    currentPageId: 'smoke-text-note-page',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
  await fs.writeFile(filePath, `${JSON.stringify({
    format: 'open-whiteboard.note',
    version: 1,
    app: 'ClearBoard Studio',
    createdAt: now,
    project,
  }, null, 2)}\n`, 'utf8')
}

async function createDocxSample(filePath) {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    '<Default Extension="xml" ContentType="application/xml"/>',
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>',
    '</Types>',
  ].join(''))
  zip.folder('_rels').file('.rels', [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>',
    '</Relationships>',
  ].join(''))
  zip.folder('word').file('document.xml', [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
    '<w:body>',
    '<w:p><w:r><w:t>DOCX import smoke test</w:t></w:r></w:p>',
    '<w:p><w:r><w:t>Formatted content, tables and paragraphs should survive import better than raw text.</w:t></w:r></w:p>',
    '<w:tbl>',
    '<w:tr><w:tc><w:p><w:r><w:t>Topic</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Status</w:t></w:r></w:p></w:tc></w:tr>',
    '<w:tr><w:tc><w:p><w:r><w:t>Table import</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>visible</w:t></w:r></w:p></w:tc></w:tr>',
    '</w:tbl>',
    '<w:p><w:r><w:t>OpenWhiteboard should render this text page.</w:t></w:r></w:p>',
    '</w:body>',
    '</w:document>',
  ].join(''))
  await fs.writeFile(filePath, await zip.generateAsync({ type: 'nodebuffer' }))
}

async function createStreamingDocxSample(filePath) {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    '<Default Extension="xml" ContentType="application/xml"/>',
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>',
    '</Types>',
  ].join(''))
  zip.folder('_rels').file('.rels', [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>',
    '</Relationships>',
  ].join(''))
  const paragraphs = Array.from({ length: 80 }, (_value, index) =>
    `<w:p><w:r><w:t>Streaming DOCX paragraph ${index + 1}: this long classroom handout paragraph should force the renderer to create multiple whiteboard pages and append them one page at a time.</w:t></w:r></w:p>`,
  )
  zip.folder('word').file('document.xml', [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
    '<w:body>',
    '<w:p><w:r><w:t>Streaming DOCX import smoke</w:t></w:r></w:p>',
    ...paragraphs,
    '</w:body>',
    '</w:document>',
  ].join(''))
  await fs.writeFile(filePath, await zip.generateAsync({ type: 'nodebuffer' }))
}

async function createOdtSample(filePath) {
  const zip = new JSZip()
  zip.file('mimetype', 'application/vnd.oasis.opendocument.text', { compression: 'STORE' })
  zip.folder('META-INF').file('manifest.xml', [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2">',
    '<manifest:file-entry manifest:media-type="application/vnd.oasis.opendocument.text" manifest:full-path="/"/>',
    '<manifest:file-entry manifest:media-type="text/xml" manifest:full-path="content.xml"/>',
    '</manifest:manifest>',
  ].join(''))
  zip.file('content.xml', [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<office:document-content',
    ' xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"',
    ' xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"',
    ' office:version="1.2">',
    '<office:body><office:text>',
    '<text:h text:outline-level="1">ODT import smoke</text:h>',
    '<text:p>OpenDocument text should render without desktop conversion.</text:p>',
    '<text:p>Line one<text:line-break/>Line two<text:tab/>Tabbed value</text:p>',
    '</office:text></office:body>',
    '</office:document-content>',
  ].join(''))
  await fs.writeFile(filePath, await zip.generateAsync({ type: 'nodebuffer' }))
}

async function createOdpSample(filePath) {
  const zip = new JSZip()
  zip.file('mimetype', 'application/vnd.oasis.opendocument.presentation', { compression: 'STORE' })
  zip.folder('META-INF').file('manifest.xml', [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2">',
    '<manifest:file-entry manifest:media-type="application/vnd.oasis.opendocument.presentation" manifest:full-path="/"/>',
    '<manifest:file-entry manifest:media-type="text/xml" manifest:full-path="content.xml"/>',
    '</manifest:manifest>',
  ].join(''))
  zip.file('content.xml', [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<office:document-content',
    ' xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"',
    ' xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0"',
    ' xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"',
    ' office:version="1.2">',
    '<office:body><office:presentation>',
    '<draw:page draw:name="ODP smoke title">',
    '<draw:frame><draw:text-box>',
    '<text:h text:outline-level="1">ODP import smoke</text:h>',
    '<text:p>OpenDocument presentation should render without desktop conversion.</text:p>',
    '</draw:text-box></draw:frame>',
    '</draw:page>',
    '<draw:page draw:name="Second slide">',
    '<draw:frame><draw:text-box>',
    '<text:h text:outline-level="1">Second ODP slide</text:h>',
    '<text:p>Slide text becomes a whiteboard page for annotation.</text:p>',
    '</draw:text-box></draw:frame>',
    '</draw:page>',
    '</office:presentation></office:body>',
    '</office:document-content>',
  ].join(''))
  await fs.writeFile(filePath, await zip.generateAsync({ type: 'nodebuffer' }))
}

async function createOdsSample(filePath) {
  const zip = new JSZip()
  zip.file('mimetype', 'application/vnd.oasis.opendocument.spreadsheet', { compression: 'STORE' })
  zip.folder('META-INF').file('manifest.xml', [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2">',
    '<manifest:file-entry manifest:media-type="application/vnd.oasis.opendocument.spreadsheet" manifest:full-path="/"/>',
    '<manifest:file-entry manifest:media-type="text/xml" manifest:full-path="content.xml"/>',
    '</manifest:manifest>',
  ].join(''))
  zip.file('content.xml', [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<office:document-content',
    ' xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"',
    ' xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"',
    ' xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"',
    ' office:version="1.2">',
    '<office:body><office:spreadsheet>',
    '<table:table table:name="Data">',
    '<table:table-row>',
    '<table:table-cell><text:p>Topic</text:p></table:table-cell>',
    '<table:table-cell><text:p>Status</text:p></table:table-cell>',
    '</table:table-row>',
    '<table:table-row>',
    '<table:table-cell><text:p>ODS import</text:p></table:table-cell>',
    '<table:table-cell><text:p>visible</text:p></table:table-cell>',
    '</table:table-row>',
    '</table:table>',
    '</office:spreadsheet></office:body>',
    '</office:document-content>',
  ].join(''))
  await fs.writeFile(filePath, await zip.generateAsync({ type: 'nodebuffer' }))
}

async function createXlsxSample(filePath) {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    '<Default Extension="xml" ContentType="application/xml"/>',
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>',
    '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>',
    '<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>',
    '</Types>',
  ].join(''))
  zip.folder('_rels').file('.rels', [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>',
    '</Relationships>',
  ].join(''))
  const xl = zip.folder('xl')
  xl.file('workbook.xml', [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">',
    '<sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/><sheet name="Review" sheetId="2" r:id="rId2"/></sheets>',
    '</workbook>',
  ].join(''))
  xl.folder('_rels').file('workbook.xml.rels', [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>',
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>',
    '</Relationships>',
  ].join(''))
  xl.folder('worksheets').file('sheet1.xml', [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
    '<sheetData>',
    '<row r="1"><c r="A1" t="inlineStr"><is><t>name</t></is></c><c r="B1" t="inlineStr"><is><t>score</t></is></c></row>',
    '<row r="2"><c r="A2" t="inlineStr"><is><t>alpha</t></is></c><c r="B2"><v>95</v></c></row>',
    '</sheetData>',
    '</worksheet>',
  ].join(''))
  xl.folder('worksheets').file('sheet2.xml', [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
    '<sheetData>',
    '<row r="1"><c r="A1" t="inlineStr"><is><t>topic</t></is></c><c r="B1" t="inlineStr"><is><t>done</t></is></c></row>',
    '<row r="2"><c r="A2" t="inlineStr"><is><t>multi-sheet import</t></is></c><c r="B2" t="inlineStr"><is><t>yes</t></is></c></row>',
    '</sheetData>',
    '</worksheet>',
  ].join(''))
  await fs.writeFile(filePath, await zip.generateAsync({ type: 'nodebuffer' }))
}

async function createPdfSample(filePath) {
  const pdf = new jsPDF({ unit: 'pt', format: 'a4' })
  pdf.setFontSize(22)
  pdf.text('PDF import smoke test', 72, 96)
  pdf.setFontSize(14)
  pdf.text('OpenWhiteboard should render this PDF page.', 72, 132)
  await fs.writeFile(filePath, Buffer.from(pdf.output('arraybuffer')))
}

async function createLargePdfSample(filePath) {
  const pdf = new jsPDF({ unit: 'pt', format: [3200, 4800] })
  pdf.setFontSize(96)
  pdf.text('Large PDF import smoke test', 180, 260)
  pdf.setFontSize(48)
  pdf.text('The rendered canvas should be bounded for classroom imports.', 180, 380)
  await fs.writeFile(filePath, Buffer.from(pdf.output('arraybuffer')))
}

async function createStreamingPdfSample(filePath) {
  const pdf = new jsPDF({ unit: 'pt', format: 'a4' })
  pdf.setFontSize(22)
  pdf.text('Streaming PDF page 1', 72, 96)
  pdf.setFontSize(14)
  pdf.text('This page should be appended before page 2 finishes.', 72, 132)
  pdf.addPage()
  pdf.setFontSize(22)
  pdf.text('Streaming PDF page 2', 72, 96)
  pdf.setFontSize(14)
  pdf.text('The smoke test checks one append event per rendered page.', 72, 132)
  await fs.writeFile(filePath, Buffer.from(pdf.output('arraybuffer')))
}

async function createPngSample(filePath) {
  const redPixelPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/l8M0fwAAAABJRU5ErkJggg=='
  await fs.writeFile(filePath, Buffer.from(redPixelPng, 'base64'))
}

async function createBmpSample(filePath) {
  const width = 2
  const height = 2
  const rowSize = Math.ceil((24 * width) / 32) * 4
  const pixelSize = rowSize * height
  const fileSize = 54 + pixelSize
  const buffer = Buffer.alloc(fileSize)
  buffer.write('BM', 0, 'ascii')
  buffer.writeUInt32LE(fileSize, 2)
  buffer.writeUInt32LE(54, 10)
  buffer.writeUInt32LE(40, 14)
  buffer.writeInt32LE(width, 18)
  buffer.writeInt32LE(height, 22)
  buffer.writeUInt16LE(1, 26)
  buffer.writeUInt16LE(24, 28)
  buffer.writeUInt32LE(pixelSize, 34)
  const pixels = [
    [0xff, 0xff, 0xff], [0x18, 0x1f, 0xef],
    [0xff, 0x7b, 0x0f], [0x18, 0xef, 0x1f],
  ]
  let offset = 54
  for (let y = height - 1; y >= 0; y -= 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = pixels[y * width + x]
      buffer[offset++] = b
      buffer[offset++] = g
      buffer[offset++] = r
    }
    offset = 54 + (height - y) * rowSize
  }
  await fs.writeFile(filePath, buffer)
}

async function createGifSample(filePath) {
  const gif2x2 = 'R0lGODdhAgACAKECAAAAAP////8AAAAAACwAAAAAAgACAAACAkwBADs='
  await fs.writeFile(filePath, Buffer.from(gif2x2, 'base64'))
}

async function createAvifSample(filePath) {
  const avif8x8 = 'AAAAIGZ0eXBhdmlmAAAAAGF2aWZtaWYxbWlhZk1BMUIAAAD5bWV0YQAAAAAAAAAvaGRscgAAAAAAAAAAcGljdAAAAAAAAAAAAAAAAFBpY3R1cmVIYW5kbGVyAAAAAA5waXRtAAAAAAABAAAAHmlsb2MAAAAARAAAAQABAAAAAQAAASEAAAAbAAAAKGlpbmYAAAAAAAEAAAAaaW5mZQIAAAAAAQAAYXYwMUNvbG9yAAAAAGppcHJwAAAAS2lwY28AAAAUaXNwZQAAAAAAAAAIAAAACAAAABBwaXhpAAAAAAMICAgAAAAMYXYxQ4EADAAAAAATY29scm5jbHgAAgACAAIAAAAAF2lwbWEAAAAAAAAAAQABBAECgwQAAAAjbWRhdAoFGAi/bAIyEhgAAABQAABAA1Lt5xf080WmIA=='
  await fs.writeFile(filePath, Buffer.from(avif8x8, 'base64'))
}

async function createBrowserImageSample(page, filePath, mimeType) {
  const dataUrl = await page.evaluate((mimeType) => {
    const canvas = document.createElement('canvas')
    canvas.width = 64
    canvas.height = 40
    const context = canvas.getContext('2d')
    if (!context) throw new Error('canvas context unavailable')
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.fillStyle = '#0f7bff'
    context.fillRect(6, 6, 52, 28)
    context.fillStyle = '#ef1f18'
    context.fillRect(16, 14, 32, 12)
    return canvas.toDataURL(mimeType, 0.9)
  }, mimeType)
  const payload = dataUrl.split(',', 2)[1]
  if (!payload) throw new Error(`could not generate ${mimeType} sample`)
  await fs.writeFile(filePath, Buffer.from(payload, 'base64'))
}

async function fileToDataUrl(filePath, mimeType) {
  const payload = (await fs.readFile(filePath)).toString('base64')
  return `data:${mimeType};base64,${payload}`
}

async function dispatchHostImportMessage(page, type, fileName, content) {
  await installSmokeHelpers(page)
  await page.waitForSelector('.status-bar')
  await page.waitForFunction(() => document.querySelector('.whiteboard-app') !== null)
  await page.evaluate(
    ({ type, fileName, content }) => {
      window.dispatchEvent(new MessageEvent('message', { data: { type, fileName, content } }))
    },
    { type, fileName, content },
  )
}

async function dispatchHostImportFilesMessage(page, files) {
  await installSmokeHelpers(page)
  await page.waitForSelector('.status-bar')
  await page.waitForFunction(() => document.querySelector('.whiteboard-app') !== null)
  await page.evaluate(
    ({ files }) => {
      window.dispatchEvent(new MessageEvent('message', { data: { type: 'open-import-file', files } }))
    },
    { files },
  )
}

async function dispatchHostNoteWithFilesMessage(page, fileName, content, files) {
  await installSmokeHelpers(page)
  await page.waitForSelector('.status-bar')
  await page.waitForFunction(() => document.querySelector('.whiteboard-app') !== null)
  await page.evaluate(
    ({ fileName, content, files }) => {
      window.dispatchEvent(new MessageEvent('message', { data: { type: 'open-note-file', fileName, content, files } }))
    },
    { fileName, content, files },
  )
}

async function installFakeWebView(page) {
  await page.evaluate(() => {
    window.__openWhiteboardWebViewMessages = []
    window.chrome = {
      webview: {
        postMessage(message) {
          try {
            window.__openWhiteboardWebViewMessages.push(typeof message === 'string' ? JSON.parse(message) : message)
          } catch {
            window.__openWhiteboardWebViewMessages.push({ malformed: String(message) })
          }
        },
      },
    }
  })
}

async function installSmokeHelpers(page) {
  await page.evaluate(() => {
    window.__readStoredBlankProjectForSmoke = () =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open('open-whiteboard-db-blank', 1)
        request.onerror = () => reject(request.error)
        request.onsuccess = () => {
          const db = request.result
          const transaction = db.transaction('projects', 'readonly')
          const getRequest = transaction.objectStore('projects').get('builtin:blank')
          getRequest.onerror = () => reject(getRequest.error)
          getRequest.onsuccess = () => resolve(getRequest.result)
        }
      })
    window.__readStoredProjectWithImageForSmoke = (imageName) =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open('open-whiteboard-db-blank', 1)
        request.onerror = () => reject(request.error)
        request.onsuccess = () => {
          const db = request.result
          const transaction = db.transaction('projects', 'readonly')
          const getRequest = transaction.objectStore('projects').getAll()
          getRequest.onerror = () => reject(getRequest.error)
          getRequest.onsuccess = () => {
            resolve(getRequest.result.find((project) =>
              project?.pages?.some((page) => page.image?.name === imageName),
            ))
          }
        }
      })
  })
}

async function resetWhiteboardStorage(page) {
  await page.evaluate(async () => {
    localStorage.clear()
    for (const name of ['open-whiteboard-db', 'open-whiteboard-db-blank', 'open-whiteboard-db-textbook']) {
      await new Promise((resolve, reject) => {
        const request = indexedDB.deleteDatabase(name)
        request.onsuccess = () => resolve(undefined)
        request.onerror = () => reject(request.error)
        request.onblocked = () => resolve(undefined)
      })
    }
  })
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
  const updated = xml.replace('</p:sld>', `${timing}</p:sld>`)
  zip.file(slidePath, updated)
  const output = await zip.generateAsync({ type: 'nodebuffer' })
  await fs.writeFile(filePath, output)
}

async function currentPresentationState(page) {
  return page.evaluate(() =>
    {
      const overlay = document.querySelector('canvas[data-presentation-overlay="true"]')
      return {
        slideIndex: overlay?.getAttribute('data-presentation-slide-index') ?? null,
        animationClick: overlay?.getAttribute('data-presentation-animation-click') ?? null,
        animationMax: overlay?.getAttribute('data-presentation-animation-max') ?? null,
        animationCacheSize: overlay?.getAttribute('data-presentation-animation-cache-size') ?? null,
        slideCacheSize: overlay?.getAttribute('data-presentation-slide-cache-size') ?? null,
        slideCachePending: overlay?.getAttribute('data-presentation-slide-cache-pending') ?? null,
        blobCacheSize: overlay?.getAttribute('data-presentation-blob-cache-size') ?? null,
        navigationQueueSize: overlay?.getAttribute('data-presentation-navigation-queue-size') ?? null,
        autoPlaying: overlay?.getAttribute('data-presentation-autoplay') ?? null,
        monitorIntervalMs: overlay?.getAttribute('data-presentation-monitor-interval-ms') ?? null,
      }
    },
  )
}

async function presentationAttribute(page, name) {
  return page.evaluate((name) =>
    document.querySelector('canvas[data-presentation-overlay="true"]')?.getAttribute(name) ?? null,
  name)
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

async function waitForStoredProjectWithImage(page, imageName, timeout = 20000) {
  await installSmokeHelpers(page)
  const started = Date.now()
  while (Date.now() - started < timeout) {
    const project = await page.evaluate((imageName) => window.__readStoredProjectWithImageForSmoke(imageName), imageName)
    if (project) return project
    await new Promise((resolve) => setTimeout(resolve, 120))
  }
  throw new Error(`stored project containing ${imageName} was not saved`)
}

async function waitForStoredBlankProjectMinPages(page, pageCount, timeout = 20000) {
  await installSmokeHelpers(page)
  const started = Date.now()
  while (Date.now() - started < timeout) {
    const project = await page.evaluate(() => window.__readStoredBlankProjectForSmoke())
    if (project?.pages?.length >= pageCount) return project
    await new Promise((resolve) => setTimeout(resolve, 120))
  }
  throw new Error(`stored blank project did not reach ${pageCount} pages`)
}

async function currentPresentationStrokeCount(page) {
  return page.evaluate(() =>
    Number(document.querySelector('canvas[data-presentation-overlay="true"]')?.getAttribute('data-presentation-stroke-count') ?? 0),
  )
}

async function currentPresentationPointCount(page) {
  return page.evaluate(() =>
    Number(document.querySelector('canvas[data-presentation-overlay="true"]')?.getAttribute('data-presentation-point-count') ?? 0),
  )
}

async function currentPresentationLastPoint(page) {
  return page.evaluate(() => {
    const overlay = document.querySelector('canvas[data-presentation-overlay="true"]')
    const x = Number(overlay?.getAttribute('data-presentation-last-point-screen-x') ?? NaN)
    const y = Number(overlay?.getAttribute('data-presentation-last-point-screen-y') ?? NaN)
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null
  })
}

async function presentationRawUpdateState(page) {
  return page.evaluate(() => {
    const overlay = document.querySelector('canvas[data-presentation-overlay="true"]')
    return {
      enabled: overlay?.getAttribute('data-presentation-raw-pointer-updates') === 'true',
      count: Number(overlay?.getAttribute('data-presentation-raw-update-count') ?? 0),
    }
  })
}

async function installDownloadCapture(page) {
  await page.evaluate(() => {
    window.__capturedDownloads = []
    const originalCreateObjectUrl = URL.createObjectURL.bind(URL)
    const originalRevokeObjectUrl = URL.revokeObjectURL.bind(URL)
    window.__restoreDownloadCaptureForSmoke?.()
    URL.createObjectURL = (blob) => {
      const url = originalCreateObjectUrl(blob)
      if (blob instanceof Blob) {
        void blob.arrayBuffer().then((buffer) => {
          const bytes = new Uint8Array(buffer)
          const isPng =
            bytes.length >= 24 &&
            bytes[0] === 0x89 &&
            bytes[1] === 0x50 &&
            bytes[2] === 0x4e &&
            bytes[3] === 0x47
          const width = isPng ? new DataView(buffer).getUint32(16) : 0
          const height = isPng ? new DataView(buffer).getUint32(20) : 0
          window.__capturedDownloads.push({
            url,
            type: blob.type,
            byteLength: blob.size,
            width,
            height,
          })
        })
      }
      return url
    }
    URL.revokeObjectURL = (url) => {
      if (!String(url).startsWith('blob:')) originalRevokeObjectUrl(url)
    }
    window.__restoreDownloadCaptureForSmoke = () => {
      URL.createObjectURL = originalCreateObjectUrl
      URL.revokeObjectURL = originalRevokeObjectUrl
    }
  })
}

async function drawBoardStroke(page) {
  const point = await page.evaluate(() => {
    const canvases = Array.from(document.querySelectorAll('.konvajs-content canvas'))
      .map((canvas) => ({ rect: canvas.getBoundingClientRect() }))
      .filter(({ rect }) => rect.width > 100 && rect.height > 100)
      .sort((a, b) => (b.rect.width * b.rect.height) - (a.rect.width * a.rect.height))
    const rect = canvases[0]?.rect
    if (!rect) return null
    return {
      x: rect.left + rect.width * 0.48,
      y: rect.top + rect.height * 0.48,
    }
  })
  if (!point) throw new Error('whiteboard canvas not found for export stroke')
  await page.mouse.move(point.x, point.y)
  await page.mouse.down()
  await page.mouse.move(point.x + 70, point.y + 28, { steps: 8 })
  await page.mouse.up()
  await page.waitForTimeout(120)
}

async function drawPresentationStroke(page) {
  const point = await page.evaluate(() => {
    const slideCanvas = Array.from(document.querySelectorAll('canvas'))
      .filter((canvas) => !canvas.matches('[data-presentation-overlay="true"]'))
      .map((canvas) => ({ canvas, rect: canvas.getBoundingClientRect() }))
      .filter(({ rect }) => rect.width > 100 && rect.height > 100)
      .sort((a, b) => (b.rect.width * b.rect.height) - (a.rect.width * a.rect.height))[0]
    const rect = slideCanvas?.rect
    if (!rect) return null
    return {
      x: rect.left + rect.width * 0.35,
      y: rect.top + rect.height * 0.4,
    }
  })
  if (!point) throw new Error('presentation slide canvas not found')
  await page.mouse.move(point.x, point.y)
  await page.mouse.down()
  await page.evaluate(({ x, y }) => {
    const overlay = document.querySelector('canvas[data-presentation-overlay="true"]')
    if (!overlay || typeof PointerEvent === 'undefined') return
    for (let index = 1; index <= 4; index += 1) {
      overlay.dispatchEvent(new PointerEvent('pointerrawupdate', {
        bubbles: true,
        cancelable: true,
        pointerId: 1,
        pointerType: 'pen',
        isPrimary: true,
        pressure: 0.62,
        buttons: 1,
        clientX: x + index * 18,
        clientY: y + index * 7,
      }))
    }
  }, point)
  await page.mouse.move(point.x + 90, point.y + 35, { steps: 8 })
  await page.mouse.up()
  return {
    start: point,
    end: { x: point.x + 90, y: point.y + 35 },
  }
}

async function beginPresentationStrokeWithoutPointerUp(page) {
  const point = await page.evaluate(() => {
    const slideCanvas = Array.from(document.querySelectorAll('canvas'))
      .filter((canvas) => !canvas.matches('[data-presentation-overlay="true"]'))
      .map((canvas) => ({ canvas, rect: canvas.getBoundingClientRect() }))
      .filter(({ rect }) => rect.width > 100 && rect.height > 100)
      .sort((a, b) => (b.rect.width * b.rect.height) - (a.rect.width * a.rect.height))[0]
    const rect = slideCanvas?.rect
    if (!rect) return null
    return {
      x: rect.left + rect.width * 0.42,
      y: rect.top + rect.height * 0.46,
    }
  })
  if (!point) throw new Error('presentation slide canvas not found')
  await page.mouse.move(point.x, point.y)
  await page.mouse.down()
  await page.evaluate(({ x, y }) => {
    const overlay = document.querySelector('canvas[data-presentation-overlay="true"]')
    if (!overlay || typeof PointerEvent === 'undefined') return
    for (let index = 1; index <= 3; index += 1) {
      overlay.dispatchEvent(new PointerEvent('pointerrawupdate', {
        bubbles: true,
        cancelable: true,
        pointerId: 1,
        pointerType: 'pen',
        isPrimary: true,
        pressure: 0.7,
        buttons: 1,
        clientX: x + index * 16,
        clientY: y + index * 8,
      }))
    }
  }, point)
  await page.mouse.move(point.x + 72, point.y + 36, { steps: 5 })
}

async function erasePresentationStroke(page, path) {
  await page.mouse.move(path.start.x - 18, path.start.y - 8)
  await page.mouse.down()
  await page.mouse.move(path.end.x + 18, path.end.y + 8, { steps: 14 })
  await page.mouse.up()
  await page.mouse.move(path.end.x + 24, path.end.y + 12)
  await page.mouse.down()
  await page.mouse.move(path.start.x - 24, path.start.y - 12, { steps: 16 })
  await page.mouse.up()
  await page.waitForTimeout(250)
}

async function clickPresentationOverlay(page) {
  const box = await page.locator('canvas[data-presentation-overlay="true"]').boundingBox()
  if (!box) throw new Error('presentation overlay canvas not found')
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.45)
}

async function rapidPresentationOverlayClicks(page, count) {
  await page.evaluate((count) => {
    const overlay = document.querySelector('canvas[data-presentation-overlay="true"]')
    if (!overlay || typeof PointerEvent === 'undefined') throw new Error('presentation overlay canvas not found')
    const rect = overlay.getBoundingClientRect()
    const clientX = rect.left + rect.width * 0.5
    const clientY = rect.top + rect.height * 0.45
    for (let index = 0; index < count; index += 1) {
      const pointerId = 4100 + index
      overlay.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true,
        cancelable: true,
        pointerId,
        pointerType: 'mouse',
        button: 0,
        buttons: 1,
        clientX,
        clientY,
      }))
      overlay.dispatchEvent(new PointerEvent('pointerup', {
        bubbles: true,
        cancelable: true,
        pointerId,
        pointerType: 'mouse',
        button: 0,
        buttons: 0,
        clientX,
        clientY,
      }))
    }
  }, count)
}

async function readSavedProjectNoteText(page) {
  await installSmokeHelpers(page)
  return page.evaluate(async () => {
    const project = await window.__readStoredBlankProjectForSmoke()
    if (!project || !Array.isArray(project.pages)) {
      throw new Error('saved project was not found in IndexedDB')
    }
    return `${JSON.stringify({
      format: 'open-whiteboard.note',
      version: 1,
      app: 'ClearBoard Studio',
      createdAt: new Date().toISOString(),
      project,
    }, null, 2)}\n`
  })
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
