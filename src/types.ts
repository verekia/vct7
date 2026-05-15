export type Point = readonly [number, number]

export type Tool = 'select' | 'line' | 'polygon' | 'circle'

/**
 * How a bezier value is interpreted when building the rounded-corner arc:
 *
 * - `proportional` — `value ∈ [0, 1]`, scaled against the shorter neighboring
 *   edge length. Far-apart vertices get larger arcs; this is the legacy mode.
 * - `absolute` — `value` is a corner radius in canvas units. Independent of
 *   neighbor distances, so every corner with the same value has the same
 *   visible arc (until the half-min-neighbor cap kicks in).
 * - `relative` — `value ∈ [0, 1]`, scaled against `min(viewBoxWidth,
 *   viewBoxHeight)`. Lives between the other two: independent of neighbors,
 *   but the absolute radius tracks the canvas size if it changes.
 */
export type BezierMode = 'proportional' | 'absolute' | 'relative'

export const BEZIER_MODES: readonly BezierMode[] = ['proportional', 'absolute', 'relative']

/**
 * A named bezier rounding value, shared across the whole project. Shapes and
 * vertices can reference one by `name`; tweaking the preset's value or mode
 * updates every corner that refers to it. References to missing presets fall
 * through silently to the next layer in the resolution chain.
 */
export interface BezierPreset {
  /** Unique identifier and display name. */
  name: string
  /** Corner-rounding amount. Range depends on `mode`. */
  value: number
  /** How `value` is interpreted. Absent in legacy files → `'proportional'`. */
  mode?: BezierMode
}

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
   * Mode this shape's `bezierOverride` uses. Absent (or undefined when
   * `bezierOverride === null`) means `'proportional'`. The mode is meaningful
   * only when `bezierOverride !== null` — clearing the override clears the
   * mode too.
   */
  bezierModeOverride?: BezierMode
  /**
   * Reference to a `BezierPreset` by name. When set, *wins over* the inline
   * `bezierOverride` / `bezierModeOverride` for this layer (those are kept in
   * memory but ignored at render time). Setting a ref via the panel clears
   * the inline pair; setting an inline value via the panel clears the ref.
   * `null` means no ref — fall through to the inline pair, then the global.
   */
  bezierRef?: string | null
  /**
   * Sparse per-vertex bezier override map (`pointIndex → t`). Wins over the
   * layer's `bezierOverride` and the project's global bezier for the corner
   * at that vertex. Endpoints of open polylines have no corner — entries on
   * those indices are stored faithfully but render as a no-op.
   */
  pointBezierOverrides?: Record<number, number>
  /**
   * Sparse per-vertex mode override, parallel to `pointBezierOverrides`. A
   * missing entry implies `'proportional'`. Indices present here without a
   * matching numeric override are meaningless (mode without a value to
   * interpret) and ignored at render time.
   */
  pointBezierModeOverrides?: Record<number, BezierMode>
  /**
   * Sparse per-vertex preset reference map. A ref at a vertex wins over the
   * inline value/mode at that vertex AND over the shape-level ref / inline.
   * Refs to missing presets fall through to the next layer.
   */
  pointBezierRefs?: Record<number, string>
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
  /**
   * Live mirror modifier — adds a reflected copy of the shape that updates as
   * the source is edited. Source and reflection behave as one rigid pair: the
   * shape's instance rotation/scale and its animation pivot move from the
   * source's bbox center to the *combined* bbox center while a mirror is
   * attached. Use `convertMirrorToGroup` on the store to bake the reflection
   * into a second independent shape inside a fresh group.
   */
  mirror?: MirrorSpec
  /**
   * Live radial repeat modifier — clones the shape rotated around `(cx, cy)`
   * by `angle`, `2·angle`, … up to one full turn. Mutually exclusive with
   * `mirror` at the UI level. The rotation/scale pivot stays the source's own
   * bbox center; only the rendered clones rotate around the radial center.
   */
  radial?: RadialSpec
  /**
   * Optional group membership — when set, the shape is a member of the
   * project-level group with this id. Group is purely a logical/selection
   * concept (no nesting, no transform inheritance); members keep their own
   * z-position in the shapes array.
   */
  groupId?: string
}

/**
 * Project-level group — a flat, named container shapes can opt into via
 * `groupId`. Click-cycling on the canvas alternates between selecting the
 * whole group and the clicked individual member; a group's members are
 * kept contiguous in the shapes array so the renderer can wrap them in a
 * single `<g>` element.
 *
 * `rotation` / `scale` are applied around the group's combined bbox center
 * via the wrapping `<g>`'s `transform` attribute, so the whole group rotates
 * and scales as a rigid body — the SVG-native equivalent of a group
 * transform in Figma/Illustrator. Members keep their own per-shape
 * transforms; the two compose visually. `animation` runs on the wrapping
 * `<g>` too, so an entire group can be animated as one unit independent of
 * its members' individual animations.
 */
export interface Group {
  id: string
  name: string
  /** Rotation in degrees, applied around the group's combined bbox center. */
  rotation?: number
  /** Uniform scale factor, applied around the group's combined bbox center. */
  scale?: number
  /** Group-level entrance animation, runs on the `<g>` wrapping the members. */
  animation?: AnimationSpec
  /**
   * Live mirror modifier on the whole group — adds a reflected copy of every
   * member across `axis`. The axis is in canvas coordinates and is independent
   * of the group's own rotation/scale (the entire transformed group is what
   * gets reflected). `convertGroupMirror` bakes the reflection into new shape
   * members of this same group.
   */
  mirror?: MirrorSpec
  /**
   * Live radial repeat on the whole group — clones the entire group rotated
   * around `(cx, cy)` by `angle`, `2·angle`, … up to one full turn. Mutually
   * exclusive with `mirror` at the UI level. `convertGroupRadial` bakes every
   * clone into new shape members of this same group.
   */
  radial?: RadialSpec
}

/**
 * Mirror axis as a line through `(x, y)` at `angle` degrees from the canvas
 * x-axis (0 = horizontal line, 90 = vertical line / horizontal flip). Stored
 * in the source shape's untransformed coord space — the source's instance
 * rotation rotates the axis with the shape so the pair behaves as a unit.
 */
export interface MirrorAxis {
  x: number
  y: number
  angle: number
}

export interface MirrorSpec {
  axis: MirrorAxis
  /** Render the bright-green axis line + its drag handles on canvas. Default false. */
  showAxis?: boolean
}

/**
 * Radial repetition spec. Clones of the shape are rendered at every angle
 * `k · angle` for `k = 1 .. floor((360 - eps)/angle)` around `(cx, cy)`. The
 * source itself sits at `k = 0`. Angle is in degrees and must be > 0.
 */
export interface RadialSpec {
  /** Rotation center in canvas coords. */
  cx: number
  cy: number
  /** Angular increment between consecutive copies, in degrees. */
  angle: number
  /** Render the orange center dot on canvas. Default false. */
  showCenter?: boolean
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
  /**
   * Named bezier presets, shared across the whole project. The first entry
   * is the *implicit global default* — any shape/vertex that doesn't override
   * inherits its value and mode. Renaming the first preset still keeps it as
   * the default (position, not name, decides). Must contain at least one
   * entry: new projects ship with `{ name: 'default', value: 0.5 }`, and the
   * SVG loader synthesizes one from legacy `data-v7-bezier` attributes when a
   * pre-presets file is opened.
   */
  bezierPresets: BezierPreset[]
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
