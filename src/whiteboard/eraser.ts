import type { BoardPointerPoint } from './core'
import { makeId, strokeIntersectsRect } from './core'
import type { Stroke } from './core'

interface EraseStrokesResult {
  changed: boolean
  strokes: Stroke[]
}

const distanceToSegment = (px: number, py: number, x1: number, y1: number, x2: number, y2: number) => {
  const dx = x2 - x1
  const dy = y2 - y1
  if (dx === 0 && dy === 0) return Math.hypot(px - x1, py - y1)
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)))
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy))
}

const dynamicEraserRadius = (baseRadius: number, point: BoardPointerPoint, previousPoint: BoardPointerPoint | null) => {
  if (!previousPoint) return Math.round(baseRadius)
  const distance = Math.hypot(point.screenX - previousPoint.screenX, point.screenY - previousPoint.screenY)
  const elapsed = Math.max(8, point.time - previousPoint.time)
  const speed = distance / elapsed
  return Math.round(baseRadius * Math.min(2.25, Math.max(0.85, 1 + speed * 0.72)))
}

const withDynamicEraserRadius = <T extends BoardPointerPoint>(
  point: T,
  previousPoint: BoardPointerPoint | null,
  baseRadius: number,
) => ({
  ...point,
  eraserRadius: dynamicEraserRadius(baseRadius, point, previousPoint),
})

const eraseStrokesAtPoints = (
  strokes: Stroke[],
  points: BoardPointerPoint[],
  baseRadius: number,
  viewScale = 1,
): EraseStrokesResult => {
  if (!points.length || !strokes.length) return { changed: false, strokes }

  const scale = Math.max(0.1, viewScale)
  const widthScale = 1 / scale
  let maxScreenRadius = 0
  for (const point of points) {
    const radius = point.eraserRadius ?? baseRadius
    if (radius > maxScreenRadius) maxScreenRadius = radius
  }
  const maxRadius = maxScreenRadius / scale
  const cellSize = Math.max(maxRadius * 2.5, 24 / scale)
  const eraseRects: Array<{ radius: number; x: number; y: number; width: number; height: number }> = []
  const eraseBounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
  const pointCells = new Map<string, number[]>()

  for (let index = 0; index < points.length; index += 1) {
    const point = points[index]
    const radius = (point.eraserRadius ?? baseRadius) / scale
    const rect = {
      radius,
      x: point.x - radius,
      y: point.y - radius,
      width: radius * 2,
      height: radius * 2,
    }
    eraseRects.push(rect)
    if (rect.x < eraseBounds.minX) eraseBounds.minX = rect.x
    if (rect.y < eraseBounds.minY) eraseBounds.minY = rect.y
    if (rect.x + rect.width > eraseBounds.maxX) eraseBounds.maxX = rect.x + rect.width
    if (rect.y + rect.height > eraseBounds.maxY) eraseBounds.maxY = rect.y + rect.height
    const key = `${Math.floor(point.x / cellSize)}:${Math.floor(point.y / cellSize)}`
    const bucket = pointCells.get(key)
    if (bucket) bucket.push(index)
    else pointCells.set(key, [index])
  }

  const eraseRect = {
    x: eraseBounds.minX,
    y: eraseBounds.minY,
    width: eraseBounds.maxX - eraseBounds.minX,
    height: eraseBounds.maxY - eraseBounds.minY,
  }

  const strokeBounds = (stroke: Stroke) => {
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (let index = 0; index < stroke.points.length; index += 2) {
      const x = stroke.points[index]
      const y = stroke.points[index + 1]
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
    const padding = maxRadius + stroke.width * widthScale
    return {
      minX: minX - padding,
      minY: minY - padding,
      maxX: maxX + padding,
      maxY: maxY + padding,
    }
  }

  const candidatePointIndexes = (stroke: Stroke) => {
    const bounds = strokeBounds(stroke)
    const indexes = new Set<number>()
    const minCellX = Math.floor(bounds.minX / cellSize)
    const maxCellX = Math.floor(bounds.maxX / cellSize)
    const minCellY = Math.floor(bounds.minY / cellSize)
    const maxCellY = Math.floor(bounds.maxY / cellSize)
    for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
      for (let cellY = minCellY; cellY <= maxCellY; cellY += 1) {
        const bucket = pointCells.get(`${cellX}:${cellY}`)
        if (!bucket) continue
        for (const index of bucket) indexes.add(index)
      }
    }
    return Array.from(indexes)
  }

  const splitStrokeByErasePoints = (stroke: Stroke, candidateIndexes: number[]) => {
    if (!candidateIndexes.length) return [stroke]
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
      const segmentRect = {
        x: Math.min(x1, x2) - maxRadius,
        y: Math.min(y1, y2) - maxRadius,
        width: Math.abs(x2 - x1) + maxRadius * 2,
        height: Math.abs(y2 - y1) + maxRadius * 2,
      }
      const segmentErased = candidateIndexes.some((index) => {
        const rect = eraseRects[index]
        if (
          rect.x > segmentRect.x + segmentRect.width ||
          rect.x + rect.width < segmentRect.x ||
          rect.y > segmentRect.y + segmentRect.height ||
          rect.y + rect.height < segmentRect.y
        ) {
          return false
        }
        const point = points[index]
        return distanceToSegment(point.x, point.y, x1, y1, x2, y2) <= rect.radius + (stroke.width * widthScale) / 2
      })

      if (segmentErased) {
        flush()
        continue
      }

      if (!currentPoints.length) pushPoint(pointIndex)
      pushPoint(pointIndex + 1)
    }

    flush()
    return chunks.length ? chunks : []
  }

  let changed = false
  const nextStrokes: Stroke[] = []
  for (const stroke of strokes) {
    if (!strokeIntersectsRect(stroke, eraseRect, maxRadius + stroke.width * widthScale)) {
      nextStrokes.push(stroke)
      continue
    }
    const candidateIndexes = candidatePointIndexes(stroke)
    if (!candidateIndexes.length) {
      nextStrokes.push(stroke)
      continue
    }

    const splitStrokes = splitStrokeByErasePoints(stroke, candidateIndexes)
    if (splitStrokes.length !== 1 || splitStrokes[0] !== stroke) changed = true
    nextStrokes.push(...splitStrokes)
  }

  return changed ? { changed, strokes: nextStrokes } : { changed, strokes }
}

export { dynamicEraserRadius, eraseStrokesAtPoints, withDynamicEraserRadius }
