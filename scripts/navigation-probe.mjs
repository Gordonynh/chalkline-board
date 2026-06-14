import { launchHeadlessBrowser } from './playwright-browser.mjs'

const targetUrl = process.argv[2] ?? 'http://127.0.0.1:5175/?perf=1'
const switchCount = Number(process.env.WHITEBOARD_NAV_SWITCHES ?? 24)
const pageCount = Number(process.env.WHITEBOARD_NAV_PAGES ?? 120)
const strokesPerPage = Number(process.env.WHITEBOARD_NAV_STROKES_PER_PAGE ?? 6)
const maxAverageSwitchMs = Number(process.env.WHITEBOARD_NAV_MAX_AVG_SWITCH_MS ?? Number.POSITIVE_INFINITY)
const installSyntheticProject = process.env.WHITEBOARD_NAV_INSTALL_PROJECT !== '0'
const verifyTextbookSwitch = process.env.WHITEBOARD_NAV_TEXTBOOK_SWITCH === '1'

const browser = await launchHeadlessBrowser()
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
const errors = []
page.setDefaultNavigationTimeout(90000)
page.setDefaultTimeout(60000)
page.on('pageerror', (error) => errors.push(String(error)))

await page.goto(targetUrl, { waitUntil: 'domcontentloaded' })
await waitForWhiteboardReady(page)

let timings = []
let pageCountText = await page.locator('.page-count-button').textContent().catch(() => '')
let textbookSwitch = null

if (installSyntheticProject) {
  await installNavigationProject(page, pageCount, strokesPerPage)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await waitForWhiteboardReady(page)
  await page.waitForFunction(
    (expected) => document.querySelector('.page-count-button')?.textContent?.includes(`/${expected}`),
    pageCount,
    { timeout: 15000 },
  )

  timings = await measurePageSwitches(page, switchCount, pageCount)
  pageCountText = await page.locator('.page-count-button').textContent()
}

if (verifyTextbookSwitch) {
  textbookSwitch = await verifyTextbookBookSwitch(page)
  pageCountText = textbookSwitch.finalPageCountText
}

await browser.close()

const elapsedValues = timings.map((timing) => timing.elapsedMs)
const averageSwitchMs = elapsedValues.reduce((total, value) => total + value, 0) / Math.max(1, elapsedValues.length)
const maxSwitchMs = Math.max(0, ...elapsedValues)
const slowest = [...timings].sort((left, right) => right.elapsedMs - left.elapsedMs).slice(0, 5)
console.log(
  JSON.stringify(
    {
      errors,
      switchCount,
      pageCount,
      strokesPerPage,
      pageCountText,
      averageSwitchMs,
      maxSwitchMs,
      firstSwitches: timings.slice(0, 6),
      slowest,
      textbookSwitch,
    },
    null,
    2,
  ),
)

if (errors.length) process.exitCode = 1
if (averageSwitchMs > maxAverageSwitchMs) process.exitCode = 1
if (installSyntheticProject && !pageCountText?.includes(`/${pageCount}`)) process.exitCode = 1
if (verifyTextbookSwitch && !textbookSwitch?.ok) process.exitCode = 1

async function measurePageSwitches(page, switchCount, pageCount) {
  const timings = []
  for (let index = 0; index < switchCount; index += 1) {
    const currentPage = await currentPageNumber(page)
    const next = currentPage <= 1 || (currentPage < pageCount && index % 5 !== 4)
    const expectedPage = next ? Math.min(pageCount, currentPage + 1) : Math.max(1, currentPage - 1)
    const selector = next
      ? 'button[title="\u4e0b\u4e00\u9875"],button[title="Next"]'
      : 'button[title="\u4e0a\u4e00\u9875"],button[title="Previous"]'
    const startedAt = performance.now()
    await page.locator(selector).click()
    await waitForCurrentPage(page, expectedPage)
    timings.push({
      index,
      direction: next ? 'next' : 'previous',
      elapsedMs: performance.now() - startedAt,
      pageCountText: await page.locator('.page-count-button').textContent(),
    })
  }
  return timings
}

async function verifyTextbookBookSwitch(page) {
  await resetTextbookStorage(page)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await waitForWhiteboardReady(page)
  await openBookPickerIfNeeded(page)
  await page.waitForSelector('.book-picker .book-card', { timeout: 15000 })
  const cardCount = await page.locator('.book-picker .book-card').count()
  if (cardCount < 2) {
    return { ok: false, reason: `expected at least 2 textbook cards, got ${cardCount}`, finalPageCountText: '' }
  }

  await page.locator('.book-picker .book-card').nth(1).click()
  await page.waitForFunction(() => document.querySelector('.page-count-button')?.textContent?.includes('/212'), undefined, { timeout: 15000 })
  const afterSecondBook = await textbookState(page)

  await openBookPickerIfNeeded(page)
  await page.locator('.book-picker .book-card').nth(0).click()
  await page.waitForFunction(() => document.querySelector('.page-count-button')?.textContent?.includes('/260'), undefined, { timeout: 15000 })
  const afterMainBook = await textbookState(page)

  return {
    ok:
      afterSecondBook.selectedBookId === 'textbook-110' &&
      afterSecondBook.pageCountText.includes('/212') &&
      afterSecondBook.statusText.includes('\u4e00\u8f6e\u590d\u4e60110\u7ec3') &&
      afterMainBook.selectedBookId === 'textbook-main' &&
      afterMainBook.pageCountText.includes('/260') &&
      afterMainBook.statusText.includes('\u6559\u6750'),
    afterSecondBook,
    afterMainBook,
    finalPageCountText: afterMainBook.pageCountText,
  }
}

async function waitForWhiteboardReady(page) {
  await page.waitForSelector('.whiteboard-app', { timeout: 60000 })
  await page.waitForSelector('.board-stage canvas', { state: 'attached', timeout: 60000 })
}

async function resetTextbookStorage(page) {
  await page.evaluate(async () => {
    localStorage.removeItem('open-whiteboard-selected-book-textbook')
    localStorage.removeItem('open-whiteboard-selected-book')
    await new Promise((resolve) => {
      const request = indexedDB.deleteDatabase('open-whiteboard-db-textbook')
      request.onsuccess = () => resolve(undefined)
      request.onerror = () => resolve(undefined)
      request.onblocked = () => resolve(undefined)
    })
  })
}

async function openBookPickerIfNeeded(page) {
  const visible = await page.locator('.book-picker').isVisible().catch(() => false)
  if (visible) return
  const clicked = await page.evaluate(() => {
    const button = Array.from(document.querySelectorAll('button')).find((item) => {
      const text = item.textContent ?? ''
      const title = item.getAttribute('title') ?? ''
      return text.includes('\u4e66\u7c4d') || title.includes('\u4e66\u7c4d') || /books/i.test(text) || /books/i.test(title)
    })
    button?.click()
    return Boolean(button)
  })
  if (!clicked) throw new Error('book picker button was not found')
  await page.waitForSelector('.book-picker .book-card', { timeout: 15000 })
}

async function textbookState(page) {
  return page.evaluate(() => {
    const pageCountText = document.querySelector('.page-count-button')?.textContent ?? ''
    return {
      selectedBookId: localStorage.getItem('open-whiteboard-selected-book-textbook') ?? '',
      pageCountText,
      statusText: document.querySelector('.status-bar')?.textContent ?? '',
    }
  })
}

async function installNavigationProject(page, pageCount, strokesPerPage) {
  await page.evaluate(
    async ({ pageCount, strokesPerPage }) => {
      localStorage.setItem('open-whiteboard-selected-book-blank', 'blank')
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open('open-whiteboard-db-blank', 1)
        request.onerror = () => reject(request.error)
        request.onsuccess = () => resolve(request.result)
        request.onupgradeneeded = () => {
          request.result.createObjectStore('projects')
        }
      })
      const pages = Array.from({ length: pageCount }, (_, pageIndex) => ({
        id: `nav-page-${pageIndex + 1}`,
        name: `Navigation ${String(pageIndex + 1).padStart(3, '0')}`,
        strokes: makeStrokes(pageIndex, strokesPerPage),
        view: { x: 0, y: 0, scale: 1 },
      }))
      const project = {
        bookId: 'blank',
        pages,
        currentPageId: pages[0].id,
        updatedAt: Date.now(),
      }
      await new Promise((resolve, reject) => {
        const transaction = db.transaction('projects', 'readwrite')
        transaction.objectStore('projects').put(project, 'builtin:blank')
        transaction.oncomplete = () => resolve(undefined)
        transaction.onerror = () => reject(transaction.error)
      })
      db.close()

      function makeStrokes(pageIndex, strokeCount) {
        return Array.from({ length: strokeCount }, (_, strokeIndex) => {
          const y = 120 + strokeIndex * 48
          const points = []
          const pressures = []
          for (let pointIndex = 0; pointIndex < 48; pointIndex += 1) {
            points.push(160 + pointIndex * 18, y + Math.sin((pointIndex + pageIndex) / 5) * 18)
            pressures.push(0.55 + (pointIndex % 8) * 0.035)
          }
          return {
            id: `nav-stroke-${pageIndex}-${strokeIndex}`,
            kind: 'pen',
            color: ['#ef1f18', '#0f7bff', '#16a34a'][strokeIndex % 3],
            width: 8,
            opacity: 1,
            points,
            pressures,
            pressureSource: 'native',
          }
        })
      }
    },
    { pageCount, strokesPerPage },
  )
}

async function currentPageNumber(page) {
  const text = await page.locator('.page-count-button').textContent()
  return Number.parseInt(String(text ?? '').split('/')[0], 10)
}

async function waitForCurrentPage(page, expectedPage) {
  await page.waitForFunction(
    (expectedPage) => {
      const text = document.querySelector('.page-count-button')?.textContent ?? ''
      return Number.parseInt(text.split('/')[0], 10) === expectedPage
    },
    expectedPage,
    { timeout: 10000 },
  )
}
