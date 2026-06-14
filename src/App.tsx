import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { Image as KonvaImage, Layer, Rect, Stage, Text } from 'react-konva'
import type Konva from 'konva'
import './App.css'
import { builtInBooks, getBuiltInBook } from './books'
import { nextToolSettingsOpen } from './components/toolSettingsState'
import { BookPicker, BottomToolbar, ClockPanel, LeftCornerControls, RightCornerControls, StatusBar } from './components/WhiteboardChrome'
import { ExportPanel, MorePanel, PageJumpPanel, TocPanel, ToolSettingsPanel } from './components/WhiteboardPanels'
import {
  EMPTY_PAGE_SIZE,
  SELECTED_BOOK_KEY,
  StrokeLines,
  appendPointerSamples,
  colors,
  configurableTools,
  drawSignatureStroke,
  finalizeVelocityStroke,
  getLastSelectedBookId,
  initialProject,
  isStoredProjectForBook,
  loadProject,
  makeId,
  makeTapStroke,
  nativePointerPressure,
  quickPenColors,
  screenToWorldPoint,
  saveProject,
  sourcePageForBoardPage,
  strokeIntersectsRect,
  stripStrokeRuntimeState,
  translateStroke,
  zoomViewAtPoint,
} from './whiteboard/core'
import { eraseStrokesAtPoints, withDynamicEraserRadius } from './whiteboard/eraser'
import { useTouchPanGesture } from './whiteboard/gestures'
import type { PanStart } from './whiteboard/gestures'
import { preloadDisplayImages, preloadImages, useCachedDisplayImage } from './whiteboard/imageCache'
import { useRawPointerUpdates } from './whiteboard/input'
import { useWhiteboardKeyboard } from './whiteboard/keyboard'
import { useLiveInk } from './whiteboard/liveInk'
import { useWhiteboardNavigation } from './whiteboard/navigation'
import { noteFileName, parseNoteFileText, serializeNoteFile } from './whiteboard/noteFormat'
import { useProjectActions } from './whiteboard/projectActions'
import { useStrokeLifecycle } from './whiteboard/strokes'
import { detectLanguage, saveLanguage, uiText } from './i18n'
import type { Language } from './i18n'
import {
  LASER_TRAIL_COLOR,
  LASER_TRAIL_HIDE_DELAY_MS,
  appendLaserTrailPoint,
  laserTrailPolylinePoints,
  lastLaserTrailPoint,
  snapshotLaserTrails,
  trimLaserTrailHistory,
} from './laserTrail'
import type { LaserTrail } from './laserTrail'
import type {
  BoardPage,
  BoardPointerPoint,
  BoardProject,
  PageView,
  ScreenPoint,
  Stroke,
  Tool,
} from './whiteboard/core'

type WhiteboardPerfStats = {
  enabled: boolean
  pointerMoves: number
  rawEvents: number
  coalescedSamples: number
  inputSamples: number
  liveDraws: number
  firstDraws: number
  totalLiveDrawMs: number
  maxLiveDrawMs: number
  totalInputToDrawMs: number
  maxInputToDrawMs: number
  totalFirstInputToDrawMs: number
  maxFirstInputToDrawMs: number
  committedRenders: number
  committedFullRenders: number
  committedIncrementalRenders: number
  totalCommittedRenderMs: number
  maxCommittedRenderMs: number
}

type WhiteboardPerfApi = {
  enable: () => WhiteboardPerfStats
  disable: () => WhiteboardPerfStats
  reset: () => WhiteboardPerfStats
  snapshot: () => WhiteboardPerfStats & {
    averageLiveDrawMs: number
    averageInputToDrawMs: number
    averageFirstInputToDrawMs: number
    averageCommittedRenderMs: number
  }
}

type HostMessage = {
  type?: string
  content?: string
  fileName?: string
  files?: Array<{
    content?: string
    fileName?: string
  }>
  preserveCurrentPages?: boolean
  path?: string
  error?: string
}

const fileFromDataUrl = (dataUrl: string, fileName: string) => {
  const [header, payload] = dataUrl.split(',', 2)
  const mime = header.match(/^data:([^;]+);base64$/)?.[1] ?? 'application/octet-stream'
  const binary = atob(payload ?? '')
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return new File([bytes], fileName, { type: mime })
}

const filesFromHostImportMessage = (message: HostMessage) => {
  const entries =
    Array.isArray(message.files) && message.files.length
      ? message.files
      : typeof message.content === 'string' && message.fileName
        ? [{ content: message.content, fileName: message.fileName }]
        : []

  return entries
    .filter((entry): entry is { content: string; fileName: string } => typeof entry.content === 'string' && Boolean(entry.fileName))
    .map((entry) => fileFromDataUrl(entry.content, entry.fileName))
}

const isWhiteboardNoteFile = (file: File) =>
  file.name.toLowerCase().endsWith('.owbn') || file.type === 'application/vnd.open-whiteboard.note+json'

const mayBeWhiteboardNoteJsonFile = (file: File) => {
  const name = file.name.toLowerCase()
  return isWhiteboardNoteFile(file) || name.endsWith('.json') || file.type === 'application/json'
}

const isEditablePasteTarget = (target: EventTarget | null) => {
  if (!(target instanceof HTMLElement)) return false
  const tagName = target.tagName
  return target.isContentEditable || tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT'
}

const filesFromClipboard = (clipboardData: DataTransfer | null) => {
  if (!clipboardData) return []
  const files = [
    ...Array.from(clipboardData.files),
    ...Array.from(clipboardData.items)
      .filter((item) => item.kind === 'file')
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file)),
  ]
  const seen = new Set<string>()
  return files.filter((file) => {
    const key = `${file.name}:${file.type}:${file.size}:${file.lastModified}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

const importableFilesFromClipboard = (clipboardData: DataTransfer | null) => {
  const files = filesFromClipboard(clipboardData)
  if (files.length || !clipboardData) return files

  const html = clipboardData.getData('text/html').trim()
  if (html) {
    return [new File([html], 'pasted-clipboard.html', { type: 'text/html' })]
  }

  const text = clipboardData.getData('text/plain').trim()
  if (text) {
    return [new File([text], 'pasted-clipboard.txt', { type: 'text/plain' })]
  }

  return []
}

type DroppedDataTransferItem = DataTransferItem & {
  webkitGetAsEntry?: () => FileSystemEntry | null
}

const MAX_DROPPED_DIRECTORY_FILES = 250

const readDroppedEntryFile = (entry: FileSystemFileEntry) =>
  new Promise<File>((resolve, reject) => {
    entry.file(resolve, reject)
  })

const readDroppedDirectoryEntries = (entry: FileSystemDirectoryEntry) => {
  const reader = entry.createReader()
  const entries: FileSystemEntry[] = []
  return new Promise<FileSystemEntry[]>((resolve, reject) => {
    const readBatch = () => {
      reader.readEntries(
        (batch) => {
          if (!batch.length) {
            resolve(entries)
            return
          }
          entries.push(...batch)
          readBatch()
        },
        reject,
      )
    }
    readBatch()
  })
}

const filesFromDroppedEntry = async (entry: FileSystemEntry, remaining: { count: number }): Promise<File[]> => {
  if (remaining.count <= 0) return []
  if (entry.isFile) {
    remaining.count -= 1
    return [await readDroppedEntryFile(entry as FileSystemFileEntry)]
  }
  if (!entry.isDirectory) return []
  const children = await readDroppedDirectoryEntries(entry as FileSystemDirectoryEntry)
  const files: File[] = []
  for (const child of children) {
    files.push(...(await filesFromDroppedEntry(child, remaining)))
    if (remaining.count <= 0) break
  }
  return files
}

const importableFilesFromDrop = async (dataTransfer: DataTransfer) => {
  const entries = Array.from(dataTransfer.items ?? [])
    .map((item) => (item as DroppedDataTransferItem).webkitGetAsEntry?.())
    .filter((entry): entry is FileSystemEntry => Boolean(entry))
  if (!entries.length) return Array.from(dataTransfer.files)

  const remaining = { count: MAX_DROPPED_DIRECTORY_FILES }
  const files: File[] = []
  for (const entry of entries) {
    files.push(...(await filesFromDroppedEntry(entry, remaining)))
    if (remaining.count <= 0) break
  }
  return files
}

type PresentationRuntime = {
  show: {
    stop: () => void
    next: () => Promise<void>
    prev: () => Promise<void>
    goto: (index: number) => Promise<void>
    toggleAutoPlay: () => void
    currentIndex: number
    slideCount: number
    animationClick?: number
    maxAnimationClick?: number
    animationCacheSize?: number
    slideCacheSize?: number
    slideCachePending?: number
    navigationBusy?: boolean
    navigationQueueSize?: number
    autoPlaying?: boolean
  }
  renderer: { destroy: () => void }
  disposeInk?: () => void
  restoreConsoleWarn?: () => void
}

declare global {
  interface Window {
    __openWhiteboardHostMessages?: unknown[]
    __openWhiteboardHostBridgeInstalled?: boolean
    __openWhiteboardHostMessagesFlushed?: boolean
    chrome?: {
      webview?: {
        addEventListener?: (type: 'message', listener: (event: MessageEvent) => void) => void
        removeEventListener?: (type: 'message', listener: (event: MessageEvent) => void) => void
        postMessage?: (message: string) => void
      }
    }
  }
}

const installEarlyHostMessageBridge = () => {
  if (window.__openWhiteboardHostBridgeInstalled) return
  window.__openWhiteboardHostBridgeInstalled = true
  window.__openWhiteboardHostMessages = window.__openWhiteboardHostMessages ?? []
  const queueHostMessage = (event: MessageEvent) => {
    if (window.__openWhiteboardHostMessages) window.__openWhiteboardHostMessages.push(event.data)
  }
  window.addEventListener('message', queueHostMessage)
  window.chrome?.webview?.addEventListener?.('message', queueHostMessage)
}

installEarlyHostMessageBridge()

const flushEarlyHostMessages = () => {
  if (window.__openWhiteboardHostMessagesFlushed) return
  window.__openWhiteboardHostMessagesFlushed = true
  window.__openWhiteboardHostMessages?.splice(0).forEach((payload) => {
    window.dispatchEvent(new MessageEvent('message', { data: payload }))
  })
  window.__openWhiteboardHostMessages = undefined
}

const preloadAroundCurrentPage = (project: BoardProject) => {
  const currentIndex = Math.max(0, project.pages.findIndex((page) => page.id === project.currentPageId))
  const sources = project.pages
    .slice(Math.max(0, currentIndex - 1), currentIndex + 4)
    .map((page) => page.image?.src)
    .filter((source): source is string => Boolean(source))
  preloadImages(sources)
  preloadDisplayImages(sources, 2400)
}

const displayMaxDimensionForView = (scale: number) => {
  if (scale > 1.15) return 3200
  if (scale > 0.62) return 2200
  return 1600
}

const PRESENTATION_BLOB_CACHE_LIMIT = 3
const PRESENTATION_SLIDE_RENDER_CACHE_RADIUS = 1
const PRESENTATION_SLIDE_RENDER_CACHE_LIMIT = PRESENTATION_SLIDE_RENDER_CACHE_RADIUS * 2 + 1
const PRESENTATION_ANIMATION_CACHE_RADIUS = 2
const PRESENTATION_ANIMATION_CACHE_LIMIT = PRESENTATION_ANIMATION_CACHE_RADIUS * 2 + 1
const PRESENTATION_OVERLAY_MONITOR_INTERVAL_MS = 160
const PRESENTATION_AUTO_PLAY_INTERVAL_MS = 1800

const initialPerfStats = (enabled = false): WhiteboardPerfStats => ({
  enabled,
  pointerMoves: 0,
  rawEvents: 0,
  coalescedSamples: 0,
  inputSamples: 0,
  liveDraws: 0,
  firstDraws: 0,
  totalLiveDrawMs: 0,
  maxLiveDrawMs: 0,
  totalInputToDrawMs: 0,
  maxInputToDrawMs: 0,
  totalFirstInputToDrawMs: 0,
  maxFirstInputToDrawMs: 0,
  committedRenders: 0,
  committedFullRenders: 0,
  committedIncrementalRenders: 0,
  totalCommittedRenderMs: 0,
  maxCommittedRenderMs: 0,
})

function App() {
  const stageRef = useRef<Konva.Stage>(null)
  const liveInkCanvasRef = useRef<HTMLCanvasElement>(null)
  const liveInkContextRef = useRef<CanvasRenderingContext2D | null>(null)
  const [committedInkCanvas] = useState(() => document.createElement('canvas'))
  const committedInkCanvasRef = useRef<HTMLCanvasElement>(committedInkCanvas)
  const committedInkImageRef = useRef<Konva.Image>(null)
  const documentLayerRef = useRef<Konva.Layer>(null)
  const vectorLayerRef = useRef<Konva.Layer>(null)
  const committedInkRenderFrame = useRef<number | null>(null)
  const viewLayerDrawFrame = useRef<number | null>(null)
  const liveInkClearFrameRef = useRef<number | null>(null)
  const committedInkCacheRef = useRef<{
    pageId: string
    view: PageView
    viewport: { width: number; height: number }
  } | null>(null)
  const skipNextEraserPreviewCommitRenderRef = useRef(false)
  const pendingCommittedStrokeRef = useRef<Stroke | null>(null)
  const previewEraserPointRef = useRef<BoardPointerPoint | null>(null)
  const eraserPreviewActiveRef = useRef(false)
  const perfStatsRef = useRef<WhiteboardPerfStats>(initialPerfStats())
  const liveInkLastPointRef = useRef<(BoardPointerPoint & { livePressure: number }) | null>(null)
  const liveInkClearTimer = useRef<number | undefined>(undefined)
  const laserHideTimer = useRef<number | undefined>(undefined)
  const laserFrame = useRef<number | null>(null)
  const laserTrailFadingRef = useRef(false)
  const laserTrailsRef = useRef<LaserTrail[]>([])
  const activeLaserTrailRef = useRef<LaserTrail | null>(null)
  const laserPointSeq = useRef(0)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const projectInputRef = useRef<HTMLInputElement>(null)
  const presentationRuntimeRef = useRef<PresentationRuntime | null>(null)
  const presentationBlobCacheRef = useRef<Map<string, { src: string; blob: Blob }>>(new Map())
  const saveTimer = useRef<number | undefined>(undefined)
  const activePointerId = useRef<number | null>(null)
  const capturedPointerTarget = useRef<Element | null>(null)
  const stageBoundsRef = useRef<DOMRectReadOnly | null>(null)
  const rawPointerMoveUntil = useRef(0)
  const isDrawingRef = useRef(false)
  const viewRenderFrame = useRef<number | null>(null)
  const viewStateSyncTimer = useRef<number | undefined>(undefined)
  const viewPersistTimer = useRef<number | undefined>(undefined)
  const interactiveViewPersistTimer = useRef<number | undefined>(undefined)
  const currentViewRef = useRef<PageView>({ x: 0, y: 0, scale: 1 })
  const panStartRef = useRef<PanStart | null>(null)
  const transientToolRef = useRef<Tool | null>(null)
  const hostNoteOpenedRef = useRef(false)
  const skipNextBookInitializationRef = useRef(false)
  const [selectedBookId, setSelectedBookId] = useState(() => getLastSelectedBookId())
  const [project, setProject] = useState<BoardProject>(() => initialProject(getLastSelectedBookId()))
  const [tool, setTool] = useState<Tool>('pen')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [exportPanelOpen, setExportPanelOpen] = useState(false)
  const [morePanelOpen, setMorePanelOpen] = useState(false)
  const [clockPanelOpen, setClockPanelOpen] = useState(false)
  const [tocOpen, setTocOpen] = useState(false)
  const [pageJumpOpen, setPageJumpOpen] = useState(false)
  const [pageJumpValue, setPageJumpValue] = useState('1')
  const [bookPickerOpen, setBookPickerOpen] = useState(() => builtInBooks.length > 1 && !localStorage.getItem(SELECTED_BOOK_KEY))
  const [projectReady, setProjectReady] = useState(false)
  const [strokeColor, setStrokeColor] = useState(colors[0])
  const [strokeWidth, setStrokeWidth] = useState(8)
  const [highlightOpacity, setHighlightOpacity] = useState(0.35)
  const [eraserRadius, setEraserRadius] = useState(24)
  const [isPanning, setIsPanning] = useState(false)
  const [spacePressed, setSpacePressed] = useState(false)
  const [selectedStrokeId, setSelectedStrokeId] = useState<string | null>(null)
  const [selectedTextId, setSelectedTextId] = useState<string | null>(null)
  const [laserTrails, setLaserTrails] = useState<LaserTrail[]>([])
  const [laserTrailFading, setLaserTrailFading] = useState(false)
  const [past, setPast] = useState<BoardPage[][]>([])
  const [future, setFuture] = useState<BoardPage[][]>([])
  const [viewport, setViewport] = useState({ width: window.innerWidth, height: window.innerHeight })
  const [language, setLanguage] = useState<Language>(() => detectLanguage())
  const labels = uiText[language]
  const [status, setStatus] = useState<string>(() => uiText[detectLanguage()].status.ready)
  const currentBook = useMemo(() => getBuiltInBook(selectedBookId), [selectedBookId])
  const currentBookTitle = currentBook.blankCanvas ? labels.book.blankTitle : currentBook.shortTitle
  const bookPickerEnabled = builtInBooks.length > 1
  const tocEnabled = currentBook.toc.length > 0
  const importsEnabled = currentBook.importsEnabled !== false
  const blankCanvas = currentBook.blankCanvas === true
  const showVectorStrokes = tool === 'select'
  const laserHeadPoint = useMemo(() => lastLaserTrailPoint(laserTrails), [laserTrails])
  const laserStyle = useMemo(() => ({
    '--laser-color': LASER_TRAIL_COLOR,
    '--laser-width': `${Math.max(5, Math.min(18, strokeWidth * 0.95))}px`,
    '--laser-head-size': `${Math.max(12, Math.min(28, strokeWidth + 8))}px`,
  }) as CSSProperties, [strokeWidth])

  const currentPage = useMemo(
    () => project.pages.find((page) => page.id === project.currentPageId) ?? project.pages[0],
    [project.currentPageId, project.pages],
  )
  const currentPresentation = useMemo(
    () => project.presentations?.find((presentation) => presentation.id === currentPage.presentation?.id),
    [currentPage.presentation?.id, project.presentations],
  )
  useEffect(() => {
    const validPresentationIds = new Set((project.presentations ?? []).map((presentation) => presentation.id))
    for (const presentationId of presentationBlobCacheRef.current.keys()) {
      if (!validPresentationIds.has(presentationId)) presentationBlobCacheRef.current.delete(presentationId)
    }
  }, [project.presentations])
  const [currentView, setCurrentView] = useState<PageView>(currentPage.view)
  const pageIndex = project.pages.findIndex((page) => page.id === currentPage.id)
  const currentPageName = currentPage.name.replace(/^白板 /, language === 'en' ? 'Board ' : '白板 ')
  const backgroundMaxDimension = displayMaxDimensionForView(currentView.scale)
  const backgroundImage = useCachedDisplayImage(currentPage.image?.src, backgroundMaxDimension)
  const documentSize = currentPage.image
    ? { width: currentPage.image.width, height: currentPage.image.height }
    : EMPTY_PAGE_SIZE
  const visibleOverscan = Math.max(96, 160 / currentView.scale)
  const visibleBoardRect = useMemo(
    () => ({
      x: -currentView.x / currentView.scale - visibleOverscan,
      y: -currentView.y / currentView.scale - visibleOverscan,
      width: viewport.width / currentView.scale + visibleOverscan * 2,
      height: viewport.height / currentView.scale + visibleOverscan * 2,
    }),
    [currentView.scale, currentView.x, currentView.y, viewport.height, viewport.width, visibleOverscan],
  )
  const shouldFilterVisibleStrokes = showVectorStrokes || !isPanning
  const visibleStrokes = useMemo(
    () => {
      if (!shouldFilterVisibleStrokes) return []
      return currentPage.strokes.filter((stroke) => strokeIntersectsRect(stroke, visibleBoardRect))
    },
    [currentPage.strokes, shouldFilterVisibleStrokes, visibleBoardRect],
  )
  const selectVisibleStrokes = useMemo(
    () => (showVectorStrokes ? visibleStrokes : []),
    [showVectorStrokes, visibleStrokes],
  )
  const currentSourcePage = sourcePageForBoardPage(currentPage)

  useEffect(() => {
    document.title = labels.appName
  }, [labels.appName])

  const sameCommittedInkCache = useCallback(
    (cache: typeof committedInkCacheRef.current, view: PageView, nextViewport: { width: number; height: number }) =>
      Boolean(
        cache &&
          cache.pageId === currentPage.id &&
          cache.viewport.width === nextViewport.width &&
          cache.viewport.height === nextViewport.height &&
          cache.view.x === view.x &&
          cache.view.y === view.y &&
          cache.view.scale === view.scale,
      ),
    [currentPage.id],
  )
  const preloadPrevious2Src = project.pages[pageIndex - 2]?.image?.src
  const preloadPreviousSrc = project.pages[pageIndex - 1]?.image?.src
  const preloadNextSrc = project.pages[pageIndex + 1]?.image?.src
  const preloadNext2Src = project.pages[pageIndex + 2]?.image?.src

  const { openPageJump, goToPageIndex, switchPage, jumpToPageNumber, jumpToSourcePage } = useWhiteboardNavigation({
    project,
    currentPage,
    pageIndex,
    pageJumpValue,
    setProject,
    setStatus,
    setPageJumpValue,
    setPageJumpOpen,
    setSettingsOpen,
    setExportPanelOpen,
    setMorePanelOpen,
    setBookPickerOpen,
    setTocOpen,
  })

  const updatePages = useCallback((updater: (pages: BoardPage[]) => BoardPage[], recordHistory = false) => {
    setProject((previous) => {
      if (recordHistory) {
        setPast((items) => [...items.slice(-40), previous.pages])
        setFuture([])
      }
      return { ...previous, pages: updater(previous.pages), updatedAt: Date.now() }
    })
  }, [])

  const updateCurrentPage = useCallback(
    (updater: (page: BoardPage) => BoardPage, recordHistory = false) => {
      updatePages(
        (pages) => {
          const pageIndex = pages.findIndex((page) => page.id === project.currentPageId)
          if (pageIndex < 0) return pages
          const nextPages = [...pages]
          nextPages[pageIndex] = updater(nextPages[pageIndex])
          return nextPages
        },
        recordHistory,
      )
    },
    [project.currentPageId, updatePages],
  )

  const persistCurrentView = useCallback(
    (view: PageView) => {
      setProject((previous) => {
        const pageIndex = previous.pages.findIndex((page) => page.id === previous.currentPageId)
        if (pageIndex < 0) return previous
        const page = previous.pages[pageIndex]
        if (page.view.x === view.x && page.view.y === view.y && page.view.scale === view.scale) return previous
        const nextPages = [...previous.pages]
        nextPages[pageIndex] = { ...page, view }
        return { ...previous, pages: nextPages }
      })
    },
    [],
  )

  const scheduleViewLayerDraw = useCallback(() => {
    if (viewLayerDrawFrame.current !== null) return
    viewLayerDrawFrame.current = window.requestAnimationFrame(() => {
      viewLayerDrawFrame.current = null
      const layers = new Set<Konva.Layer>()
      if (documentLayerRef.current) layers.add(documentLayerRef.current)
      if (vectorLayerRef.current) layers.add(vectorLayerRef.current)
      const inkLayer = committedInkImageRef.current?.getLayer()
      if (inkLayer) layers.add(inkLayer)
      layers.forEach((layer) => layer.batchDraw())
    })
  }, [])

  const syncCurrentViewState = useCallback((mode: 'frame' | 'idle' | 'now' = 'frame') => {
    if (viewRenderFrame.current !== null) {
      window.cancelAnimationFrame(viewRenderFrame.current)
      viewRenderFrame.current = null
    }
    if (viewStateSyncTimer.current !== undefined) {
      window.clearTimeout(viewStateSyncTimer.current)
      viewStateSyncTimer.current = undefined
    }

    if (mode === 'now') {
      setCurrentView(currentViewRef.current)
      return
    }

    if (mode === 'idle') {
      viewStateSyncTimer.current = window.setTimeout(() => {
        viewStateSyncTimer.current = undefined
        setCurrentView(currentViewRef.current)
      }, 96)
      return
    }

    viewRenderFrame.current = window.requestAnimationFrame(() => {
      viewRenderFrame.current = null
      setCurrentView(currentViewRef.current)
    })
  }, [])

  const applyInstantViewToLayers = useCallback((view: PageView) => {
    for (const layer of [documentLayerRef.current, vectorLayerRef.current]) {
      if (!layer) continue
      layer.position({ x: view.x, y: view.y })
      layer.scale({ x: view.scale, y: view.scale })
    }

    const inkImage = committedInkImageRef.current
    const cachedView = committedInkCacheRef.current?.view
    if (inkImage && cachedView) {
      const scale = view.scale / Math.max(0.1, cachedView.scale)
      inkImage.position({
        x: view.x - cachedView.x * scale,
        y: view.y - cachedView.y * scale,
      })
      inkImage.scale({ x: scale, y: scale })
    }
    scheduleViewLayerDraw()
  }, [scheduleViewLayerDraw])

  const applyCurrentView = useCallback(
    (view: PageView, syncMode: 'frame' | 'idle' | 'now' = 'frame') => {
      currentViewRef.current = view
      applyInstantViewToLayers(view)
      syncCurrentViewState(syncMode)
      if (viewPersistTimer.current !== undefined) window.clearTimeout(viewPersistTimer.current)
      viewPersistTimer.current = window.setTimeout(() => {
        viewPersistTimer.current = undefined
        persistCurrentView(view)
      }, 160)
    },
    [applyInstantViewToLayers, persistCurrentView, syncCurrentViewState],
  )

  const clearLiveInkLayer = useCallback(() => {
    if (liveInkClearTimer.current !== undefined) {
      window.clearTimeout(liveInkClearTimer.current)
      liveInkClearTimer.current = undefined
    }
    if (liveInkClearFrameRef.current !== null) {
      window.cancelAnimationFrame(liveInkClearFrameRef.current)
      liveInkClearFrameRef.current = null
    }
    liveInkContextRef.current?.clearRect(0, 0, viewport.width, viewport.height)
    liveInkLastPointRef.current = null
  }, [viewport.height, viewport.width])

  const clearLiveInkLayerAfterPaint = useCallback(() => {
    if (liveInkClearFrameRef.current !== null) window.cancelAnimationFrame(liveInkClearFrameRef.current)
    liveInkClearFrameRef.current = window.requestAnimationFrame(() => {
      liveInkClearFrameRef.current = null
      if (!isDrawingRef.current) clearLiveInkLayer()
    })
  }, [clearLiveInkLayer])

  const previewErasePoints = useCallback(
    (points: BoardPointerPoint[]) => {
      if (!points.length) return
      eraserPreviewActiveRef.current = true
      const canvas = committedInkCanvasRef.current
      const context = canvas.getContext('2d')
      if (!context) return
      const ratio = Math.max(1, Math.min(window.devicePixelRatio || 1, 2))
      context.save()
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
      context.globalCompositeOperation = 'destination-out'
      context.lineCap = 'round'
      context.lineJoin = 'round'

      for (const point of points) {
        const previous = previewEraserPointRef.current
        const radius = point.eraserRadius ?? eraserRadius
        context.lineWidth = radius * 2
        context.beginPath()
        if (previous) {
          context.lineWidth = ((previous.eraserRadius ?? eraserRadius) + radius)
          context.moveTo(previous.screenX, previous.screenY)
          context.lineTo(point.screenX, point.screenY)
          context.stroke()
        } else {
          context.arc(point.screenX, point.screenY, radius, 0, Math.PI * 2)
          context.fill()
        }
        previewEraserPointRef.current = point
      }
      context.restore()
      committedInkImageRef.current?.getLayer()?.batchDraw()
    },
    [eraserRadius],
  )

  const fitPage = useCallback(() => {
    const reservedBottom = blankCanvas ? 92 : 150
    const reservedSide = blankCanvas ? 0 : 32
    const scale = Math.min(
      (viewport.width - reservedSide) / documentSize.width,
      (viewport.height - reservedBottom) / documentSize.height,
      blankCanvas ? 4 : 1.6,
    )
    const nextView = {
      scale: Math.max(0.12, scale),
      x: (viewport.width - documentSize.width * scale) / 2,
      y: Math.max(blankCanvas ? 0 : 18, (viewport.height - reservedBottom - documentSize.height * scale) / 2),
    }
    applyCurrentView(nextView)
  }, [applyCurrentView, blankCanvas, documentSize.height, documentSize.width, viewport.height, viewport.width])

  const openNoteText = useCallback(
    (text: string, sourceName = 'Whiteboard note', afterOpen?: () => void) => {
      try {
        const parsed = parseNoteFileText(text)
        const parsedBook = getBuiltInBook(parsed.bookId || currentBook.id)
        setPast([])
        setFuture([])
        setSelectedStrokeId(null)
        setSelectedTextId(null)
        hostNoteOpenedRef.current = true
        skipNextBookInitializationRef.current = true
        setSelectedBookId(parsedBook.id)
        localStorage.setItem(SELECTED_BOOK_KEY, parsedBook.id)
        setProject({ ...parsed, bookId: parsedBook.id, updatedAt: Date.now() })
        setProjectReady(true)
        setBookPickerOpen(false)
        setSettingsOpen(false)
        setExportPanelOpen(false)
        setMorePanelOpen(false)
        setTocOpen(false)
        setPageJumpOpen(false)
        setStatus(labels.status.loaded(sourceName))
        window.setTimeout(() => {
          fitPage()
          afterOpen?.()
        }, 80)
      } catch {
        setStatus(language === 'en' ? 'Whiteboard note file is invalid' : '白板笔记文件格式不正确')
      }
    },
    [currentBook.id, fitPage, labels.status, language],
  )

  useEffect(() => {
    let active = true

    if (skipNextBookInitializationRef.current) {
      skipNextBookInitializationRef.current = false
      return () => {
        active = false
      }
    }

    const initializeSession = async () => {
      try {
        const stored = await loadProject(currentBook.id)
        if (!active || hostNoteOpenedRef.current) return
        if (isStoredProjectForBook(stored, currentBook)) {
          preloadAroundCurrentPage(stored)
          setProject(stored)
          setStatus(labels.status.loaded(currentBookTitle))
        } else {
          const nextProject = initialProject(currentBook.id)
          preloadAroundCurrentPage(nextProject)
          setProject(nextProject)
          setStatus(labels.status.loaded(currentBookTitle))
        }
      } catch {
        if (!active || hostNoteOpenedRef.current) return
        const nextProject = initialProject(currentBook.id)
        preloadAroundCurrentPage(nextProject)
        setProject(nextProject)
        setStatus(labels.status.loaded(currentBookTitle))
      }
      if (active) setProjectReady(true)
    }
    void initializeSession()
    return () => {
      active = false
    }
  }, [currentBook, currentBookTitle, labels.status])

  useEffect(() => {
    const openFromMessage = (payload: unknown) => {
      const message = payload as HostMessage
      if (message?.type === 'save-note-file-result') {
        setStatus(message.path ? `Saved ${message.path}` : message.error || labels.status.autoSaveFailed)
        return
      }
      if (message?.type === 'autosave-note-file-result' && message.error) {
        setStatus(`Auto-save failed: ${message.error}`)
      }
    }
    const handleWindowMessage = (event: MessageEvent) => openFromMessage(event.data)
    const webview = window.chrome?.webview

    window.addEventListener('message', handleWindowMessage)
    webview?.addEventListener?.('message', handleWindowMessage)
    webview?.postMessage?.('app-ready')
    return () => {
      window.removeEventListener('message', handleWindowMessage)
      webview?.removeEventListener?.('message', handleWindowMessage)
    }
  }, [labels.status, language])

  useEffect(() => {
    const onResize = () => {
      stageBoundsRef.current = null
      setViewport({ width: window.innerWidth, height: window.innerHeight })
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    currentViewRef.current = currentPage.view
    const frame = window.requestAnimationFrame(() => {
      setCurrentView(currentPage.view)
    })
    return () => window.cancelAnimationFrame(frame)
  }, [currentPage.id, currentPage.view])

  useEffect(
    () => () => {
      if (liveInkClearTimer.current !== undefined) window.clearTimeout(liveInkClearTimer.current)
      if (liveInkClearFrameRef.current !== null) window.cancelAnimationFrame(liveInkClearFrameRef.current)
      if (committedInkRenderFrame.current !== null) window.cancelAnimationFrame(committedInkRenderFrame.current)
      if (viewLayerDrawFrame.current !== null) window.cancelAnimationFrame(viewLayerDrawFrame.current)
      if (viewRenderFrame.current !== null) window.cancelAnimationFrame(viewRenderFrame.current)
      if (viewStateSyncTimer.current !== undefined) window.clearTimeout(viewStateSyncTimer.current)
      if (viewPersistTimer.current !== undefined) window.clearTimeout(viewPersistTimer.current)
      if (interactiveViewPersistTimer.current !== undefined) window.clearTimeout(interactiveViewPersistTimer.current)
    },
    [],
  )

  useEffect(() => {
    const perfEnabled =
      new URLSearchParams(window.location.search).get('perf') === '1' ||
      localStorage.getItem('open-whiteboard-perf') === '1'
    perfStatsRef.current.enabled = perfEnabled
    const perfWindow = window as Window & { __whiteboardPerf?: WhiteboardPerfApi }
    const snapshot = () => {
      const stats = perfStatsRef.current
      return {
        ...stats,
        averageLiveDrawMs: stats.liveDraws ? stats.totalLiveDrawMs / stats.liveDraws : 0,
        averageInputToDrawMs: stats.inputSamples ? stats.totalInputToDrawMs / stats.inputSamples : 0,
        averageFirstInputToDrawMs: stats.firstDraws ? stats.totalFirstInputToDrawMs / stats.firstDraws : 0,
        averageCommittedRenderMs: stats.committedRenders ? stats.totalCommittedRenderMs / stats.committedRenders : 0,
      }
    }
    perfWindow.__whiteboardPerf = {
      enable: () => {
        perfStatsRef.current.enabled = true
        localStorage.setItem('open-whiteboard-perf', '1')
        return perfStatsRef.current
      },
      disable: () => {
        perfStatsRef.current.enabled = false
        localStorage.removeItem('open-whiteboard-perf')
        return perfStatsRef.current
      },
      reset: () => {
        perfStatsRef.current = initialPerfStats(perfStatsRef.current.enabled)
        return perfStatsRef.current
      },
      snapshot,
    }
    return () => {
      delete perfWindow.__whiteboardPerf
    }
  }, [])

  const drawCommittedStroke = (context: CanvasRenderingContext2D, stroke: Stroke, screenStableScale: number) => {
    if (stroke.points.length < 2) return
    context.save()
    context.globalAlpha = stroke.opacity
    context.globalCompositeOperation = stroke.kind === 'highlighter' ? 'multiply' : 'source-over'
    context.strokeStyle = stroke.color
    context.fillStyle = stroke.color
    context.lineCap = 'round'
    context.lineJoin = 'round'

    if (stroke.kind === 'pen') {
      drawSignatureStroke(context, stroke, screenStableScale)
    } else {
      context.lineWidth = stroke.width * screenStableScale
      context.beginPath()
      context.moveTo(stroke.points[0], stroke.points[1])
      for (let i = 2; i < stroke.points.length; i += 2) {
        context.lineTo(stroke.points[i], stroke.points[i + 1])
      }
      context.stroke()
    }
    context.restore()
  }

  useEffect(() => {
    if (eraserPreviewActiveRef.current) return
    if (skipNextEraserPreviewCommitRenderRef.current) {
      skipNextEraserPreviewCommitRenderRef.current = false
      committedInkCacheRef.current = {
        pageId: currentPage.id,
        view: currentView,
        viewport,
      }
      committedInkImageRef.current?.position({ x: 0, y: 0 })
      committedInkImageRef.current?.scale({ x: 1, y: 1 })
      committedInkImageRef.current?.getLayer()?.batchDraw()
      return
    }
    if (isPanning && committedInkCacheRef.current) return
    if (committedInkRenderFrame.current !== null) window.cancelAnimationFrame(committedInkRenderFrame.current)
    committedInkRenderFrame.current = window.requestAnimationFrame(() => {
      const perfStart = perfStatsRef.current.enabled ? performance.now() : 0
      committedInkRenderFrame.current = null
      const canvas = committedInkCanvasRef.current
      const ratio = Math.max(1, Math.min(window.devicePixelRatio || 1, 2))
      const width = Math.max(1, Math.round(viewport.width * ratio))
      const height = Math.max(1, Math.round(viewport.height * ratio))
      if (canvas.width !== width) canvas.width = width
      if (canvas.height !== height) canvas.height = height

      const context = canvas.getContext('2d')
      if (!context) return
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
      const screenStableScale = 1 / Math.max(0.1, currentView.scale)

      const pendingStroke = pendingCommittedStrokeRef.current
      const shouldClearLiveInkAfterRender = Boolean(pendingStroke && currentPage.strokes.includes(pendingStroke))
      let committedRenderKind: 'incremental' | 'full' = 'full'
      if (
        pendingStroke &&
        currentPage.strokes.includes(pendingStroke) &&
        sameCommittedInkCache(committedInkCacheRef.current, currentView, viewport)
      ) {
        committedRenderKind = 'incremental'
        context.save()
        context.translate(currentView.x, currentView.y)
        context.scale(currentView.scale, currentView.scale)
        drawCommittedStroke(context, pendingStroke, screenStableScale)
        context.restore()
        pendingCommittedStrokeRef.current = null
      } else {
        pendingCommittedStrokeRef.current = null
        context.clearRect(0, 0, viewport.width, viewport.height)
        context.save()
        context.translate(currentView.x, currentView.y)
        context.scale(currentView.scale, currentView.scale)

        for (const stroke of visibleStrokes) {
          drawCommittedStroke(context, stroke, screenStableScale)
        }
        context.restore()
        committedInkCacheRef.current = {
          pageId: currentPage.id,
          view: currentView,
          viewport,
        }
      }
      committedInkImageRef.current?.position({ x: 0, y: 0 })
      committedInkImageRef.current?.scale({ x: 1, y: 1 })
      committedInkImageRef.current?.getLayer()?.batchDraw()
      if (shouldClearLiveInkAfterRender && !isDrawingRef.current) clearLiveInkLayerAfterPaint()
      if (perfStatsRef.current.enabled) {
        const elapsed = performance.now() - perfStart
        const stats = perfStatsRef.current
        stats.committedRenders += 1
        if (committedRenderKind === 'incremental') stats.committedIncrementalRenders += 1
        else stats.committedFullRenders += 1
        stats.totalCommittedRenderMs += elapsed
        stats.maxCommittedRenderMs = Math.max(stats.maxCommittedRenderMs, elapsed)
      }
    })

    return () => {
      if (committedInkRenderFrame.current !== null) {
        window.cancelAnimationFrame(committedInkRenderFrame.current)
        committedInkRenderFrame.current = null
      }
    }
  }, [clearLiveInkLayerAfterPaint, currentPage.id, currentPage.strokes, currentView, isPanning, sameCommittedInkCache, viewport, visibleStrokes])

  useEffect(() => {
    if (currentView.x === 0 && currentView.y === 0 && currentView.scale === 1) {
      const timer = window.setTimeout(fitPage, 0)
      return () => window.clearTimeout(timer)
    }
  }, [currentPage.id, currentView.scale, currentView.x, currentView.y, fitPage])

  useEffect(() => {
    const sources = [preloadPrevious2Src, preloadPreviousSrc, preloadNextSrc, preloadNext2Src].filter(
      (source): source is string => Boolean(source),
    )
    if (sources.length === 0) return

    preloadImages(sources)
    preloadDisplayImages(sources, backgroundMaxDimension)
  }, [backgroundMaxDimension, preloadNext2Src, preloadNextSrc, preloadPrevious2Src, preloadPreviousSrc])

  useEffect(() => {
    const timer = window.setTimeout(() => setSelectedStrokeId(null), 0)
    const textTimer = window.setTimeout(() => setSelectedTextId(null), 0)
    return () => {
      window.clearTimeout(timer)
      window.clearTimeout(textTimer)
    }
  }, [currentPage.id])

  const undo = useCallback(() => {
    setPast((items) => {
      if (!items.length) return items
      const previousPages = items[items.length - 1]
      setFuture((futureItems) => [project.pages, ...futureItems.slice(0, 40)])
      setProject((previous) => ({
        ...previous,
        pages: previousPages,
        currentPageId: previousPages.some((page) => page.id === previous.currentPageId)
          ? previous.currentPageId
          : previousPages[0].id,
        updatedAt: Date.now(),
      }))
      return items.slice(0, -1)
    })
  }, [project.pages])

  const redo = useCallback(() => {
    setFuture((items) => {
      if (!items.length) return items
      const nextPages = items[0]
      setPast((pastItems) => [...pastItems.slice(-40), project.pages])
      setProject((previous) => ({
        ...previous,
        pages: nextPages,
        currentPageId: nextPages.some((page) => page.id === previous.currentPageId) ? previous.currentPageId : nextPages[0].id,
        updatedAt: Date.now(),
      }))
      return items.slice(1)
    })
  }, [project.pages])

  const deleteSelectedStroke = useCallback(() => {
    if (!selectedStrokeId && !selectedTextId) return
    updateCurrentPage(
      (page) => ({
        ...page,
        strokes: selectedStrokeId ? page.strokes.filter((stroke) => stroke.id !== selectedStrokeId) : page.strokes,
        texts: selectedTextId ? (page.texts ?? []).filter((note) => note.id !== selectedTextId) : page.texts,
      }),
      true,
    )
    setSelectedStrokeId(null)
    setSelectedTextId(null)
  }, [selectedStrokeId, selectedTextId, updateCurrentPage])

  const moveStroke = useCallback(
    (strokeId: string, dx: number, dy: number) => {
      updateCurrentPage(
        (page) => ({
          ...page,
          strokes: page.strokes.map((stroke) => (stroke.id === strokeId ? translateStroke(stroke, dx, dy) : stroke)),
        }),
        true,
      )
    },
    [updateCurrentPage],
  )

  const moveText = useCallback(
    (textId: string, dx: number, dy: number) => {
      updateCurrentPage(
        (page) => ({
          ...page,
          texts: (page.texts ?? []).map((note) => (note.id === textId ? { ...note, x: note.x + dx, y: note.y + dy } : note)),
        }),
        true,
      )
    },
    [updateCurrentPage],
  )

  useEffect(() => {
    if (!projectReady) return
    if (saveTimer.current) window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => {
      const webview = window.chrome?.webview
      if (webview?.postMessage) {
        webview.postMessage(
          JSON.stringify({
            type: 'autosave-note-file',
            fileName: noteFileName(),
            content: serializeNoteFile(project),
          }),
        )
        return
      }
      saveProject(project)
        .then(() => setStatus(labels.status.autoSaved(new Date().toLocaleTimeString(language === 'en' ? 'en-US' : 'zh-CN', { hour12: false }))))
        .catch(() => setStatus(labels.status.autoSaveFailed))
    }, 1500)
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current)
    }
  }, [labels.status, language, project, projectReady])

  const screenToBoardPoint = (screenX: number, screenY: number, pressure?: number, time = performance.now()): BoardPointerPoint => ({
    ...screenToWorldPoint({ x: screenX, y: screenY }, currentViewRef.current),
    screenX,
    screenY,
    pressure,
    time,
  })

  const refreshStageBounds = useCallback(() => {
    const stage = stageRef.current
    const bounds = stage?.container().getBoundingClientRect() ?? null
    stageBoundsRef.current = bounds
    return bounds
  }, [])

  const getStageBounds = useCallback(() => stageBoundsRef.current ?? refreshStageBounds(), [refreshStageBounds])

  const getBoardPoint = () => {
    const stage = stageRef.current
    const pointer = stage?.getPointerPosition()
    if (!stage || !pointer) return null
    return screenToBoardPoint(pointer.x, pointer.y)
  }

  const eventScreenPoint = useCallback((event: PointerEvent): ScreenPoint | null => {
    const bounds = getStageBounds()
    if (!bounds) return null
    return {
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top,
    }
  }, [getStageBounds])

  const applyInteractiveView = useCallback(
    (view: PageView) => {
      currentViewRef.current = view
      applyInstantViewToLayers(view)
      syncCurrentViewState('idle')
      if (interactiveViewPersistTimer.current !== undefined) window.clearTimeout(interactiveViewPersistTimer.current)
      interactiveViewPersistTimer.current = window.setTimeout(() => {
        interactiveViewPersistTimer.current = undefined
        persistCurrentView(currentViewRef.current)
      }, 240)
    },
    [applyInstantViewToLayers, persistCurrentView, syncCurrentViewState],
  )

  const commitInteractiveView = useCallback(() => {
    if (interactiveViewPersistTimer.current !== undefined) {
      window.clearTimeout(interactiveViewPersistTimer.current)
      interactiveViewPersistTimer.current = undefined
    }
    syncCurrentViewState('now')
    persistCurrentView(currentViewRef.current)
  }, [persistCurrentView, syncCurrentViewState])

  const {
    beginTouchPan,
    continueTouchPan,
    continueTouchPanPointerEvent,
    endTouchPan,
    hasTouchPanPointer,
    resetTouchPan,
    setPanStart,
  } = useTouchPanGesture({
    currentViewRef,
    panStartRef,
    setIsPanning,
    applyCurrentView: applyInteractiveView,
    eventScreenPoint,
  })

  const getBoardSamplesFromPointerEvent = (event: PointerEvent) => {
    const bounds = getStageBounds()
    if (!bounds) return []
    const view = currentViewRef.current
    const receivedAt = performance.now()
    const coalescedEvents =
      typeof event.getCoalescedEvents === 'function' ? event.getCoalescedEvents() : []
    const sourceEvents = coalescedEvents.length ? coalescedEvents : [event]
    if (perfStatsRef.current.enabled && coalescedEvents.length > 1) {
      perfStatsRef.current.coalescedSamples += coalescedEvents.length
    }
    const samples: BoardPointerPoint[] = []
    for (const sampleEvent of sourceEvents) {
      const screenX = sampleEvent.clientX - bounds.left
      const screenY = sampleEvent.clientY - bounds.top
      const sampleTime = sampleEvent.timeStamp
      samples.push({
        x: (screenX - view.x) / view.scale,
        y: (screenY - view.y) / view.scale,
        screenX,
        screenY,
        pressure: nativePointerPressure(sampleEvent),
        time: receivedAt - sampleTime > 64 ? receivedAt : sampleTime,
      })
    }
    if (samples.length) return samples
    const fallbackPoint = getBoardPoint()
    return fallbackPoint ? [fallbackPoint] : []
  }

  const getBoardSamples = (event: Konva.KonvaEventObject<PointerEvent>) => getBoardSamplesFromPointerEvent(event.evt)

  const { clearLiveInkCanvas, scheduleLiveInkClear, drawLiveInkSamples, drawEraserCursor } = useLiveInk({
    canvasRef: liveInkCanvasRef,
    contextRef: liveInkContextRef,
    lastPointRef: liveInkLastPointRef,
    clearTimerRef: liveInkClearTimer,
    viewport,
    eraserRadius,
    perfStatsRef,
    refreshStageBounds,
  })

  const captureBoardPointer = (event: Konva.KonvaEventObject<PointerEvent>) => {
    activePointerId.current = event.evt.pointerId
    event.evt.preventDefault()
    const target = event.evt.target instanceof Element ? event.evt.target : null
    if (!target) return

    try {
      if (!target.hasPointerCapture(event.evt.pointerId)) {
        target.setPointerCapture(event.evt.pointerId)
      }
      capturedPointerTarget.current = target
    } catch {
      capturedPointerTarget.current = null
    }
  }

  const releaseBoardPointer = (event?: Konva.KonvaEventObject<PointerEvent>) => {
    const pointerId = event?.evt.pointerId ?? activePointerId.current
    const target = capturedPointerTarget.current
    try {
      if (pointerId !== null && pointerId !== undefined && target?.hasPointerCapture(pointerId)) {
        target.releasePointerCapture(pointerId)
      }
    } catch {
      // Pointer capture may already be gone after pointercancel or browser gesture interruption.
    }
    capturedPointerTarget.current = null
    activePointerId.current = null
  }

  const clearLaserTrail = useCallback(() => {
    if (laserHideTimer.current) window.clearTimeout(laserHideTimer.current)
    laserHideTimer.current = undefined
    if (laserFrame.current !== null) {
      window.cancelAnimationFrame(laserFrame.current)
      laserFrame.current = null
    }
    laserTrailFadingRef.current = false
    setLaserTrailFading(false)
    activeLaserTrailRef.current = null
    laserTrailsRef.current = []
    setLaserTrails([])
  }, [])

  const flushLaserTrail = useCallback(() => {
    laserFrame.current = null
    setLaserTrails(snapshotLaserTrails(laserTrailsRef.current))
  }, [])

  const scheduleLaserTrailFlush = useCallback(() => {
    if (laserFrame.current !== null) return
    laserFrame.current = window.requestAnimationFrame(flushLaserTrail)
  }, [flushLaserTrail])

  const scheduleLaserTrailClear = useCallback(() => {
    if (laserHideTimer.current) window.clearTimeout(laserHideTimer.current)
    activeLaserTrailRef.current = null
    if (laserTrailsRef.current.some((trail) => trail.points.length > 0)) {
      laserTrailFadingRef.current = true
      setLaserTrailFading(true)
    }
    laserHideTimer.current = window.setTimeout(() => {
      laserHideTimer.current = undefined
      laserTrailFadingRef.current = false
      setLaserTrailFading(false)
      activeLaserTrailRef.current = null
      laserTrailsRef.current = []
      setLaserTrails([])
    }, LASER_TRAIL_HIDE_DELAY_MS)
  }, [])

  const beginLaserTrail = useCallback(() => {
    if (laserHideTimer.current) window.clearTimeout(laserHideTimer.current)
    laserHideTimer.current = undefined
    if (laserTrailFadingRef.current) {
      laserTrailFadingRef.current = false
      setLaserTrailFading(false)
    }
    const trail: LaserTrail = { id: `laser-trail-${laserPointSeq.current++}`, points: [] }
    activeLaserTrailRef.current = trail
    laserTrailsRef.current.push(trail)
    trimLaserTrailHistory(laserTrailsRef.current)
    scheduleLaserTrailFlush()
  }, [scheduleLaserTrailFlush])

  const pushLaserPoint = useCallback((point: ScreenPoint | null) => {
    if (!point) return
    if (laserHideTimer.current) window.clearTimeout(laserHideTimer.current)
    laserHideTimer.current = undefined
    if (laserTrailFadingRef.current) {
      laserTrailFadingRef.current = false
      setLaserTrailFading(false)
    }
    if (!activeLaserTrailRef.current) {
      const trail: LaserTrail = { id: `laser-trail-${laserPointSeq.current++}`, points: [] }
      activeLaserTrailRef.current = trail
      laserTrailsRef.current.push(trail)
    }
    if (!appendLaserTrailPoint(activeLaserTrailRef.current.points, point, `laser-${laserPointSeq.current++}`)) return
    trimLaserTrailHistory(laserTrailsRef.current)
    scheduleLaserTrailFlush()
  }, [scheduleLaserTrailFlush])

  const pushLaserEventPoints = useCallback((event: PointerEvent) => {
    const events = typeof event.getCoalescedEvents === 'function' ? event.getCoalescedEvents() : [event]
    for (const item of events) pushLaserPoint(eventScreenPoint(item))
  }, [eventScreenPoint, pushLaserPoint])

  const recordHistory = useCallback(() => {
    setPast((items) => [...items.slice(-40), project.pages])
    setFuture([])
  }, [project.pages])

  const {
    beginStroke,
    continueStroke,
    continueStrokeSamples,
    commitStroke,
    beginEraser,
    trackEraserSamples,
    finishEraser,
    resetStrokeInput,
  } = useStrokeLifecycle({
    tool,
    strokeColor,
    strokeWidth,
    highlightOpacity,
    eraserRadius,
    isDrawingRef,
    currentViewRef,
    pendingCommittedStrokeRef,
    recordHistory,
    updateCurrentPage,
    getBoardSamples,
    clearLiveInkCanvas,
    scheduleLiveInkClear,
    drawLiveInkSamples,
    drawEraserCursor,
    previewErasePoints,
    onEraserPreviewCommit: () => {
      skipNextEraserPreviewCommitRenderRef.current = true
    },
  })

  const {
    addBlankPage,
    importFiles,
    exportProject,
    saveNow,
    resetCurrentView,
    importProject,
    exportCurrentPng,
    exportAllPdf,
    sendHostCommand,
    clearCurrentPage,
    selectBuiltInBook,
  } = useProjectActions({
    project,
    currentBook,
    currentPage,
    selectedBookId,
    setProject,
    setProjectReady,
    setSelectedBookId,
    setPast,
    setFuture,
    setStatus,
    setBookPickerOpen,
    setSettingsOpen,
    setExportPanelOpen,
    setMorePanelOpen,
    setTocOpen,
    setPageJumpOpen,
    setSelectedStrokeId,
    setSelectedTextId,
    updateCurrentPage,
    fitPage,
    clearLiveInkCanvas,
    resetStrokeInput,
  })

  useEffect(() => {
    const openConvertedOfficeFile = async (payload: unknown) => {
      const message = payload as HostMessage
      if (message?.type === 'open-note-file' && typeof message.content === 'string') {
        const files = Array.isArray(message.files) ? filesFromHostImportMessage({ files: message.files }) : []
        openNoteText(message.content, message.fileName || 'Whiteboard note', files.length ? () => {
          void importFiles(files, { preserveCurrentPages: true })
        } : undefined)
        return
      }
      if (message?.type === 'converted-office-file' && typeof message.content === 'string' && message.fileName) {
        try {
          setStatus(`Importing converted file: ${message.fileName}`)
          const result = await importFiles(
            [fileFromDataUrl(message.content, message.fileName)],
            { preserveCurrentPages: Boolean(message.preserveCurrentPages) },
          )
          if (!result?.importedPages) setStatus(`Converted ${message.fileName}`)
        } catch (error) {
          setStatus(error instanceof Error ? error.message : 'Converted file could not be imported')
        }
        return
      }
      if (message?.type === 'open-import-file') {
        const files = filesFromHostImportMessage(message)
        if (!files.length) return
        try {
          setStatus(files.length === 1 ? `Importing ${files[0].name}` : `Importing ${files.length} startup files`)
          if (files.length === 1 && mayBeWhiteboardNoteJsonFile(files[0])) {
            try {
              const text = await files[0].text()
              parseNoteFileText(text)
              openNoteText(text, files[0].name)
              return
            } catch {
              // Plain JSON files should continue through the generic importer.
            }
          }
          const result = await importFiles(files)
          if (!result?.importedPages) setStatus(files.length === 1 ? `Imported ${files[0].name}` : `Imported ${files.length} startup files`)
        } catch (error) {
          setStatus(error instanceof Error ? error.message : 'Startup file could not be imported')
        }
        return
      }
      if (message?.type === 'convert-office-file-result' && message.error) {
        setStatus(message.error)
      }
    }
    const handleWindowMessage = (event: MessageEvent) => {
      void openConvertedOfficeFile(event.data)
    }
    const webview = window.chrome?.webview
    window.addEventListener('message', handleWindowMessage)
    webview?.addEventListener?.('message', handleWindowMessage)
    window.setTimeout(flushEarlyHostMessages, 0)
    return () => {
      window.removeEventListener('message', handleWindowMessage)
      webview?.removeEventListener?.('message', handleWindowMessage)
    }
  }, [importFiles, importProject, openNoteText])

  const importUserFiles = useCallback(
    async (files: FileList | File[]) => {
      const fileList = Array.from(files)
      let noteFile: File | undefined
      for (const file of fileList) {
        if (!mayBeWhiteboardNoteJsonFile(file)) continue
        try {
          parseNoteFileText(await file.text())
          noteFile = file
          break
        } catch {
          // Plain JSON files should still import as text pages.
        }
      }
      if (noteFile) {
        const remainingFiles = fileList.filter((file) => file !== noteFile)
        openNoteText(await noteFile.text(), noteFile.name, remainingFiles.length ? () => {
          void importFiles(remainingFiles, { preserveCurrentPages: true })
        } : undefined)
        return
      }
      void importFiles(fileList)
    },
    [importFiles, openNoteText],
  )

  useEffect(() => {
    if (!importsEnabled) return
    const handlePaste = (event: ClipboardEvent) => {
      if (isEditablePasteTarget(event.target)) return
      const files = importableFilesFromClipboard(event.clipboardData)
      if (!files.length) return
      event.preventDefault()
      void importUserFiles(files)
    }
    window.addEventListener('paste', handlePaste)
    return () => {
      window.removeEventListener('paste', handlePaste)
    }
  }, [importUserFiles, importsEnabled])

  const handleCloseApp = useCallback(async () => {
    sendHostCommand('close')
  }, [sendHostCommand])

  const closeFloatingPanels = useCallback(() => {
    setBookPickerOpen(false)
    setSettingsOpen(false)
    setExportPanelOpen(false)
    setMorePanelOpen(false)
    setClockPanelOpen(false)
    setTocOpen(false)
    setPageJumpOpen(false)
  }, [])

  const stopPresentationRuntime = useCallback(() => {
    const runtime = presentationRuntimeRef.current
    presentationRuntimeRef.current = null
    runtime?.disposeInk?.()
    runtime?.show.stop()
    runtime?.restoreConsoleWarn?.()
    runtime?.renderer.destroy()
  }, [])

  const attachPresentationInkOverlay = useCallback(
    (
      show: PresentationRuntime['show'],
      presentationId: string,
      slideCanvas: HTMLCanvasElement,
      renderWarningState?: { seen: boolean },
    ) => {
      const fallbackCanvas = document.createElement('canvas')
      const committedCanvas = document.createElement('canvas')
      const canvas = document.createElement('canvas')
      const toolbar = document.createElement('div')
      const ratio = Math.max(1, Math.min(window.devicePixelRatio || 1, 2))
      let overlayTool: 'select' | 'pen' | 'highlighter' | 'eraser' = 'select'
      let draftStroke: Stroke | null = null
      let lastEraserPoint: BoardPointerPoint | null = null
      let selectStartPoint: BoardPointerPoint | null = null
      let pointerId: number | null = null
      let lastRenderedSlideIndex = show.currentIndex
      let lastSlideRectKey = ''
      let lastFallbackState = false
      let slideMonitorFrame: number | null = null
      let redrawFrame: number | null = null
      let liveRedrawFrame: number | null = null
      let committedRedrawFrame: number | null = null
      let fallbackDrawVersion = 0
      let rawPointerMoveSeen = false
      let rawPointerUpdateCount = 0
      const dirtyErasedSlideIndexes = new Set<number>()
      const presentationDataset = new Map<string, string>()
      const fallbackImageCache = new Map<string, HTMLImageElement>()
      const rawPointerUpdatesEnabled = typeof window.PointerEvent !== 'undefined' && 'onpointerrawupdate' in window
      const slidePages = new Map(
        project.pages
          .filter((page) => page.presentation?.id === presentationId && page.presentation.slideIndex !== undefined)
          .map((page) => [page.presentation?.slideIndex ?? 0, page]),
      )

      const overlayCanvasStyle = [
        'position:fixed',
        'inset:0',
        'touch-action:none',
      ]
      fallbackCanvas.style.cssText = [
        ...overlayCanvasStyle,
        'z-index:999999',
        'pointer-events:none',
        'display:none',
      ].join(';')
      committedCanvas.style.cssText = [
        ...overlayCanvasStyle,
        'z-index:1000000',
        'pointer-events:none',
      ].join(';')
      canvas.style.cssText = [
        ...overlayCanvasStyle,
        'z-index:1000001',
        'cursor:default',
      ].join(';')
      toolbar.style.cssText = [
        'position:fixed',
        'left:50%',
        'bottom:24px',
        'transform:translateX(-50%)',
        'z-index:1000002',
        'display:flex',
        'gap:8px',
        'padding:8px',
        'border-radius:12px',
        'background:rgba(255,255,255,0.92)',
        'box-shadow:0 10px 28px rgba(15,23,42,0.22)',
        'font:600 13px/1.2 system-ui,sans-serif',
      ].join(';')

      const makeButton = (label: string) => {
        const button = document.createElement('button')
        button.type = 'button'
        button.textContent = label
        button.style.cssText = [
          'min-width:54px',
          'height:36px',
          'border:1px solid rgba(15,23,42,0.14)',
          'border-radius:8px',
          'background:#fff',
          'color:#334155',
          'font:inherit',
          'cursor:pointer',
        ].join(';')
        toolbar.appendChild(button)
        return button
      }

      fallbackCanvas.dataset.presentationFallbackLayer = 'true'
      canvas.dataset.presentationOverlay = 'true'
      toolbar.dataset.presentationToolbar = 'true'
      const selectButton = makeButton('\u9009\u62e9')
      const penButton = makeButton('\u7b14')
      const highlighterButton = makeButton('\u8367\u5149')
      const eraserButton = makeButton('\u6a61\u76ae')
      const playButton = makeButton('\u64ad\u653e')
      const previousButton = makeButton('\u4e0a\u4e00\u9875')
      const nextButton = makeButton('\u4e0b\u4e00\u9875')
      const closeButton = makeButton('\u5173\u95ed')
      selectButton.dataset.presentationAction = 'select'
      penButton.dataset.presentationAction = 'pen'
      highlighterButton.dataset.presentationAction = 'highlighter'
      eraserButton.dataset.presentationAction = 'eraser'
      playButton.dataset.presentationAction = 'autoplay'
      previousButton.dataset.presentationAction = 'previous'
      nextButton.dataset.presentationAction = 'next'
      closeButton.dataset.presentationAction = 'close'

      const syncToolButtons = () => {
        selectButton.style.background = overlayTool === 'select' ? '#dff7f4' : '#fff'
        penButton.style.background = overlayTool === 'pen' ? '#dff7f4' : '#fff'
        highlighterButton.style.background = overlayTool === 'highlighter' ? '#fff7cc' : '#fff'
        eraserButton.style.background = overlayTool === 'eraser' ? '#dff7f4' : '#fff'
        playButton.style.background = show.autoPlaying ? '#dff7f4' : '#fff'
        playButton.textContent = show.autoPlaying ? '\u6682\u505c' : '\u64ad\u653e'
      }

      selectButton.addEventListener('click', (event) => {
        event.stopPropagation()
        overlayTool = 'select'
        canvas.style.cursor = 'default'
        syncToolButtons()
      })
      penButton.addEventListener('click', (event) => {
        event.stopPropagation()
        overlayTool = 'pen'
        canvas.style.cursor = 'crosshair'
        syncToolButtons()
      })
      highlighterButton.addEventListener('click', (event) => {
        event.stopPropagation()
        overlayTool = 'highlighter'
        canvas.style.cursor = 'crosshair'
        syncToolButtons()
      })
      eraserButton.addEventListener('click', (event) => {
        event.stopPropagation()
        overlayTool = 'eraser'
        canvas.style.cursor = 'cell'
        syncToolButtons()
      })
      playButton.addEventListener('click', (event) => {
        event.stopPropagation()
        settlePendingOverlayEdits()
        show.toggleAutoPlay()
        syncToolButtons()
      })
      previousButton.addEventListener('click', (event) => {
        event.stopPropagation()
        settlePendingOverlayEdits()
        void show.prev().then(redraw)
      })
      nextButton.addEventListener('click', (event) => {
        event.stopPropagation()
        settlePendingOverlayEdits()
        void show.next().then(redraw)
      })
      closeButton.addEventListener('click', (event) => {
        event.stopPropagation()
        settlePendingOverlayEdits()
        stopPresentationRuntime()
      })
      syncToolButtons()

      const resize = () => {
        for (const targetCanvas of [fallbackCanvas, committedCanvas, canvas]) {
          targetCanvas.width = Math.max(1, Math.round(window.innerWidth * ratio))
          targetCanvas.height = Math.max(1, Math.round(window.innerHeight * ratio))
          targetCanvas.style.width = `${window.innerWidth}px`
          targetCanvas.style.height = `${window.innerHeight}px`
        }
        redrawFallbackSlide()
        redrawCommitted()
        redrawLive()
      }

      const setPresentationDataset = (name: string, value: string) => {
        if (presentationDataset.get(name) === value) return
        presentationDataset.set(name, value)
        canvas.setAttribute(name, value)
      }

      const syncPresentationDataset = () => {
        setPresentationDataset('data-presentation-raw-pointer-updates', String(rawPointerUpdatesEnabled))
        setPresentationDataset('data-presentation-raw-update-count', String(rawPointerUpdateCount))
        setPresentationDataset('data-presentation-slide-index', String(show.currentIndex))
        setPresentationDataset('data-presentation-animation-click', String(show.animationClick ?? 0))
        setPresentationDataset('data-presentation-animation-max', String(show.maxAnimationClick ?? 0))
        setPresentationDataset('data-presentation-animation-cache-size', String(show.animationCacheSize ?? 0))
        setPresentationDataset('data-presentation-slide-cache-size', String(show.slideCacheSize ?? 0))
        setPresentationDataset('data-presentation-slide-cache-pending', String(show.slideCachePending ?? 0))
        setPresentationDataset('data-presentation-blob-cache-size', String(presentationBlobCacheRef.current.size))
        setPresentationDataset('data-presentation-navigation-busy', String(Boolean(show.navigationBusy)))
        setPresentationDataset('data-presentation-navigation-queue-size', String(show.navigationQueueSize ?? 0))
        setPresentationDataset('data-presentation-autoplay', String(Boolean(show.autoPlaying)))
        setPresentationDataset('data-presentation-fallback-slide', String(shouldUseFallbackSlide()))
        setPresentationDataset('data-presentation-monitor-interval-ms', String(PRESENTATION_OVERLAY_MONITOR_INTERVAL_MS))
        syncToolButtons()
      }

      const scheduleRedraw = () => {
        if (redrawFrame !== null) return
        redrawFrame = window.requestAnimationFrame(() => {
          redrawFrame = null
          redraw()
        })
      }

      const scheduleLiveRedraw = () => {
        if (liveRedrawFrame !== null) return
        liveRedrawFrame = window.requestAnimationFrame(() => {
          liveRedrawFrame = null
          redrawLive()
        })
      }

      const scheduleCommittedRedraw = () => {
        if (committedRedrawFrame !== null) return
        committedRedrawFrame = window.requestAnimationFrame(() => {
          committedRedrawFrame = null
          redrawCommitted()
        })
      }

      const monitorSlideIndex = () => {
        syncPresentationDataset()
        const fallbackState = shouldUseFallbackSlide()
        const rect = slideCanvasRect()
        const slideRectKey = `${Math.round(rect.left)}:${Math.round(rect.top)}:${Math.round(rect.width)}:${Math.round(rect.height)}`
        if (show.currentIndex !== lastRenderedSlideIndex) {
          lastRenderedSlideIndex = show.currentIndex
          lastSlideRectKey = slideRectKey
          scheduleRedraw()
        } else if (slideRectKey !== lastSlideRectKey) {
          lastSlideRectKey = slideRectKey
          scheduleRedraw()
        } else if (fallbackState !== lastFallbackState) {
          lastFallbackState = fallbackState
          scheduleRedraw()
        }
        slideMonitorFrame = window.setTimeout(monitorSlideIndex, PRESENTATION_OVERLAY_MONITOR_INTERVAL_MS)
      }

      const slideCanvasRect = () => slideCanvas.getBoundingClientRect()

      const currentSlidePage = () => slidePages.get(show.currentIndex)

      const shouldUseFallbackSlide = () => Boolean(renderWarningState?.seen)

      const loadFallbackImage = (src: string) => {
        const cached = fallbackImageCache.get(src)
        if (cached?.complete && cached.naturalWidth > 0) return Promise.resolve(cached)
        return new Promise<HTMLImageElement>((resolve, reject) => {
          const image = cached ?? new Image()
          fallbackImageCache.set(src, image)
          image.onload = () => resolve(image)
          image.onerror = () => reject(new Error('Unable to load fallback presentation slide'))
          if (!cached) image.src = src
          else if (!image.src) image.src = src
        })
      }

      const eventPoint = (event: PointerEvent): BoardPointerPoint | null => {
        const page = currentSlidePage()
        if (!page?.image) return null
        const rect = slideCanvasRect()
        const scale = rect.width / page.image.width
        if (scale <= 0) return null
        return {
          x: (event.clientX - rect.left) / scale,
          y: (event.clientY - rect.top) / scale,
          screenX: event.clientX,
          screenY: event.clientY,
          pressure: event.pointerType === 'pen' && event.pressure > 0 ? event.pressure : undefined,
          time: performance.now(),
        }
      }

      const eventPoints = (event: PointerEvent) => {
        const events = typeof event.getCoalescedEvents === 'function' ? event.getCoalescedEvents() : [event]
        return events.map((coalescedEvent) => eventPoint(coalescedEvent)).filter((point): point is BoardPointerPoint => Boolean(point))
      }

      const setupOverlayContext = (targetCanvas: HTMLCanvasElement) => {
        const context = targetCanvas.getContext('2d')
        if (!context) return null
        context.setTransform(ratio, 0, 0, ratio, 0, 0)
        context.clearRect(0, 0, window.innerWidth, window.innerHeight)
        return context
      }

      const slideDrawingState = () => {
        const page = currentSlidePage()
        canvas.dataset.presentationStrokeCount = String(page?.strokes.length ?? 0)
        canvas.dataset.presentationPointCount = String(page?.strokes.reduce((sum, stroke) => sum + stroke.points.length / 2, 0) ?? 0)
        if (!page?.image) return null
        const rect = slideCanvasRect()
        const scale = rect.width / page.image.width
        if (scale <= 0) return null
        const lastStroke = page.strokes.at(-1)
        const lastX = lastStroke?.points.at(-2)
        const lastY = lastStroke?.points.at(-1)
        canvas.dataset.presentationLastPointScreenX = lastX === undefined ? '' : String(rect.left + lastX * scale)
        canvas.dataset.presentationLastPointScreenY = lastY === undefined ? '' : String(rect.top + lastY * scale)
        return { page, rect, scale }
      }

      const drawStrokeOnContext = (context: CanvasRenderingContext2D, stroke: Stroke, widthScale: number) => {
        context.save()
        context.globalAlpha = stroke.opacity
        context.globalCompositeOperation = stroke.kind === 'highlighter' ? 'multiply' : 'source-over'
        if (stroke.kind === 'pen') {
          drawSignatureStroke(context, stroke, widthScale)
        } else {
          context.strokeStyle = stroke.color
          context.lineWidth = stroke.width * widthScale
          context.lineCap = 'round'
          context.lineJoin = 'round'
          context.beginPath()
          context.moveTo(stroke.points[0], stroke.points[1])
          for (let index = 2; index < stroke.points.length; index += 2) {
            context.lineTo(stroke.points[index], stroke.points[index + 1])
          }
          context.stroke()
        }
        context.restore()
      }

      function redrawFallbackSlide() {
        const context = setupOverlayContext(fallbackCanvas)
        if (!context) return
        const useFallback = shouldUseFallbackSlide()
        const state = slideDrawingState()
        fallbackCanvas.style.display = useFallback && state ? 'block' : 'none'
        fallbackCanvas.dataset.presentationFallbackVisible = String(useFallback && Boolean(state))
        fallbackDrawVersion += 1
        const drawVersion = fallbackDrawVersion
        if (!useFallback || !state?.page.image?.src) return

        const { rect } = state
        void loadFallbackImage(state.page.image.src)
          .then((image) => {
            if (drawVersion !== fallbackDrawVersion) return
            const nextContext = setupOverlayContext(fallbackCanvas)
            if (!nextContext) return
            fallbackCanvas.style.display = 'block'
            nextContext.imageSmoothingEnabled = true
            nextContext.imageSmoothingQuality = 'high'
            nextContext.drawImage(image, rect.left, rect.top, rect.width, rect.height)
          })
          .catch(() => {
            fallbackCanvas.style.display = 'none'
            fallbackCanvas.dataset.presentationFallbackVisible = 'false'
          })
      }

      function redrawCommitted() {
        const context = setupOverlayContext(committedCanvas)
        if (!context) return
        const state = slideDrawingState()
        if (!state) return
        const { page, rect, scale } = state
        context.save()
        context.translate(rect.left, rect.top)
        context.scale(scale, scale)
        for (const stroke of page.strokes) {
          drawStrokeOnContext(context, stroke, 1 / scale)
        }
        context.restore()
      }

      function redrawLive() {
        const context = setupOverlayContext(canvas)
        if (!context) return
        const state = slideDrawingState()
        if (!state || !draftStroke) return
        const { rect, scale } = state
        context.save()
        context.translate(rect.left, rect.top)
        context.scale(scale, scale)
        if (draftStroke.kind === 'pen') {
          context.globalAlpha = draftStroke.opacity
          drawSignatureStroke(context, draftStroke, 1 / scale, 0.5)
        } else {
          drawStrokeOnContext(context, draftStroke, 1 / scale)
        }
        context.restore()
      }

      function redraw() {
        syncPresentationDataset()
        redrawFallbackSlide()
        redrawCommitted()
        redrawLive()
      }

      const persistOverlayProject = (nextProject: BoardProject) => {
        const webview = window.chrome?.webview
        if (webview?.postMessage) {
          webview.postMessage(
            JSON.stringify({
              type: 'autosave-note-file',
              fileName: noteFileName(),
              content: serializeNoteFile(nextProject),
            }),
          )
          return
        }
        void saveProject(nextProject).catch(() => undefined)
      }

      const commitDraftStroke = () => {
        if (!draftStroke) return
        const committed = stripStrokeRuntimeState(draftStroke.points.length < 4 ? makeTapStroke(draftStroke) : finalizeVelocityStroke(draftStroke))
        const slideIndex = show.currentIndex
        const page = slidePages.get(slideIndex)
        if (page) slidePages.set(slideIndex, { ...page, strokes: [...page.strokes, committed] })
        setProject((previous) => {
          const nextProject = {
            ...previous,
            pages: previous.pages.map((page) =>
              page.presentation?.id === presentationId && page.presentation.slideIndex === slideIndex
                ? { ...page, strokes: [...page.strokes, committed] }
                : page,
            ),
            updatedAt: Date.now(),
          }
          persistOverlayProject(nextProject)
          return nextProject
        })
        draftStroke = null
        scheduleLiveRedraw()
        scheduleCommittedRedraw()
      }

      const flushErasedSlides = () => {
        if (!dirtyErasedSlideIndexes.size) return
        const dirtySlides = new Map<number, BoardPage>()
        for (const slideIndex of dirtyErasedSlideIndexes) {
          const page = slidePages.get(slideIndex)
          if (page) dirtySlides.set(slideIndex, page)
        }
        dirtyErasedSlideIndexes.clear()
        if (!dirtySlides.size) return
        setProject((previous) => {
          const nextProject = {
            ...previous,
            pages: previous.pages.map((page) => {
              if (page.presentation?.id !== presentationId || page.presentation.slideIndex === undefined) return page
              const erasedPage = dirtySlides.get(page.presentation.slideIndex)
              return erasedPage ? { ...page, strokes: erasedPage.strokes } : page
            }),
            updatedAt: Date.now(),
          }
          persistOverlayProject(nextProject)
          return nextProject
        })
      }

      const settlePendingOverlayEdits = () => {
        if (draftStroke) commitDraftStroke()
        flushErasedSlides()
      }

      const eraseAtPoints = (points: BoardPointerPoint[]) => {
        const trackedPoints = points.map((point) => {
          const tracked = withDynamicEraserRadius(point, lastEraserPoint, eraserRadius)
          lastEraserPoint = tracked
          return tracked
        })
        if (!trackedPoints.length) return
        const slideIndex = show.currentIndex
        const localPage = slidePages.get(slideIndex)
        if (!localPage) return
        const result = eraseStrokesAtPoints(localPage.strokes, trackedPoints, eraserRadius, 1)
        if (!result.changed) return
        slidePages.set(slideIndex, { ...localPage, strokes: result.strokes })
        dirtyErasedSlideIndexes.add(slideIndex)
        scheduleCommittedRedraw()
      }

      const onPointerDown = (event: PointerEvent) => {
        const point = eventPoint(event)
        if (!point) return
        if (event.button !== 0) return
        event.preventDefault()
        pointerId = event.pointerId
        rawPointerMoveSeen = false
        rawPointerUpdateCount = 0
        setPresentationDataset('data-presentation-raw-update-count', String(rawPointerUpdateCount))
        try {
          canvas.setPointerCapture(event.pointerId)
        } catch {
          // Synthetic or interrupted pointer streams may not be capturable.
        }
        if (overlayTool === 'select') {
          selectStartPoint = point
          return
        }
        if (overlayTool === 'eraser') {
          lastEraserPoint = null
          eraseAtPoints([point])
          return
        }
        const highlighter = overlayTool === 'highlighter'
        draftStroke = {
          id: makeId(),
          kind: highlighter ? 'highlighter' : 'pen',
          color: highlighter ? '#ffe45c' : strokeColor,
          width: highlighter ? strokeWidth * 2.4 : strokeWidth,
          opacity: highlighter ? 0.35 : 1,
          points: [point.x, point.y],
          pressures: [point.pressure ?? 0.96],
          pressureSource: point.pressure === undefined ? 'velocity' : 'native',
          lastInputTime: point.time,
        }
        scheduleLiveRedraw()
      }

      const handlePointerDrawingMove = (event: PointerEvent, source: 'raw' | 'move') => {
        if (pointerId !== event.pointerId) return
        const point = eventPoint(event)
        if (!point) return
        event.preventDefault()
        if (overlayTool === 'select') return
        if (source === 'raw') {
          rawPointerMoveSeen = true
          rawPointerUpdateCount += 1
          setPresentationDataset('data-presentation-raw-update-count', String(rawPointerUpdateCount))
        }
        if (overlayTool === 'eraser') {
          eraseAtPoints(eventPoints(event))
          return
        }
        if (!draftStroke) return
        appendPointerSamples(draftStroke, eventPoints(event), 1)
        scheduleLiveRedraw()
      }

      const onPointerMove = (event: PointerEvent) => {
        if (rawPointerMoveSeen && (overlayTool === 'pen' || overlayTool === 'highlighter' || overlayTool === 'eraser')) return
        handlePointerDrawingMove(event, 'move')
      }

      const onPointerRawUpdate = (event: PointerEvent) => {
        handlePointerDrawingMove(event, 'raw')
      }

      const onPointerRawUpdateEvent = (event: Event) => {
        onPointerRawUpdate(event as PointerEvent)
      }

      const onPointerUp = (event: PointerEvent) => {
        if (pointerId !== event.pointerId) return
        const point = eventPoint(event)
        if (overlayTool === 'select' && selectStartPoint && point) {
          const distance = Math.hypot(point.screenX - selectStartPoint.screenX, point.screenY - selectStartPoint.screenY)
          if (distance < 10) void show.next().then(redraw)
        } else {
          if (draftStroke && (overlayTool === 'pen' || overlayTool === 'highlighter')) {
            appendPointerSamples(draftStroke, eventPoints(event), 1)
            scheduleLiveRedraw()
          }
          if (overlayTool === 'eraser') eraseAtPoints(eventPoints(event))
          if (draftStroke) commitDraftStroke()
          if (overlayTool === 'eraser') flushErasedSlides()
        }
        pointerId = null
        rawPointerMoveSeen = false
        selectStartPoint = null
        lastEraserPoint = null
        try {
          canvas.releasePointerCapture(event.pointerId)
        } catch {
          // Pointer capture can already be released by browser navigation.
        }
      }

      const onKeyDown = (event: KeyboardEvent) => {
        const stop = () => {
          event.preventDefault()
          event.stopPropagation()
          event.stopImmediatePropagation()
        }
        if (['ArrowRight', 'ArrowDown', ' ', 'Enter', 'PageDown', 'n', 'N'].includes(event.key)) {
          stop()
          settlePendingOverlayEdits()
          void show.next().then(redraw)
        } else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace', 'p', 'P'].includes(event.key)) {
          stop()
          settlePendingOverlayEdits()
          void show.prev().then(redraw)
        } else if (event.key === 'Home') {
          stop()
          settlePendingOverlayEdits()
          void show.goto(0).then(redraw)
        } else if (event.key === 'End') {
          stop()
          settlePendingOverlayEdits()
          void show.goto(show.slideCount - 1).then(redraw)
        } else if (event.key === 'Escape') {
          stop()
          settlePendingOverlayEdits()
          stopPresentationRuntime()
        }
      }

      canvas.addEventListener('pointerdown', onPointerDown)
      canvas.addEventListener('pointermove', onPointerMove)
      if (rawPointerUpdatesEnabled) canvas.addEventListener('pointerrawupdate', onPointerRawUpdateEvent)
      canvas.addEventListener('pointerup', onPointerUp)
      canvas.addEventListener('pointercancel', onPointerUp)
      document.addEventListener('keydown', onKeyDown, true)
      window.addEventListener('resize', resize)
      document.body.appendChild(fallbackCanvas)
      document.body.appendChild(committedCanvas)
      document.body.appendChild(canvas)
      document.body.appendChild(toolbar)
      resize()
      syncPresentationDataset()
      lastSlideRectKey = (() => {
        const rect = slideCanvasRect()
        return `${Math.round(rect.left)}:${Math.round(rect.top)}:${Math.round(rect.width)}:${Math.round(rect.height)}`
      })()
      slideMonitorFrame = window.setTimeout(monitorSlideIndex, PRESENTATION_OVERLAY_MONITOR_INTERVAL_MS)

      return () => {
        settlePendingOverlayEdits()
        if (slideMonitorFrame !== null) window.clearTimeout(slideMonitorFrame)
        if (redrawFrame !== null) window.cancelAnimationFrame(redrawFrame)
        if (liveRedrawFrame !== null) window.cancelAnimationFrame(liveRedrawFrame)
        if (committedRedrawFrame !== null) window.cancelAnimationFrame(committedRedrawFrame)
        canvas.removeEventListener('pointerdown', onPointerDown)
        canvas.removeEventListener('pointermove', onPointerMove)
        if (rawPointerUpdatesEnabled) canvas.removeEventListener('pointerrawupdate', onPointerRawUpdateEvent)
        canvas.removeEventListener('pointerup', onPointerUp)
        canvas.removeEventListener('pointercancel', onPointerUp)
        document.removeEventListener('keydown', onKeyDown, true)
        window.removeEventListener('resize', resize)
        fallbackCanvas.remove()
        committedCanvas.remove()
        canvas.remove()
        toolbar.remove()
      }
    },
    [eraserRadius, project.pages, setProject, stopPresentationRuntime, strokeColor, strokeWidth],
  )

  const playCurrentPresentation = useCallback(async () => {
    if (!currentPresentation || !currentPage.presentation) return
    closeFloatingPanels()
    stopPresentationRuntime()
    setStatus('Loading PPTX presentation...')

    let cleanupRenderer: { destroy: () => void } | null = null
    let cleanupShow: { stop: () => void } | null = null
    const renderWarningState = { seen: false }
    const originalConsoleWarn = console.warn.bind(console)
    let consoleWarnRestored = false
    const restoreConsoleWarn = () => {
      if (consoleWarnRestored) return
      consoleWarnRestored = true
      console.warn = originalConsoleWarn
    }
    console.warn = (...args: unknown[]) => {
      if (args.some((arg) => String(arg).includes('Error rendering shape'))) {
        renderWarningState.seen = true
      }
      originalConsoleWarn(...args)
    }
    try {
      const [{ PptxRenderer, SlideShow }, response] = await Promise.all([
        import('pptx-browser'),
        presentationBlobCacheRef.current.get(currentPresentation.id)?.src === currentPresentation.src
          ? Promise.resolve(null)
          : fetch(currentPresentation.src),
      ])
      let cachedBlob = presentationBlobCacheRef.current.get(currentPresentation.id)
      if (!cachedBlob || cachedBlob.src !== currentPresentation.src) {
        const blob = await response!.blob()
        presentationBlobCacheRef.current.set(currentPresentation.id, { src: currentPresentation.src, blob })
        while (presentationBlobCacheRef.current.size > PRESENTATION_BLOB_CACHE_LIMIT) {
          const oldestKey = presentationBlobCacheRef.current.keys().next().value
          if (!oldestKey) break
          presentationBlobCacheRef.current.delete(oldestKey)
        }
        cachedBlob = presentationBlobCacheRef.current.get(currentPresentation.id)
      }
      const blob = cachedBlob?.blob
      if (!blob) throw new Error('PPTX data unavailable')
      const renderer = new PptxRenderer()
      cleanupRenderer = renderer
      await renderer.load(blob)
      const show = new SlideShow(renderer, document.body, {
        fullscreen: false,
        showHud: true,
        showThumbs: false,
        showNotes: false,
        onSlideChange: (index) => {
          if (typeof index === 'number') setStatus(`PPTX ${index + 1}/${currentPresentation.slideCount}`)
        },
      })
      cleanupShow = show
      await show.start(currentPage.presentation.slideIndex)
      const slideCanvas = (show as unknown as { _canvas?: HTMLCanvasElement })._canvas
      if (!slideCanvas) throw new Error('PPTX player canvas unavailable')
      const animationPlayer = renderer.createPlayer?.(slideCanvas)
      let animationClick = 0
      let animationClickGroups: number[] = []
      let navigationBusy = false
      let autoPlayTimer: number | undefined
      type QueuedPresentationNavigation = { kind: 'next' } | { kind: 'prev' } | { kind: 'goto'; index: number }
      const queuedNavigation: QueuedPresentationNavigation[] = []
      const animationClickGroupCache = new Map<number, number[]>()
      const pendingAnimationWarmups = new Set<number>()
      const slideRenderCache = new Map<number, HTMLCanvasElement>()
      const pendingSlideRenderWarmups = new Set<number>()
      const playbackControllerRef: { current: PresentationRuntime['show'] | null } = { current: null }
      const syncSlideCacheStats = () => {
        if (!playbackControllerRef.current) return
        playbackControllerRef.current.slideCacheSize = slideRenderCache.size
        playbackControllerRef.current.slideCachePending = pendingSlideRenderWarmups.size
      }
      const pruneRenderedSlideCache = (anchorIndex = show.currentIndex) => {
        for (const key of [...slideRenderCache.keys()]) {
          if (Math.abs(key - anchorIndex) > PRESENTATION_SLIDE_RENDER_CACHE_RADIUS) slideRenderCache.delete(key)
        }
        while (slideRenderCache.size > PRESENTATION_SLIDE_RENDER_CACHE_LIMIT) {
          const farthestKey = [...slideRenderCache.keys()]
            .sort((left, right) => Math.abs(right - anchorIndex) - Math.abs(left - anchorIndex))[0]
          if (farthestKey === undefined) break
          slideRenderCache.delete(farthestKey)
        }
      }
      const canvasRenderWidth = () => {
        const canvas = (show as unknown as { _canvas?: HTMLCanvasElement })._canvas
        if (!canvas) return 1280
        return canvas.width / Math.max(1, window.devicePixelRatio || 1)
      }
      const cacheRenderedSlide = (slideIndex: number, sourceCanvas: HTMLCanvasElement) => {
        const cached = document.createElement('canvas')
        cached.width = sourceCanvas.width
        cached.height = sourceCanvas.height
        cached.getContext('2d')?.drawImage(sourceCanvas, 0, 0)
        slideRenderCache.set(slideIndex, cached)
        pruneRenderedSlideCache()
        syncSlideCacheStats()
      }
      const renderSlideToCache = async (slideIndex: number) => {
        if (slideIndex < 0 || slideIndex >= currentPresentation.slideCount) return
        if (slideRenderCache.has(slideIndex) || pendingSlideRenderWarmups.has(slideIndex)) return
        pendingSlideRenderWarmups.add(slideIndex)
        syncSlideCacheStats()
        try {
          const cached = document.createElement('canvas')
          await renderer.renderSlide(slideIndex, cached, canvasRenderWidth())
          slideRenderCache.set(slideIndex, cached)
          pruneRenderedSlideCache()
        } finally {
          pendingSlideRenderWarmups.delete(slideIndex)
          syncSlideCacheStats()
        }
      }
      const warmRenderedSlidesAround = (slideIndex: number) => {
        const warmup = () => {
          void renderSlideToCache(slideIndex - 1)
          void renderSlideToCache(slideIndex + 1)
        }
        if (window.requestIdleCallback) {
          window.requestIdleCallback(warmup, { timeout: 700 })
        } else {
          window.setTimeout(warmup, 0)
        }
      }
      const showInternals = show as unknown as {
        _renderCurrent?: (prevIndex?: number | null) => Promise<void>
        _canvas?: HTMLCanvasElement
        _updateThumbnail?: (index: number) => void
        _updateNotes?: () => void
      }
      const originalRenderCurrent = showInternals._renderCurrent?.bind(show)
      if (originalRenderCurrent) {
        showInternals._renderCurrent = async (prevIndex: number | null = null) => {
          const canvas = showInternals._canvas
          if (!canvas) return
          const transition = prevIndex !== null
            ? (renderer as { getTransition?: (index: number) => { type?: string } | null }).getTransition?.(show.currentIndex)
            : null
          const cached = slideRenderCache.get(show.currentIndex)
          if (!transition && cached && cached.width === canvas.width && cached.height === canvas.height) {
            const context = canvas.getContext('2d')
            if (context) {
              context.setTransform(1, 0, 0, 1, 0, 0)
              context.clearRect(0, 0, canvas.width, canvas.height)
              context.drawImage(cached, 0, 0)
              showInternals._updateThumbnail?.(show.currentIndex)
              showInternals._updateNotes?.()
              warmRenderedSlidesAround(show.currentIndex)
              return
            }
          }
          await originalRenderCurrent(prevIndex)
          if (showInternals._canvas) cacheRenderedSlide(show.currentIndex, showInternals._canvas)
          warmRenderedSlidesAround(show.currentIndex)
        }
      }
      cacheRenderedSlide(show.currentIndex, slideCanvas)
      const syncAnimationCacheStats = () => {
        if (!playbackControllerRef.current) return
        playbackControllerRef.current.animationCacheSize = animationClickGroupCache.size
      }
      const pruneAnimationCache = (anchorIndex = show.currentIndex) => {
        for (const key of [...animationClickGroupCache.keys()]) {
          if (Math.abs(key - anchorIndex) > PRESENTATION_ANIMATION_CACHE_RADIUS) animationClickGroupCache.delete(key)
        }
        while (animationClickGroupCache.size > PRESENTATION_ANIMATION_CACHE_LIMIT) {
          const farthestKey = [...animationClickGroupCache.keys()]
            .sort((left, right) => Math.abs(right - anchorIndex) - Math.abs(left - anchorIndex))[0]
          if (farthestKey === undefined) break
          animationClickGroupCache.delete(farthestKey)
        }
      }
      const animationGroupsForSlide = (slideIndex: number) => {
        const cached = animationClickGroupCache.get(slideIndex)
        if (cached) return [...cached]
        const groups = [...new Set((renderer.getAnimations?.(slideIndex) ?? [])
          .map((step) => step.clickNum ?? 0)
          .filter((clickNum) => clickNum > 0))]
          .sort((a, b) => a - b)
        animationClickGroupCache.set(slideIndex, groups)
        pruneAnimationCache()
        syncAnimationCacheStats()
        return [...groups]
      }
      const warmAnimationGroupsAround = (slideIndex: number) => {
        for (const nextIndex of [slideIndex - 1, slideIndex, slideIndex + 1]) {
          if (nextIndex < 0 || nextIndex >= currentPresentation.slideCount) continue
          if (animationClickGroupCache.has(nextIndex) || pendingAnimationWarmups.has(nextIndex)) continue
          pendingAnimationWarmups.add(nextIndex)
          const warmup = () => {
            pendingAnimationWarmups.delete(nextIndex)
            animationGroupsForSlide(nextIndex)
          }
          if (window.requestIdleCallback) {
            window.requestIdleCallback(warmup, { timeout: 800 })
          } else {
            window.setTimeout(warmup, 0)
          }
        }
      }
      const loadSlideAnimations = async () => {
        animationClick = 0
        animationClickGroups = animationGroupsForSlide(show.currentIndex)
        await animationPlayer?.loadSlide(show.currentIndex)
        warmAnimationGroupsAround(show.currentIndex)
        warmRenderedSlidesAround(show.currentIndex)
      }
      await loadSlideAnimations()
      const syncNavigationQueueSize = () => {
        if (playbackControllerRef.current) playbackControllerRef.current.navigationQueueSize = queuedNavigation.length
      }
      const clearAutoPlayTimer = () => {
        if (autoPlayTimer !== undefined) {
          window.clearTimeout(autoPlayTimer)
          autoPlayTimer = undefined
        }
      }
      const hasAutoPlayStep = () => animationClickGroups.length > 0 || show.currentIndex < currentPresentation.slideCount - 1
      const scheduleAutoPlayStep = () => {
        clearAutoPlayTimer()
        if (!playbackControllerRef.current?.autoPlaying) return
        if (!hasAutoPlayStep()) {
          playbackControllerRef.current.autoPlaying = false
          return
        }
        autoPlayTimer = window.setTimeout(() => {
          autoPlayTimer = undefined
          if (!playbackControllerRef.current?.autoPlaying) return
          if (navigationBusy || queuedNavigation.length) {
            scheduleAutoPlayStep()
            return
          }
          void playbackController.next().then(scheduleAutoPlayStep)
        }, PRESENTATION_AUTO_PLAY_INTERVAL_MS)
      }
      const enqueueNavigation = (navigation: QueuedPresentationNavigation) => {
        if (navigation.kind === 'goto') {
          queuedNavigation.length = 0
        } else if (queuedNavigation.length >= 8) {
          queuedNavigation.shift()
        }
        queuedNavigation.push(navigation)
        syncNavigationQueueSize()
      }
      const runQueuedNavigation = () => {
        const queued = queuedNavigation.shift()
        syncNavigationQueueSize()
        if (queued?.kind === 'next') {
          void playbackController.next()
        } else if (queued?.kind === 'prev') {
          void playbackController.prev()
        } else if (queued?.kind === 'goto') {
          void playbackController.goto(queued.index)
        }
      }
      const finishNavigation = () => {
        navigationBusy = false
        playbackController.navigationBusy = false
        syncNavigationQueueSize()
        if (queuedNavigation.length) window.setTimeout(runQueuedNavigation, 0)
      }
      const playbackController: PresentationRuntime['show'] = {
        stop: () => {
          queuedNavigation.length = 0
          syncNavigationQueueSize()
          clearAutoPlayTimer()
          playbackController.autoPlaying = false
          show.stop()
        },
        next: async () => {
          if (navigationBusy) {
            enqueueNavigation({ kind: 'next' })
            return
          }
          navigationBusy = true
          playbackController.navigationBusy = true
          try {
            if (animationPlayer && animationClickGroups.length) {
              const targetClick = animationClickGroups.shift() ?? animationClick + 1
              while (animationClick < targetClick) {
                animationClick += 1
                playbackController.animationClick = animationClick
                await animationPlayer.nextClick()
              }
              playbackController.maxAnimationClick = animationClickGroups.at(-1) ?? animationClick
              return
            }
            if (show.currentIndex >= currentPresentation.slideCount - 1) return
            await show.goto(Math.min(show.currentIndex + 1, currentPresentation.slideCount - 1))
            await loadSlideAnimations()
            playbackController.animationClick = animationClick
            playbackController.maxAnimationClick = animationClickGroups.at(-1) ?? 0
          } finally {
            finishNavigation()
          }
        },
        prev: async () => {
          if (navigationBusy) {
            enqueueNavigation({ kind: 'prev' })
            return
          }
          navigationBusy = true
          playbackController.navigationBusy = true
          try {
            if (show.currentIndex <= 0) return
            await show.goto(Math.max(show.currentIndex - 1, 0))
            await loadSlideAnimations()
            playbackController.animationClick = animationClick
            playbackController.maxAnimationClick = animationClickGroups.at(-1) ?? 0
          } finally {
            finishNavigation()
          }
        },
        goto: async (index: number) => {
          const targetIndex = Math.max(0, Math.min(currentPresentation.slideCount - 1, Math.round(index)))
          if (navigationBusy) {
            enqueueNavigation({ kind: 'goto', index: targetIndex })
            return
          }
          navigationBusy = true
          playbackController.navigationBusy = true
          try {
            if (show.currentIndex === targetIndex) return
            await show.goto(targetIndex)
            await loadSlideAnimations()
            playbackController.animationClick = animationClick
            playbackController.maxAnimationClick = animationClickGroups.at(-1) ?? 0
          } finally {
            finishNavigation()
          }
        },
        toggleAutoPlay: () => {
          playbackController.autoPlaying = !playbackController.autoPlaying
          if (playbackController.autoPlaying) scheduleAutoPlayStep()
          else clearAutoPlayTimer()
        },
        get currentIndex() {
          return show.currentIndex
        },
        slideCount: currentPresentation.slideCount,
        animationClick,
        maxAnimationClick: animationClickGroups.at(-1) ?? 0,
        animationCacheSize: animationClickGroupCache.size,
        slideCacheSize: slideRenderCache.size,
        slideCachePending: pendingSlideRenderWarmups.size,
        navigationBusy: false,
        navigationQueueSize: 0,
        autoPlaying: false,
      }
      playbackControllerRef.current = playbackController
      const disposeInk = attachPresentationInkOverlay(playbackController, currentPresentation.id, slideCanvas, renderWarningState)
      presentationRuntimeRef.current = { show: playbackController, renderer, disposeInk, restoreConsoleWarn }
      cleanupShow = null
      cleanupRenderer = null
      setStatus(`PPTX ${currentPage.presentation.slideIndex + 1}/${currentPresentation.slideCount}`)
    } catch (error) {
      cleanupShow?.stop()
      restoreConsoleWarn()
      cleanupRenderer?.destroy()
      setStatus(error instanceof Error ? error.message : 'Unable to play PPTX')
    }
  }, [attachPresentationInkOverlay, closeFloatingPanels, currentPage.presentation, currentPresentation, setStatus, stopPresentationRuntime])

  useEffect(() => () => stopPresentationRuntime(), [stopPresentationRuntime])

  const handlePointerDown = (event: Konva.KonvaEventObject<PointerEvent>) => {
    refreshStageBounds()
    closeFloatingPanels()
    const rightButtonEraser = event.evt.button === 2 && (tool === 'pen' || tool === 'highlighter' || tool === 'select')
    const activeTool = rightButtonEraser ? 'eraser' : tool
    const isTouchPanGesture = tool === 'pan' && event.evt.pointerType === 'touch'
    if (!isTouchPanGesture && activePointerId.current !== null) return
    if (!isTouchPanGesture && event.evt.pointerType === 'touch' && !event.evt.isPrimary) return
    if (rightButtonEraser) {
      transientToolRef.current = 'eraser'
      event.evt.preventDefault()
    }
    if (activeTool === 'select') {
      clearLiveInkCanvas()
      setSelectedStrokeId(null)
      setSelectedTextId(null)
      return
    }
    if (activeTool === 'laser') {
      clearLiveInkCanvas()
      beginLaserTrail()
      captureBoardPointer(event)
      pushLaserEventPoints(event.evt)
      return
    }
    const wantsPan = activeTool === 'pan' || spacePressed || event.evt.button === 1
    if (wantsPan) {
      clearLiveInkCanvas()
      if (event.evt.pointerType === 'touch' && activeTool === 'pan') {
        beginTouchPan(event)
        return
      }
      const point = getBoardPoint()
      if (!point) return
      captureBoardPointer(event)
      setIsPanning(true)
      setPanStart({ x: point.screenX, y: point.screenY, view: currentViewRef.current })
      return
    }
    if (activeTool === 'pen' || activeTool === 'highlighter') {
      captureBoardPointer(event)
      beginStroke(event)
    }
    if (activeTool === 'eraser') {
      captureBoardPointer(event)
      previewEraserPointRef.current = null
      eraserPreviewActiveRef.current = true
      beginEraser(event)
    }
  }

  const handlePointerMove = (event: Konva.KonvaEventObject<PointerEvent>) => {
    if (perfStatsRef.current.enabled) perfStatsRef.current.pointerMoves += 1
    const activeTool = transientToolRef.current ?? tool
    if (activeTool === 'pan' && hasTouchPanPointer(event.evt.pointerId)) {
      if (performance.now() < rawPointerMoveUntil.current) return
      continueTouchPan(event)
      return
    }
    if (activeTool === 'laser') {
      if (activePointerId.current !== null && event.evt.pointerId !== activePointerId.current) return
      if (performance.now() < rawPointerMoveUntil.current) return
      pushLaserEventPoints(event.evt)
      return
    }
    const isDrawingActive = isDrawingRef.current
    if ((isDrawingActive || isPanning) && activePointerId.current !== null && event.evt.pointerId !== activePointerId.current) {
      return
    }
    if (isDrawingActive && (activeTool === 'pen' || activeTool === 'highlighter' || activeTool === 'eraser') && performance.now() < rawPointerMoveUntil.current) {
      return
    }
    const eraserSamples = activeTool === 'eraser' ? getBoardSamples(event) : []
    if (activeTool === 'eraser' && !isDrawingActive) {
      drawEraserCursor(eraserSamples.at(-1) ?? null)
    }
    const panStart = panStartRef.current
    if (isPanning && panStart) {
      const pointer = eventScreenPoint(event.evt)
      if (!pointer) return
      applyInteractiveView({
        ...panStart.view,
        x: panStart.view.x + pointer.x - panStart.x,
        y: panStart.view.y + pointer.y - panStart.y,
      })
      return
    }
    if (!isDrawingActive) return
    if (activeTool === 'eraser') trackEraserSamples(eraserSamples)
    if (activeTool === 'pen' || activeTool === 'highlighter') continueStroke(event)
  }

  const handlePointerUp = (event?: Konva.KonvaEventObject<PointerEvent>) => {
    const activeTool = transientToolRef.current ?? tool
    if (event && activeTool === 'pan' && hasTouchPanPointer(event.evt.pointerId)) {
      endTouchPan(event)
      commitInteractiveView()
      transientToolRef.current = null
      return
    }
    if (event && activePointerId.current !== null && event.evt.pointerId !== activePointerId.current) return
    if (activeTool === 'laser') {
      if (event) pushLaserEventPoints(event.evt)
      scheduleLaserTrailClear()
      transientToolRef.current = null
      releaseBoardPointer(event)
      return
    }
    if (event && isDrawingRef.current && (activeTool === 'pen' || activeTool === 'highlighter')) continueStroke(event)
    if (isPanning) {
      setIsPanning(false)
      setPanStart(null)
      commitInteractiveView()
    }
    if (activeTool === 'pen' || activeTool === 'highlighter') commitStroke()
    if (activeTool === 'eraser') {
      clearLiveInkCanvas()
      finishEraser()
      previewEraserPointRef.current = null
      eraserPreviewActiveRef.current = false
    }
    transientToolRef.current = null
    releaseBoardPointer(event)
  }

  useRawPointerUpdates({
    stageRef,
    isDrawingRef,
    activePointerId,
    activeToolRef: transientToolRef,
    tool,
    viewport,
    rawPointerMoveUntil,
    perfStatsRef,
    getBoardSamplesFromPointerEvent,
    trackEraserSamples,
    continueStrokeSamples,
    pushLaserEventPoints,
    continueTouchPanPointerEvent,
  })

  const handlePointerLeave = () => {
    if (tool === 'laser') {
      scheduleLaserTrailClear()
      return
    }
    if (pendingCommittedStrokeRef.current) return
    if (!isDrawingRef.current && !isPanning) clearLiveInkCanvas()
  }

  const handleWheel = (event: Konva.KonvaEventObject<WheelEvent>) => {
    if (tool !== 'pan' && !spacePressed) return
    event.evt.preventDefault()
    const stage = stageRef.current
    const pointer = stage?.getPointerPosition()
    if (!pointer) return
    const direction = event.evt.deltaY > 0 ? -1 : 1
    applyInteractiveView(zoomViewAtPoint(currentViewRef.current, pointer, direction > 0 ? 1.08 : 0.92))
  }

  useEffect(() => {
    return () => {
      if (laserHideTimer.current) window.clearTimeout(laserHideTimer.current)
      if (laserFrame.current !== null) window.cancelAnimationFrame(laserFrame.current)
    }
  }, [])

  const settleActiveInputBeforeToolChange = () => {
    const activeTool = transientToolRef.current ?? tool
    if (activeTool === 'laser' && activePointerId.current !== null) scheduleLaserTrailClear()
    if (isPanning) {
      setIsPanning(false)
      setPanStart(null)
      commitInteractiveView()
    }
    if (isDrawingRef.current) {
      if (activeTool === 'pen' || activeTool === 'highlighter') commitStroke()
      if (activeTool === 'eraser') {
        clearLiveInkCanvas()
        finishEraser()
        previewEraserPointRef.current = null
        eraserPreviewActiveRef.current = false
      }
    }
    transientToolRef.current = null
    resetTouchPan()
    releaseBoardPointer()
  }

  const chooseTool = (nextTool: Tool) => {
    settleActiveInputBeforeToolChange()
    const nextSettingsOpen = nextToolSettingsOpen(tool, nextTool, settingsOpen, configurableTools)
    const hasPendingCommittedStroke = Boolean(pendingCommittedStrokeRef.current)
    if (!hasPendingCommittedStroke) clearLiveInkCanvas()
    clearLaserTrail()
    resetStrokeInput()
    setTool(nextTool)
    setBookPickerOpen(false)
    setExportPanelOpen(false)
    setMorePanelOpen(false)
    setClockPanelOpen(false)
    setTocOpen(false)
    setPageJumpOpen(false)
    setSelectedStrokeId(null)
    setSelectedTextId(null)
    if (!hasPendingCommittedStroke && nextTool !== 'eraser') clearLiveInkCanvas()
    setSettingsOpen(nextSettingsOpen)
  }

  useWhiteboardKeyboard({
    pageCount: project.pages.length,
    selectedStrokeId,
    selectedTextId,
    setSpacePressed,
    closePanelsAndSelection: () => {
      setBookPickerOpen(false)
      setExportPanelOpen(false)
      setMorePanelOpen(false)
      setClockPanelOpen(false)
      setSettingsOpen(false)
      setTocOpen(false)
      setPageJumpOpen(false)
      setSelectedStrokeId(null)
      setSelectedTextId(null)
    },
    openPageJump,
    switchPage,
    goToPageIndex,
    chooseTool,
    setStatus,
    undo,
    redo,
    saveNow,
    deleteSelectedStroke,
  })

  return (
    <main
      className={`whiteboard-app ${blankCanvas ? 'blank-mode' : ''}`}
      onDragOver={importsEnabled ? (event) => event.preventDefault() : undefined}
      onDrop={
        importsEnabled
          ? (event) => {
              event.preventDefault()
              void importableFilesFromDrop(event.dataTransfer)
                .then((files) => {
                  if (files.length) void importUserFiles(files)
                  else setStatus('No supported files imported')
                })
                .catch((error: unknown) => {
                  setStatus(error instanceof Error ? error.message : 'Dropped files could not be imported')
                })
            }
          : undefined
      }
    >
      {importsEnabled && (
        <input
          ref={fileInputRef}
          className="hidden-input"
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif,image/bmp,image/avif,image/svg+xml,application/pdf,.png,.jpg,.jpeg,.webp,.gif,.bmp,.avif,.svg,.ppt,.pps,.pot,.pptx,.pptm,.ppsx,.ppsm,.potx,.potm,.odp,.doc,.dot,.rtf,.docx,.docm,.dotx,.dotm,.odt,.xls,.xlsx,.xlsm,.xltx,.xltm,.ods,.txt,.md,.csv,.tsv,.json,.html,.htm,.xml,.log,.owbn,application/vnd.open-whiteboard.note+json,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/plain,text/markdown,text/csv,application/json"
          multiple
          onChange={(event) => {
            if (event.target.files) void importUserFiles(event.target.files)
            event.currentTarget.value = ''
          }}
        />
      )}
      <input
        ref={projectInputRef}
        className="hidden-input"
        type="file"
        accept=".owbn,.json,application/json,application/vnd.open-whiteboard.note+json"
        onChange={(event) => {
          if (event.target.files?.[0]) importProject(event.target.files[0])
          event.currentTarget.value = ''
        }}
      />

      {bookPickerEnabled && bookPickerOpen && (
        <BookPicker
          labels={labels}
          books={builtInBooks}
          currentBookId={currentBook.id}
          onClose={() => setBookPickerOpen(false)}
          onSelectBook={selectBuiltInBook}
        />
      )}

      <Stage
        ref={stageRef}
        width={viewport.width}
        height={viewport.height}
        className={`board-stage ${spacePressed || tool === 'pan' ? 'is-panning' : ''} ${tool === 'laser' ? 'is-laser' : ''}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onPointerLeave={handlePointerLeave}
        onWheel={handleWheel}
      >
        <Layer listening={false}>
          <Rect width={viewport.width} height={viewport.height} fill={blankCanvas ? '#fff' : '#f3f5f8'} listening={false} />
          {!blankCanvas && (
            <Rect
              x={currentView.x - 24}
              y={currentView.y - 24}
              width={documentSize.width * currentView.scale + 48}
              height={documentSize.height * currentView.scale + 48}
              fill="#d9dee7"
              opacity={0.26}
              cornerRadius={18}
              listening={false}
            />
          )}
        </Layer>
        <Layer
          ref={documentLayerRef}
          x={currentView.x}
          y={currentView.y}
          scaleX={currentView.scale}
          scaleY={currentView.scale}
          listening={false}
        >
          <Rect
            width={documentSize.width}
            height={documentSize.height}
            fill="#fff"
            shadowColor={blankCanvas || isPanning ? undefined : '#0f172a'}
            shadowOpacity={blankCanvas || isPanning ? 0 : 0.12}
            shadowBlur={blankCanvas || isPanning ? 0 : 28}
            listening={false}
          />
          {backgroundImage ? (
            <KonvaImage
              image={backgroundImage}
              width={documentSize.width}
              height={documentSize.height}
              listening={false}
              perfectDrawEnabled={false}
            />
          ) : !blankCanvas ? (
            <>
              <Text
                x={documentSize.width / 2 - 280}
                y={documentSize.height / 2 - 54}
                width={560}
                align="center"
                text={labels.canvas.dropTitle}
                fontFamily="Microsoft YaHei, Segoe UI, sans-serif"
                fontSize={28}
                fill="#1f2937"
                listening={false}
              />
              <Text
                x={documentSize.width / 2 - 260}
                y={documentSize.height / 2 + 6}
                width={520}
                align="center"
                text={labels.canvas.dropSubtitle}
                fontFamily="Microsoft YaHei, Segoe UI, sans-serif"
                fontSize={18}
                fill="#6b7280"
                listening={false}
              />
            </>
          ) : null}
        </Layer>
        {!showVectorStrokes && (
          <Layer listening={false}>
            <KonvaImage
              ref={committedInkImageRef}
              image={committedInkCanvas}
              width={viewport.width}
              height={viewport.height}
              listening={false}
              perfectDrawEnabled={false}
            />
          </Layer>
        )}
        <Layer ref={vectorLayerRef} x={currentView.x} y={currentView.y} scaleX={currentView.scale} scaleY={currentView.scale}>
          {showVectorStrokes &&
            selectVisibleStrokes.map((stroke) => (
              <StrokeLines
                key={stroke.id}
                stroke={stroke}
                viewScale={currentView.scale}
                selected={selectedStrokeId === stroke.id}
                selectable
                onSelect={() => setSelectedStrokeId(stroke.id)}
                onMove={(dx, dy) => moveStroke(stroke.id, dx, dy)}
              />
            ))}
          {(currentPage.texts ?? []).map((note) => (
            <Text
              key={note.id}
              x={note.x}
              y={note.y}
              text={note.text}
              fontSize={note.fontSize}
              fontFamily="Microsoft YaHei, Segoe UI, sans-serif"
              fill={note.color}
              padding={4}
              listening={tool === 'select'}
              draggable={tool === 'select' && selectedTextId === note.id}
              stroke={selectedTextId === note.id ? '#139f9b' : undefined}
              strokeWidth={selectedTextId === note.id ? 0.8 : 0}
              onPointerDown={(event) => {
                if (tool !== 'select') return
                event.cancelBubble = true
                setSelectedStrokeId(null)
                setSelectedTextId(note.id)
              }}
              onDragEnd={(event) => {
                const dx = event.target.x() - note.x
                const dy = event.target.y() - note.y
                event.target.position({ x: note.x, y: note.y })
                if (dx || dy) moveText(note.id, dx, dy)
              }}
            />
          ))}
        </Layer>
      </Stage>
      <canvas ref={liveInkCanvasRef} className="live-ink-canvas" aria-hidden="true" />
      {laserTrails.length > 0 && (
        <div className={`laser-trail ${laserTrailFading ? 'is-fading' : ''}`} style={laserStyle} aria-hidden="true">
          <svg className="laser-trail-svg">
            {laserTrails.map((trail) =>
              trail.points.length > 1 ? (
                <g key={trail.id}>
                  <polyline className="laser-trail-glow" points={laserTrailPolylinePoints(trail.points)} />
                  <polyline className="laser-trail-line" points={laserTrailPolylinePoints(trail.points)} />
                </g>
              ) : null,
            )}
          </svg>
          {laserHeadPoint && (
            <span
              className="laser-trail-head"
              style={{
                left: laserHeadPoint.x,
                top: laserHeadPoint.y,
              }}
            />
          )}
        </div>
      )}

      {tool === 'pan' && (
        <div className="gesture-hint" role="status">
          {labels.canvas.panHint}
        </div>
      )}

      {settingsOpen && (
        <ToolSettingsPanel
          labels={labels}
          tool={tool}
          strokeColor={strokeColor}
          strokeWidth={strokeWidth}
          highlightOpacity={highlightOpacity}
          eraserRadius={eraserRadius}
          onStrokeColorChange={setStrokeColor}
          onStrokeWidthChange={setStrokeWidth}
          onHighlightOpacityChange={setHighlightOpacity}
          onEraserRadiusChange={setEraserRadius}
          onClearCurrentPage={clearCurrentPage}
        />
      )}

      {exportPanelOpen && (
        <ExportPanel labels={labels} onExportCurrentPng={exportCurrentPng} onExportAllPdf={exportAllPdf} onExportProject={exportProject} />
      )}

      {morePanelOpen && (
        <MorePanel
          labels={labels}
          onClose={() => setMorePanelOpen(false)}
          onSaveNow={saveNow}
          onImportProject={() => {
            setMorePanelOpen(false)
            projectInputRef.current?.click()
          }}
          onExportProject={exportProject}
          onChooseHighlighter={() => chooseTool('highlighter')}
          onOpenExportPanel={() => {
            setMorePanelOpen(false)
            setBookPickerOpen(false)
            setSettingsOpen(false)
            setClockPanelOpen(false)
            setTocOpen(false)
            setPageJumpOpen(false)
            setExportPanelOpen(true)
          }}
          onToggleLanguage={() => {
            const nextLanguage = language === 'zh' ? 'en' : 'zh'
            saveLanguage(nextLanguage)
            setLanguage(nextLanguage)
            setStatus(uiText[nextLanguage].status.ready)
            setMorePanelOpen(false)
          }}
          onRedo={() => {
            redo()
            setMorePanelOpen(false)
          }}
          redoDisabled={!future.length}
          onResetCurrentView={resetCurrentView}
          onClearCurrentPage={() => {
            clearCurrentPage()
            setMorePanelOpen(false)
          }}
        />
      )}

      {clockPanelOpen && <ClockPanel labels={labels} now={new Date()} onClose={() => setClockPanelOpen(false)} />}

      {pageJumpOpen && (
        <PageJumpPanel
          labels={labels}
          pageJumpValue={pageJumpValue}
          pageCount={project.pages.length}
          onClose={() => setPageJumpOpen(false)}
          onValueChange={setPageJumpValue}
          onJump={jumpToPageNumber}
          onFitPage={fitPage}
        />
      )}

      {tocEnabled && tocOpen && (
        <TocPanel
          labels={labels}
          currentBook={currentBook}
          currentSourcePage={currentSourcePage}
          onClose={() => setTocOpen(false)}
          onJumpToSourcePage={jumpToSourcePage}
        />
      )}

      <LeftCornerControls
        labels={labels}
        importsEnabled={importsEnabled}
        onImport={() => fileInputRef.current?.click()}
        onClose={handleCloseApp}
        onMinimize={() => sendHostCommand('minimize')}
      />

      <BottomToolbar
        labels={labels}
        tool={tool}
        strokeColor={strokeColor}
        quickColors={quickPenColors}
        pastCount={past.length}
        clockPanelOpen={clockPanelOpen}
        morePanelOpen={morePanelOpen}
        bookPickerEnabled={bookPickerEnabled}
        tocEnabled={tocEnabled}
        presentationPlayable={Boolean(currentPresentation && currentPage.presentation)}
        bookPickerOpen={bookPickerOpen}
        tocOpen={tocOpen}
        onChooseTool={chooseTool}
        onStrokeColorChange={setStrokeColor}
        onUndo={undo}
        onOpenBookPicker={() => {
          setMorePanelOpen(false)
          setSettingsOpen(false)
          setExportPanelOpen(false)
          setClockPanelOpen(false)
          setTocOpen(false)
          setPageJumpOpen(false)
          setBookPickerOpen(true)
        }}
        onOpenToc={() => {
          setMorePanelOpen(false)
          setBookPickerOpen(false)
          setSettingsOpen(false)
          setExportPanelOpen(false)
          setClockPanelOpen(false)
          setPageJumpOpen(false)
          setTocOpen(true)
        }}
        onPlayPresentation={playCurrentPresentation}
        onToggleClock={() => {
          setBookPickerOpen(false)
          setSettingsOpen(false)
          setExportPanelOpen(false)
          setMorePanelOpen(false)
          setTocOpen(false)
          setPageJumpOpen(false)
          setClockPanelOpen((open) => !open)
        }}
        onToggleMore={() => {
          setBookPickerOpen(false)
          setSettingsOpen(false)
          setExportPanelOpen(false)
          setClockPanelOpen(false)
          setTocOpen(false)
          setPageJumpOpen(false)
          setMorePanelOpen((open) => !open)
        }}
      />

      <RightCornerControls
        labels={labels}
        pageIndex={pageIndex}
        pageCount={project.pages.length}
        onAddPage={addBlankPage}
        onPreviousPage={() => switchPage(-1)}
        onNextPage={() => switchPage(1)}
        onOpenPageJump={openPageJump}
      />

      <StatusBar labels={labels} bookTitle={currentBookTitle} pageName={currentPageName} status={status} onOpenPageJump={openPageJump} />
    </main>
  )
}

export default App
