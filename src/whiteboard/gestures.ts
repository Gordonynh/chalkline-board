import { useCallback, useRef } from 'react'
import type { Dispatch, RefObject, SetStateAction } from 'react'
import type Konva from 'konva'
import { panViewFromStart, pinchViewFromStart, screenToWorldPoint } from './core'
import type { PageView, PinchStart, ScreenPoint } from './core'

interface PanStart {
  x: number
  y: number
  view: PageView
}

interface UseTouchPanGestureOptions {
  currentViewRef: RefObject<PageView>
  panStartRef: RefObject<PanStart | null>
  setIsPanning: Dispatch<SetStateAction<boolean>>
  applyCurrentView: (view: PageView) => void
  eventScreenPoint: (event: PointerEvent) => ScreenPoint | null
}

function useTouchPanGesture({
  currentViewRef,
  panStartRef,
  setIsPanning,
  applyCurrentView,
  eventScreenPoint,
}: UseTouchPanGestureOptions) {
  const touchPanPointers = useRef<Map<number, ScreenPoint>>(new Map())
  const pinchStartRef = useRef<PinchStart | null>(null)

  const firstTwoTouchPoints = useCallback(() => {
    let first: ScreenPoint | null = null
    let second: ScreenPoint | null = null
    for (const point of touchPanPointers.current.values()) {
      if (!first) {
        first = point
      } else {
        second = point
        break
      }
    }
    return first && second ? { first, second } : null
  }, [])

  const setPanStart = useCallback(
    (value: PanStart | null) => {
      panStartRef.current = value
    },
    [panStartRef],
  )

  const touchGestureMetrics = useCallback(() => {
    const points = firstTwoTouchPoints()
    if (!points) return null
    const { first, second } = points
    const center = {
      x: (first.x + second.x) / 2,
      y: (first.y + second.y) / 2,
    }
    return {
      center,
      distance: Math.max(1, Math.hypot(second.x - first.x, second.y - first.y)),
    }
  }, [firstTwoTouchPoints])

  const beginPinchGesture = useCallback(() => {
    const metrics = touchGestureMetrics()
    if (!metrics) {
      pinchStartRef.current = null
      return
    }
    const view = currentViewRef.current
      pinchStartRef.current = {
        ...metrics,
        view,
        boardCenter: screenToWorldPoint(metrics.center, view),
      }
  }, [currentViewRef, touchGestureMetrics])

  const beginTouchPan = useCallback(
    (event: Konva.KonvaEventObject<PointerEvent>) => {
      const point = eventScreenPoint(event.evt)
      if (!point) return
      event.evt.preventDefault()
      touchPanPointers.current.set(event.evt.pointerId, point)
      setIsPanning(true)
      if (touchPanPointers.current.size >= 2) {
        setPanStart(null)
        beginPinchGesture()
        return
      }
      pinchStartRef.current = null
      setPanStart({ x: point.x, y: point.y, view: currentViewRef.current })
    },
    [beginPinchGesture, currentViewRef, eventScreenPoint, setIsPanning, setPanStart],
  )

  const continueTouchPanPointerEvent = useCallback(
    (event: PointerEvent) => {
      const point = eventScreenPoint(event)
      if (!point || !touchPanPointers.current.has(event.pointerId)) return false
      event.preventDefault()
      touchPanPointers.current.set(event.pointerId, point)

      if (touchPanPointers.current.size >= 2) {
        if (!pinchStartRef.current) beginPinchGesture()
        const start = pinchStartRef.current
        const metrics = touchGestureMetrics()
        if (!start || !metrics) return true
        applyCurrentView(pinchViewFromStart(start, metrics.center, metrics.distance))
        return true
      }

      const panStart = panStartRef.current
      if (!panStart) return true
      applyCurrentView(panViewFromStart(panStart.view, { x: panStart.x, y: panStart.y }, point))
      return true
    },
    [applyCurrentView, beginPinchGesture, eventScreenPoint, panStartRef, touchGestureMetrics],
  )

  const continueTouchPan = useCallback(
    (event: Konva.KonvaEventObject<PointerEvent>) => {
      continueTouchPanPointerEvent(event.evt)
    },
    [continueTouchPanPointerEvent],
  )

  const endTouchPan = useCallback(
    (event: Konva.KonvaEventObject<PointerEvent>) => {
      event.evt.preventDefault()
      touchPanPointers.current.delete(event.evt.pointerId)
      if (touchPanPointers.current.size >= 2) {
        beginPinchGesture()
        return
      }

      pinchStartRef.current = null
      if (touchPanPointers.current.size === 1) {
        const remaining = touchPanPointers.current.values().next().value
        if (!remaining) return
        setPanStart({ x: remaining.x, y: remaining.y, view: currentViewRef.current })
        return
      }

      setPanStart(null)
      setIsPanning(false)
    },
    [beginPinchGesture, currentViewRef, setIsPanning, setPanStart],
  )

  const resetTouchPan = useCallback(() => {
    touchPanPointers.current.clear()
    pinchStartRef.current = null
    setPanStart(null)
    setIsPanning(false)
  }, [setIsPanning, setPanStart])

  const hasTouchPanPointer = useCallback((pointerId: number) => touchPanPointers.current.has(pointerId), [])

  return {
    beginTouchPan,
    continueTouchPan,
    continueTouchPanPointerEvent,
    endTouchPan,
    hasTouchPanPointer,
    resetTouchPan,
    setPanStart,
  }
}

export { useTouchPanGesture }
export type { PanStart }
