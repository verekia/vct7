import { bbox, dist, fmt } from './geometry'

import type { Point, Shape } from '../types'

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

  const [cx, cy] = shapeBBoxCenter(shape)
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
  const [cx, cy] = shapeBBoxCenter(shape)
  const dx = (p[0] - cx) * scl
  const dy = (p[1] - cy) * scl
  const rad = (rot * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  return [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos]
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
