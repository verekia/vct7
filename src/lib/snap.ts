import type { Point } from '../types'

const DEG_TO_RAD = Math.PI / 180
const RAD_TO_DEG = 180 / Math.PI

const normalize = (a: number): number => ((a % 360) + 360) % 360

export interface SnapResult {
  x: number
  y: number
  /** Which allowed angle (deg) was chosen, or null if snapping was skipped. */
  angle: number | null
}

/**
 * Project `to` onto a ray from `from` along the nearest of `angles` (degrees).
 *
 * The projected point is the perpendicular foot of `to` on the chosen ray, so
 * the cursor visibly snaps to the closest allowed direction without locking the
 * length. If `angles` is empty, returns `to` unchanged.
 */
export function snapToAngle(
  from: { x: number; y: number },
  to: { x: number; y: number },
  angles: number[],
): SnapResult {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const len = Math.hypot(dx, dy)
  if (angles.length === 0 || len < 1e-6) {
    return { x: to.x, y: to.y, angle: null }
  }
  const cur = normalize(Math.atan2(dy, dx) * RAD_TO_DEG)
  let bestAngle = angles[0]
  let bestDiff = Infinity
  for (const a of angles) {
    const an = normalize(a)
    const raw = Math.abs(an - cur)
    const diff = Math.min(raw, 360 - raw)
    if (diff < bestDiff) {
      bestDiff = diff
      bestAngle = an
    }
  }
  const rad = bestAngle * DEG_TO_RAD
  const projLen = len * Math.cos(bestDiff * DEG_TO_RAD)
  return {
    x: from.x + projLen * Math.cos(rad),
    y: from.y + projLen * Math.sin(rad),
    angle: bestAngle,
  }
}

/** Sentinel angle sets useful as project presets. */
export const ANGLE_PRESETS: Record<string, number[]> = {
  ortho: [0, 90, 180, 270],
  '45': [0, 45, 90, 135, 180, 225, 270, 315],
  '30': [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330],
  '60': [0, 60, 120, 180, 240, 300],
  '15': Array.from({ length: 24 }, (_, i) => i * 15),
}

export const distancePoints = (a: Point, b: Point): number => Math.hypot(a[0] - b[0], a[1] - b[1])

/**
 * Snap a point to the nearest intersection of a regular grid (origin 0,0).
 * Returns the input unchanged when `size` is non-positive.
 */
export function snapToGrid(p: Point, size: number): Point {
  if (!Number.isFinite(size) || size <= 0) return p
  return [Math.round(p[0] / size) * size, Math.round(p[1] / size) * size]
}

/**
 * Compute the intersection points of every line through `anchorA` at one of
 * `angles` with every line through `anchorB` at one of `angles`.
 *
 * Each `(α, β)` pair is treated as two infinite lines through their anchors.
 * Parallel pairs (same direction, including 180°-opposite directions) are
 * skipped. This is the geometric basis for "snap to where the angle rays
 * cross" during a vertex drag with two neighbors.
 */
export function rayIntersections(anchorA: Point, anchorB: Point, angles: number[]): Point[] {
  if (angles.length === 0) return []
  const out: Point[] = []
  const dx = anchorB[0] - anchorA[0]
  const dy = anchorB[1] - anchorA[1]
  for (const aDeg of angles) {
    const ra = aDeg * DEG_TO_RAD
    const cosA = Math.cos(ra)
    const sinA = Math.sin(ra)
    for (const bDeg of angles) {
      // det = sin(α − β); zero ⇒ parallel lines, no unique intersection.
      const det = Math.sin((aDeg - bDeg) * DEG_TO_RAD)
      if (Math.abs(det) < 1e-9) continue
      const cosB = Math.cos(bDeg * DEG_TO_RAD)
      const sinB = Math.sin(bDeg * DEG_TO_RAD)
      const t = (dy * cosB - dx * sinB) / det
      out.push([anchorA[0] + t * cosA, anchorA[1] + t * sinA])
    }
  }
  return out
}

export interface SnapOptions {
  /** Anchors for continuous angle snap (drawing's last point, vertex's neighbors, …). */
  anchors: Point[]
  /** Discrete points the cursor can magnetically lock to (other shapes' vertices, etc.). */
  vertexTargets: Point[]
  snapAngles: number[]
  gridSize: number
  gridSnap: boolean
  /** Magnetic snap radius for point targets, in canvas units. */
  pointThresholdCanvas: number
  snapDisabled: boolean
}

export interface SnapOutcome {
  snapped: Point
  /** When set, the cursor was magnetically pulled to a discrete point (vertex/grid intersection). */
  snapPoint: Point | null
}

/**
 * Compute the snapped position of a raw cursor under the project's snap rules.
 *
 * Priority is: magnetic point snap > continuous angle projection > grid round.
 * Point snap is what gives the "strong, larger area" feel near vertices and
 * grid intersections — within the threshold the cursor jumps to the exact
 * point. Outside the threshold the existing continuous snaps apply.
 */
export function applySnap(raw: Point, opts: SnapOptions): SnapOutcome {
  if (opts.snapDisabled) return { snapped: raw, snapPoint: null }

  let bestPoint: Point | null = null
  let bestDist = opts.pointThresholdCanvas
  for (const p of opts.vertexTargets) {
    const d = Math.hypot(raw[0] - p[0], raw[1] - p[1])
    if (d < bestDist) {
      bestDist = d
      bestPoint = [p[0], p[1]]
    }
  }
  if (!bestPoint && opts.gridSnap && opts.gridSize > 0) {
    const gx = Math.round(raw[0] / opts.gridSize) * opts.gridSize
    const gy = Math.round(raw[1] / opts.gridSize) * opts.gridSize
    const d = Math.hypot(raw[0] - gx, raw[1] - gy)
    if (d < opts.pointThresholdCanvas) bestPoint = [gx, gy]
  }
  if (bestPoint) return { snapped: bestPoint, snapPoint: bestPoint }

  let result: Point = raw
  if (opts.anchors.length > 0 && opts.snapAngles.length > 0) {
    let bestProj = Infinity
    for (const a of opts.anchors) {
      const r = snapToAngle({ x: a[0], y: a[1] }, { x: raw[0], y: raw[1] }, opts.snapAngles)
      const d = Math.hypot(raw[0] - r.x, raw[1] - r.y)
      if (d < bestProj) {
        bestProj = d
        result = [r.x, r.y]
      }
    }
  }
  if (opts.gridSnap && opts.gridSize > 0) {
    result = snapToGrid(result, opts.gridSize)
  }
  return { snapped: result, snapPoint: null }
}
