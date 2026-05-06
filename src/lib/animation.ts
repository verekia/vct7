import { parseHex, toHex } from './blend'
import { fmt } from './geometry'
import { shapePivot } from './transform'

import type { AnimationFromState, AnimationSpec, Easing, Shape } from '../types'
import type { RGB } from './blend'

/** Cubic bezier value sampled at parameter t for control points (a, b) on [0,1]. */
const bezSample = (a: number, b: number, t: number): number => {
  const u = 1 - t
  return 3 * u * u * t * a + 3 * u * t * t * b + t * t * t
}

/**
 * Cubic bezier easing helper. Solves x(t) = bx via a small Newton iteration so
 * we can sample y(t) at the desired x. Good enough for live scrubbing without
 * pulling in a dependency. The 4-arg form matches CSS `cubic-bezier(x1,y1,x2,y2)`.
 */
const cubicBezier = (x1: number, y1: number, x2: number, y2: number, x: number): number => {
  if (x <= 0) return 0
  if (x >= 1) return 1
  // Newton-Raphson on x(t). Bezier endpoints are 0 and 1, so an initial guess
  // of `x` itself converges in ~4 iterations for reasonable control points.
  let t = x
  for (let i = 0; i < 8; i++) {
    const xt = bezSample(x1, x2, t)
    const dx = 3 * (1 - t) * (1 - t) * x1 + 6 * (1 - t) * t * (x2 - x1) + 3 * t * t * (1 - x2)
    if (dx === 0) break
    const next = t - (xt - x) / dx
    if (Math.abs(next - t) < 1e-5) {
      t = next
      break
    }
    t = Math.max(0, Math.min(1, next))
  }
  return bezSample(y1, y2, t)
}

const SNAP_CURVE: readonly [number, number, number, number] = [0.2, 0.8, 0.2, 1]

const easeFn = (e: Easing): ((t: number) => number) => {
  switch (e) {
    case 'linear':
      return t => t
    case 'ease':
      return t => cubicBezier(0.25, 0.1, 0.25, 1, t)
    case 'ease-in':
      return t => cubicBezier(0.42, 0, 1, 1, t)
    case 'ease-out':
      return t => cubicBezier(0, 0, 0.58, 1, t)
    case 'ease-in-out':
      return t => cubicBezier(0.42, 0, 0.58, 1, t)
    case 'snap':
      return t => cubicBezier(...SNAP_CURVE, t)
  }
}

/** CSS `animation-timing-function` value matching the named easing keyword. */
export const easingToCss = (e: Easing): string => {
  if (e === 'snap') return `cubic-bezier(${SNAP_CURVE.join(',')})`
  return e
}

/**
 * Map a scene-time `t` (ms, can be any value) to this shape's local progress
 * in [0, 1]. Before `delay` returns 0 (held at from-state); after delay+duration
 * returns 1 (held at rest). A non-positive duration short-circuits to 1 to
 * avoid divide-by-zero.
 */
export const shapeProgress = (spec: AnimationSpec, sceneT: number): number => {
  if (spec.duration <= 0) return 1
  const local = (sceneT - spec.delay) / spec.duration
  if (local <= 0) return 0
  if (local >= 1) return 1
  return local
}

/**
 * Resolved offsets a wrapper `<g>` should apply at progress `p` (already eased
 * by the caller — see {@link sampleAnimation}). Each field is the *current*
 * value, not a delta — opacity multiplier in [0, 1], rotation in degrees,
 * scale as a multiplier, translate in canvas units. `fill` / `stroke` are
 * resolved hex strings to paint the shape with at this frame, or `null` to
 * fall back to the shape's authored value. At p=1 every field is the identity.
 */
export interface AnimationOffsets {
  opacityMul: number
  rotation: number
  scale: number
  translateX: number
  translateY: number
  fill: string | null
  stroke: string | null
}

export const IDENTITY_OFFSETS: AnimationOffsets = {
  opacityMul: 1,
  rotation: 0,
  scale: 1,
  translateX: 0,
  translateY: 0,
  fill: null,
  stroke: null,
}

/** Linearly mix two RGBs in normalized space, then re-encode as hex. */
const lerpRgb = (a: RGB, b: RGB, p: number): RGB => {
  const inv = 1 - p
  return [a[0] * inv + b[0] * p, a[1] * inv + b[1] * p, a[2] * inv + b[2] * p]
}

const lerpColor = (fromHex: string, restHex: string | undefined, p: number): string | null => {
  const fromRgb = parseHex(fromHex)
  const restRgb = restHex ? parseHex(restHex) : null
  // No usable rest color (e.g. `fill="none"`) — animating into "nothing"
  // would produce a visual jump; safer to skip the channel entirely.
  if (!fromRgb || !restRgb) return null
  return toHex(lerpRgb(fromRgb, restRgb, p))
}

/**
 * Linearly blend each `from` channel toward identity by progress `p`. Caller
 * is responsible for easing — i.e. pass `easeFn(spec.easing)(rawProgress)`.
 *
 * For opacity we treat `from.opacity` as an absolute value at p=0 (matching CSS
 * `from { opacity: 0 }` semantics — fade-in is the dominant use case). Other
 * geometric channels are offsets/multipliers; color channels lerp from
 * `from.fill / from.stroke` toward the shape's authored rest value.
 */
export const lerpOffsets = (
  from: AnimationFromState,
  p: number,
  restFill?: string,
  restStroke?: string,
): AnimationOffsets => {
  const inv = 1 - p
  const opacityFrom = from.opacity ?? 1
  const rotFrom = from.rotation ?? 0
  const scaleFrom = from.scale ?? 1
  const txFrom = from.translateX ?? 0
  const tyFrom = from.translateY ?? 0
  return {
    opacityMul: opacityFrom * inv + 1 * p,
    rotation: rotFrom * inv,
    scale: scaleFrom * inv + 1 * p,
    translateX: txFrom * inv,
    translateY: tyFrom * inv,
    fill: from.fill ? lerpColor(from.fill, restFill, p) : null,
    stroke: from.stroke ? lerpColor(from.stroke, restStroke, p) : null,
  }
}

/**
 * High-level convenience: apply this shape's easing + windowing to a scene
 * time and return the offsets to render with. Returns IDENTITY_OFFSETS for
 * unanimated shapes (callers can therefore call this unconditionally).
 *
 * `spin` (when set) layers a constant-speed rotation on top of the entrance's
 * own rotation channel — the editor sums them into a single combined rotation
 * value that the JS render path applies to one wrapper. The exported SVG
 * splits them across two CSS animations on nested wrappers because CSS can't
 * compose two animations driving the same property on one element.
 */
export const sampleAnimation = (shape: Shape, sceneT: number): AnimationOffsets => {
  if (!shape.animation) return IDENTITY_OFFSETS
  const raw = shapeProgress(shape.animation, sceneT)
  const eased = easeFn(shape.animation.easing)(raw)
  const offsets = lerpOffsets(shape.animation.from, eased, shape.fill, shape.stroke)
  return applySpin(offsets, shape.animation, sceneT)
}

/** Spin start time (ms) relative to scene zero. Negative if startOffset extends past 0. */
export const spinStartT = (anim: AnimationSpec): number => anim.delay + anim.duration + (anim.spin?.startOffset ?? 0)

/** Add the accumulated spin rotation at scene time `sceneT` to an offset bundle. */
const applySpin = (offsets: AnimationOffsets, anim: AnimationSpec, sceneT: number): AnimationOffsets => {
  if (!anim.spin || anim.spin.speed === 0) return offsets
  const start = spinStartT(anim)
  if (sceneT < start) return offsets
  const elapsed = (sceneT - start) / 1000
  return { ...offsets, rotation: offsets.rotation + elapsed * anim.spin.speed }
}

/**
 * Build the SVG `transform` attribute for the animation wrapper `<g>`. The
 * rotation/scale pivot is the shape's bbox center (matching the static
 * transform's pivot). Translate is applied raw, after the pivoted rot+scale,
 * so it reads as a simple screen-space shift.
 *
 * Returns `''` when offsets equal identity — caller can omit the attribute.
 */
export const offsetsToTransform = (shape: Shape, o: AnimationOffsets): string => {
  if (o.rotation === 0 && o.scale === 1 && o.translateX === 0 && o.translateY === 0) return ''
  // Mirror-attached shapes pivot at the combined pair center so the source
  // and reflection rotate as one rigid group during animation. Non-mirrored
  // shapes pivot at their own bbox center as before.
  const [cx, cy] = shapePivot(shape)
  const parts: string[] = []
  if (o.translateX !== 0 || o.translateY !== 0) {
    parts.push(`translate(${fmt(o.translateX)} ${fmt(o.translateY)})`)
  }
  if (o.rotation !== 0 || o.scale !== 1) {
    parts.push(
      `translate(${fmt(cx)} ${fmt(cy)})`,
      `rotate(${fmt(o.rotation)})`,
      `scale(${fmt(o.scale)})`,
      `translate(${fmt(-cx)} ${fmt(-cy)})`,
    )
  }
  return parts.join(' ')
}

/**
 * How much extra preview time the timeline shows past the entrance end when
 * any shape has a spin. The spin runs forever in the exported SVG, but the
 * editor needs a finite scrub range — three seconds is enough to feel the
 * speed and direction without making the slider's "rest" segment dominate.
 */
export const SPIN_PREVIEW_MS = 3000

/**
 * Total scene length in ms — `max(delay + duration)` over animated shapes,
 * plus a fixed tail when any shape spins so the scrubber has somewhere to go
 * after the entrance lands.
 */
export const sceneTotal = (shapes: Shape[]): number => {
  let total = 0
  let hasSpin = false
  for (const sh of shapes) {
    if (!sh.animation) continue
    const end = sh.animation.delay + sh.animation.duration
    if (end > total) total = end
    if (sh.animation.spin && sh.animation.spin.speed !== 0) hasSpin = true
  }
  return hasSpin ? total + SPIN_PREVIEW_MS : total
}

/**
 * True when this shape's animation needs the separate paint-rule (fill / stroke).
 * Geometric-only animations skip the second class to keep the saved SVG tidy.
 */
export const animationHasPaint = (shape: Shape): boolean => {
  if (!shape.animation) return false
  const start = lerpOffsets(shape.animation.from, 0, shape.fill, shape.stroke)
  return start.fill !== null || start.stroke !== null
}

/** True when the shape's animation has a non-zero spin (needs the extra wrapper). */
export const animationHasSpin = (shape: Shape): boolean => !!shape.animation?.spin && shape.animation.spin.speed !== 0

/**
 * Build a `<style>` block embedding @keyframes + class rules for every
 * animated shape. Used at export time so the saved SVG runs the animation in
 * any browser context (e.g. dropped into the consumer's DOM). Returns `''`
 * when no shape is animated, so callers can splice unconditionally.
 *
 * Mechanism: each animated shape gets wrapped in `<g class="vh-anim-{id}">`,
 * and the @keyframes drive that wrapper's transform + opacity from the
 * from-state at 0% to identity at 100%. `both` fill-mode pins the from-state
 * during `delay` (so a staggered shape doesn't pop into view at t=0) and the
 * rest pose after the animation ends.
 *
 * Paint (fill / stroke) is animated via a *second* class `vh-anim-{id}-paint`
 * on the inner element, since CSS `fill` set on the wrapper is shadowed by the
 * inner `<path fill="...">` attribute. Splitting the animation across two rules
 * keeps the inner element's authored attrs untouched.
 *
 * The pivot is baked into the CSS transform via translate/rotate/scale/-translate
 * rather than `transform-origin: center` — that combo plus `transform-box: fill-box`
 * has historically had inconsistent behavior across browsers on SVG `<g>`. Baked
 * pivot is fully explicit and renders identically everywhere.
 */
export const buildKeyframesStyle = (shapes: Shape[]): string => {
  const blocks: string[] = []
  for (const sh of shapes) {
    if (!sh.animation) continue
    const startOffsets = lerpOffsets(sh.animation.from, 0, sh.fill, sh.stroke)
    const { from: startTransform, to: restTransform } = cssTransformPair(sh, startOffsets)
    const opacityRule = startOffsets.opacityMul === 1 ? '' : `    opacity: ${fmt(startOffsets.opacityMul)};\n`
    const fromTransformRule = startTransform === 'none' ? '' : `    transform: ${startTransform};\n`
    const toTransformPart = restTransform === 'none' ? 'none' : restTransform
    const id = `vh-anim-${sh.id}`
    const timing = `${fmt(sh.animation.duration)}ms ${easingToCss(sh.animation.easing)} ${fmt(sh.animation.delay)}ms both`
    blocks.push(
      `@keyframes ${id} {\n  from {\n${opacityRule}${fromTransformRule}  }\n  to { opacity: 1; transform: ${toTransformPart}; }\n}`,
      `.${id} {\n  animation: ${id} ${timing};\n}`,
    )

    // Paint keyframe — only when at least one color channel resolved (i.e.
    // both from-color and rest-color are real hex values).
    const fillStart = startOffsets.fill
    const strokeStart = startOffsets.stroke
    if (fillStart || strokeStart) {
      const fromLines: string[] = []
      const toLines: string[] = []
      if (fillStart) {
        fromLines.push(`fill: ${fillStart};`)
        toLines.push(`fill: ${sh.fill};`)
      }
      if (strokeStart) {
        fromLines.push(`stroke: ${strokeStart};`)
        toLines.push(`stroke: ${sh.stroke};`)
      }
      const paintId = `${id}-paint`
      blocks.push(
        `@keyframes ${paintId} {\n  from { ${fromLines.join(' ')} }\n  to { ${toLines.join(' ')} }\n}`,
        `.${paintId} {\n  animation: ${paintId} ${timing};\n}`,
      )
    }

    // Spin keyframe — runs forever on a *nested* wrapper so the entrance's
    // transform animation isn't shadowed. Pivot is the shape's bbox center,
    // baked into the keyframe values for cross-browser consistency.
    if (sh.animation.spin && sh.animation.spin.speed !== 0) {
      const spin = sh.animation.spin
      const period = Math.abs(360 / spin.speed) * 1000 // ms per revolution
      const direction = spin.speed >= 0 ? 360 : -360
      const [cx, cy] = shapePivot(sh)
      const pivotIn = `translate(${fmt(cx)}px, ${fmt(cy)}px)`
      const pivotOut = `translate(${fmt(-cx)}px, ${fmt(-cy)}px)`
      const start = `${pivotIn} rotate(0deg) ${pivotOut}`
      const end = `${pivotIn} rotate(${direction}deg) ${pivotOut}`
      const spinId = `${id}-spin`
      const spinDelay = fmt(spinStartT(sh.animation))
      blocks.push(
        `@keyframes ${spinId} {\n  from { transform: ${start}; }\n  to { transform: ${end}; }\n}`,
        `.${spinId} {\n  animation: ${spinId} ${fmt(period)}ms linear ${spinDelay}ms infinite;\n}`,
      )
    }
  }
  return blocks.length === 0 ? '' : blocks.join('\n')
}

/**
 * CSS `transform` values for the keyframe pair, with pivot baked in (see
 * {@link buildKeyframesStyle}). Returns matching from/to function lists so the
 * browser interpolates each function independently — interpolating a structured
 * list against `transform: none` (or any mismatched list) falls back to matrix
 * decomposition, which produces undefined intermediates when scale=0 makes the
 * from-matrix degenerate. Using identity values for the rest pose keeps the
 * lists structurally aligned without changing the at-rest visual.
 */
const cssTransformPair = (shape: Shape, o: AnimationOffsets): { from: string; to: string } => {
  const fromParts: string[] = []
  const toParts: string[] = []
  if (o.translateX !== 0 || o.translateY !== 0) {
    fromParts.push(`translate(${fmt(o.translateX)}px, ${fmt(o.translateY)}px)`)
    toParts.push(`translate(0px, 0px)`)
  }
  if (o.rotation !== 0 || o.scale !== 1) {
    const [cx, cy] = shapePivot(shape)
    const pivotIn = `translate(${fmt(cx)}px, ${fmt(cy)}px)`
    const pivotOut = `translate(${fmt(-cx)}px, ${fmt(-cy)}px)`
    fromParts.push(pivotIn)
    toParts.push(pivotIn)
    if (o.rotation !== 0) {
      fromParts.push(`rotate(${fmt(o.rotation)}deg)`)
      toParts.push(`rotate(0deg)`)
    }
    if (o.scale !== 1) {
      fromParts.push(`scale(${fmt(o.scale)})`)
      toParts.push(`scale(1)`)
    }
    fromParts.push(pivotOut)
    toParts.push(pivotOut)
  }
  return {
    from: fromParts.length ? fromParts.join(' ') : 'none',
    to: toParts.length ? toParts.join(' ') : 'none',
  }
}
