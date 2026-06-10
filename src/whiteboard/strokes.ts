import { useCallback, useRef } from 'react'
import type { RefObject } from 'react'
import type Konva from 'konva'
import {
  VELOCITY_PRESSURE_MAX,
  appendPointerSamples,
  finalizeVelocityStroke,
  makeId,
  makeTapStroke,
  stripStrokeRuntimeState,
} from './core'
import { eraseStrokesAtPoints, withDynamicEraserRadius } from './eraser'
import type { BoardPage, BoardPointerPoint, PageView, Stroke, StrokeKind, Tool } from './core'

interface UseStrokeLifecycleOptions {
  tool: Tool
  strokeColor: string
  strokeWidth: number
  highlightOpacity: number
  eraserRadius: number
  isDrawingRef: RefObject<boolean>
  currentViewRef: RefObject<PageView>
  pendingCommittedStrokeRef: RefObject<Stroke | null>
  recordHistory: () => void
  updateCurrentPage: (updater: (page: BoardPage) => BoardPage, recordHistory?: boolean) => void
  getBoardSamples: (event: Konva.KonvaEventObject<PointerEvent>) => BoardPointerPoint[]
  clearLiveInkCanvas: () => void
  scheduleLiveInkClear: (delayMs?: number) => void
  drawLiveInkSamples: (stroke: Stroke, samples: BoardPointerPoint[]) => void
  drawEraserCursor: (point: BoardPointerPoint | null) => void
  previewErasePoints: (points: BoardPointerPoint[]) => void
}

const appendedStrokeSamples = (
  stroke: Stroke,
  fromPointIndex: number,
  view: PageView,
  sampleTime: number,
): BoardPointerPoint[] => {
  const samples: BoardPointerPoint[] = []
  const pointCount = stroke.points.length / 2
  for (let pointIndex = fromPointIndex; pointIndex < pointCount; pointIndex += 1) {
    const x = stroke.points[pointIndex * 2]
    const y = stroke.points[pointIndex * 2 + 1]
    samples.push({
      x,
      y,
      screenX: view.x + x * view.scale,
      screenY: view.y + y * view.scale,
      pressure: stroke.pressures?.[pointIndex],
      time: sampleTime,
    })
  }
  return samples
}

function useStrokeLifecycle({
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
}: UseStrokeLifecycleOptions) {
  const draftStrokeRef = useRef<Stroke | null>(null)
  const lastEraserPointRef = useRef<BoardPointerPoint | null>(null)
  const eraserPathRef = useRef<BoardPointerPoint[]>([])
  const pendingEraserPointsRef = useRef<BoardPointerPoint[]>([])
  const pendingPreviewEraserPointsRef = useRef<BoardPointerPoint[]>([])
  const eraserPreviewFrameRef = useRef<number | null>(null)

  const setLiveDraftStroke = useCallback((stroke: Stroke | null) => {
    draftStrokeRef.current = stroke
  }, [])

  const setDrawingActive = useCallback(
    (active: boolean) => {
      isDrawingRef.current = active
    },
    [isDrawingRef],
  )

  const beginStroke = useCallback(
    (event: Konva.KonvaEventObject<PointerEvent>) => {
      const point = getBoardSamples(event).at(-1)
      if (!point) return
      const kind: StrokeKind = tool === 'highlighter' ? 'highlighter' : 'pen'
      const nextStroke: Stroke = {
        id: makeId(),
        kind,
        color: strokeColor,
        width: kind === 'highlighter' ? strokeWidth * 2.4 : strokeWidth,
        opacity: kind === 'highlighter' ? highlightOpacity : 1,
        points: [point.x, point.y],
        pressures: kind === 'pen' ? [point.pressure ?? VELOCITY_PRESSURE_MAX] : undefined,
        pressureSource: kind === 'pen' ? (point.pressure === undefined ? 'velocity' : 'native') : undefined,
        lastInputTime: point.time,
      }
      setLiveDraftStroke(nextStroke)
      if (!pendingCommittedStrokeRef.current) clearLiveInkCanvas()
      drawLiveInkSamples(nextStroke, [point])
      setDrawingActive(true)
    },
    [
      clearLiveInkCanvas,
      drawLiveInkSamples,
      getBoardSamples,
      highlightOpacity,
      pendingCommittedStrokeRef,
      setDrawingActive,
      setLiveDraftStroke,
      strokeColor,
      strokeWidth,
      tool,
    ],
  )

  const continueStrokeSamples = useCallback(
    (samples: BoardPointerPoint[]) => {
      if (!samples.length) return
      const stroke = draftStrokeRef.current
      if (!stroke) return
      const view = currentViewRef.current
      const fromPointIndex = stroke.points.length / 2
      if (!appendPointerSamples(stroke, samples, view.scale)) return
      drawLiveInkSamples(stroke, appendedStrokeSamples(stroke, fromPointIndex, view, samples[samples.length - 1].time))
    },
    [currentViewRef, drawLiveInkSamples],
  )

  const continueStroke = useCallback(
    (event: Konva.KonvaEventObject<PointerEvent>) => {
      continueStrokeSamples(getBoardSamples(event))
    },
    [continueStrokeSamples, getBoardSamples],
  )

  const commitStroke = useCallback(() => {
    const stroke = draftStrokeRef.current
    if (!stroke) {
      setLiveDraftStroke(null)
      setDrawingActive(false)
      return
    }
    const committed = stripStrokeRuntimeState(stroke.points.length < 4 ? makeTapStroke(stroke) : finalizeVelocityStroke(stroke))
    pendingCommittedStrokeRef.current = committed
    updateCurrentPage((page) => ({ ...page, strokes: [...page.strokes, committed] }), true)
    setLiveDraftStroke(null)
    setDrawingActive(false)
  }, [pendingCommittedStrokeRef, setDrawingActive, setLiveDraftStroke, updateCurrentPage])

  const eraseAtPoints = useCallback(
    (points: BoardPointerPoint[]) => {
      if (!points.length) return
      const viewScale = Math.max(0.1, currentViewRef.current.scale)
      updateCurrentPage((page) => {
        const result = eraseStrokesAtPoints(page.strokes, points, eraserRadius, viewScale)
        return result.changed ? { ...page, strokes: result.strokes } : page
      })
    },
    [currentViewRef, eraserRadius, updateCurrentPage],
  )

  const flushPreviewEraserPoints = useCallback(() => {
    eraserPreviewFrameRef.current = null
    const points = pendingPreviewEraserPointsRef.current
    if (!points.length) return
    pendingPreviewEraserPointsRef.current = []
    previewErasePoints(points)
  }, [previewErasePoints])

  const schedulePreviewEraserPoints = useCallback(() => {
    if (eraserPreviewFrameRef.current !== null) return
    eraserPreviewFrameRef.current = window.requestAnimationFrame(flushPreviewEraserPoints)
  }, [flushPreviewEraserPoints])

  const queueEraserPoints = useCallback(
    (points: BoardPointerPoint[]) => {
      if (!points.length) return
      pendingEraserPointsRef.current.push(...points)
      pendingPreviewEraserPointsRef.current.push(...points)
      schedulePreviewEraserPoints()
    },
    [schedulePreviewEraserPoints],
  )

  const trackEraserPoint = useCallback(
    (point: BoardPointerPoint): BoardPointerPoint | null => {
      const previousPoint = lastEraserPointRef.current
      const viewScale = Math.max(0.1, currentViewRef.current.scale)
      const minEraseDistance = Math.max(3, eraserRadius * 0.24) / viewScale
      if (previousPoint && Math.hypot(point.x - previousPoint.x, point.y - previousPoint.y) < minEraseDistance) return null
      const trackedPoint = withDynamicEraserRadius(point, previousPoint, eraserRadius)
      lastEraserPointRef.current = trackedPoint
      eraserPathRef.current.push(trackedPoint)
      return trackedPoint
    },
    [currentViewRef, eraserRadius],
  )

  const trackEraserSamples = useCallback(
    (samples: BoardPointerPoint[]) => {
      if (!samples.length) return
      const acceptedPoints: BoardPointerPoint[] = []
      let cursorPoint = samples[samples.length - 1]
      for (const sample of samples) {
        const trackedPoint = trackEraserPoint(sample)
        if (!trackedPoint) continue
        acceptedPoints.push(trackedPoint)
        cursorPoint = trackedPoint
      }
      drawEraserCursor(cursorPoint)
      queueEraserPoints(acceptedPoints)
    },
    [drawEraserCursor, queueEraserPoints, trackEraserPoint],
  )

  const beginEraser = useCallback(
    (event: Konva.KonvaEventObject<PointerEvent>) => {
      if (!pendingCommittedStrokeRef.current) clearLiveInkCanvas()
      lastEraserPointRef.current = null
      eraserPathRef.current = []
      recordHistory()
      trackEraserSamples(getBoardSamples(event))
      setDrawingActive(true)
    },
    [clearLiveInkCanvas, getBoardSamples, pendingCommittedStrokeRef, recordHistory, setDrawingActive, trackEraserSamples],
  )

  const commitEraserPath = useCallback(() => {
    if (eraserPreviewFrameRef.current !== null) {
      window.cancelAnimationFrame(eraserPreviewFrameRef.current)
      eraserPreviewFrameRef.current = null
    }
    if (pendingPreviewEraserPointsRef.current.length) {
      previewErasePoints(pendingPreviewEraserPointsRef.current)
      pendingPreviewEraserPointsRef.current = []
    }
    const points = pendingEraserPointsRef.current
    pendingEraserPointsRef.current = []
    eraseAtPoints(points)
    eraserPathRef.current = []
    lastEraserPointRef.current = null
  }, [eraseAtPoints, previewErasePoints])

  const finishEraser = useCallback(() => {
    commitEraserPath()
    setDrawingActive(false)
    lastEraserPointRef.current = null
    scheduleLiveInkClear()
  }, [commitEraserPath, scheduleLiveInkClear, setDrawingActive])

  const resetStrokeInput = useCallback(() => {
    setLiveDraftStroke(null)
    setDrawingActive(false)
    lastEraserPointRef.current = null
    eraserPathRef.current = []
    pendingEraserPointsRef.current = []
    pendingPreviewEraserPointsRef.current = []
    if (eraserPreviewFrameRef.current !== null) {
      window.cancelAnimationFrame(eraserPreviewFrameRef.current)
      eraserPreviewFrameRef.current = null
    }
  }, [setDrawingActive, setLiveDraftStroke])

  return {
    beginStroke,
    continueStroke,
    continueStrokeSamples,
    commitStroke,
    beginEraser,
    trackEraserSamples,
    finishEraser,
    resetStrokeInput,
  }
}

export { useStrokeLifecycle }
