import { MIN_VISIBLE_PEN_WIDTH, PEN_TIP_PRESSURE } from './core'
import type { Stroke } from './core'

function strokeLiveWidth(stroke: Stroke, pressure: number, widthScale = 1) {
  if (stroke.kind === 'highlighter') return stroke.width * widthScale
  const minimum = Math.min(stroke.width * widthScale * 0.42, MIN_VISIBLE_PEN_WIDTH * widthScale)
  return Math.max(minimum, stroke.width * widthScale * Math.max(PEN_TIP_PRESSURE, pressure))
}

export { strokeLiveWidth }
