import type { AnimationFromState, AnimationSpec, Easing, Shape } from '../types';
import { fmt } from './geometry';
import { shapeBBoxCenter } from './transform';

/** Cubic bezier value sampled at parameter t for control points (a, b) on [0,1]. */
const bezSample = (a: number, b: number, t: number): number => {
  const u = 1 - t;
  return 3 * u * u * t * a + 3 * u * t * t * b + t * t * t;
};

/**
 * Cubic bezier easing helper. Solves x(t) = bx via a small Newton iteration so
 * we can sample y(t) at the desired x. Good enough for live scrubbing without
 * pulling in a dependency. The 4-arg form matches CSS `cubic-bezier(x1,y1,x2,y2)`.
 */
const cubicBezier = (x1: number, y1: number, x2: number, y2: number, x: number): number => {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  // Newton-Raphson on x(t). Bezier endpoints are 0 and 1, so an initial guess
  // of `x` itself converges in ~4 iterations for reasonable control points.
  let t = x;
  for (let i = 0; i < 8; i++) {
    const xt = bezSample(x1, x2, t);
    const dx = 3 * (1 - t) * (1 - t) * x1 + 6 * (1 - t) * t * (x2 - x1) + 3 * t * t * (1 - x2);
    if (dx === 0) break;
    const next = t - (xt - x) / dx;
    if (Math.abs(next - t) < 1e-5) {
      t = next;
      break;
    }
    t = Math.max(0, Math.min(1, next));
  }
  return bezSample(y1, y2, t);
};

const DR_CLASSIC: readonly [number, number, number, number] = [0.2, 0.8, 0.2, 1];

const easeFn = (e: Easing): ((t: number) => number) => {
  switch (e) {
    case 'linear':
      return (t) => t;
    case 'ease':
      return (t) => cubicBezier(0.25, 0.1, 0.25, 1, t);
    case 'ease-in':
      return (t) => cubicBezier(0.42, 0, 1, 1, t);
    case 'ease-out':
      return (t) => cubicBezier(0, 0, 0.58, 1, t);
    case 'ease-in-out':
      return (t) => cubicBezier(0.42, 0, 0.58, 1, t);
    case 'dr-classic':
      return (t) => cubicBezier(...DR_CLASSIC, t);
  }
};

/** CSS `animation-timing-function` value matching the named easing keyword. */
export const easingToCss = (e: Easing): string => {
  if (e === 'dr-classic') return `cubic-bezier(${DR_CLASSIC.join(',')})`;
  return e;
};

/**
 * Map a scene-time `t` (ms, can be any value) to this shape's local progress
 * in [0, 1]. Before `delay` returns 0 (held at from-state); after delay+duration
 * returns 1 (held at rest). A non-positive duration short-circuits to 1 to
 * avoid divide-by-zero.
 */
export const shapeProgress = (spec: AnimationSpec, sceneT: number): number => {
  if (spec.duration <= 0) return 1;
  const local = (sceneT - spec.delay) / spec.duration;
  if (local <= 0) return 0;
  if (local >= 1) return 1;
  return local;
};

/**
 * Resolved offsets a wrapper `<g>` should apply at progress `p` (already eased
 * by the caller — see {@link sampleAnimation}). Each field is the *current*
 * value, not a delta — opacity multiplier in [0, 1], rotation in degrees,
 * scale as a multiplier, translate in canvas units. At p=1 every field is the
 * identity (1, 0, 1, 0, 0).
 */
export interface AnimationOffsets {
  opacityMul: number;
  rotation: number;
  scale: number;
  translateX: number;
  translateY: number;
}

export const IDENTITY_OFFSETS: AnimationOffsets = {
  opacityMul: 1,
  rotation: 0,
  scale: 1,
  translateX: 0,
  translateY: 0,
};

/**
 * Linearly blend each `from` channel toward identity by progress `p`. Caller
 * is responsible for easing — i.e. pass `easeFn(spec.easing)(rawProgress)`.
 *
 * For opacity we treat `from.opacity` as an absolute value at p=0 (matching CSS
 * `from { opacity: 0 }` semantics — fade-in is the dominant use case). Other
 * channels are offsets/multipliers.
 */
export const lerpOffsets = (from: AnimationFromState, p: number): AnimationOffsets => {
  const inv = 1 - p;
  const opacityFrom = from.opacity ?? 1;
  const rotFrom = from.rotation ?? 0;
  const scaleFrom = from.scale ?? 1;
  const txFrom = from.translateX ?? 0;
  const tyFrom = from.translateY ?? 0;
  return {
    opacityMul: opacityFrom * inv + 1 * p,
    rotation: rotFrom * inv,
    scale: scaleFrom * inv + 1 * p,
    translateX: txFrom * inv,
    translateY: tyFrom * inv,
  };
};

/**
 * High-level convenience: apply this shape's easing + windowing to a scene
 * time and return the offsets to render with. Returns IDENTITY_OFFSETS for
 * unanimated shapes (callers can therefore call this unconditionally).
 */
export const sampleAnimation = (shape: Shape, sceneT: number): AnimationOffsets => {
  if (!shape.animation) return IDENTITY_OFFSETS;
  const raw = shapeProgress(shape.animation, sceneT);
  const eased = easeFn(shape.animation.easing)(raw);
  return lerpOffsets(shape.animation.from, eased);
};

/**
 * Build the SVG `transform` attribute for the animation wrapper `<g>`. The
 * rotation/scale pivot is the shape's bbox center (matching the static
 * transform's pivot). Translate is applied raw, after the pivoted rot+scale,
 * so it reads as a simple screen-space shift.
 *
 * Returns `''` when offsets equal identity — caller can omit the attribute.
 */
export const offsetsToTransform = (shape: Shape, o: AnimationOffsets): string => {
  if (o.rotation === 0 && o.scale === 1 && o.translateX === 0 && o.translateY === 0) return '';
  const [cx, cy] = shapeBBoxCenter(shape);
  const parts: string[] = [];
  if (o.translateX !== 0 || o.translateY !== 0) {
    parts.push(`translate(${fmt(o.translateX)} ${fmt(o.translateY)})`);
  }
  if (o.rotation !== 0 || o.scale !== 1) {
    parts.push(
      `translate(${fmt(cx)} ${fmt(cy)})`,
      `rotate(${fmt(o.rotation)})`,
      `scale(${fmt(o.scale)})`,
      `translate(${fmt(-cx)} ${fmt(-cy)})`,
    );
  }
  return parts.join(' ');
};

/** Total scene length in ms — `max(delay + duration)` over animated shapes. */
export const sceneTotal = (shapes: Shape[]): number => {
  let total = 0;
  for (const sh of shapes) {
    if (!sh.animation) continue;
    const end = sh.animation.delay + sh.animation.duration;
    if (end > total) total = end;
  }
  return total;
};

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
 * The pivot is baked into the CSS transform via translate/rotate/scale/-translate
 * rather than `transform-origin: center` — that combo plus `transform-box: fill-box`
 * has historically had inconsistent behavior across browsers on SVG `<g>`. Baked
 * pivot is fully explicit and renders identically everywhere.
 */
export const buildKeyframesStyle = (shapes: Shape[]): string => {
  const blocks: string[] = [];
  for (const sh of shapes) {
    if (!sh.animation) continue;
    const startOffsets = lerpOffsets(sh.animation.from, 0);
    const startTransform = cssTransformOf(sh, startOffsets);
    const opacityRule =
      startOffsets.opacityMul === 1 ? '' : `    opacity: ${fmt(startOffsets.opacityMul)};\n`;
    const transformRule = startTransform === 'none' ? '' : `    transform: ${startTransform};\n`;
    const id = `vh-anim-${sh.id}`;
    blocks.push(
      `@keyframes ${id} {\n  from {\n${opacityRule}${transformRule}  }\n  to { opacity: 1; transform: none; }\n}`,
      `.${id} {\n  animation: ${id} ${fmt(sh.animation.duration)}ms ${easingToCss(sh.animation.easing)} ${fmt(sh.animation.delay)}ms both;\n}`,
    );
  }
  return blocks.length === 0 ? '' : blocks.join('\n');
};

/** CSS `transform` value with pivot baked in (see {@link buildKeyframesStyle}). */
const cssTransformOf = (shape: Shape, o: AnimationOffsets): string => {
  const parts: string[] = [];
  if (o.translateX !== 0 || o.translateY !== 0) {
    parts.push(`translate(${fmt(o.translateX)}px, ${fmt(o.translateY)}px)`);
  }
  if (o.rotation !== 0 || o.scale !== 1) {
    const [cx, cy] = shapeBBoxCenter(shape);
    parts.push(`translate(${fmt(cx)}px, ${fmt(cy)}px)`);
    if (o.rotation !== 0) parts.push(`rotate(${fmt(o.rotation)}deg)`);
    if (o.scale !== 1) parts.push(`scale(${fmt(o.scale)})`);
    parts.push(`translate(${fmt(-cx)}px, ${fmt(-cy)}px)`);
  }
  return parts.length ? parts.join(' ') : 'none';
};
