import { useCallback, useEffect, useRef } from 'react'
import type { RefObject } from 'react'
import {
  VELOCITY_PRESSURE_MAX,
  velocityPressure,
} from './core'
import { strokeLiveWidth } from './inkStroke'
import type { BoardPointerPoint, Stroke } from './core'

type CursorBounds = { x: number; y: number; width: number; height: number }

interface LiveInkPerfStats {
  enabled: boolean
  inputSamples: number
  liveDraws: number
  firstDraws: number
  totalLiveDrawMs: number
  maxLiveDrawMs: number
  totalInputToDrawMs: number
  maxInputToDrawMs: number
  totalFirstInputToDrawMs: number
  maxFirstInputToDrawMs: number
}

interface UseLiveInkOptions {
  canvasRef: RefObject<HTMLCanvasElement | null>
  contextRef: RefObject<CanvasRenderingContext2D | null>
  lastPointRef: RefObject<(BoardPointerPoint & { livePressure: number }) | null>
  clearTimerRef: RefObject<number | undefined>
  viewport: { width: number; height: number }
  eraserRadius: number
  perfStatsRef: RefObject<LiveInkPerfStats>
  refreshStageBounds: () => DOMRectReadOnly | null
}

function useLiveInk({
  canvasRef,
  contextRef,
  lastPointRef,
  clearTimerRef,
  viewport,
  eraserRadius,
  perfStatsRef,
  refreshStageBounds,
}: UseLiveInkOptions) {
  const eraserCursorBoundsRef = useRef<CursorBounds | null>(null)
  const eraserCursorFrameRef = useRef<number | null>(null)
  const pendingEraserCursorPointRef = useRef<BoardPointerPoint | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ratio = Math.max(1, Math.min(window.devicePixelRatio || 1, 2))
    canvas.width = Math.max(1, Math.round(viewport.width * ratio))
    canvas.height = Math.max(1, Math.round(viewport.height * ratio))
    canvas.style.width = `${viewport.width}px`
    canvas.style.height = `${viewport.height}px`
    const context = canvas.getContext('2d')
    contextRef.current = context
    if (!context) return
    context.setTransform(ratio, 0, 0, ratio, 0, 0)
    context.clearRect(0, 0, viewport.width, viewport.height)
    lastPointRef.current = null
    eraserCursorBoundsRef.current = null
    pendingEraserCursorPointRef.current = null
    if (eraserCursorFrameRef.current !== null) {
      window.cancelAnimationFrame(eraserCursorFrameRef.current)
      eraserCursorFrameRef.current = null
    }
    refreshStageBounds()
  }, [canvasRef, contextRef, lastPointRef, refreshStageBounds, viewport.height, viewport.width])

  useEffect(
    () => () => {
      if (eraserCursorFrameRef.current !== null) window.cancelAnimationFrame(eraserCursorFrameRef.current)
    },
    [],
  )

  const clearEraserCursor = useCallback(() => {
    const context = contextRef.current
    const bounds = eraserCursorBoundsRef.current
    if (!context || !bounds) return
    context.clearRect(bounds.x, bounds.y, bounds.width, bounds.height)
    eraserCursorBoundsRef.current = null
  }, [contextRef])

  const clearLiveInkCanvas = useCallback(() => {
    if (clearTimerRef.current !== undefined) {
      window.clearTimeout(clearTimerRef.current)
      clearTimerRef.current = undefined
    }
    contextRef.current?.clearRect(0, 0, viewport.width, viewport.height)
    lastPointRef.current = null
    eraserCursorBoundsRef.current = null
    pendingEraserCursorPointRef.current = null
    if (eraserCursorFrameRef.current !== null) {
      window.cancelAnimationFrame(eraserCursorFrameRef.current)
      eraserCursorFrameRef.current = null
    }
  }, [clearTimerRef, contextRef, lastPointRef, viewport.height, viewport.width])

  const scheduleLiveInkClear = useCallback((delayMs = 220) => {
    if (clearTimerRef.current !== undefined) window.clearTimeout(clearTimerRef.current)
    clearTimerRef.current = window.setTimeout(() => {
      clearTimerRef.current = undefined
      contextRef.current?.clearRect(0, 0, viewport.width, viewport.height)
      lastPointRef.current = null
      eraserCursorBoundsRef.current = null
      pendingEraserCursorPointRef.current = null
      if (eraserCursorFrameRef.current !== null) {
        window.cancelAnimationFrame(eraserCursorFrameRef.current)
        eraserCursorFrameRef.current = null
      }
    }, delayMs)
  }, [clearTimerRef, contextRef, lastPointRef, viewport.height, viewport.width])

  const liveInkPressure = useCallback((previous: BoardPointerPoint | null, sample: BoardPointerPoint) => {
    if (sample.pressure !== undefined) return sample.pressure
    if (!previous) return VELOCITY_PRESSURE_MAX
    const distance = Math.hypot(sample.screenX - previous.screenX, sample.screenY - previous.screenY)
    const elapsed = Math.max(8, sample.time - previous.time)
    return velocityPressure(distance, elapsed)
  }, [])

  const drawLiveInkSamples = useCallback(
    (stroke: Stroke, samples: BoardPointerPoint[]) => {
      const context = contextRef.current
      if (!context || !samples.length) return
      const perfStart = perfStatsRef.current.enabled ? performance.now() : 0
      const isFirstStrokeDraw = lastPointRef.current === null
      context.save()
      context.globalAlpha = stroke.opacity
      context.globalCompositeOperation = stroke.kind === 'highlighter' ? 'multiply' : 'source-over'
      context.strokeStyle = stroke.color
      context.fillStyle = stroke.color
      context.lineCap = 'round'
      context.lineJoin = 'round'

      samples.forEach((sample) => {
        const previous = lastPointRef.current
        const pressure = stroke.kind === 'pen' ? liveInkPressure(previous, sample) : 1
        const width = strokeLiveWidth(stroke, pressure)
        if (!previous) {
          context.beginPath()
          context.arc(sample.screenX, sample.screenY, width / 2, 0, Math.PI * 2)
          context.fill()
        } else {
          context.lineWidth = (strokeLiveWidth(stroke, previous.livePressure) + width) / 2
          context.beginPath()
          context.moveTo(previous.screenX, previous.screenY)
          context.lineTo(sample.screenX, sample.screenY)
          context.stroke()
        }
        lastPointRef.current = {
          x: sample.x,
          y: sample.y,
          screenX: sample.screenX,
          screenY: sample.screenY,
          pressure: sample.pressure,
          time: sample.time,
          livePressure: pressure,
        }
      })
      context.restore()
      if (perfStatsRef.current.enabled) {
        const finishedAt = performance.now()
        const elapsed = finishedAt - perfStart
        const latestSampleTime = samples[samples.length - 1]?.time ?? perfStart
        const inputToDraw = Math.max(0, finishedAt - latestSampleTime)
        const stats = perfStatsRef.current
        stats.inputSamples += samples.length
        stats.liveDraws += 1
        stats.totalLiveDrawMs += elapsed
        stats.maxLiveDrawMs = Math.max(stats.maxLiveDrawMs, elapsed)
        stats.totalInputToDrawMs += inputToDraw
        stats.maxInputToDrawMs = Math.max(stats.maxInputToDrawMs, inputToDraw)
        if (isFirstStrokeDraw) {
          const firstInputToDraw = Math.max(0, finishedAt - (samples[0]?.time ?? perfStart))
          stats.firstDraws += 1
          stats.totalFirstInputToDrawMs += firstInputToDraw
          stats.maxFirstInputToDrawMs = Math.max(stats.maxFirstInputToDrawMs, firstInputToDraw)
        }
      }
    },
    [contextRef, lastPointRef, liveInkPressure, perfStatsRef],
  )

  const paintEraserCursor = useCallback(
    (point: BoardPointerPoint | null) => {
      clearEraserCursor()
      if (!point) return
      const context = contextRef.current
      if (!context) return
      const radius = point.eraserRadius ?? eraserRadius
      const padding = 12
      eraserCursorBoundsRef.current = {
        x: point.screenX - radius - padding,
        y: point.screenY - radius - padding,
        width: (radius + padding) * 2,
        height: (radius + padding) * 2,
      }
      context.save()
      context.strokeStyle = '#139f9b'
      context.fillStyle = 'rgba(19, 159, 155, 0.08)'
      context.lineWidth = 2
      context.setLineDash([8, 5])
      context.beginPath()
      context.arc(point.screenX, point.screenY, radius, 0, Math.PI * 2)
      context.fill()
      context.stroke()
      context.restore()
    },
    [clearEraserCursor, contextRef, eraserRadius],
  )

  const flushEraserCursor = useCallback(() => {
    eraserCursorFrameRef.current = null
    const point = pendingEraserCursorPointRef.current
    pendingEraserCursorPointRef.current = null
    paintEraserCursor(point)
  }, [paintEraserCursor])

  const drawEraserCursor = useCallback(
    (point: BoardPointerPoint | null) => {
      pendingEraserCursorPointRef.current = point
      if (eraserCursorFrameRef.current !== null) return
      eraserCursorFrameRef.current = window.requestAnimationFrame(flushEraserCursor)
    },
    [flushEraserCursor],
  )

  return {
    clearLiveInkCanvas,
    scheduleLiveInkClear,
    drawLiveInkSamples,
    drawEraserCursor,
  }
}

export { useLiveInk }
