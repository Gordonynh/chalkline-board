import { memo } from 'react'
import { Group, Line, Rect, Shape } from 'react-konva'
import type Konva from 'konva'
/* eslint-disable react-refresh/only-export-components */
import { DEFAULT_BOOK_ID, getBuiltInBook } from '../books'
import type { BuiltInBook } from '../books'
import { loadCanvasImage } from './imageCache'

type Tool = 'select' | 'pen' | 'highlighter' | 'eraser' | 'pan' | 'laser'
type HostCommand = 'close' | 'minimize'

type StrokeKind = 'pen' | 'highlighter'

interface BoardImage {
  src: string
  name: string
  width: number
  height: number
}

interface Stroke {
  id: string
  kind: StrokeKind
  points: number[]
  pressures?: number[]
  pressureSource?: 'native' | 'velocity'
  lastInputTime?: number
  color: string
  width: number
  opacity: number
}

interface TextNote {
  id: string
  x: number
  y: number
  text: string
  color: string
  fontSize: number
}

interface PageView {
  x: number
  y: number
  scale: number
}

interface BoardPresentation {
  id: string
  name: string
  kind: 'pptx'
  src: string
  slideCount: number
}

interface BoardPresentationRef {
  id: string
  slideIndex: number
}

interface ScreenPoint {
  x: number
  y: number
}

interface PinchStart {
  center: ScreenPoint
  distance: number
  view: PageView
  boardCenter: ScreenPoint
}

interface BoardPage {
  id: string
  name: string
  image?: BoardImage
  presentation?: BoardPresentationRef
  strokes: Stroke[]
  texts?: TextNote[]
  view: PageView
}

interface BoardProject {
  bookId: string
  pages: BoardPage[]
  presentations?: BoardPresentation[]
  currentPageId: string
  updatedAt: number
}

interface BoardPointerPoint {
  x: number
  y: number
  screenX: number
  screenY: number
  pressure?: number
  eraserRadius?: number
  time: number
}

const APP_STORAGE_SCOPE =
  import.meta.env.VITE_APP_KIND === 'textbook' ? 'textbook' : import.meta.env.VITE_APP_KIND === 'visualizer' ? 'visualizer' : 'blank'
const DB_NAME = `open-whiteboard-db-${APP_STORAGE_SCOPE}`
const LEGACY_DB_NAME = 'open-whiteboard-db'
const DB_VERSION = 1
const PROJECT_STORE = 'projects'
const SELECTED_BOOK_KEY = `open-whiteboard-selected-book-${APP_STORAGE_SCOPE}`
const LEGACY_SELECTED_BOOK_KEY = 'open-whiteboard-selected-book'
const EMPTY_PAGE_SIZE = { width: 1280, height: 720 }

const standardPenColors = ['#000000', '#ef1f18', '#0f7bff', '#f97316', '#7c3aed', '#16a34a']
const pantonePenColors = ['#0f4c81', '#bb2649', '#dd4124', '#009473', '#5f4b8b', '#955251']
const quickPenColors = ['#000000', '#ef1f18', '#0f7bff']
const colors = [...standardPenColors, ...pantonePenColors]

const configurableTools = new Set<Tool>(['pen', 'highlighter', 'eraser'])
const toolShortcuts: Record<string, Tool> = {
  '1': 'select',
  v: 'select',
  '2': 'pen',
  p: 'pen',
  '3': 'highlighter',
  h: 'highlighter',
  '4': 'eraser',
  e: 'eraser',
  '5': 'pan',
  m: 'pan',
  '6': 'laser',
  l: 'laser',
}
const toolLabels: Record<Tool, string> = {
  select: '选择',
  pen: '教笔',
  highlighter: '荧光',
  eraser: '橡皮',
  pan: '漫游',
  laser: '\u6fc0\u5149',
}
const sourcePageLabel = (page: number) => String(page).padStart(3, '0')
const sourcePageForBoardPage = (page: BoardPage) => {
  const sourceText = `${page.name} ${page.image?.name ?? ''}`
  const match = sourceText.match(/(?:^|\D)(\d{3})(?:\D|$)/)
  return match ? Number(match[1]) : undefined
}
const MIN_POINT_DISTANCE = 2.6
const MAX_POINT_DISTANCE = 9.5
const SHORT_TAP_RADIUS = 0.8
const VELOCITY_PRESSURE_MIN = 0.06
const VELOCITY_PRESSURE_MAX = 0.96
const PEN_TIP_PRESSURE = 0.22
const MIN_VISIBLE_PEN_WIDTH = 2.2
const MIN_VIEW_SCALE = 0.1
const MAX_VIEW_SCALE = 4

const makeId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
const clampViewScale = (scale: number) => Math.max(MIN_VIEW_SCALE, Math.min(MAX_VIEW_SCALE, scale))
const screenToWorldPoint = (point: ScreenPoint, view: PageView) => ({
  x: (point.x - view.x) / view.scale,
  y: (point.y - view.y) / view.scale,
})
const panViewFromStart = (startView: PageView, startPoint: ScreenPoint, currentPoint: ScreenPoint) => ({
  ...startView,
  x: startView.x + currentPoint.x - startPoint.x,
  y: startView.y + currentPoint.y - startPoint.y,
})
const zoomViewAtPoint = (view: PageView, point: ScreenPoint, scaleMultiplier: number) => {
  const worldPoint = screenToWorldPoint(point, view)
  const nextScale = clampViewScale(view.scale * scaleMultiplier)
  return {
    scale: nextScale,
    x: point.x - worldPoint.x * nextScale,
    y: point.y - worldPoint.y * nextScale,
  }
}
const pinchViewFromStart = (start: PinchStart, center: ScreenPoint, distance: number) => {
  const nextScale = clampViewScale(start.view.scale * (distance / start.distance))
  return {
    scale: nextScale,
    x: center.x - start.boardCenter.x * nextScale,
    y: center.y - start.boardCenter.y * nextScale,
  }
}
const translateStroke = (stroke: Stroke, dx: number, dy: number) => ({
  ...stroke,
  points: stroke.points.map((value, index) => value + (index % 2 === 0 ? dx : dy)),
})
const isEditableKeyboardTarget = (target: EventTarget | null) => {
  const element = target as HTMLElement | null
  return Boolean(element?.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(element?.tagName ?? ''))
}

const createBookPages = (book: BuiltInBook) =>
  Array.from({ length: book.pageCount }, (_, index): BoardPage => {
    const pageNumber = index + 1
    const name = book.imageBasePath ? `${sourcePageLabel(pageNumber)}.jpg` : `白板 ${pageNumber}`
    const size = book.imageSize(pageNumber)
    return {
      id: makeId(),
      name,
      image: book.imageBasePath
        ? {
            src: `${book.imageBasePath}/${name}`,
            name,
            ...size,
          }
        : undefined,
      strokes: [],
      texts: [],
      view: { x: 0, y: 0, scale: 1 },
    }
  })

const initialProject = (bookId = DEFAULT_BOOK_ID): BoardProject => {
  const book = getBuiltInBook(bookId)
  const pages = createBookPages(book)

  return {
    bookId: book.id,
    pages,
    currentPageId: pages[0].id,
    updatedAt: Date.now(),
  }
}

const getLastSelectedBookId = () => getBuiltInBook(localStorage.getItem(SELECTED_BOOK_KEY) ?? localStorage.getItem(LEGACY_SELECTED_BOOK_KEY)).id

const isStoredProjectForBook = (project: BoardProject | undefined, book: BuiltInBook): project is BoardProject =>
  project?.bookId === book.id &&
  project.pages.length > 0 &&
  (book.blankCanvas || project.pages.length === book.pageCount) &&
  project.pages.every((page, index) =>
    book.imageBasePath ? page.image?.name === `${sourcePageLabel(index + 1)}.jpg` : !page.image,
  )

const projectStoreKey = (bookId: string) => `builtin:${bookId}`

const openDatabase = (databaseName = DB_NAME) =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(databaseName, DB_VERSION)
    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(PROJECT_STORE)) {
        request.result.createObjectStore(PROJECT_STORE)
      }
    }
  })

async function saveProject(project: BoardProject) {
  const db = await openDatabase(DB_NAME)
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(PROJECT_STORE, 'readwrite')
    transaction.objectStore(PROJECT_STORE).put(project, projectStoreKey(project.bookId ?? DEFAULT_BOOK_ID))
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
  })
  db.close()
  localStorage.setItem('open-whiteboard-last-save', String(project.updatedAt))
}

async function readProjectFromDatabase(databaseName: string, bookId: string) {
  const db = await openDatabase(databaseName)
  const project = await new Promise<BoardProject | undefined>((resolve, reject) => {
    const transaction = db.transaction(PROJECT_STORE, 'readonly')
    const request = transaction.objectStore(PROJECT_STORE).get(projectStoreKey(bookId))
    request.onsuccess = () => resolve(request.result as BoardProject | undefined)
    request.onerror = () => reject(request.error)
  })
  db.close()
  return project
}

async function loadProject(bookId: string) {
  const project = await readProjectFromDatabase(DB_NAME, bookId)
  if (project || DB_NAME === LEGACY_DB_NAME) return project

  const legacyProject = await readProjectFromDatabase(LEGACY_DB_NAME, bookId)
  if (legacyProject) {
    await saveProject(legacyProject)
  }
  return legacyProject
}

async function clearStoredProjects() {
  for (const databaseName of [DB_NAME, LEGACY_DB_NAME]) {
    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase(databaseName)
      request.onsuccess = () => resolve()
      request.onerror = () => resolve()
      request.onblocked = () => resolve()
    })
  }
  localStorage.removeItem('open-whiteboard-last-save')
}

const pageSize = (page: BoardPage) => (page.image ? { width: page.image.width, height: page.image.height } : EMPTY_PAGE_SIZE)

async function renderPageCanvas(page: BoardPage, scale = 1) {
  const size = pageSize(page)
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(size.width * scale)
  canvas.height = Math.round(size.height * scale)

  const context = canvas.getContext('2d')
  if (!context) throw new Error('canvas context unavailable')

  context.save()
  context.scale(scale, scale)
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, size.width, size.height)

  if (page.image) {
    const image = await loadCanvasImage(page.image.src)
    context.drawImage(image, 0, 0, size.width, size.height)
  }

  for (const stroke of page.strokes) {
    if (stroke.points.length < 2) continue
    context.save()
    context.globalAlpha = stroke.opacity
    context.globalCompositeOperation = stroke.kind === 'highlighter' ? 'multiply' : 'source-over'
    context.strokeStyle = stroke.color
    context.fillStyle = stroke.color
    context.lineCap = 'round'
    context.lineJoin = 'round'

    if (stroke.kind === 'pen') {
      drawSignatureStroke(context, stroke)
    } else {
      context.lineWidth = stroke.width
      context.beginPath()
      context.moveTo(stroke.points[0], stroke.points[1])
      for (let i = 2; i < stroke.points.length; i += 2) {
        context.lineTo(stroke.points[i], stroke.points[i + 1])
      }
      context.stroke()
    }
    context.restore()
  }

  for (const note of page.texts ?? []) {
    context.save()
    context.fillStyle = note.color
    context.font = `${note.fontSize}px "Microsoft YaHei", "Segoe UI", sans-serif`
    context.textBaseline = 'top'
    context.fillText(note.text, note.x, note.y)
    context.restore()
  }

  context.restore()
  return canvas
}

const distanceToSegment = (px: number, py: number, x1: number, y1: number, x2: number, y2: number) => {
  const dx = x2 - x1
  const dy = y2 - y1
  if (dx === 0 && dy === 0) return Math.hypot(px - x1, py - y1)
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)))
  const x = x1 + t * dx
  const y = y1 + t * dy
  return Math.hypot(px - x, py - y)
}

const lastPoint = (points: number[]) => ({
  x: points[points.length - 2],
  y: points[points.length - 1],
})

const shouldAppendPoint = (points: number[], x: number, y: number, scale: number) => {
  if (points.length < 2) return true
  const previous = lastPoint(points)
  return Math.hypot(x - previous.x, y - previous.y) >= MIN_POINT_DISTANCE / scale
}

const smoothNextPoint = (points: number[], x: number, y: number) => {
  if (points.length < 4) return { x, y }
  const previous = lastPoint(points)
  const distance = Math.hypot(x - previous.x, y - previous.y)
  const follow = Math.max(0.58, Math.min(0.88, distance / 9))
  return {
    x: previous.x * (1 - follow) + x * follow,
    y: previous.y * (1 - follow) + y * follow,
  }
}

const makeTapStroke = (stroke: Stroke) => {
  const [x, y] = stroke.points
  const radius = Math.max(SHORT_TAP_RADIUS, stroke.width * 0.18)
  return {
    ...stroke,
    points: [x - radius, y, x, y + radius, x + radius, y],
    pressures: stroke.kind === 'pen' && stroke.pressures?.length ? [0.55, 0.65, 0.55] : undefined,
  }
}

const finalizeVelocityStroke = (stroke: Stroke) => {
  if (stroke.kind !== 'pen' || !stroke.pressures?.length) return stroke
  const pointCount = stroke.points.length / 2
  if (pointCount < 4) return stroke
  const basePressures = Array.from({ length: pointCount }, (_, index) => stroke.pressures?.[index] ?? VELOCITY_PRESSURE_MAX)
  const smoothed = basePressures.map((pressure, index) => {
    const previous = basePressures[Math.max(0, index - 1)]
    const next = basePressures[Math.min(pointCount - 1, index + 1)]
    return previous * 0.22 + pressure * 0.56 + next * 0.22
  })
  if (pointCount < 7) {
    return {
      ...stroke,
      pressures: smoothed.map((pressure) => Math.max(0.56, Math.min(VELOCITY_PRESSURE_MAX, pressure))),
      lastInputTime: undefined,
    }
  }

  const taperStart = Math.max(1, Math.floor(pointCount * 0.8))
  const taperCount = Math.max(1, pointCount - taperStart)
  const pressures = smoothed.map((pressure, index) => {
    if (index < taperStart) {
      return Math.max(0.52, Math.min(VELOCITY_PRESSURE_MAX, pressure))
    }

    const endProgress = (index - taperStart) / taperCount
    const taper = 1 - Math.pow(Math.max(0, Math.min(1, endProgress)), 2.35) * 0.34
    const minPressure = index === pointCount - 1 ? Math.max(PEN_TIP_PRESSURE, 0.3) : 0.42
    return Math.max(minPressure, Math.min(VELOCITY_PRESSURE_MAX, pressure * taper))
  })
  return { ...stroke, pressures, lastInputTime: undefined }
}

const stripStrokeRuntimeState = (stroke: Stroke) => ({ ...stroke, lastInputTime: undefined })

const nativePointerPressure = (event?: PointerEvent) => {
  if (!event || event.pointerType !== 'pen' || event.pressure <= 0) return undefined
  return event.pressure
}

const velocityPressure = (distance: number, elapsed: number) => {
  const speed = distance / Math.max(8, elapsed)
  const pressure = VELOCITY_PRESSURE_MAX - speed * 0.5
  return Math.max(VELOCITY_PRESSURE_MIN, Math.min(VELOCITY_PRESSURE_MAX, pressure))
}

const appendPointerSamples = (stroke: Stroke, samples: BoardPointerPoint[], scale: number) => {
  const nextPoints = stroke.points
  const nextPressures =
    stroke.kind === 'pen' ? (stroke.pressures ?? (stroke.pressures = [VELOCITY_PRESSURE_MAX])) : undefined
  let lastInputTime = stroke.lastInputTime
  let changed = false

  const pushPoint = (x: number, y: number, pressure?: number) => {
    if (!shouldAppendPoint(nextPoints, x, y, scale)) return
    const previous = lastPoint(nextPoints)
    const distance = Math.hypot(x - previous.x, y - previous.y)
    const smoothed = smoothNextPoint(nextPoints, x, y)
    nextPoints.push(smoothed.x, smoothed.y)
    if (stroke.kind === 'pen' && nextPressures) {
      const previousPressure = nextPressures.at(-1) ?? 0.5
      const targetPressure = pressure ?? velocityPressure(distance * scale, 16)
      nextPressures.push(previousPressure * 0.35 + targetPressure * 0.65)
    }
    changed = true
  }

  samples.forEach((sample, sampleIndex) => {
    const previous = lastPoint(nextPoints)
    const distance = Math.hypot(sample.x - previous.x, sample.y - previous.y)
    const previousTime = sampleIndex === 0 ? lastInputTime ?? sample.time - 16 : samples[sampleIndex - 1]?.time
    const elapsed = Math.max(8, sample.time - (previousTime ?? sample.time - 16))
    const samplePressure = sample.pressure ?? velocityPressure(distance * scale, elapsed)
    lastInputTime = sample.time
    const maxDistance = MAX_POINT_DISTANCE / scale
    if (distance <= maxDistance) {
      pushPoint(sample.x, sample.y, samplePressure)
      return
    }

    const steps = Math.ceil(distance / maxDistance)
    const startPressure = nextPressures?.at(-1)
    for (let step = 1; step <= steps; step += 1) {
      const ratio = step / steps
      const interpolatedPressure =
        startPressure === undefined ? samplePressure : startPressure + (samplePressure - startPressure) * ratio
      pushPoint(
        previous.x + (sample.x - previous.x) * ratio,
        previous.y + (sample.y - previous.y) * ratio,
        interpolatedPressure,
      )
    }
  })

  if (!changed) return false
  stroke.pressureSource ??= 'velocity'
  stroke.lastInputTime = lastInputTime
  return true
}

const strokeHit = (stroke: Stroke, x: number, y: number, radius: number, widthScale = 1) => {
  for (let i = 0; i < stroke.points.length - 2; i += 2) {
    if (
      distanceToSegment(
        x,
        y,
        stroke.points[i],
        stroke.points[i + 1],
        stroke.points[i + 2],
        stroke.points[i + 3],
      ) <=
      radius + (stroke.width * widthScale) / 2
    ) {
      return true
    }
  }
  return false
}

const splitStrokeAt = (stroke: Stroke, x: number, y: number, radius: number, widthScale = 1) => {
  if (!strokeHit(stroke, x, y, radius, widthScale)) return [stroke]

  const chunks: Stroke[] = []
  let currentPoints: number[] = []
  let currentPressures: number[] = []
  const pointCount = stroke.points.length / 2

  const pushPoint = (pointIndex: number) => {
    currentPoints.push(stroke.points[pointIndex * 2], stroke.points[pointIndex * 2 + 1])
    if (stroke.pressures) currentPressures.push(stroke.pressures[pointIndex] ?? 0.5)
  }

  const flush = () => {
    if (currentPoints.length >= 4) {
      chunks.push({
        ...stroke,
        id: makeId(),
        points: currentPoints,
        pressures: stroke.pressures ? currentPressures : undefined,
      })
    }
    currentPoints = []
    currentPressures = []
  }

  for (let pointIndex = 0; pointIndex < pointCount - 1; pointIndex += 1) {
    const x1 = stroke.points[pointIndex * 2]
    const y1 = stroke.points[pointIndex * 2 + 1]
    const x2 = stroke.points[pointIndex * 2 + 2]
    const y2 = stroke.points[pointIndex * 2 + 3]
    const segmentErased = distanceToSegment(x, y, x1, y1, x2, y2) <= radius + (stroke.width * widthScale) / 2

    if (segmentErased) {
      flush()
      continue
    }

    if (!currentPoints.length) pushPoint(pointIndex)
    pushPoint(pointIndex + 1)
  }

  flush()
  return chunks
}

type InkContext = {
  beginPath: () => void
  arc: (x: number, y: number, radius: number, startAngle: number, endAngle: number) => void
  moveTo: (x: number, y: number) => void
  lineTo: (x: number, y: number) => void
  stroke: () => void
  fill: () => void
  setAttr?: (attr: string, val: unknown) => void
  fillStyle: string | CanvasGradient | CanvasPattern
  strokeStyle: string | CanvasGradient | CanvasPattern
  lineCap: CanvasLineCap
  lineJoin: CanvasLineJoin
  lineWidth: number
}

const setInkAttr = <K extends keyof InkContext>(context: InkContext, attr: K, value: InkContext[K]) => {
  if (context.setAttr) context.setAttr(String(attr), value)
  else context[attr] = value
}

const strokePressure = (stroke: Stroke, index: number) =>
  Math.max(PEN_TIP_PRESSURE, Math.min(VELOCITY_PRESSURE_MAX, stroke.pressures?.[index] ?? VELOCITY_PRESSURE_MAX))

const strokePointLiveWidth = (stroke: Stroke, pressure: number, widthScale = 1) => {
  if (stroke.kind === 'highlighter') return stroke.width * widthScale
  const minimum = Math.min(stroke.width * widthScale * 0.42, MIN_VISIBLE_PEN_WIDTH * widthScale)
  return Math.max(minimum, stroke.width * widthScale * Math.max(PEN_TIP_PRESSURE, pressure))
}

const strokePointWidth = (stroke: Stroke, index: number, widthScale: number) => {
  return strokePointLiveWidth(stroke, strokePressure(stroke, index), widthScale)
}

const drawSignatureStroke = (context: InkContext, stroke: Stroke, widthScale = 1, stepScale = 1) => {
  const pointCount = stroke.points.length / 2
  if (pointCount < 1) return

  setInkAttr(context, 'strokeStyle', stroke.color)
  setInkAttr(context, 'fillStyle', stroke.color)
  setInkAttr(context, 'lineCap', 'round')
  setInkAttr(context, 'lineJoin', 'round')

  if (pointCount === 1) {
    if (stepScale < 1) return
    context.beginPath()
    context.arc(stroke.points[0], stroke.points[1], strokePointWidth(stroke, 0, widthScale) / 2, 0, Math.PI * 2)
    context.fill()
    return
  }

  for (let index = 0; index < pointCount - 1; index += 1) {
    const x1 = stroke.points[index * 2]
    const y1 = stroke.points[index * 2 + 1]
    const x2 = stroke.points[index * 2 + 2]
    const y2 = stroke.points[index * 2 + 3]
    const distance = Math.hypot(x2 - x1, y2 - y1)
    if (distance < 0.01) continue

    const currentWidth = strokePointWidth(stroke, index, widthScale)
    const nextWidth = strokePointWidth(stroke, index + 1, widthScale)
    const liveBoost = stepScale < 1 ? 1.02 : 1
    setInkAttr(context, 'lineWidth', ((currentWidth + nextWidth) / 2) * liveBoost)
    context.beginPath()
    context.moveTo(x1, y1)
    context.lineTo(x2, y2)
    context.stroke()
  }
}

type Bounds = { x: number; y: number; width: number; height: number }

const strokeRawBoundsCache = new WeakMap<Stroke, Bounds>()

const strokeRawBounds = (stroke: Stroke) => {
  const cached = strokeRawBoundsCache.get(stroke)
  if (cached) return cached
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (let i = 0; i < stroke.points.length; i += 2) {
    const x = stroke.points[i]
    const y = stroke.points[i + 1]
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  const bounds = { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
  strokeRawBoundsCache.set(stroke, bounds)
  return bounds
}

const strokeBounds = (stroke: Stroke) => {
  const bounds = strokeRawBounds(stroke)
  const padding = stroke.width + 8
  return {
    x: bounds.x - padding,
    y: bounds.y - padding,
    width: bounds.width + padding * 2,
    height: bounds.height + padding * 2,
  }
}

const strokeIntersectsRect = (
  stroke: Stroke,
  rect: { x: number; y: number; width: number; height: number },
  padding = stroke.width + 12,
) => {
  if (stroke.points.length < 2) return false
  const bounds = strokeRawBounds(stroke)
  return (
    bounds.x + bounds.width + padding >= rect.x &&
    bounds.x - padding <= rect.x + rect.width &&
    bounds.y + bounds.height + padding >= rect.y &&
    bounds.y - padding <= rect.y + rect.height
  )
}

type StrokeLinesProps = {
  stroke: Stroke
  viewScale?: number
  selected?: boolean
  selectable?: boolean
  draftPreview?: boolean
  onMove?: (dx: number, dy: number) => void
  onSelect?: () => void
}

function StrokeLinesComponent({
  stroke,
  viewScale = 1,
  selected = false,
  selectable = false,
  draftPreview = false,
  onMove,
  onSelect,
}: StrokeLinesProps) {
  const bounds = selected ? strokeBounds(stroke) : null
  const screenStableScale = 1 / Math.max(0.1, viewScale)
  const commonProps = {
    onPointerDown: (event: Konva.KonvaEventObject<PointerEvent>) => {
      if (!selectable) return
      event.cancelBubble = true
      onSelect?.()
    },
    draggable: selectable && selected,
    onDragEnd: (event: Konva.KonvaEventObject<DragEvent>) => {
      const dx = event.target.x()
      const dy = event.target.y()
      event.target.position({ x: 0, y: 0 })
      if (dx || dy) onMove?.(dx, dy)
    },
  }

  if (stroke.kind !== 'pen') {
    return (
      <Group {...commonProps}>
        <Line
          points={stroke.points}
          stroke={stroke.color}
          strokeWidth={stroke.width * screenStableScale}
          opacity={stroke.opacity}
          tension={0.36}
          lineCap="round"
          lineJoin="round"
          hitStrokeWidth={Math.max(24, stroke.width * 2) * screenStableScale}
          globalCompositeOperation={stroke.kind === 'highlighter' ? 'multiply' : 'source-over'}
          listening={selectable}
          perfectDrawEnabled={false}
        />
        {bounds && (
          <Rect
            x={bounds.x}
            y={bounds.y}
            width={bounds.width}
            height={bounds.height}
            stroke="#139f9b"
            strokeWidth={2}
            dash={[8, 6]}
            listening={false}
          />
        )}
      </Group>
    )
  }

  if (draftPreview) {
    return (
      <Shape
        opacity={stroke.opacity}
        listening={false}
        perfectDrawEnabled={false}
        sceneFunc={(context) => {
          drawSignatureStroke(context, stroke, screenStableScale, 0.5)
        }}
      />
    )
  }

  return (
    <Group {...commonProps}>
      <Shape
        opacity={stroke.opacity}
        listening={false}
        perfectDrawEnabled={false}
        sceneFunc={(context) => {
          drawSignatureStroke(context, stroke, screenStableScale)
        }}
      />
      <Line
        points={stroke.points}
        stroke="rgba(0,0,0,0)"
        strokeWidth={Math.max(24, stroke.width * 2) * screenStableScale}
        lineCap="round"
        lineJoin="round"
        listening={selectable}
        perfectDrawEnabled={false}
      />
      {bounds && (
        <Rect
          x={bounds.x}
          y={bounds.y}
          width={bounds.width}
          height={bounds.height}
          stroke="#139f9b"
          strokeWidth={2}
          dash={[8, 6]}
          listening={false}
        />
      )}
    </Group>
  )
}

const StrokeLines = memo(
  StrokeLinesComponent,
  (previous, next) =>
    previous.stroke === next.stroke &&
    previous.viewScale === next.viewScale &&
    previous.selected === next.selected &&
    previous.selectable === next.selectable &&
    previous.draftPreview === next.draftPreview,
)


export {
  EMPTY_PAGE_SIZE,
  MAX_VIEW_SCALE,
  MIN_VIEW_SCALE,
  MIN_VISIBLE_PEN_WIDTH,
  PEN_TIP_PRESSURE,
  SELECTED_BOOK_KEY,
  VELOCITY_PRESSURE_MAX,
  StrokeLines,
  appendPointerSamples,
  clampViewScale,
  colors,
  configurableTools,
  drawSignatureStroke,
  finalizeVelocityStroke,
  getLastSelectedBookId,
  initialProject,
  isEditableKeyboardTarget,
  isStoredProjectForBook,
  clearStoredProjects,
  loadProject,
  makeId,
  makeTapStroke,
  nativePointerPressure,
  pageSize,
  panViewFromStart,
  pinchViewFromStart,
  renderPageCanvas,
  saveProject,
  screenToWorldPoint,
  sourcePageForBoardPage,
  sourcePageLabel,
  pantonePenColors,
  quickPenColors,
  standardPenColors,
  splitStrokeAt,
  stripStrokeRuntimeState,
  strokeHit,
  strokeIntersectsRect,
  toolLabels,
  toolShortcuts,
  translateStroke,
  velocityPressure,
  zoomViewAtPoint,
}

export type {
  BoardImage,
  BoardPage,
  BoardPresentation,
  BoardPresentationRef,
  BoardPointerPoint,
  BoardProject,
  HostCommand,
  PageView,
  PinchStart,
  ScreenPoint,
  Stroke,
  StrokeKind,
  TextNote,
  Tool,
}
