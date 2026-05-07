import { bbox, dist, fmt } from './geometry'

import type { MirrorAxis, Point, Shape } from '../types'

/**
 * Effective rotation (degrees) and uniform scale of a shape. Defaults so callers
 * can treat untransformed shapes uniformly without null-checking.
 */
export const shapeRotation = (s: Shape): number => s.rotation ?? 0
export const shapeScale = (s: Shape): number => s.scale ?? 1

export const hasTransform = (s: Shape): boolean => shapeRotation(s) !== 0 || shapeScale(s) !== 1

/**
 * Visual bbox of a shape **before** rotation/scale is applied, in canvas
 * coordinates. For polygons it's the points AABB; for circles it's the bbox of
 * the perimeter; for glyphs it's `points[0]` extended by the glyph payload's
 * local width/height. Used as the rotation/scale pivot.
 */
export const untransformedBBox = (shape: Shape): { x: number; y: number; w: number; h: number } => {
  if (shape.kind === 'glyphs' && shape.glyphs && shape.points.length >= 1) {
    const [tlx, tly] = shape.points[0]
    return { x: tlx, y: tly, w: shape.glyphs.width, h: shape.glyphs.height }
  }
  if (shape.kind === 'circle' && shape.points.length >= 2) {
    const [cx, cy] = shape.points[0]
    const r = dist(shape.points[0], shape.points[1])
    return { x: cx - r, y: cy - r, w: 2 * r, h: 2 * r }
  }
  return bbox(shape.points)
}

export const shapeBBoxCenter = (shape: Shape): Point => {
  const b = untransformedBBox(shape)
  return [b.x + b.w / 2, b.y + b.h / 2]
}

/**
 * Compose the SVG `transform` attribute for `shape`. Returns `''` when the
 * shape has neither a rotation/scale nor a glyph base translate — the caller
 * can omit the attribute in that case.
 *
 * For glyphs, the path's `d` is in local coords (anchored at 0, 0); the
 * composed transform first translates to the canvas anchor, then applies
 * rotation+scale around the local bbox center. Matrices compose right-to-left
 * for points, so the rightmost factor (the un-pivoting translate) runs first.
 */
export const composeTransformString = (shape: Shape): string => {
  const rot = shapeRotation(shape)
  const scl = shapeScale(shape)
  const isGlyphs = shape.kind === 'glyphs' && !!shape.glyphs
  if (rot === 0 && scl === 1 && !isGlyphs) return ''

  if (isGlyphs && shape.glyphs && shape.points.length >= 1) {
    const [tlx, tly] = shape.points[0]
    const px = shape.glyphs.width / 2
    const py = shape.glyphs.height / 2
    if (rot === 0 && scl === 1) {
      return `translate(${fmt(tlx)} ${fmt(tly)})`
    }
    return (
      `translate(${fmt(tlx)} ${fmt(tly)}) ` +
      `translate(${fmt(px)} ${fmt(py)}) ` +
      `rotate(${fmt(rot)}) scale(${fmt(scl)}) ` +
      `translate(${fmt(-px)} ${fmt(-py)})`
    )
  }

  const [cx, cy] = shapePivot(shape)
  return (
    `translate(${fmt(cx)} ${fmt(cy)}) ` +
    `rotate(${fmt(rot)}) scale(${fmt(scl)}) ` +
    `translate(${fmt(-cx)} ${fmt(-cy)})`
  )
}

/** Apply the shape's rotation/scale to a point given in the same coord space as `points`. */
export const applyTransformToPoint = (shape: Shape, p: Point): Point => {
  const rot = shapeRotation(shape)
  const scl = shapeScale(shape)
  if (rot === 0 && scl === 1) return p
  const [cx, cy] = shapePivot(shape)
  const dx = (p[0] - cx) * scl
  const dy = (p[1] - cy) * scl
  const rad = (rot * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  return [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos]
}

/**
 * Reflect a point across a line through `(ax, ay)` at `angle` degrees from
 * the x-axis. Standard 2D reflection: shift the line to the origin, rotate so
 * it lies on the x-axis, negate y, undo. The closed-form below folds those
 * three steps into a single matrix application.
 */
export const reflectPoint = (p: Point, axis: MirrorAxis): Point => {
  const rad = (axis.angle * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const dx = p[0] - axis.x
  const dy = p[1] - axis.y
  // M = R(-θ) · diag(1,-1) · R(θ) — reflection across the line at angle θ.
  // Expanded: [[cos2θ, sin2θ], [sin2θ, -cos2θ]].
  const c2 = cos * cos - sin * sin
  const s2 = 2 * sin * cos
  return [axis.x + c2 * dx + s2 * dy, axis.y + s2 * dx - c2 * dy]
}

/**
 * Tolerance for "is this point on the axis" checks. Loose enough that a snap
 * pulled the user onto the axis line, tight enough that a vertex an editor
 * pixel away at typical zoom doesn't accidentally count.
 */
const AXIS_TOLERANCE = 1e-3

/** True when reflecting `p` across `axis` leaves it within tolerance of itself. */
export const isPointOnAxis = (p: Point, axis: MirrorAxis, tol = AXIS_TOLERANCE): boolean => {
  const reflected = reflectPoint(p, axis)
  const dx = reflected[0] - p[0]
  const dy = reflected[1] - p[1]
  return dx * dx + dy * dy < tol * tol
}

/**
 * Default axis for a freshly-enabled mirror, anchored at the supplied center
 * point. Angle defaults to 90° (vertical line → horizontal/left-right
 * reflection); pass 0° for a horizontal line / vertical/top-bottom reflection.
 * Anchoring at the canvas (not the shape's bbox) means a shape drawn
 * off-center mirrors *across* the canvas rather than back onto itself.
 */
export const defaultMirrorAxis = (centerX: number, centerY: number, angle = 90): MirrorAxis => ({
  x: centerX,
  y: centerY,
  angle,
})

/**
 * Reflect a shape's geometry across `axis`. Used by the live-mirror renderer
 * (each frame) and by `ejectMirror` (one-shot bake). The result keeps the
 * source's `rotation` / `scale` *unchanged* — the live renderer applies them
 * to source and reflection alike around the combined pair pivot, so the pair
 * rotates as one rigid group rather than each half pivoting independently.
 *
 * Arc angles flip across the reflection line (α → 2θ − α) and start/end swap
 * so the clockwise-sweep convention survives. `mirror` is cleared on the
 * output to prevent recursion (`pairBBoxCenter` calls this helper).
 */
export const reflectShape = (shape: Shape, axis: MirrorAxis): Shape => {
  const newPoints = shape.points.map(p => reflectPoint(p, axis))
  const next: Shape = { ...shape, points: newPoints, mirror: undefined }
  if (shape.kind === 'circle' && shape.arc) {
    const a = shape.arc
    next.arc = { ...a, start: 2 * axis.angle - a.end, end: 2 * axis.angle - a.start }
  }
  return next
}

/**
 * Rotate + scale `points` around an explicit pivot, returning new points.
 * Used by `ejectMirror` to bake the group transform (which pivots at the
 * combined pair center, not the shape's own bbox) into both the source and
 * the materialized reflection so the ejected pair is at its visual rest pose.
 */
export const transformPointsAround = (points: Point[], rot: number, scl: number, cx: number, cy: number): Point[] => {
  if (rot === 0 && scl === 1) return points.map(p => [p[0], p[1]] as Point)
  const rad = (rot * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  return points.map(p => {
    const dx = (p[0] - cx) * scl
    const dy = (p[1] - cy) * scl
    return [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos] as Point
  })
}

/**
 * Combined bbox center of a source shape and its mirrored counterpart, in
 * the same canvas coords as `shapeBBoxCenter`. This is the rotation/scale
 * pivot used while a mirror is attached so the pair rotates and animates as
 * one rigid group rather than each half pivoting independently.
 */
export const pairBBoxCenter = (shape: Shape): Point => {
  if (!shape.mirror) return shapeBBoxCenter(shape)
  const a = untransformedBBox(shape)
  const reflected = reflectShape(shape, shape.mirror.axis)
  const b = untransformedBBox(reflected)
  const minX = Math.min(a.x, b.x)
  const minY = Math.min(a.y, b.y)
  const maxX = Math.max(a.x + a.w, b.x + b.w)
  const maxY = Math.max(a.y + a.h, b.y + b.h)
  return [(minX + maxX) / 2, (minY + maxY) / 2]
}

/**
 * Pivot for the shape's rotation/scale and animation transforms — the
 * combined center while a mirror is attached, the source's own bbox center
 * otherwise. Matches the user-visible "rotate as a group" rule.
 */
export const shapePivot = (shape: Shape): Point => (shape.mirror ? pairBBoxCenter(shape) : shapeBBoxCenter(shape))

/**
 * Combined visual bbox center for a group's members. Used as the pivot for
 * the group's `<g transform>` and as the rotation/scale center when baking
 * a group transform into its children. Aggregates each member's
 * {@link visualBBox} so a member's own per-shape rotation/scale is already
 * folded in — the group transform pivots at the visual center the user
 * sees on screen, not the raw points center.
 */
export const groupBBoxCenter = (members: Shape[]): Point => {
  if (members.length === 0) return [0, 0]
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const sh of members) {
    const b = visualBBox(sh)
    if (b.x < minX) minX = b.x
    if (b.y < minY) minY = b.y
    if (b.x + b.w > maxX) maxX = b.x + b.w
    if (b.y + b.h > maxY) maxY = b.y + b.h
  }
  return [(minX + maxX) / 2, (minY + maxY) / 2]
}

/**
 * Compose `translate(pivot) rotate(rot) scale(sc) translate(-pivot)` — the
 * shared form used by the group `<g>` wrapper, the per-shape composer, and
 * the mirror sibling renderer. Returns `''` when the transform is identity
 * so callers can omit the attribute entirely.
 */
export const transformAroundString = (rot: number, scl: number, cx: number, cy: number): string => {
  if (rot === 0 && scl === 1) return ''
  return (
    `translate(${fmt(cx)} ${fmt(cy)}) ` +
    `rotate(${fmt(rot)}) scale(${fmt(scl)}) ` +
    `translate(${fmt(-cx)} ${fmt(-cy)})`
  )
}

/** AABB of the rotated+scaled bbox. Used by marquee selection so a rotated shape still hits. */
export const visualBBox = (shape: Shape): { x: number; y: number; w: number; h: number } => {
  const b = untransformedBBox(shape)
  if (!hasTransform(shape)) return b
  const corners: Point[] = [
    [b.x, b.y],
    [b.x + b.w, b.y],
    [b.x + b.w, b.y + b.h],
    [b.x, b.y + b.h],
  ]
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const c of corners) {
    const [x, y] = applyTransformToPoint(shape, c)
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}
