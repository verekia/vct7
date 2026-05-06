export type Point = readonly [number, number]

export type Tool = 'select' | 'line' | 'polygon' | 'circle'

export type StrokeLinejoin = 'miter' | 'round' | 'bevel'
export type StrokeLinecap = 'butt' | 'round' | 'square'

export const STROKE_LINEJOINS: readonly StrokeLinejoin[] = ['miter', 'round', 'bevel']
export const STROKE_LINECAPS: readonly StrokeLinecap[] = ['butt', 'round', 'square']

/**
 * Optional partial-circle range for `kind === 'circle'` shapes. When absent,
 * the shape is a full circle. Angles are degrees, measured clockwise from
 * 3 o'clock (matching SVG screen coordinates). `style` decides how the arc
 * is closed: `'wedge'` adds straight edges back to the center (pie slice),
 * `'chord'` connects the endpoints with a straight line (D-shape), and
 * `'open'` leaves the curve unfilled.
 */
export interface ArcRange {
  start: number
  end: number
  style: 'wedge' | 'chord' | 'open'
}

/**
 * Shape representation — `kind` is optional with implicit default `'path'` so
 * older projects (and tests) keep round-tripping without an explicit field.
 *
 * Circles store two points: `points[0]` is the center and `points[1]` is a
 * perimeter anchor. The radius is `dist(points[0], points[1])`. Storing the
 * perimeter as an actual point (rather than a scalar radius) lets generic
 * code — bbox, snap, vertex drag — keep operating on points uniformly, and
 * gives the user a draggable "resize handle" for free.
 *
 * Glyph shapes store baked text outlines. `points[0]` is the top-left anchor in
 * canvas coordinates and `points[1]` is `topLeft + (width, height)`. The actual
 * vector geometry lives in `glyphs.d` as a single SVG path string anchored at
 * (0, 0); rendering applies a translate(topLeft) to position it. Both points
 * always move together — vertex handles aren't shown — so the block translates
 * as one unit while still benefiting from the existing snap/bbox machinery.
 */
export interface Shape {
  id: string
  kind?: 'path' | 'circle' | 'glyphs'
  points: Point[]
  closed: boolean
  fill: string
  stroke: string
  strokeWidth: number
  /** SVG `stroke-linejoin`. Absent means `'round'` (the legacy default). */
  strokeLinejoin?: StrokeLinejoin
  /** SVG `stroke-linecap`. Absent means `'round'` (the legacy default). */
  strokeLinecap?: StrokeLinecap
  /**
   * SVG `stroke-dasharray` value (e.g. `"4 2"`). Absent or empty means a solid
   * stroke. Stored verbatim as the user typed it; the renderer just forwards it
   * to the SVG attribute, so any valid dasharray syntax works.
   */
  strokeDasharray?: string
  /**
   * SVG `paint-order`. Absent / `'fill'` means the default (fill, then stroke
   * painted on top). `'stroke'` flips the order so the stroke is painted first
   * and the fill covers its inner half — the typical "stroke outside the
   * shape" look used for outlined text and chunky icon strokes.
   */
  paintOrder?: 'fill' | 'stroke'
  /**
   * Optional palette references. When set, `fill` / `stroke` is kept synced with
   * the palette entry's color — the editor uses the resolved hex (so the saved
   * SVG has a real color value) and the ref name is metadata for round-tripping
   * the link between shape and palette entry.
   */
  fillRef?: string
  strokeRef?: string
  /** When null, the project's global bezier value applies. */
  bezierOverride: number | null
  /**
   * Sparse per-vertex bezier override map (`pointIndex → t`). Wins over the
   * layer's `bezierOverride` and the project's global bezier for the corner
   * at that vertex. Endpoints of open polylines have no corner — entries on
   * those indices are stored faithfully but render as a no-op.
   */
  pointBezierOverrides?: Record<number, number>
  hidden: boolean
  locked: boolean
  /** User-supplied display name. Empty / undefined falls back to "polygon" / "line" / "circle". */
  name?: string
  /** Partial-circle range. Only meaningful when `kind === 'circle'`. */
  arc?: ArcRange
  /**
   * CSS `mix-blend-mode` value applied to the rendered shape. Absent / `'normal'`
   * means no blending (the default).
   */
  blendMode?: BlendMode
  /** Element opacity in [0, 1]. Absent / `1` means fully opaque (the default). */
  opacity?: number
  /** Baked text outline data. Only meaningful when `kind === 'glyphs'`. */
  glyphs?: GlyphData
  /**
   * Rotation in degrees, applied around the visual bbox center. Composes with
   * `scale` and (for glyphs) the local-coord translate. Absent / `0` means no
   * rotation. Stored as a transform on top of `points` rather than baked, so
   * the user can adjust it freely; "Apply transform" bakes the current value
   * into the geometry and resets back to `0`.
   */
  rotation?: number
  /**
   * Uniform scale factor, applied around the visual bbox center. Absent / `1`
   * means no scaling. Same baking semantics as `rotation`.
   */
  scale?: number
  /**
   * Per-shape entrance animation. Absent means the shape does not animate. The
   * authored shape state (points + rotation + scale + opacity) is the *rest /
   * final* frame; `from` describes additive offsets at t=0. The animation
   * therefore plays the shape *into* its rest pose. Saved into the SVG only
   * when `ProjectSettings.animationEnabled` is true — otherwise stripped on
   * export.
   */
  animation?: AnimationSpec
}

/**
 * Easing keyword. The first five map 1:1 to a CSS `animation-timing-function`
 * value; `snap` is a custom cubic-bezier tuned for a fast-out / firm-stop
 * curve that lands shapes decisively into their rest pose.
 */
export type Easing = 'linear' | 'ease' | 'ease-in' | 'ease-out' | 'ease-in-out' | 'snap'

export const EASINGS: readonly Easing[] = ['linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out', 'snap']

/**
 * Entrance animation spec. `duration` and `delay` are milliseconds; the scene's
 * total length is derived as `max(delay + duration)` over animated shapes, not
 * stored. `from` holds offsets applied at t=0 and linearly approaching identity
 * at t=1 (the rest state). All `from` fields are optional — a missing field is
 * a zero offset for that channel.
 *
 * `spin` adds a constant-speed rotation that runs forever after the entrance.
 * Composed with the entrance via a separate CSS animation on a nested wrapper,
 * so the entrance's own transform doesn't get clobbered while the spin runs.
 */
export interface AnimationSpec {
  duration: number
  delay: number
  easing: Easing
  from: AnimationFromState
  spin?: SpinSpec
}

/**
 * Constant-speed rotation that engages after the entrance and never stops.
 * Use case: cog-wheel decorations that translate into place while already
 * spinning, then keep spinning once the menu is open.
 */
export interface SpinSpec {
  /** Degrees per second. Positive = clockwise. Zero disables. */
  speed: number
  /**
   * Offset from the entrance's end (`delay + duration`) at which the spin
   * engages, in milliseconds. Negative values start the spin *during* the
   * entrance, so the cog can already be rotating while it's flying in.
   */
  startOffset: number
}

export interface AnimationFromState {
  /** Absolute opacity at t=0 (rest opacity is the shape's own `opacity`, default 1). */
  opacity?: number
  /** Additive rotation offset in degrees, applied around the shape's bbox center. */
  rotation?: number
  /** Multiplicative scale factor, applied around the shape's bbox center (1 = no offset). */
  scale?: number
  /** Translate offset in canvas units, applied as a raw screen-space shift. */
  translateX?: number
  translateY?: number
  /**
   * Hex fill color at t=0; lerps toward the shape's rest fill across the
   * animation. Ignored when the shape's rest fill is `'none'` — there's
   * nothing to interpolate toward.
   */
  fill?: string
  /** Hex stroke color at t=0. Same `none`-rest caveat as `fill`. */
  stroke?: string
}

/**
 * Vectorized text payload. `d` is the combined SVG path data for every glyph,
 * anchored so that the visible bbox starts at (0, 0) — the renderer just
 * translates by the shape's top-left. `text` / `fontFamily` / `fontSize` are
 * informational only; once vectorized, the text is "frozen" — the path data is
 * the source of truth and does not get re-rasterized.
 */
export interface GlyphData {
  text: string
  fontFamily: string
  fontSize: number
  d: string
  width: number
  height: number
}

export type BlendMode =
  | 'normal'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'darken'
  | 'lighten'
  | 'color-dodge'
  | 'color-burn'
  | 'hard-light'
  | 'soft-light'
  | 'difference'
  | 'exclusion'
  | 'hue'
  | 'saturation'
  | 'color'
  | 'luminosity'

export const BLEND_MODES: readonly BlendMode[] = [
  'normal',
  'multiply',
  'screen',
  'overlay',
  'darken',
  'lighten',
  'color-dodge',
  'color-burn',
  'hard-light',
  'soft-light',
  'difference',
  'exclusion',
  'hue',
  'saturation',
  'color',
  'luminosity',
]

/**
 * Named project-level color, surfaced in the project sidebar. Shapes can
 * reference a palette entry via `fillRef` / `strokeRef`, and the project
 * background can reference one via `bgRef`. The reference is metadata only —
 * the SVG always emits the resolved hex on the actual paint attribute so the
 * file renders correctly outside the editor.
 */
export interface PaletteColor {
  /** Free-form unique label. Empty names are not allowed by the editor. */
  name: string
  /** Hex color (`#rrggbb` or `#rgb`). */
  color: string
}

export interface ProjectSettings {
  /** Allowed snap angles in degrees. Empty array disables snapping. */
  snapAngles: number[]
  /** Global corner rounding amount, 0..1. */
  bezier: number
  /**
   * Project-level color palette. The editor enforces unique non-empty names;
   * the order is the order the user added entries (used as the display order
   * in the sidebar).
   */
  palette: PaletteColor[]
  /**
   * Background color (also rendered as a `<rect>` so the SVG previews correctly).
   * `null` means no background — the canvas shows a checkerboard for contrast and
   * the exported SVG omits the bg rect (transparent).
   */
  bg: string | null
  /** Optional palette reference for `bg`. Same metadata-only contract as shape refs. */
  bgRef?: string
  /**
   * Output rendered size — emitted as the SVG `width`/`height` attributes. Decoupled
   * from the viewBox so a small SVG can hold high-precision coordinates (e.g.
   * `width=100, viewBoxWidth=1000` renders the 1000-unit drawing scaled to 100px).
   */
  width: number
  height: number
  /**
   * SVG viewBox — defines the user coordinate system shapes live in and the
   * artboard the editor draws. Defaults to `0 0 width height`, matching the
   * legacy single-dimension behavior. Coordinates of every shape are in this
   * space; changing the viewBox does NOT move shapes (just the visible window
   * onto them).
   */
  viewBoxX: number
  viewBoxY: number
  viewBoxWidth: number
  viewBoxHeight: number
  /** Grid spacing in canvas units. Must be > 0 to be usable. */
  gridSize: number
  gridVisible: boolean
  gridSnap: boolean
  /** Clip rendered shapes to the artboard rectangle. */
  clip: boolean
  /**
   * Master switch for per-shape entrance animations. When false the timeline UI
   * is dimmed and saved SVGs strip every animation field — the file roundtrips
   * as a static composition. Per-shape `Shape.animation` data is preserved in
   * memory regardless, so toggling back on restores the authored animation.
   */
  animationEnabled: boolean
}

export interface ViewState {
  x: number
  y: number
  scale: number
}

export interface Drawing {
  type: 'line' | 'polygon' | 'circle'
  points: Point[]
}
