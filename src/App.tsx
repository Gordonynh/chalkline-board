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
  colors,
  configurableTools,
  drawSignatureStroke,
  getLastSelectedBookId,
  initialProject,
  isStoredProjectForBook,
  loadProject,
  nativePointerPressure,
  quickPenColors,
  screenToWorldPoint,
  saveProject,
  sourcePageForBoardPage,
  strokeIntersectsRect,
  translateStroke,
  zoomViewAtPoint,
} from './whiteboard/core'
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
  path?: string
  error?: string
}

declare global {
  interface Window {
    __openWhiteboardHostMessages?: unknown[]
    __openWhiteboardHostBridgeInstalled?: boolean
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
    (text: string, sourceName = 'Whiteboard note') => {
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
        window.setTimeout(fitPage, 80)
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
      if (message?.type === 'open-note-file' && typeof message.content === 'string') {
        openNoteText(message.content, message.fileName || 'Whiteboard note')
        return
      }
      if (message?.type === 'save-note-file-result') {
        setStatus(message.path ? (language === 'en' ? `Saved ${message.path}` : `已保存 ${message.path}`) : message.error || labels.status.autoSaveFailed)
        return
      }
      if (message?.type === 'autosave-note-file-result' && message.error) {
        setStatus(language === 'en' ? `Auto-save failed: ${message.error}` : `自动保存失败：${message.error}`)
      }
    }
    const handleWindowMessage = (event: MessageEvent) => openFromMessage(event.data)
    const webview = window.chrome?.webview

    window.addEventListener('message', handleWindowMessage)
    webview?.addEventListener?.('message', handleWindowMessage)
    window.__openWhiteboardHostMessages?.splice(0).forEach(openFromMessage)
    window.__openWhiteboardHostMessages = undefined
    webview?.postMessage?.('app-ready')
    return () => {
      window.removeEventListener('message', handleWindowMessage)
      webview?.removeEventListener?.('message', handleWindowMessage)
    }
  }, [labels.status, language, openNoteText])

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
      samples.push({
        x: (screenX - view.x) / view.scale,
        y: (screenY - view.y) / view.scale,
        screenX,
        screenY,
        pressure: nativePointerPressure(sampleEvent),
        time: sampleEvent.timeStamp,
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

  const chooseTool = (nextTool: Tool) => {
    const nextSettingsOpen = nextToolSettingsOpen(tool, nextTool, settingsOpen, configurableTools)
    const hasPendingCommittedStroke = Boolean(pendingCommittedStrokeRef.current)
    if (!hasPendingCommittedStroke) clearLiveInkCanvas()
    clearLaserTrail()
    transientToolRef.current = null
    resetStrokeInput()
    resetTouchPan()
    releaseBoardPointer()
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
              importFiles(event.dataTransfer.files)
            }
          : undefined
      }
    >
      {importsEnabled && (
        <input
          ref={fileInputRef}
          className="hidden-input"
          type="file"
          accept="image/png,image/jpeg,image/webp,application/pdf"
          multiple
          onChange={(event) => {
            if (event.target.files) void importFiles(event.target.files)
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
