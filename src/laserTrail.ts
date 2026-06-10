interface LaserTrailInput {
  x: number
  y: number
}

interface LaserTrailPoint extends LaserTrailInput {
  id: string
}

interface LaserTrail {
  id: string
  points: LaserTrailPoint[]
}

const LASER_TRAIL_LIMIT = 420
const LASER_TRAIL_TOTAL_LIMIT = 560
const LASER_TRAIL_SEGMENT_LIMIT = 18
const LASER_TRAIL_MIN_DISTANCE = 2.5
const LASER_TRAIL_HIDE_DELAY_MS = 2000
const LASER_TRAIL_COLOR = '#ff1f1f'

const appendLaserTrailPoint = (points: LaserTrailPoint[], point: LaserTrailInput, id: string) => {
  const last = points.at(-1)
  if (last && Math.hypot(point.x - last.x, point.y - last.y) < LASER_TRAIL_MIN_DISTANCE) return false
  points.push({ x: point.x, y: point.y, id })
  if (points.length > LASER_TRAIL_LIMIT) points.splice(0, points.length - LASER_TRAIL_LIMIT)
  return true
}

const laserTrailPolylinePoints = (points: LaserTrailInput[]) => {
  let value = ''
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index]
    value += `${index ? ' ' : ''}${point.x},${point.y}`
  }
  return value
}

const trimLaserTrailHistory = (trails: LaserTrail[]) => {
  while (trails.length > LASER_TRAIL_SEGMENT_LIMIT) trails.shift()

  let totalPoints = 0
  for (const trail of trails) totalPoints += trail.points.length
  while (totalPoints > LASER_TRAIL_TOTAL_LIMIT && trails.length) {
    const firstTrail = trails[0]
    const removable = Math.min(firstTrail.points.length, totalPoints - LASER_TRAIL_TOTAL_LIMIT)
    firstTrail.points.splice(0, removable)
    totalPoints -= removable
    if (!firstTrail.points.length) trails.shift()
  }
}

const snapshotLaserTrails = (trails: LaserTrail[]) =>
  trails
    .filter((trail) => trail.points.length > 0)
    .map((trail) => ({
      id: trail.id,
      points: trail.points.slice(),
    }))

const lastLaserTrailPoint = (trails: LaserTrail[]) => {
  for (let index = trails.length - 1; index >= 0; index -= 1) {
    const point = trails[index].points.at(-1)
    if (point) return point
  }
  return null
}

export {
  LASER_TRAIL_COLOR,
  LASER_TRAIL_HIDE_DELAY_MS,
  appendLaserTrailPoint,
  laserTrailPolylinePoints,
  lastLaserTrailPoint,
  snapshotLaserTrails,
  trimLaserTrailHistory,
}
export type { LaserTrail, LaserTrailInput, LaserTrailPoint }
