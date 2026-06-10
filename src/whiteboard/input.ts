import { useEffect } from 'react'
import type { RefObject } from 'react'
import type Konva from 'konva'
import type { BoardPointerPoint, Tool } from './core'

interface RawPointerPerfStats {
  enabled: boolean
  rawEvents: number
}

interface UseRawPointerUpdatesOptions {
  stageRef: RefObject<Konva.Stage | null>
  isDrawingRef: RefObject<boolean>
  activePointerId: RefObject<number | null>
  activeToolRef?: RefObject<Tool | null>
  tool: Tool
  viewport: { width: number; height: number }
  rawPointerMoveUntil: RefObject<number>
  perfStatsRef: RefObject<RawPointerPerfStats>
  getBoardSamplesFromPointerEvent: (event: PointerEvent) => BoardPointerPoint[]
  trackEraserSamples: (samples: BoardPointerPoint[]) => void
  continueStrokeSamples: (samples: BoardPointerPoint[]) => void
  pushLaserEventPoints: (event: PointerEvent) => void
  continueTouchPanPointerEvent?: (event: PointerEvent) => boolean
}

function useRawPointerUpdates({
  stageRef,
  isDrawingRef,
  activePointerId,
  activeToolRef,
  tool,
  viewport,
  rawPointerMoveUntil,
  perfStatsRef,
  getBoardSamplesFromPointerEvent,
  trackEraserSamples,
  continueStrokeSamples,
  pushLaserEventPoints,
  continueTouchPanPointerEvent,
}: UseRawPointerUpdatesOptions) {
  useEffect(() => {
    const stage = stageRef.current
    const container = stage?.container()
    if (!container || typeof window.PointerEvent === 'undefined' || !('onpointerrawupdate' in window)) return

    const handlePointerRawUpdate: EventListener = (rawEvent) => {
      const event = rawEvent as PointerEvent
      if (activePointerId.current !== null && event.pointerId !== activePointerId.current) return
      const activeTool = activeToolRef?.current ?? tool
      if (activeTool !== 'pen' && activeTool !== 'highlighter' && activeTool !== 'eraser' && activeTool !== 'laser' && activeTool !== 'pan') return
      if (activeTool === 'pan') {
        if (continueTouchPanPointerEvent?.(event)) {
          if (perfStatsRef.current.enabled) perfStatsRef.current.rawEvents += 1
          rawPointerMoveUntil.current = performance.now() + 32
        }
        return
      }
      if (activeTool === 'laser' && activePointerId.current === null) return
      if (activeTool !== 'laser' && !isDrawingRef.current) return
      event.preventDefault()
      if (activeTool === 'laser') {
        if (perfStatsRef.current.enabled) perfStatsRef.current.rawEvents += 1
        rawPointerMoveUntil.current = performance.now() + 32
        pushLaserEventPoints(event)
        return
      }
      const samples = getBoardSamplesFromPointerEvent(event)
      if (!samples.length) return
      if (perfStatsRef.current.enabled) perfStatsRef.current.rawEvents += 1
      rawPointerMoveUntil.current = performance.now() + 32
      if (activeTool === 'eraser') {
        trackEraserSamples(samples)
        return
      }
      continueStrokeSamples(samples)
    }

    container.addEventListener('pointerrawupdate', handlePointerRawUpdate)
    return () => container.removeEventListener('pointerrawupdate', handlePointerRawUpdate)
  }, [
    activePointerId,
    activeToolRef,
    continueStrokeSamples,
    continueTouchPanPointerEvent,
    getBoardSamplesFromPointerEvent,
    isDrawingRef,
    perfStatsRef,
    pushLaserEventPoints,
    rawPointerMoveUntil,
    stageRef,
    tool,
    trackEraserSamples,
    viewport.height,
    viewport.width,
  ])
}

export { useRawPointerUpdates }
