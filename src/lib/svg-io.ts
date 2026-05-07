import { BLEND_MODES, EASINGS, STROKE_LINECAPS, STROKE_LINEJOINS } from '../types'
import { animationHasPaint, animationHasSpin, buildKeyframesStyle } from './animation'
import { arcToPath, dist, fmt, isPartialArc, pointsToPath } from './geometry'
import { importFreshShape, isInsideNonRenderedAncestor, pickDominantT } from './svg-import'
import {
  composeTransformString,
  groupBBoxCenter,
  pairBBoxCenter,
  reflectShape,
  shapeRotation,
  shapeScale,
  transformAroundString,
} from './transform'

import type {
  AnimationFromState,
  AnimationSpec,
  ArcRange,
  BlendMode,
  Easing,
  GlyphData,
  Group,
  MirrorAxis,
  PaletteColor,
  Point,
  ProjectSettings,
  Shape,
  SpinSpec,
  StrokeLinecap,
  StrokeLinejoin,
} from '../types'

const ARC_STYLES: ReadonlySet<ArcRange['style']> = new Set(['wedge', 'chord', 'open'])
const BLEND_MODE_SET: ReadonlySet<string> = new Set(BLEND_MODES)
const EASING_SET: ReadonlySet<string> = new Set(EASINGS)
const LINEJOIN_SET: ReadonlySet<string> = new Set(STROKE_LINEJOINS)
const LINECAP_SET: ReadonlySet<string> = new Set(STROKE_LINECAPS)

/** Coerce an unknown value to a finite number, defaulting to undefined. */
const numOpt = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

/**
 * Decode a `data-v7-anim` JSON blob back into an {@link AnimationSpec},
 * tolerating malformed input by returning undefined (in which case the shape
 * loads as a non-animated rest pose). Numeric fields are guarded with
 * `Number.isFinite` so a stray `NaN` slips into a missing-channel undefined.
 */
const HEX_COLOR = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i
const colorOpt = (v: unknown): string | undefined => (typeof v === 'string' && HEX_COLOR.test(v) ? v : undefined)

const parseAnimationAttr = (raw: string | null): AnimationSpec | undefined => {
  if (!raw) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return undefined
  }
  if (!parsed || typeof parsed !== 'object') return undefined
  const obj = parsed as Record<string, unknown>
  const duration = typeof obj.duration === 'number' ? obj.duration : NaN
  const delay = typeof obj.delay === 'number' ? obj.delay : 0
  const easingRaw = typeof obj.easing === 'string' ? obj.easing : ''
  // `dr-classic` was the historic name for `snap` (same curve, renamed in
  // commit ed94daf). Map it through so older files round-trip instead of
  // silently dropping their animations.
  const easing = easingRaw === 'dr-classic' ? 'snap' : easingRaw
  if (!Number.isFinite(duration) || duration < 0) return undefined
  if (!EASING_SET.has(easing)) return undefined
  const fromRaw = obj.from && typeof obj.from === 'object' ? (obj.from as Record<string, unknown>) : {}
  const from: AnimationFromState = {
    opacity: numOpt(fromRaw.opacity),
    rotation: numOpt(fromRaw.rotation),
    scale: numOpt(fromRaw.scale),
    translateX: numOpt(fromRaw.translateX),
    translateY: numOpt(fromRaw.translateY),
    fill: colorOpt(fromRaw.fill),
    stroke: colorOpt(fromRaw.stroke),
  }
  // Strip undefined keys so the in-memory shape stays compact.
  const compactFrom: AnimationFromState = {}
  if (from.opacity !== undefined) compactFrom.opacity = from.opacity
  if (from.rotation !== undefined) compactFrom.rotation = from.rotation
  if (from.scale !== undefined) compactFrom.scale = from.scale
  if (from.translateX !== undefined) compactFrom.translateX = from.translateX
  if (from.translateY !== undefined) compactFrom.translateY = from.translateY
  if (from.fill !== undefined) compactFrom.fill = from.fill
  if (from.stroke !== undefined) compactFrom.stroke = from.stroke
  let spin: SpinSpec | undefined
  if (obj.spin && typeof obj.spin === 'object') {
    const spinRaw = obj.spin as Record<string, unknown>
    const speed = numOpt(spinRaw.speed)
    const startOffset = numOpt(spinRaw.startOffset) ?? 0
    if (speed !== undefined && speed !== 0) spin = { speed, startOffset }
  }
  return {
    duration,
    delay: Number.isFinite(delay) && delay >= 0 ? delay : 0,
    easing: easing as Easing,
    from: compactFrom,
    ...(spin ? { spin } : {}),
  }
}

/**
 * JSON-encode an {@link AnimationSpec} for storage on the shape element.
 * Channels left undefined are omitted so the saved file stays tidy. Reading
 * is via {@link parseAnimationAttr} which tolerates the omissions.
 */
const animationToAttr = (anim: AnimationSpec): string => {
  const from: Record<string, number | string> = {}
  if (anim.from.opacity !== undefined) from.opacity = anim.from.opacity
  if (anim.from.rotation !== undefined) from.rotation = anim.from.rotation
  if (anim.from.scale !== undefined) from.scale = anim.from.scale
  if (anim.from.translateX !== undefined) from.translateX = anim.from.translateX
  if (anim.from.translateY !== undefined) from.translateY = anim.from.translateY
  if (anim.from.fill !== undefined) from.fill = anim.from.fill
  if (anim.from.stroke !== undefined) from.stroke = anim.from.stroke
  return JSON.stringify({
    duration: anim.duration,
    delay: anim.delay,
    easing: anim.easing,
    from,
    ...(anim.spin && anim.spin.speed !== 0 ? { spin: anim.spin } : {}),
  })
}

/**
 * Reconstruct a {@link GlyphData} payload from a serialized `<path>`. The path
 * carries both the local-coord `d` (as the path's `d` attribute) and the
 * vct7 metadata that captures the original text + font label + bbox so
 * the shape round-trips. Returns undefined when required attrs are missing.
 */
const parseGlyphsAttrs = (el: Element): GlyphData | undefined => {
  const d = el.getAttribute('d')
  if (!d) return undefined
  const text = el.getAttribute('data-v7-text') ?? ''
  const fontFamily = el.getAttribute('data-v7-font-family') ?? ''
  const fontSize = parseFloat(el.getAttribute('data-v7-font-size') ?? '')
  const width = parseFloat(el.getAttribute('data-v7-glyph-w') ?? '')
  const height = parseFloat(el.getAttribute('data-v7-glyph-h') ?? '')
  if (!Number.isFinite(fontSize) || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return undefined
  }
  return { d, text, fontFamily, fontSize, width, height }
}

const parsePointBezierAttr = (raw: string | null): Record<number, number> | undefined => {
  if (!raw) return undefined
  const out: Record<number, number> = {}
  for (const entry of raw.split(',')) {
    const idx = entry.indexOf(':')
    if (idx <= 0) continue
    const k = parseInt(entry.slice(0, idx), 10)
    const v = parseFloat(entry.slice(idx + 1))
    if (!Number.isFinite(k) || k < 0) continue
    if (!Number.isFinite(v)) continue
    out[k] = v
  }
  return Object.keys(out).length > 0 ? out : undefined
}

const parseMirrorAxisAttr = (raw: string | null): MirrorAxis | undefined => {
  if (!raw) return undefined
  const parts = raw.split(',').map(s => parseFloat(s.trim()))
  if (parts.length !== 3 || !parts.every(Number.isFinite)) return undefined
  return { x: parts[0], y: parts[1], angle: parts[2] }
}

const parseArcAttr = (raw: string | null): ArcRange | undefined => {
  if (!raw) return undefined
  const parts = raw.split(',').map(s => s.trim())
  if (parts.length !== 3) return undefined
  const start = parseFloat(parts[0])
  const end = parseFloat(parts[1])
  const style = parts[2] as ArcRange['style']
  if (!Number.isFinite(start) || !Number.isFinite(end) || !ARC_STYLES.has(style)) return undefined
  return { start, end, style }
}

export const DEFAULT_SETTINGS: ProjectSettings = {
  snapAngles: [0, 45, 90, 135, 180, 225, 270, 315],
  bezier: 0.5,
  palette: [],
  bg: null,
  width: 100,
  height: 100,
  viewBoxX: 0,
  viewBoxY: 0,
  viewBoxWidth: 100,
  viewBoxHeight: 100,
  gridSize: 5,
  gridVisible: false,
  gridSnap: true,
  clip: false,
  animationEnabled: false,
}

/**
 * Encode the palette as a single attribute value: `name:#rrggbb;name2:#rrggbb`.
 * Names are restricted by the UI to characters that don't conflict with the
 * delimiters, so a simple split-based decoder is sufficient.
 */
const serializePalette = (palette: PaletteColor[]): string =>
  palette
    .filter(p => p.name)
    .map(p => `${p.name}:${p.color}`)
    .join(';')

const PALETTE_NAME_RE = /^[A-Za-z0-9_-][A-Za-z0-9_ -]*$/

/**
 * Encode the group list. Plain `id:name;id2:name2` is used when no group has
 * a transform or animation (keeps legacy files diff-clean); JSON is used as
 * soon as any group carries extra state. The parser sniffs the leading
 * character to pick the right decoder, so older files round-trip unchanged.
 */
const serializeGroups = (groups: Group[]): string => {
  const valid = groups.filter(g => g.id && g.name)
  const needsJson = valid.some(g => g.rotation !== undefined || g.scale !== undefined || g.animation !== undefined)
  if (!needsJson) {
    return valid.map(g => `${g.id}:${g.name}`).join(';')
  }
  const payload = valid.map(g => {
    const entry: Record<string, unknown> = { id: g.id, name: g.name }
    if (g.rotation !== undefined && g.rotation !== 0) entry.rotation = g.rotation
    if (g.scale !== undefined && g.scale !== 1) entry.scale = g.scale
    if (g.animation) entry.animation = g.animation
    return entry
  })
  return JSON.stringify(payload)
}

const parseGroups = (raw: string | null): Group[] => {
  if (!raw) return []
  const trimmed = raw.trim()
  if (trimmed.startsWith('[')) {
    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      return []
    }
    if (!Array.isArray(parsed)) return []
    const out: Group[] = []
    const seen = new Set<string>()
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue
      const obj = item as Record<string, unknown>
      const id = typeof obj.id === 'string' ? obj.id.trim() : ''
      const name = typeof obj.name === 'string' ? obj.name.trim() : ''
      if (!id || !name || seen.has(id)) continue
      if (!PALETTE_NAME_RE.test(name)) continue
      seen.add(id)
      const g: Group = { id, name }
      if (typeof obj.rotation === 'number' && Number.isFinite(obj.rotation) && obj.rotation !== 0) {
        g.rotation = obj.rotation
      }
      if (typeof obj.scale === 'number' && Number.isFinite(obj.scale) && obj.scale !== 1) {
        g.scale = obj.scale
      }
      // Animation reuses the per-shape parser via JSON.stringify round-trip,
      // since JSON.parse already decoded the inner object — re-encode and
      // hand it off so all the field validation lives in one place.
      if (obj.animation && typeof obj.animation === 'object') {
        const anim = parseAnimationAttr(JSON.stringify(obj.animation))
        if (anim) g.animation = anim
      }
      out.push(g)
    }
    return out
  }
  // Legacy `id:name;id2:name2` form — preserved so files saved before
  // transforms/animations were added round-trip without diff churn.
  const out: Group[] = []
  const seen = new Set<string>()
  for (const entry of trimmed.split(';')) {
    const idx = entry.indexOf(':')
    if (idx <= 0) continue
    const id = entry.slice(0, idx).trim()
    const name = entry.slice(idx + 1).trim()
    if (!id || seen.has(id) || !name) continue
    if (!PALETTE_NAME_RE.test(name)) continue
    seen.add(id)
    out.push({ id, name })
  }
  return out
}

const parsePalette = (raw: string | null): PaletteColor[] => {
  if (!raw) return []
  const out: PaletteColor[] = []
  const seen = new Set<string>()
  for (const entry of raw.split(';')) {
    const idx = entry.indexOf(':')
    if (idx <= 0) continue
    const name = entry.slice(0, idx).trim()
    const color = entry.slice(idx + 1).trim()
    if (!name || seen.has(name)) continue
    if (!PALETTE_NAME_RE.test(name)) continue
    if (!HEX_COLOR.test(color)) continue
    seen.add(name)
    out.push({ name, color })
  }
  return out
}

const escapeAttr = (v: string): string => v.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;')

const animationEmitsPaint = (shape: Shape, settings: ProjectSettings): boolean =>
  settings.animationEnabled && !!shape.animation && animationHasPaint(shape)

/**
 * Compose `translate(C) rotate(r) scale(sc) translate(-C)` with an explicit
 * pivot. Mirror siblings need this because they have no `mirror` field of
 * their own (we strip it on `reflectShape` to break recursion), so calling
 * `composeTransformString` on the reflected shape would pick the reflection's
 * own bbox center instead of the combined pair pivot we actually want.
 */
const transformStringAround = (rot: number, scl: number, cx: number, cy: number): string => {
  if (rot === 0 && scl === 1) return ''
  return (
    `translate(${fmt(cx)} ${fmt(cy)}) ` +
    `rotate(${fmt(rot)}) scale(${fmt(scl)}) ` +
    `translate(${fmt(-cx)} ${fmt(-cy)})`
  )
}

/**
 * Build a render-only `<path>` / `<circle>` for the source's mirror copy. The
 * sibling carries paint attributes (so external viewers render both halves),
 * `data-v7-mirror-of` so on parse we recognize and skip it (the source's axis
 * metadata is the authoritative source for the live mirror), and the same
 * paint-animation class as the source so a per-shape color animation runs on
 * both halves in sync. No `data-v7-points` — the parser's shape loop bails
 * on missing points before considering this element.
 */
const buildMirrorSibling = (source: Shape, settings: ProjectSettings, emitsPaint: boolean): string | null => {
  if (!source.mirror) return null
  const reflected = reflectShape(source, source.mirror.axis)
  const isCircle = reflected.kind === 'circle' && reflected.points.length >= 2
  const partialArc = isCircle && isPartialArc(reflected.arc) ? reflected.arc : undefined
  const filled = partialArc ? partialArc.style !== 'open' : reflected.closed
  const hasStroke = reflected.stroke !== 'none'

  const attrs: string[] = []
  attrs.push(`fill="${escapeAttr(filled ? reflected.fill : 'none')}"`)
  if (hasStroke) {
    attrs.push(`stroke="${escapeAttr(reflected.stroke)}"`, `stroke-width="${fmt(reflected.strokeWidth)}"`)
    const isPathElement = !isCircle || !!partialArc
    if (isPathElement) {
      const linejoin = reflected.strokeLinejoin ?? 'round'
      const linecap = reflected.strokeLinecap ?? 'round'
      attrs.push(`stroke-linejoin="${linejoin}"`, `stroke-linecap="${linecap}"`)
    }
    const dash = reflected.strokeDasharray?.trim()
    if (dash) attrs.push(`stroke-dasharray="${escapeAttr(dash)}"`)
    if (reflected.paintOrder === 'stroke') attrs.push(`paint-order="stroke"`)
  }
  if (reflected.hidden) attrs.push(`visibility="hidden"`)
  if (reflected.blendMode && reflected.blendMode !== 'normal') {
    attrs.push(`style="mix-blend-mode:${reflected.blendMode}"`)
  }
  if (reflected.opacity !== undefined && reflected.opacity < 1) {
    attrs.push(`opacity="${fmt(Math.max(0, reflected.opacity))}"`)
  }
  attrs.push(`data-v7-mirror-of="${escapeAttr(source.id)}"`)
  if (emitsPaint) attrs.push(`class="vh-anim-${source.id}-paint"`)

  // Use the source's combined pair pivot for the reflection's transform so
  // both halves rotate/scale around the same center.
  const rot = shapeRotation(source)
  const scl = shapeScale(source)
  const [cx, cy] = pairBBoxCenter(source)
  const composed = transformStringAround(rot, scl, cx, cy)
  const transformAttr = composed ? ` transform="${composed}"` : ''

  if (isCircle && !partialArc) {
    const [rcx, rcy] = reflected.points[0]
    const r = dist(reflected.points[0], reflected.points[1])
    return `<circle cx="${fmt(rcx)}" cy="${fmt(rcy)}" r="${fmt(r)}"${transformAttr} ${attrs.join(' ')}/>`
  }
  if (isCircle && partialArc) {
    const [rcx, rcy] = reflected.points[0]
    const r = dist(reflected.points[0], reflected.points[1])
    const d = arcToPath(rcx, rcy, r, partialArc)
    return `<path d="${d}"${transformAttr} ${attrs.join(' ')}/>`
  }
  const bz = reflected.bezierOverride ?? settings.bezier
  const d = pointsToPath(reflected.points, reflected.closed, bz, reflected.pointBezierOverrides)
  return `<path d="${d}"${transformAttr} ${attrs.join(' ')}/>`
}

let nextId = 1
export const makeId = (): string => `s${nextId++}`
export const resetIds = (n = 1): void => {
  nextId = n
}

/**
 * Strip every `data-v7-*` attribute from a serialized SVG so the file becomes
 * a plain SVG with no VCT7 round-trip metadata. Used by Export. Attribute
 * values can't contain unescaped `"` (see {@link escapeAttr}), so a simple
 * whitespace-anchored regex is sufficient.
 */
export const stripV7Attributes = (svg: string): string => svg.replaceAll(/\s+data-v7-[\w-]+="[^"]*"/g, '')

export function serializeProject(settings: ProjectSettings, shapes: Shape[], groups: Group[] = []): string {
  const lines: string[] = []
  lines.push('<?xml version="1.0" encoding="UTF-8"?>')
  const vbX = settings.viewBoxX
  const vbY = settings.viewBoxY
  const vbW = settings.viewBoxWidth
  const vbH = settings.viewBoxHeight
  lines.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${fmt(vbX)} ${fmt(vbY)} ${fmt(vbW)} ${fmt(
      vbH,
    )}" width="${fmt(settings.width)}" height="${fmt(settings.height)}"` +
      ` data-v7-snap-angles="${escapeAttr(settings.snapAngles.join(','))}"` +
      ` data-v7-bezier="${fmt(settings.bezier)}"` +
      (settings.bg === null ? ` data-v7-no-bg="true"` : ` data-v7-bg="${escapeAttr(settings.bg)}"`) +
      (settings.bgRef ? ` data-v7-bg-ref="${escapeAttr(settings.bgRef)}"` : '') +
      (settings.palette.length > 0 ? ` data-v7-palette="${escapeAttr(serializePalette(settings.palette))}"` : '') +
      (groups.length > 0 ? ` data-v7-groups="${escapeAttr(serializeGroups(groups))}"` : '') +
      ` data-v7-grid-size="${fmt(settings.gridSize)}"` +
      ` data-v7-grid-visible="${settings.gridVisible}"` +
      ` data-v7-grid-snap="${settings.gridSnap}"` +
      ` data-v7-clip="${settings.clip}"` +
      (settings.animationEnabled ? ` data-v7-animation-enabled="true"` : '') +
      `>`,
  )

  // Animation CSS is emitted only when enabled — turning the project switch
  // off removes every animation byte from the saved file, matching the
  // "nothing animation related" requirement.
  if (settings.animationEnabled) {
    const style = buildKeyframesStyle(shapes, groups)
    if (style) {
      lines.push(`  <style>${style}</style>`)
    }
  }
  if (settings.bg !== null) {
    lines.push(
      `  <rect x="${fmt(vbX)}" y="${fmt(vbY)}" width="${fmt(vbW)}" height="${fmt(
        vbH,
      )}" fill="${escapeAttr(settings.bg)}"/>`,
    )
  }
  if (settings.clip) {
    lines.push(
      `  <defs><clipPath id="vh-artboard-clip"><rect x="${fmt(vbX)}" y="${fmt(vbY)}" width="${fmt(
        vbW,
      )}" height="${fmt(vbH)}"/></clipPath></defs>`,
    )
    lines.push(`  <g clip-path="url(#vh-artboard-clip)">`)
  }
  // Track the currently-open group wrapper so contiguous members of the same
  // group end up inside one `<g>` element. The wrapper carries the static
  // group transform (rotation/scale around the bbox center) and, when an
  // entrance animation is set, the matching `vh-anim-group-*` class so the
  // CSS keyframe rule binds to it.
  const groupById = new Map<string, Group>()
  for (const g of groups) groupById.set(g.id, g)
  let openGroupId: string | undefined
  const closeOpenGroup = () => {
    if (openGroupId !== undefined) {
      lines.push(`  </g>`)
      openGroupId = undefined
    }
  }
  const openGroup = (groupId: string) => {
    const g = groupById.get(groupId)
    const members = shapes.filter(sh => sh.groupId === groupId)
    const [cx, cy] = members.length > 0 ? groupBBoxCenter(members) : [0, 0]
    const rot = g?.rotation ?? 0
    const scl = g?.scale ?? 1
    const tStr = transformAroundString(rot, scl, cx, cy)
    const transformAttr = tStr ? ` transform="${tStr}"` : ''
    const animClass = settings.animationEnabled && g?.animation ? ` vh-anim-group-${groupId}` : ''
    lines.push(
      `  <g class="vh-group-${escapeAttr(groupId)}${animClass}"${transformAttr} data-v7-group-id="${escapeAttr(groupId)}">`,
    )
    openGroupId = groupId
  }
  for (const shape of shapes) {
    if (shape.groupId !== openGroupId) {
      closeOpenGroup()
      if (shape.groupId !== undefined && groupById.has(shape.groupId)) openGroup(shape.groupId)
    }
    const isGlyphs = shape.kind === 'glyphs' && !!shape.glyphs && shape.points.length >= 2
    const isCircle = !isGlyphs && shape.kind === 'circle' && shape.points.length >= 2
    const partialArc = isCircle && isPartialArc(shape.arc) ? shape.arc : undefined
    const filled = partialArc ? partialArc.style !== 'open' : shape.closed
    const hasStroke = shape.stroke !== 'none'
    const baseAttrs = [`fill="${escapeAttr(filled ? shape.fill : 'none')}"`]
    if (hasStroke) {
      baseAttrs.push(`stroke="${escapeAttr(shape.stroke)}"`, `stroke-width="${fmt(shape.strokeWidth)}"`)
      // linejoin / linecap apply to <path> elements (paths, glyphs, partial
      // arcs). Full <circle> has no joins or caps to style — skip the attrs
      // to keep the file tidy.
      const isPathElement = !isCircle || !!partialArc
      if (isPathElement) {
        const linejoin = shape.strokeLinejoin ?? 'round'
        const linecap = shape.strokeLinecap ?? 'round'
        baseAttrs.push(`stroke-linejoin="${linejoin}"`, `stroke-linecap="${linecap}"`)
      }
      const dash = shape.strokeDasharray?.trim()
      if (dash) {
        baseAttrs.push(`stroke-dasharray="${escapeAttr(dash)}"`)
      }
      if (shape.paintOrder === 'stroke') {
        baseAttrs.push(`paint-order="stroke"`)
      }
    }
    if (shape.hidden) baseAttrs.push(`visibility="hidden"`)
    baseAttrs.push(
      `data-v7-points="${shape.points.map(p => `${fmt(p[0])},${fmt(p[1])}`).join(' ')}"`,
      `data-v7-closed="${shape.closed}"`,
    )
    if (isCircle) baseAttrs.push(`data-v7-kind="circle"`)
    if (isGlyphs && shape.glyphs) {
      const g = shape.glyphs
      baseAttrs.push(
        `data-v7-kind="glyphs"`,
        `data-v7-text="${escapeAttr(g.text)}"`,
        `data-v7-font-family="${escapeAttr(g.fontFamily)}"`,
        `data-v7-font-size="${fmt(g.fontSize)}"`,
        `data-v7-glyph-w="${fmt(g.width)}"`,
        `data-v7-glyph-h="${fmt(g.height)}"`,
      )
    }
    if (partialArc) {
      baseAttrs.push(`data-v7-arc="${fmt(partialArc.start)},${fmt(partialArc.end)},${partialArc.style}"`)
    }
    if (!isCircle && shape.bezierOverride !== null) {
      baseAttrs.push(`data-v7-bezier="${fmt(shape.bezierOverride)}"`)
    }
    if (!isCircle && !isGlyphs && shape.pointBezierOverrides) {
      const entries = Object.entries(shape.pointBezierOverrides)
        .map(([k, v]) => [Number(k), v] as const)
        .filter(([k, v]) => Number.isFinite(k) && Number.isFinite(v))
        .toSorted(([a], [b]) => a - b)
        .map(([k, v]) => `${k}:${fmt(v)}`)
        .join(',')
      if (entries) baseAttrs.push(`data-v7-point-bezier="${entries}"`)
    }
    if (shape.hidden) baseAttrs.push(`data-v7-hidden="true"`)
    if (shape.locked) baseAttrs.push(`data-v7-locked="true"`)
    if (shape.name) baseAttrs.push(`data-v7-name="${escapeAttr(shape.name)}"`)
    if (shape.fillRef) baseAttrs.push(`data-v7-fill-ref="${escapeAttr(shape.fillRef)}"`)
    if (shape.strokeRef) baseAttrs.push(`data-v7-stroke-ref="${escapeAttr(shape.strokeRef)}"`)
    if (shape.groupId) baseAttrs.push(`data-v7-group-id="${escapeAttr(shape.groupId)}"`)
    if (shape.blendMode && shape.blendMode !== 'normal') {
      // Both: data-v7-blend for round-trip, inline style so external browser
      // viewers honor the blending without our editor metadata.
      baseAttrs.push(`data-v7-blend="${shape.blendMode}"`, `style="mix-blend-mode:${shape.blendMode}"`)
    }
    if (shape.opacity !== undefined && shape.opacity < 1) {
      baseAttrs.push(`opacity="${fmt(Math.max(0, shape.opacity))}"`)
    }
    if (shape.mirror) {
      const ax = shape.mirror.axis
      baseAttrs.push(`data-v7-mirror-axis="${fmt(ax.x)},${fmt(ax.y)},${fmt(ax.angle)}"`)
      if (shape.mirror.showAxis) baseAttrs.push(`data-v7-mirror-show-axis="true"`)
    }
    // Animation metadata is only emitted when the project switch is on, so the
    // file is byte-identical to a non-animated project when the user toggles
    // animation off.
    const emitsAnimation = settings.animationEnabled && !!shape.animation
    if (emitsAnimation && shape.animation) {
      baseAttrs.push(`data-v7-anim="${escapeAttr(animationToAttr(shape.animation))}"`)
      // The transform/opacity animation lives on the wrapper <g>; the
      // paint animation has to live on the inner element because CSS `fill`
      // on the wrapper is shadowed by the inner element's `fill="..."` attr.
      if (animationHasPaint(shape)) {
        baseAttrs.push(`class="vh-anim-${shape.id}-paint"`)
      }
    }
    const rot = shapeRotation(shape)
    const scl = shapeScale(shape)
    if (rot !== 0) baseAttrs.push(`data-v7-rotation="${fmt(rot)}"`)
    if (scl !== 1) baseAttrs.push(`data-v7-scale="${fmt(scl)}"`)
    // External viewers respect the SVG transform attribute, so always emit it
    // for transformed shapes (and for glyphs, where the local-coord d needs the
    // base translate). The composed string folds translate + rotate + scale
    // into one attribute value.
    const composedTransform = composeTransformString(shape)

    let element: string
    if (isGlyphs && shape.glyphs) {
      element = `<path d="${shape.glyphs.d}" transform="${composedTransform}" ${baseAttrs.join(' ')}/>`
    } else if (isCircle && !partialArc) {
      const [cx, cy] = shape.points[0]
      const r = dist(shape.points[0], shape.points[1])
      const transformAttr = composedTransform ? ` transform="${composedTransform}"` : ''
      element = `<circle cx="${fmt(cx)}" cy="${fmt(cy)}" r="${fmt(r)}"${transformAttr} ${baseAttrs.join(' ')}/>`
    } else if (isCircle && partialArc) {
      const [cx, cy] = shape.points[0]
      const r = dist(shape.points[0], shape.points[1])
      const d = arcToPath(cx, cy, r, partialArc)
      const transformAttr = composedTransform ? ` transform="${composedTransform}"` : ''
      element = `<path d="${d}"${transformAttr} ${baseAttrs.join(' ')}/>`
    } else {
      const bz = shape.bezierOverride ?? settings.bezier
      const d = pointsToPath(shape.points, shape.closed, bz, shape.pointBezierOverrides)
      const transformAttr = composedTransform ? ` transform="${composedTransform}"` : ''
      element = `<path d="${d}"${transformAttr} ${baseAttrs.join(' ')}/>`
    }

    // Build the live mirror's sibling element when this shape has one. The
    // sibling carries the reflected geometry as a real <path>/<circle> so any
    // SVG viewer renders both halves; we mark it `data-v7-mirror-of` so the
    // parser knows it's derived (it gets recomputed on load from the source's
    // axis metadata, never read directly). No `data-v7-points` means the
    // parser's regular shape path skips it cleanly.
    const mirrorElement: string | null = shape.mirror
      ? buildMirrorSibling(shape, settings, animationEmitsPaint(shape, settings))
      : null

    // Wrap animated shapes in a <g> the CSS keyframes can target. Only when
    // animationEnabled — otherwise emit the raw element (no extra DOM node).
    // When spin is set, an extra nested wrapper carries the spin animation so
    // the entrance's transform animation is not shadowed. With a live mirror,
    // both source and reflection sit inside the same wrapper so they animate
    // as one rigid group (matching the in-editor pivot).
    if (settings.animationEnabled && shape.animation) {
      const id = shape.id
      lines.push(`  <g class="vh-anim-${id}">`)
      if (animationHasSpin(shape)) {
        lines.push(`    <g class="vh-anim-${id}-spin">`)
        lines.push(`      ${element}`)
        if (mirrorElement) lines.push(`      ${mirrorElement}`)
        lines.push(`    </g>`)
      } else {
        lines.push(`    ${element}`)
        if (mirrorElement) lines.push(`    ${mirrorElement}`)
      }
      lines.push(`  </g>`)
    } else {
      lines.push(`  ${element}`)
      if (mirrorElement) lines.push(`  ${mirrorElement}`)
    }
  }
  closeOpenGroup()
  if (settings.clip) lines.push('  </g>')
  lines.push('</svg>')
  return lines.join('\n')
}

export interface ParsedProject {
  settings: ProjectSettings
  shapes: Shape[]
  /** Project-level groups, including empty ones (preserved as drop targets). */
  groups: Group[]
}

export function parseProject(text: string): ParsedProject {
  const parser = new DOMParser()
  const doc = parser.parseFromString(text, 'image/svg+xml')
  if (doc.querySelector('parsererror')) {
    throw new Error('Invalid SVG file')
  }

  const svg = doc.querySelector('svg')
  if (!svg) throw new Error('No <svg> root found')

  const settings: ProjectSettings = { ...DEFAULT_SETTINGS }

  // Parse the viewBox and width/height attributes independently. When a file
  // has only one, derive the other so legacy SVGs (typical case: viewBox only)
  // round-trip with width === viewBoxWidth, height === viewBoxHeight.
  const vbAttr = svg.getAttribute('viewBox')
  let vbParts: [number, number, number, number] | null = null
  if (vbAttr) {
    const parts = vbAttr.split(/[\s,]+/).map(Number)
    if (parts.length === 4 && parts.every(Number.isFinite)) {
      vbParts = [parts[0], parts[1], parts[2], parts[3]]
    }
  }
  const widthAttr = parseFloat(svg.getAttribute('width') ?? '')
  const heightAttr = parseFloat(svg.getAttribute('height') ?? '')
  if (vbParts) {
    settings.viewBoxX = vbParts[0]
    settings.viewBoxY = vbParts[1]
    settings.viewBoxWidth = vbParts[2]
    settings.viewBoxHeight = vbParts[3]
  }
  if (Number.isFinite(widthAttr)) settings.width = widthAttr
  else if (vbParts) settings.width = vbParts[2]
  if (Number.isFinite(heightAttr)) settings.height = heightAttr
  else if (vbParts) settings.height = vbParts[3]
  // No viewBox in the source: default it to (0, 0, width, height) so the
  // editor's drawing extent matches the legacy interpretation.
  if (!vbParts) {
    settings.viewBoxX = 0
    settings.viewBoxY = 0
    settings.viewBoxWidth = settings.width
    settings.viewBoxHeight = settings.height
  }

  const angles = svg.getAttribute('data-v7-snap-angles')
  if (angles) {
    const parsed = angles
      .split(',')
      .map(s => parseFloat(s.trim()))
      .filter(n => Number.isFinite(n))
    if (parsed.length > 0) settings.snapAngles = parsed
  }

  const bz = svg.getAttribute('data-v7-bezier')
  if (bz) {
    const v = parseFloat(bz)
    if (Number.isFinite(v)) settings.bezier = v
  }

  if (svg.getAttribute('data-v7-no-bg') === 'true') {
    settings.bg = null
  } else {
    const bg = svg.getAttribute('data-v7-bg')
    if (bg) settings.bg = bg
  }

  settings.palette = parsePalette(svg.getAttribute('data-v7-palette'))
  const groups = parseGroups(svg.getAttribute('data-v7-groups'))
  const groupIdSet = new Set(groups.map(g => g.id))
  const bgRef = svg.getAttribute('data-v7-bg-ref')
  if (bgRef) settings.bgRef = bgRef

  const gridSize = svg.getAttribute('data-v7-grid-size')
  if (gridSize) {
    const v = parseFloat(gridSize)
    if (Number.isFinite(v) && v > 0) settings.gridSize = v
  }
  const gridVisible = svg.getAttribute('data-v7-grid-visible')
  if (gridVisible) settings.gridVisible = gridVisible === 'true'
  const gridSnap = svg.getAttribute('data-v7-grid-snap')
  if (gridSnap) settings.gridSnap = gridSnap === 'true'
  const clip = svg.getAttribute('data-v7-clip')
  if (clip) settings.clip = clip === 'true'
  if (svg.getAttribute('data-v7-animation-enabled') === 'true') {
    settings.animationEnabled = true
  }

  // Both VCT7 exports and many third-party SVGs render their background as a
  // viewBox-sized `<rect>`. We always identify it (so the shape loop can skip
  // it — otherwise the user gets a giant background-colored rectangle as the
  // bottom layer), and absorb its fill into `settings.bg` when v7 hasn't
  // already specified one.
  let bgRectEl: Element | null = null
  const firstRect = Array.from(svg.children).find(c => c.tagName.toLowerCase() === 'rect') ?? null
  if (firstRect) {
    const rx = parseFloat(firstRect.getAttribute('x') ?? '0')
    const ry = parseFloat(firstRect.getAttribute('y') ?? '0')
    const rw = parseFloat(firstRect.getAttribute('width') ?? '')
    const rh = parseFloat(firstRect.getAttribute('height') ?? '')
    const fill = firstRect.getAttribute('fill')
    if (
      Number.isFinite(rw) &&
      Number.isFinite(rh) &&
      Math.abs(rx - settings.viewBoxX) < 1e-6 &&
      Math.abs(ry - settings.viewBoxY) < 1e-6 &&
      Math.abs(rw - settings.viewBoxWidth) < 1e-6 &&
      Math.abs(rh - settings.viewBoxHeight) < 1e-6 &&
      fill &&
      fill !== 'none'
    ) {
      bgRectEl = firstRect
      const v7HasBg = svg.hasAttribute('data-v7-bg') || svg.getAttribute('data-v7-no-bg') === 'true'
      if (!v7HasBg) settings.bg = fill
    }
  }

  const shapes: Shape[] = []
  // Indices of shapes that came in via the plain-SVG fallback (no v7
  // metadata). Tracked so the post-loop reconciliation pass can lift the
  // dominant per-shape bezier into `settings.bezier` and null out the
  // shape-level overrides that match it.
  const freshIndices: number[] = []
  // Iterate every renderable shape element in document order so z-order
  // survives. Plain SVG primitives (rect/line/polygon/polyline) are imported
  // via `importFreshShape` below; VCT7-authored elements carry data-v7-points
  // and take the precise round-trip branch.
  for (const el of Array.from(svg.querySelectorAll('path, circle, rect, line, polygon, polyline'))) {
    // Skip render-only mirror siblings — they are derived on the fly from the
    // source's `data-v7-mirror-axis` and don't materialize as their own Shape.
    if (el.hasAttribute('data-v7-mirror-of')) continue
    if (isInsideNonRenderedAncestor(el, svg)) continue
    if (el === bgRectEl) continue
    const ptsAttr = el.getAttribute('data-v7-points')
    if (!ptsAttr) {
      // No round-trip metadata — derive a Shape from native geometry
      // attributes. `importFreshShape` supplies the recovered per-shape
      // `bezierOverride`; the post-loop pass below lifts the dominant value
      // up to the project setting and nulls shapes that match it.
      const fresh = importFreshShape(el, svg)
      if (fresh) {
        shapes.push({
          id: makeId(),
          ...fresh,
          locked: false,
        })
        freshIndices.push(shapes.length - 1)
      }
      continue
    }
    const points = ptsAttr
      .trim()
      .split(/\s+/)
      .map(p => {
        const [x, y] = p.split(',').map(Number)
        return [x, y] as [number, number]
      })
      .filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y))
    if (points.length === 0) continue

    const kindAttr = el.getAttribute('data-v7-kind')
    const isGlyphs = kindAttr === 'glyphs'
    const isCircle = !isGlyphs && (el.tagName.toLowerCase() === 'circle' || kindAttr === 'circle')
    const closed = isCircle || isGlyphs ? true : el.getAttribute('data-v7-closed') === 'true'
    const overrideAttr = el.getAttribute('data-v7-bezier')
    const overrideNum = overrideAttr === null ? NaN : parseFloat(overrideAttr)
    const bezierOverride = !isCircle && !isGlyphs && Number.isFinite(overrideNum) ? overrideNum : null
    const pointBezierOverrides =
      !isCircle && !isGlyphs ? parsePointBezierAttr(el.getAttribute('data-v7-point-bezier')) : undefined
    const glyphs = isGlyphs ? parseGlyphsAttrs(el) : undefined
    if (isGlyphs && !glyphs) continue

    // If a `<circle>` element was tagged but its perimeter anchor is missing
    // (only one point in `data-v7-points`), reconstruct it from `cx`/`r` so
    // the shape stays editable.
    let resolvedPoints: Point[] = points
    if (isCircle && points.length < 2) {
      const cx = parseFloat(el.getAttribute('cx') ?? '')
      const cy = parseFloat(el.getAttribute('cy') ?? '')
      const r = parseFloat(el.getAttribute('r') ?? '')
      if (Number.isFinite(cx) && Number.isFinite(cy) && Number.isFinite(r)) {
        resolvedPoints = [
          [cx, cy],
          [cx + r, cy],
        ]
      }
    }

    const nameAttr = el.getAttribute('data-v7-name')
    const arc = isCircle ? parseArcAttr(el.getAttribute('data-v7-arc')) : undefined
    const blendAttr = el.getAttribute('data-v7-blend')
    const blendMode: BlendMode | undefined =
      blendAttr && BLEND_MODE_SET.has(blendAttr) && blendAttr !== 'normal' ? (blendAttr as BlendMode) : undefined
    const opacityAttr = el.getAttribute('opacity')
    const opacityNum = opacityAttr === null ? NaN : parseFloat(opacityAttr)
    const opacity = Number.isFinite(opacityNum) && opacityNum < 1 ? Math.max(0, Math.min(1, opacityNum)) : undefined
    const rotationAttr = el.getAttribute('data-v7-rotation')
    const rotationNum = rotationAttr === null ? NaN : parseFloat(rotationAttr)
    const rotation = Number.isFinite(rotationNum) && rotationNum !== 0 ? rotationNum : undefined
    const scaleAttr = el.getAttribute('data-v7-scale')
    const scaleNum = scaleAttr === null ? NaN : parseFloat(scaleAttr)
    const scale = Number.isFinite(scaleNum) && scaleNum !== 1 ? scaleNum : undefined
    const animation = parseAnimationAttr(el.getAttribute('data-v7-anim'))
    const mirrorAxis = parseMirrorAxisAttr(el.getAttribute('data-v7-mirror-axis'))
    const mirror = mirrorAxis
      ? { axis: mirrorAxis, ...(el.getAttribute('data-v7-mirror-show-axis') === 'true' ? { showAxis: true } : {}) }
      : undefined
    // The legacy default is 'round' for both — treat round as undefined so
    // re-saving a legacy file doesn't introduce a difference, and only persist
    // explicit non-default choices in memory.
    const linejoinAttr = el.getAttribute('stroke-linejoin')
    const linejoin: StrokeLinejoin | undefined =
      linejoinAttr && LINEJOIN_SET.has(linejoinAttr) && linejoinAttr !== 'round'
        ? (linejoinAttr as StrokeLinejoin)
        : undefined
    const linecapAttr = el.getAttribute('stroke-linecap')
    const linecap: StrokeLinecap | undefined =
      linecapAttr && LINECAP_SET.has(linecapAttr) && linecapAttr !== 'round'
        ? (linecapAttr as StrokeLinecap)
        : undefined
    const dashAttr = el.getAttribute('stroke-dasharray')
    const strokeDasharray =
      dashAttr && dashAttr.trim() !== '' && dashAttr.trim() !== 'none' ? dashAttr.trim() : undefined
    // Only the leading keyword matters for the visual difference we expose —
    // anything starting with `stroke` flips the order so the stroke renders
    // under the fill. `normal`, `fill …`, or a missing attr stay default.
    const paintOrderAttr = el.getAttribute('paint-order')?.trim().toLowerCase() ?? ''
    const paintOrder: 'stroke' | undefined = paintOrderAttr.startsWith('stroke') ? 'stroke' : undefined
    const fillRef = el.getAttribute('data-v7-fill-ref') ?? undefined
    const strokeRef = el.getAttribute('data-v7-stroke-ref') ?? undefined
    // Drop a stale group-id reference that doesn't match any record on the
    // root — keeps the in-memory state self-consistent. Hand-edited SVGs
    // may also list groups without registering them; the parser carries
    // those forward into `groups` further down so the membership survives.
    const groupIdAttr = el.getAttribute('data-v7-group-id') ?? undefined
    const groupId = groupIdAttr ? groupIdAttr : undefined
    shapes.push({
      id: makeId(),
      ...(isGlyphs ? { kind: 'glyphs' as const } : isCircle ? { kind: 'circle' as const } : {}),
      points: resolvedPoints,
      closed,
      fill: el.getAttribute('fill') ?? (closed ? '#000000' : 'none'),
      stroke: el.getAttribute('stroke') ?? 'none',
      strokeWidth: parseFloat(el.getAttribute('stroke-width') ?? '2'),
      bezierOverride,
      ...(pointBezierOverrides ? { pointBezierOverrides } : {}),
      hidden: el.getAttribute('data-v7-hidden') === 'true',
      locked: el.getAttribute('data-v7-locked') === 'true',
      ...(linejoin ? { strokeLinejoin: linejoin } : {}),
      ...(linecap ? { strokeLinecap: linecap } : {}),
      ...(strokeDasharray ? { strokeDasharray } : {}),
      ...(paintOrder ? { paintOrder } : {}),
      ...(nameAttr ? { name: nameAttr } : {}),
      ...(fillRef ? { fillRef } : {}),
      ...(strokeRef ? { strokeRef } : {}),
      ...(arc ? { arc } : {}),
      ...(blendMode ? { blendMode } : {}),
      ...(opacity !== undefined ? { opacity } : {}),
      ...(glyphs ? { glyphs } : {}),
      ...(rotation !== undefined ? { rotation } : {}),
      ...(scale !== undefined ? { scale } : {}),
      ...(animation ? { animation } : {}),
      ...(mirror ? { mirror } : {}),
      ...(groupId ? { groupId } : {}),
    })
  }

  // Reconcile fresh-imported shapes' per-shape bezier into a single project
  // setting. The user model is "global is the source of truth, shape-level
  // overrides only when they differ, point-level overrides only when those
  // differ from their shape" — but `importFreshShape` writes a per-shape
  // override on every fresh path because it can't see siblings. Here we
  // collect those overrides, pick the dominant value (2-dp bucketed so float
  // drift in the recovered `t` doesn't shatter the histogram), and:
  //   1. promote it to `settings.bezier` when the file didn't already carry
  //      `data-v7-bezier`,
  //   2. null any fresh shape's `bezierOverride` that lands on the global
  //      (and any shape with no actual corners — `bezierOverride` on a
  //      2-vertex line is meaningless and would emit a noisy attribute).
  // Per-vertex overrides are left alone — they were already selected to
  // deviate from the shape's representative `t`, so they remain meaningful
  // overrides regardless of where the shape's base lands.
  if (freshIndices.length > 0) {
    const candidateTs: number[] = []
    for (const idx of freshIndices) {
      const sh = shapes[idx]
      if (sh.kind === 'circle') continue
      if (sh.points.length < 3) continue
      if (typeof sh.bezierOverride === 'number') candidateTs.push(sh.bezierOverride)
    }
    if (candidateTs.length > 0 && !svg.hasAttribute('data-v7-bezier')) {
      settings.bezier = pickDominantT(candidateTs)
    }
    for (const idx of freshIndices) {
      const sh = shapes[idx]
      if (typeof sh.bezierOverride !== 'number') continue
      const noCorners = sh.kind === 'circle' || sh.points.length < 3
      if (noCorners || Math.abs(sh.bezierOverride - settings.bezier) <= 0.005) {
        sh.bezierOverride = null
      }
    }
  }

  // Backfill `groups` for any shape-referenced ids that weren't declared on
  // the root (older files, hand-edits). Generated names match the in-app
  // default scheme so the layer panel stays usable.
  for (const sh of shapes) {
    if (!sh.groupId) continue
    if (groupIdSet.has(sh.groupId)) continue
    groupIdSet.add(sh.groupId)
    groups.push({ id: sh.groupId, name: `Group ${groups.length + 1}` })
  }

  return { settings, shapes, groups }
}
