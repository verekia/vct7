import { BLEND_MODES, type BlendMode, type Point, type StrokeLinecap, type StrokeLinejoin } from '../types'

/**
 * Plain-SVG import path. Used when an opened file lacks the `data-v7-*`
 * round-trip metadata (VCT7's exported plain SVG, an Inkscape/Illustrator
 * file, etc.) — we derive editable {@link Shape}s from native attributes
 * instead. Bezier and arc commands are flattened to a polyline of sampled
 * points so the recovered silhouette tracks the original curve; each shape
 * still becomes a vertex polygon, just with finer resolution along curves.
 */

interface Mat2x3 {
  readonly a: number
  readonly b: number
  readonly c: number
  readonly d: number
  readonly e: number
  readonly f: number
}

const IDENTITY: Mat2x3 = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }

const mulMat = (m: Mat2x3, n: Mat2x3): Mat2x3 => ({
  a: m.a * n.a + m.c * n.b,
  b: m.b * n.a + m.d * n.b,
  c: m.a * n.c + m.c * n.d,
  d: m.b * n.c + m.d * n.d,
  e: m.a * n.e + m.c * n.f + m.e,
  f: m.b * n.e + m.d * n.f + m.f,
})

const applyMatrix = (m: Mat2x3, p: Point): Point => [m.a * p[0] + m.c * p[1] + m.e, m.b * p[0] + m.d * p[1] + m.f]

const TRANSFORM_FN_RE = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]+)\)/g

/**
 * Parse an SVG `transform` attribute into a 2x3 affine matrix. Recognizes
 * the common functions (`matrix`, `translate`, `scale`, `rotate`, `skewX`,
 * `skewY`); unknown fragments are skipped silently. Returns identity for
 * empty / null input.
 */
export const parseTransform = (raw: string | null | undefined): Mat2x3 => {
  if (!raw) return IDENTITY
  let m = IDENTITY
  TRANSFORM_FN_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = TRANSFORM_FN_RE.exec(raw)) !== null) {
    const name = match[1]
    const args = match[2]
      .split(/[\s,]+/)
      .map(parseFloat)
      .filter(Number.isFinite)
    let next: Mat2x3 = IDENTITY
    if (name === 'matrix' && args.length >= 6) {
      next = { a: args[0], b: args[1], c: args[2], d: args[3], e: args[4], f: args[5] }
    } else if (name === 'translate' && args.length >= 1) {
      next = { ...IDENTITY, e: args[0], f: args.length >= 2 ? args[1] : 0 }
    } else if (name === 'scale' && args.length >= 1) {
      const sx = args[0]
      const sy = args.length >= 2 ? args[1] : sx
      next = { ...IDENTITY, a: sx, d: sy }
    } else if (name === 'rotate' && args.length >= 1) {
      const angle = (args[0] * Math.PI) / 180
      const cos = Math.cos(angle)
      const sin = Math.sin(angle)
      const r: Mat2x3 = { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 }
      if (args.length >= 3) {
        const cx = args[1]
        const cy = args[2]
        const t1: Mat2x3 = { ...IDENTITY, e: cx, f: cy }
        const t2: Mat2x3 = { ...IDENTITY, e: -cx, f: -cy }
        next = mulMat(mulMat(t1, r), t2)
      } else {
        next = r
      }
    } else if (name === 'skewX' && args.length >= 1) {
      next = { ...IDENTITY, c: Math.tan((args[0] * Math.PI) / 180) }
    } else if (name === 'skewY' && args.length >= 1) {
      next = { ...IDENTITY, b: Math.tan((args[0] * Math.PI) / 180) }
    }
    m = mulMat(m, next)
  }
  return m
}

const combinedMatrix = (el: Element, root: Element): Mat2x3 => {
  const chain: Mat2x3[] = []
  let cur: Element | null = el
  while (cur && cur !== root) {
    const t = cur.getAttribute('transform')
    if (t) chain.push(parseTransform(t))
    cur = cur.parentElement
  }
  // chain is innermost-first; effective matrix = M_outermost * ... * M_inner.
  let combined = IDENTITY
  for (let i = chain.length - 1; i >= 0; i--) {
    combined = mulMat(combined, chain[i])
  }
  return combined
}

const PATH_CMDS = 'MmLlHhVvCcSsQqTtAaZz'
const NUM_RE = /-?\d*\.?\d+(?:[eE][+-]?\d+)?/g

interface PathSegment {
  cmd: string
  args: number[]
}

export interface ParsedPath {
  points: Point[]
  closed: boolean
  /**
   * Layer-level bezier rounding factor recovered for the shape, or `0` when
   * no rounding could be inferred. For paths matching VCT7's emit pattern
   * this is the original `t` (or the most common `t` when corners differ);
   * `pointBezierOverrides` carries the deviating corners.
   */
  bezierOverride: number
  pointBezierOverrides?: Record<number, number>
}

const parsePathSegments = (d: string): PathSegment[] => {
  const segments: PathSegment[] = []
  let i = 0
  while (i < d.length) {
    const ch = d[i]
    if (PATH_CMDS.includes(ch)) {
      const cmd = ch
      i++
      let buf = ''
      while (i < d.length && !PATH_CMDS.includes(d[i])) {
        buf += d[i]
        i++
      }
      const nums = (buf.match(NUM_RE) ?? []).map(Number).filter(Number.isFinite)
      segments.push({ cmd, args: nums })
    } else {
      i++
    }
  }
  return segments
}

const dist = (a: Point, b: Point): number => Math.hypot(a[0] - b[0], a[1] - b[1])

/**
 * Mode of a list of bezier `t` values, bucketed to 2 decimal places so float
 * drift from the serializer's `fmt` rounding doesn't split a "nice" value
 * (e.g. 0.5) across adjacent buckets. Returns 0 for an empty input. The
 * returned value is the bucket key itself, snapped to 0.01, which is the
 * grain users actually pick — and lossless for any t the editor's UI emits.
 */
export const pickDominantT = (ts: readonly number[]): number => {
  if (ts.length === 0) return 0
  const buckets = new Map<number, number>()
  for (const t of ts) {
    const key = Math.round(t * 100) / 100
    buckets.set(key, (buckets.get(key) ?? 0) + 1)
  }
  let bestKey = 0
  let bestCount = 0
  for (const [key, count] of buckets) {
    if (count > bestCount) {
      bestCount = count
      bestKey = key
    }
  }
  return bestKey
}

/**
 * Detect VCT7's own emit pattern and recover the original polygon vertices.
 *
 * VCT7 serializes a rounded shape as alternating `L Q` pairs — the `L`
 * lands on a bezier shoulder and the `Q` control sits at the original
 * vertex. For a closed shape the path is `M b₀ (L aᵢ Q vᵢ bᵢ)+ Z`, with
 * the M endpoint matching the last Q's b. For an open shape the path is
 * `M v₀ (L aᵢ Q vᵢ bᵢ)+ L vₙ₋₁`. When the structure matches we extract the
 * Q controls as the canonical vertices and back out the per-corner `t` from
 * the observed shoulder distance: `t = 2·dist(v, a) / min(inLen, outLen)`,
 * where the lengths come from the recovered vertex polygon. Returns null
 * for any path that doesn't fit, leaving the generic polyline fallback to
 * deal with foreign SVGs.
 */
const recoverVCT7Polygon = (segs: PathSegment[]): ParsedPath | null => {
  if (segs.length < 2) return null
  if (segs.some(s => s.cmd !== s.cmd.toUpperCase())) return null
  if (segs[0].cmd !== 'M' || segs[0].args.length !== 2) return null

  const last = segs[segs.length - 1]
  const closed = last.cmd === 'Z'
  const middle = closed ? segs.slice(1, -1) : segs.slice(1)

  if (closed) {
    if (middle.length === 0 || middle.length % 2 !== 0) return null
    for (let i = 0; i < middle.length; i += 2) {
      if (middle[i].cmd !== 'L' || middle[i].args.length !== 2) return null
      if (middle[i + 1].cmd !== 'Q' || middle[i + 1].args.length !== 4) return null
    }
  } else {
    if (middle.length === 0 || middle.length % 2 !== 1) return null
    for (let i = 0; i < middle.length - 1; i += 2) {
      if (middle[i].cmd !== 'L' || middle[i].args.length !== 2) return null
      if (middle[i + 1].cmd !== 'Q' || middle[i + 1].args.length !== 4) return null
    }
    if (middle[middle.length - 1].cmd !== 'L' || middle[middle.length - 1].args.length !== 2) return null
  }

  const Mp: Point = [segs[0].args[0], segs[0].args[1]]
  const vertices: Point[] = []
  // For closed: cornerData[i] is the corner at vertices[i] post-rotation.
  // For open: cornerData[i] is the corner at vertices[i + 1] (interior only).
  const cornerData: { v: Point; a: Point; b: Point }[] = []

  if (closed) {
    for (let i = 0; i < middle.length; i += 2) {
      const a: Point = [middle[i].args[0], middle[i].args[1]]
      const v: Point = [middle[i + 1].args[0], middle[i + 1].args[1]]
      const b: Point = [middle[i + 1].args[2], middle[i + 1].args[3]]
      vertices.push(v)
      cornerData.push({ v, a, b })
    }
    // The first M endpoint is the shoulder of the very last Q. If they don't
    // line up the path wasn't authored by VCT7 — bail so the polyline
    // fallback can have a turn.
    const lastB = cornerData[cornerData.length - 1].b
    if (Math.abs(lastB[0] - Mp[0]) > 1e-3 || Math.abs(lastB[1] - Mp[1]) > 1e-3) return null
    // Path order yields [v₁, v₂, …, vₙ₋₁, v₀]; rotate to canonical [v₀, …].
    const lastV = vertices.pop() as Point
    vertices.unshift(lastV)
    const lastCorner = cornerData.pop() as { v: Point; a: Point; b: Point }
    cornerData.unshift(lastCorner)
  } else {
    vertices.push(Mp)
    for (let i = 0; i < middle.length - 1; i += 2) {
      const a: Point = [middle[i].args[0], middle[i].args[1]]
      const v: Point = [middle[i + 1].args[0], middle[i + 1].args[1]]
      const b: Point = [middle[i + 1].args[2], middle[i + 1].args[3]]
      vertices.push(v)
      cornerData.push({ v, a, b })
    }
    const finalL = middle[middle.length - 1]
    vertices.push([finalL.args[0], finalL.args[1]])
  }

  if (vertices.length < 2) return null

  const ts: number[] = Array.from({ length: vertices.length }, () => 0)
  for (let cIdx = 0; cIdx < cornerData.length; cIdx++) {
    const vIdx = closed ? cIdx : cIdx + 1
    const prev = closed ? vertices[(vIdx - 1 + vertices.length) % vertices.length] : vertices[vIdx - 1]
    const next = closed ? vertices[(vIdx + 1) % vertices.length] : vertices[vIdx + 1]
    const inLen = dist(prev, vertices[vIdx])
    const outLen = dist(vertices[vIdx], next)
    const minLen = Math.min(inLen, outLen)
    if (minLen < 1e-6) continue
    const radius = dist(cornerData[cIdx].v, cornerData[cIdx].a)
    const t = (2 * radius) / minLen
    ts[vIdx] = Math.max(0, Math.min(1, t))
  }

  // Endpoints of an open polyline have no corner — exclude them when picking
  // the layer-level base. Bucket the rest to 2 decimal places to absorb the
  // float drift introduced by serializer's 3-dp `fmt`, and pick the bucket
  // mode as the layer's representative `t`. Anything that doesn't fall into
  // that bucket goes into `pointBezierOverrides` (`pointsToPath` ignores
  // overrides on endpoint indices, so we don't emit any for those).
  const interior = closed ? ts : ts.slice(1, -1)
  const baseT = pickDominantT(interior)
  const overrides: Record<number, number> = {}
  for (let i = 0; i < ts.length; i++) {
    if (!closed && (i === 0 || i === ts.length - 1)) continue
    if (Math.abs(ts[i] - baseT) > 0.005) overrides[i] = Math.round(ts[i] * 1000) / 1000
  }

  return {
    points: vertices,
    closed,
    bezierOverride: baseT,
    ...(Object.keys(overrides).length > 0 ? { pointBezierOverrides: overrides } : {}),
  }
}

const CUBIC_STEPS = 16
const QUAD_STEPS = 12
const ARC_STEP_DEG = 22.5

type AddPoint = (x: number, y: number) => void

const sampleCubic = (
  p0x: number,
  p0y: number,
  p1x: number,
  p1y: number,
  p2x: number,
  p2y: number,
  p3x: number,
  p3y: number,
  add: AddPoint,
): void => {
  for (let i = 1; i <= CUBIC_STEPS; i++) {
    const t = i / CUBIC_STEPS
    const u = 1 - t
    const b0 = u * u * u
    const b1 = 3 * u * u * t
    const b2 = 3 * u * t * t
    const b3 = t * t * t
    add(b0 * p0x + b1 * p1x + b2 * p2x + b3 * p3x, b0 * p0y + b1 * p1y + b2 * p2y + b3 * p3y)
  }
}

const sampleQuadratic = (
  p0x: number,
  p0y: number,
  p1x: number,
  p1y: number,
  p2x: number,
  p2y: number,
  add: AddPoint,
): void => {
  for (let i = 1; i <= QUAD_STEPS; i++) {
    const t = i / QUAD_STEPS
    const u = 1 - t
    add(u * u * p0x + 2 * u * t * p1x + t * t * p2x, u * u * p0y + 2 * u * t * p1y + t * t * p2y)
  }
}

const signedAngle = (ax: number, ay: number, bx: number, by: number): number => {
  const sign = ax * by - ay * bx >= 0 ? 1 : -1
  const len = Math.hypot(ax, ay) * Math.hypot(bx, by)
  if (len === 0) return 0
  const cos = Math.min(1, Math.max(-1, (ax * bx + ay * by) / len))
  return sign * Math.acos(cos)
}

/**
 * Endpoint-to-center conversion for an SVG elliptical arc, then sample at
 * roughly one segment per {@link ARC_STEP_DEG}. Degenerate radii fall back to
 * a straight line. See https://www.w3.org/TR/SVG/implnote.html#ArcImplementationNotes.
 */
const sampleArc = (
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  rxIn: number,
  ryIn: number,
  phi: number,
  large: boolean,
  sweep: boolean,
  add: AddPoint,
): void => {
  let rx = Math.abs(rxIn)
  let ry = Math.abs(ryIn)
  if (rx === 0 || ry === 0 || (x1 === x2 && y1 === y2)) {
    add(x2, y2)
    return
  }
  const cosPhi = Math.cos(phi)
  const sinPhi = Math.sin(phi)
  const dx = (x1 - x2) / 2
  const dy = (y1 - y2) / 2
  const x1p = cosPhi * dx + sinPhi * dy
  const y1p = -sinPhi * dx + cosPhi * dy
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry)
  if (lambda > 1) {
    const s = Math.sqrt(lambda)
    rx *= s
    ry *= s
  }
  const sign = large === sweep ? -1 : 1
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p
  const factor = sign * Math.sqrt(Math.max(0, num / den))
  const cxp = (factor * rx * y1p) / ry
  const cyp = (factor * -ry * x1p) / rx
  const cxc = cosPhi * cxp - sinPhi * cyp + (x1 + x2) / 2
  const cyc = sinPhi * cxp + cosPhi * cyp + (y1 + y2) / 2
  const ux = (x1p - cxp) / rx
  const uy = (y1p - cyp) / ry
  const vx = (-x1p - cxp) / rx
  const vy = (-y1p - cyp) / ry
  const theta1 = signedAngle(1, 0, ux, uy)
  let dTheta = signedAngle(ux, uy, vx, vy)
  if (!sweep && dTheta > 0) dTheta -= 2 * Math.PI
  if (sweep && dTheta < 0) dTheta += 2 * Math.PI
  const steps = Math.max(4, Math.ceil((Math.abs(dTheta) * 180) / Math.PI / ARC_STEP_DEG))
  for (let i = 1; i <= steps; i++) {
    const theta = theta1 + (dTheta * i) / steps
    const cosT = Math.cos(theta)
    const sinT = Math.sin(theta)
    add(cosPhi * (rx * cosT) - sinPhi * (ry * sinT) + cxc, sinPhi * (rx * cosT) + cosPhi * (ry * sinT) + cyc)
  }
}

const polylineFromSegments = (segments: PathSegment[]): ParsedPath => {
  const points: Point[] = []
  let closed = false
  let cx = 0
  let cy = 0
  let startX = 0
  let startY = 0
  // Reflected-control trackers for smooth-curve commands: S reflects the
  // previous C/S control2; T reflects the previous Q/T control. Any other
  // command resets them so the next S/T falls back to the current point.
  let lastCubicCtrl: Point | null = null
  let lastQuadCtrl: Point | null = null
  const add: AddPoint = (x, y) => {
    points.push([x, y])
    cx = x
    cy = y
  }

  for (const seg of segments) {
    const upper = seg.cmd.toUpperCase()
    const rel = seg.cmd !== upper
    const args = seg.args
    if (upper === 'M') {
      if (args.length < 2) continue
      const x = rel && points.length > 0 ? cx + args[0] : args[0]
      const y = rel && points.length > 0 ? cy + args[1] : args[1]
      add(x, y)
      startX = x
      startY = y
      let k = 2
      while (k + 1 < args.length) {
        const lx = rel ? cx + args[k] : args[k]
        const ly = rel ? cy + args[k + 1] : args[k + 1]
        add(lx, ly)
        k += 2
      }
      lastCubicCtrl = null
      lastQuadCtrl = null
    } else if (upper === 'L') {
      let k = 0
      while (k + 1 < args.length) {
        const x = rel ? cx + args[k] : args[k]
        const y = rel ? cy + args[k + 1] : args[k + 1]
        add(x, y)
        k += 2
      }
      lastCubicCtrl = null
      lastQuadCtrl = null
    } else if (upper === 'H') {
      for (const v of args) add(rel ? cx + v : v, cy)
      lastCubicCtrl = null
      lastQuadCtrl = null
    } else if (upper === 'V') {
      for (const v of args) add(cx, rel ? cy + v : v)
      lastCubicCtrl = null
      lastQuadCtrl = null
    } else if (upper === 'C') {
      let k = 0
      while (k + 5 < args.length) {
        const c1x = rel ? cx + args[k] : args[k]
        const c1y = rel ? cy + args[k + 1] : args[k + 1]
        const c2x = rel ? cx + args[k + 2] : args[k + 2]
        const c2y = rel ? cy + args[k + 3] : args[k + 3]
        const x = rel ? cx + args[k + 4] : args[k + 4]
        const y = rel ? cy + args[k + 5] : args[k + 5]
        sampleCubic(cx, cy, c1x, c1y, c2x, c2y, x, y, add)
        lastCubicCtrl = [c2x, c2y]
        k += 6
      }
      lastQuadCtrl = null
    } else if (upper === 'S') {
      let k = 0
      while (k + 3 < args.length) {
        const c1x = lastCubicCtrl ? 2 * cx - lastCubicCtrl[0] : cx
        const c1y = lastCubicCtrl ? 2 * cy - lastCubicCtrl[1] : cy
        const c2x = rel ? cx + args[k] : args[k]
        const c2y = rel ? cy + args[k + 1] : args[k + 1]
        const x = rel ? cx + args[k + 2] : args[k + 2]
        const y = rel ? cy + args[k + 3] : args[k + 3]
        sampleCubic(cx, cy, c1x, c1y, c2x, c2y, x, y, add)
        lastCubicCtrl = [c2x, c2y]
        k += 4
      }
      lastQuadCtrl = null
    } else if (upper === 'Q') {
      let k = 0
      while (k + 3 < args.length) {
        const c1x = rel ? cx + args[k] : args[k]
        const c1y = rel ? cy + args[k + 1] : args[k + 1]
        const x = rel ? cx + args[k + 2] : args[k + 2]
        const y = rel ? cy + args[k + 3] : args[k + 3]
        sampleQuadratic(cx, cy, c1x, c1y, x, y, add)
        lastQuadCtrl = [c1x, c1y]
        k += 4
      }
      lastCubicCtrl = null
    } else if (upper === 'T') {
      let k = 0
      while (k + 1 < args.length) {
        const c1x: number = lastQuadCtrl ? 2 * cx - lastQuadCtrl[0] : cx
        const c1y: number = lastQuadCtrl ? 2 * cy - lastQuadCtrl[1] : cy
        const x = rel ? cx + args[k] : args[k]
        const y = rel ? cy + args[k + 1] : args[k + 1]
        sampleQuadratic(cx, cy, c1x, c1y, x, y, add)
        lastQuadCtrl = [c1x, c1y]
        k += 2
      }
      lastCubicCtrl = null
    } else if (upper === 'A') {
      let k = 0
      while (k + 6 < args.length) {
        const rx = args[k]
        const ry = args[k + 1]
        const xRot = (args[k + 2] * Math.PI) / 180
        const large = args[k + 3] !== 0
        const sweep = args[k + 4] !== 0
        const x = rel ? cx + args[k + 5] : args[k + 5]
        const y = rel ? cy + args[k + 6] : args[k + 6]
        sampleArc(cx, cy, x, y, rx, ry, xRot, large, sweep, add)
        k += 7
      }
      lastCubicCtrl = null
      lastQuadCtrl = null
    } else if (upper === 'Z') {
      closed = true
      cx = startX
      cy = startY
      lastCubicCtrl = null
      lastQuadCtrl = null
    }
  }

  // A `... L start Z` pattern leaves the start vertex duplicated at the end —
  // drop it so the closed polygon doesn't carry a zero-length edge.
  if (closed && points.length >= 2) {
    const a = points[0]
    const b = points[points.length - 1]
    if (Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6) points.pop()
  }

  return { points, closed, bezierOverride: 0 }
}

/**
 * Parse an SVG `d` attribute into editable shape data. First tries to
 * recognize VCT7's own emit pattern (so our exports re-import losslessly,
 * including the per-corner bezier `t`); falls back to a generic polyline
 * extraction when the structure doesn't match — cubic / quadratic / arc
 * segments are flattened into sampled vertices there so the imported
 * silhouette tracks the foreign curves.
 */
export const parsePathD = (d: string): ParsedPath => {
  const segments = parsePathSegments(d)
  return recoverVCT7Polygon(segments) ?? polylineFromSegments(segments)
}

export const parsePointsAttr = (raw: string): Point[] => {
  const nums = (raw.match(NUM_RE) ?? []).map(Number).filter(Number.isFinite)
  const out: Point[] = []
  for (let i = 0; i + 1 < nums.length; i += 2) out.push([nums[i], nums[i + 1]])
  return out
}

const NON_RENDERED_TAGS = new Set(['defs', 'clippath', 'mask', 'pattern', 'symbol', 'marker'])

/**
 * Whether `el` lives inside a non-rendered SVG container (`<defs>`, `<clipPath>`,
 * `<mask>`, …). Such elements are templates / paint references, not visible
 * shapes, so the importer skips them.
 */
export const isInsideNonRenderedAncestor = (el: Element, root: Element): boolean => {
  let cur: Element | null = el.parentElement
  while (cur && cur !== root) {
    if (NON_RENDERED_TAGS.has(cur.tagName.toLowerCase())) return true
    cur = cur.parentElement
  }
  return false
}

const LINEJOIN_OPTS: ReadonlySet<string> = new Set(['miter', 'round', 'bevel'])
const LINECAP_OPTS: ReadonlySet<string> = new Set(['butt', 'round', 'square'])
const BLEND_MODE_OPTS: ReadonlySet<string> = new Set(BLEND_MODES)
const BLEND_RE = /mix-blend-mode\s*:\s*([\w-]+)/

export interface FreshShapeData {
  kind?: 'circle' | 'path'
  points: Point[]
  closed: boolean
  fill: string
  stroke: string
  strokeWidth: number
  hidden: boolean
  /**
   * Layer-level bezier rounding. `0` for primitives that have no curvature
   * (circle / rect / line / polygon / polyline) and for foreign paths whose
   * structure didn't match VCT7's emit; the recovered `t` for paths that did.
   */
  bezierOverride: number
  pointBezierOverrides?: Record<number, number>
  strokeLinejoin?: StrokeLinejoin
  strokeLinecap?: StrokeLinecap
  strokeDasharray?: string
  paintOrder?: 'stroke'
  opacity?: number
  blendMode?: BlendMode
}

/**
 * Derive editable shape data from a native SVG element. Returns null when the
 * element can't be imported (malformed numeric attrs, unsupported tag,
 * degenerate geometry). Composes ancestor `transform` chains and bakes the
 * resulting matrix into the points so the imported shape renders at its
 * original on-canvas location without inheriting the transform attribute.
 *
 * The caller is expected to assign `id`, `bezierOverride: 0`, and
 * `locked: false` to produce a complete {@link Shape}.
 */
export const importFreshShape = (el: Element, root: Element): FreshShapeData | null => {
  const tag = el.tagName.toLowerCase()
  const m = combinedMatrix(el, root)

  let points: Point[] = []
  let closed = false
  let kind: FreshShapeData['kind']
  let bezierOverride = 0
  let pointBezierOverrides: Record<number, number> | undefined

  if (tag === 'circle') {
    const cx = parseFloat(el.getAttribute('cx') ?? '0')
    const cy = parseFloat(el.getAttribute('cy') ?? '0')
    const r = parseFloat(el.getAttribute('r') ?? '')
    if (![cx, cy, r].every(Number.isFinite) || r <= 0) return null
    // The shape model stores center + perimeter anchor; transform both so
    // a translated/rotated circle keeps its on-canvas position. Non-uniform
    // scale would distort to an ellipse — we lose that and keep it circular,
    // measuring the radius from the transformed perimeter point.
    points = [applyMatrix(m, [cx, cy]), applyMatrix(m, [cx + r, cy])]
    kind = 'circle'
    closed = true
  } else if (tag === 'path') {
    const d = el.getAttribute('d')
    if (!d) return null
    const parsed = parsePathD(d)
    if (parsed.points.length < 2) return null
    points = parsed.points.map(p => applyMatrix(m, p))
    closed = parsed.closed
    bezierOverride = parsed.bezierOverride
    pointBezierOverrides = parsed.pointBezierOverrides
  } else if (tag === 'rect') {
    const x = parseFloat(el.getAttribute('x') ?? '0')
    const y = parseFloat(el.getAttribute('y') ?? '0')
    const w = parseFloat(el.getAttribute('width') ?? '')
    const h = parseFloat(el.getAttribute('height') ?? '')
    if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) return null
    points = [
      applyMatrix(m, [x, y]),
      applyMatrix(m, [x + w, y]),
      applyMatrix(m, [x + w, y + h]),
      applyMatrix(m, [x, y + h]),
    ]
    closed = true
  } else if (tag === 'line') {
    const x1 = parseFloat(el.getAttribute('x1') ?? '0')
    const y1 = parseFloat(el.getAttribute('y1') ?? '0')
    const x2 = parseFloat(el.getAttribute('x2') ?? '0')
    const y2 = parseFloat(el.getAttribute('y2') ?? '0')
    if (![x1, y1, x2, y2].every(Number.isFinite)) return null
    points = [applyMatrix(m, [x1, y1]), applyMatrix(m, [x2, y2])]
    closed = false
  } else if (tag === 'polygon' || tag === 'polyline') {
    const raw = el.getAttribute('points')
    if (!raw) return null
    const pts = parsePointsAttr(raw)
    if (pts.length < 2) return null
    points = pts.map(p => applyMatrix(m, p))
    closed = tag === 'polygon'
  } else {
    return null
  }

  const fill = el.getAttribute('fill') ?? (closed ? '#000000' : 'none')
  const stroke = el.getAttribute('stroke') ?? 'none'
  const strokeWidthRaw = parseFloat(el.getAttribute('stroke-width') ?? '')
  const strokeWidth = Number.isFinite(strokeWidthRaw) ? strokeWidthRaw : 2
  const linejoinAttr = el.getAttribute('stroke-linejoin')
  const strokeLinejoin: StrokeLinejoin | undefined =
    linejoinAttr && LINEJOIN_OPTS.has(linejoinAttr) && linejoinAttr !== 'round'
      ? (linejoinAttr as StrokeLinejoin)
      : undefined
  const linecapAttr = el.getAttribute('stroke-linecap')
  const strokeLinecap: StrokeLinecap | undefined =
    linecapAttr && LINECAP_OPTS.has(linecapAttr) && linecapAttr !== 'round' ? (linecapAttr as StrokeLinecap) : undefined
  const dashAttr = el.getAttribute('stroke-dasharray')
  const strokeDasharray = dashAttr && dashAttr.trim() !== '' && dashAttr.trim() !== 'none' ? dashAttr.trim() : undefined
  const paintOrderRaw = el.getAttribute('paint-order')?.trim().toLowerCase() ?? ''
  const paintOrder: 'stroke' | undefined = paintOrderRaw.startsWith('stroke') ? 'stroke' : undefined
  const opacityRaw = parseFloat(el.getAttribute('opacity') ?? '')
  const opacity = Number.isFinite(opacityRaw) && opacityRaw < 1 ? Math.max(0, Math.min(1, opacityRaw)) : undefined
  const hidden = el.getAttribute('visibility') === 'hidden'
  // VCT7 emits `style="mix-blend-mode:..."` alongside `data-v7-blend` so foreign
  // viewers honor the blending — pick it up here so a re-imported export
  // preserves the blend mode.
  let blendMode: BlendMode | undefined
  const styleAttr = el.getAttribute('style') ?? ''
  const blendMatch = styleAttr.match(BLEND_RE)
  if (blendMatch && BLEND_MODE_OPTS.has(blendMatch[1]) && blendMatch[1] !== 'normal') {
    blendMode = blendMatch[1] as BlendMode
  }

  return {
    ...(kind ? { kind } : {}),
    points,
    closed,
    fill,
    stroke,
    strokeWidth,
    hidden,
    bezierOverride,
    ...(pointBezierOverrides ? { pointBezierOverrides } : {}),
    ...(strokeLinejoin ? { strokeLinejoin } : {}),
    ...(strokeLinecap ? { strokeLinecap } : {}),
    ...(strokeDasharray ? { strokeDasharray } : {}),
    ...(paintOrder ? { paintOrder } : {}),
    ...(opacity !== undefined ? { opacity } : {}),
    ...(blendMode ? { blendMode } : {}),
  }
}
