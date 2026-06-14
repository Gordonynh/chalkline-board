import { launchHeadlessBrowser } from './playwright-browser.mjs'

const targetUrl = process.argv[2] ?? 'http://127.0.0.1:5175/?perf=1'
const scenario = process.argv[3] ?? 'all'
const seed = Number(process.env.WHITEBOARD_STRESS_SEED ?? 20260530)
const yieldEveryStrokes = readPositiveInt('WHITEBOARD_STRESS_YIELD_EVERY', 1)
const maxLiveDrawMs = readPositiveNumber('WHITEBOARD_STRESS_MAX_LIVE_DRAW_MS', Number.POSITIVE_INFINITY)
const maxInputToDrawMs = readPositiveNumber('WHITEBOARD_STRESS_MAX_INPUT_TO_DRAW_MS', Number.POSITIVE_INFINITY)
const maxCommittedRenderMs = readPositiveNumber('WHITEBOARD_STRESS_MAX_COMMITTED_RENDER_MS', Number.POSITIVE_INFINITY)
const maxEraseElapsedMs = readPositiveNumber('WHITEBOARD_STRESS_MAX_ERASE_ELAPSED_MS', Number.POSITIVE_INFINITY)

const scenarios = {
  long: { pages: 1, strokesPerPage: 100, movesPerStroke: 3000 },
  many: { pages: 1, strokesPerPage: 5000, movesPerStroke: 80 },
  big: { pages: 10, strokesPerPage: 700, movesPerStroke: 80 },
  erase: { pages: 1, strokesPerPage: 2500, movesPerStroke: 64, eraseMoves: 260 },
}
const defaultScenarioNames = ['long', 'many', 'big']

const selectedScenarios = (scenario === 'all' ? defaultScenarioNames.map((name) => [name, scenarios[name]]) : [[scenario, scenarios[scenario]]])
  .map(([name, config]) => [name, withEnvOverrides(config)])
if (selectedScenarios.some(([, config]) => !config)) {
  throw new Error(`Unknown scenario "${scenario}". Use one of: ${Object.keys(scenarios).join(', ')}, all`)
}

const browser = await launchHeadlessBrowser()
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
const errors = []
page.setDefaultNavigationTimeout(90000)
page.setDefaultTimeout(60000)
page.on('pageerror', (error) => errors.push(String(error)))

await page.goto(targetUrl, { waitUntil: 'domcontentloaded' })
await waitForWhiteboardReady(page)

const results = []
for (const [name, config] of selectedScenarios) {
  await resetProject(page)
  await page.evaluate(() => window.__whiteboardPerf?.reset())
  const startedAt = Date.now()

  for (let pageIndex = 0; pageIndex < config.pages; pageIndex += 1) {
    await page.evaluate(
      async ({ seed, pageIndex, strokesPerPage, movesPerStroke, yieldEveryStrokes }) => {
        const stage = document.querySelector('.konvajs-content')
        if (!(stage instanceof HTMLElement)) throw new Error('board stage not found')

        const random = makeRandom(seed + pageIndex * 1000003)
        const bounds = stage.getBoundingClientRect()
        const minX = bounds.left + 120
        const maxX = bounds.right - 120
        const minY = bounds.top + 120
        const maxY = bounds.bottom - 120
        let pointerId = 1000 + pageIndex * 10000

        for (let stroke = 0; stroke < strokesPerPage; stroke += 1) {
          pointerId += 1
          let x = minX + random() * (maxX - minX)
          let y = minY + random() * (maxY - minY)
          let direction = random() * Math.PI * 2
          let curve = (random() - 0.5) * 0.16
          const step = 1.2 + random() * 2.6

          dispatchPointer(stage, 'pointerdown', x, y, pointerId, 0.55)
          for (let move = 0; move < movesPerStroke; move += 1) {
            direction += curve + (random() - 0.5) * 0.12
            curve = curve * 0.985 + (random() - 0.5) * 0.012
            x += Math.cos(direction) * step
            y += Math.sin(direction) * step

            if (x < minX || x > maxX) {
              direction = Math.PI - direction
              x = Math.min(maxX, Math.max(minX, x))
            }
            if (y < minY || y > maxY) {
              direction = -direction
              y = Math.min(maxY, Math.max(minY, y))
            }

            const pressure = 0.35 + random() * 0.55
            dispatchPointer(stage, 'pointerrawupdate', x, y, pointerId, pressure)
            dispatchPointer(stage, 'pointermove', x, y, pointerId, pressure)
          }
          dispatchPointer(stage, 'pointerup', x, y, pointerId, 0)
          if ((stroke + 1) % yieldEveryStrokes === 0) {
            await new Promise((resolve) => setTimeout(resolve, 0))
            await new Promise((resolve) => requestAnimationFrame(resolve))
          }
        }

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
              buttons: type === 'pointerup' ? 0 : 1,
              button: type === 'pointerdown' ? 0 : -1,
            }),
          )
        }

        function makeRandom(initialSeed) {
          let state = initialSeed >>> 0
          return () => {
            state = (state * 1664525 + 1013904223) >>> 0
            return state / 0x100000000
          }
        }
      },
      {
        seed,
        pageIndex,
        strokesPerPage: config.strokesPerPage,
        movesPerStroke: config.movesPerStroke,
        yieldEveryStrokes,
      },
    )

    if (pageIndex < config.pages - 1) {
      await page.getByTitle('新建页面').click()
      await page.waitForTimeout(0)
    }
  }

  const eraseResult = config.eraseMoves ? await performErase(page, config.eraseMoves) : { elapsedMs: 0, stats: null }

  await page.waitForTimeout(500)
  const stats = await page.evaluate(() => window.__whiteboardPerf?.snapshot())
  results.push({
    name,
    config,
    elapsedMs: Date.now() - startedAt,
    eraseElapsedMs: eraseResult.elapsedMs,
    eraseStats: eraseResult.stats,
    stats,
  })
}

await browser.close()
console.log(JSON.stringify({ errors, seed, results }, null, 2))

if (errors.length) process.exitCode = 1
if (results.some((result) => !result.config.eraseMoves && !result.stats?.liveDraws)) process.exitCode = 1
for (const result of results) {
  if (result.stats.maxLiveDrawMs > maxLiveDrawMs) {
    console.error(`${result.name}: maxLiveDrawMs ${result.stats.maxLiveDrawMs} exceeded ${maxLiveDrawMs}`)
    process.exitCode = 1
  }
  if (result.stats.maxInputToDrawMs > maxInputToDrawMs) {
    console.error(`${result.name}: maxInputToDrawMs ${result.stats.maxInputToDrawMs} exceeded ${maxInputToDrawMs}`)
    process.exitCode = 1
  }
  if (result.stats.maxCommittedRenderMs > maxCommittedRenderMs) {
    console.error(`${result.name}: maxCommittedRenderMs ${result.stats.maxCommittedRenderMs} exceeded ${maxCommittedRenderMs}`)
    process.exitCode = 1
  }
  if (result.eraseElapsedMs > maxEraseElapsedMs) {
    console.error(`${result.name}: eraseElapsedMs ${result.eraseElapsedMs} exceeded ${maxEraseElapsedMs}`)
    process.exitCode = 1
  }
}

function withEnvOverrides(config) {
  if (!config) return config
  return {
    pages: readPositiveInt('WHITEBOARD_STRESS_PAGES', config.pages),
    strokesPerPage: readPositiveInt('WHITEBOARD_STRESS_STROKES', config.strokesPerPage),
    movesPerStroke: readPositiveInt('WHITEBOARD_STRESS_MOVES', config.movesPerStroke),
    eraseMoves: config.eraseMoves ? readPositiveInt('WHITEBOARD_STRESS_ERASE_MOVES', config.eraseMoves) : undefined,
  }
}

function readPositiveInt(name, fallback) {
  const raw = process.env[name]
  if (raw == null || raw === '') return fallback
  const value = Number(raw)
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`)
  return value
}

function readPositiveNumber(name, fallback) {
  const raw = process.env[name]
  if (raw == null || raw === '') return fallback
  const value = Number(raw)
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number`)
  return value
}

async function resetProject(page) {
  await page.evaluate(async () => {
    localStorage.clear()
    const databases = await indexedDB.databases?.()
    if (databases) {
      await Promise.all(
        databases
          .map((database) => database.name)
          .filter(Boolean)
          .map(
            (name) =>
              new Promise((resolve) => {
                const request = indexedDB.deleteDatabase(name)
                request.onsuccess = request.onerror = request.onblocked = () => resolve(undefined)
              }),
          ),
      )
    }
  })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await waitForWhiteboardReady(page)
}

async function waitForWhiteboardReady(page) {
  await page.waitForSelector('.whiteboard-app', { timeout: 60000 })
  await page.waitForSelector('.board-stage canvas', { state: 'attached', timeout: 60000 })
}

async function performErase(page, moveCount) {
  await page.evaluate(() => window.__whiteboardPerf?.reset())
  await page.getByTitle('\u6a61\u76ae').click()
  const stage = page.locator('.konvajs-content')
  const box = await stage.boundingBox()
  if (!box) throw new Error('board stage not found for eraser')
  const startedAt = Date.now()
  const y = box.y + box.height * 0.5
  await page.mouse.move(box.x + box.width * 0.12, y)
  await page.mouse.down()
  for (let index = 0; index < moveCount; index += 1) {
    const ratio = index / Math.max(1, moveCount - 1)
    await page.mouse.move(box.x + box.width * (0.12 + ratio * 0.76), y + Math.sin(index / 9) * 36, { steps: 1 })
  }
  await page.mouse.up()
  await page.waitForTimeout(40)
  return {
    elapsedMs: Date.now() - startedAt,
    stats: await page.evaluate(() => window.__whiteboardPerf?.snapshot()),
  }
}
