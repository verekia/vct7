export type Point = readonly [number, number];

export type Tool = 'select' | 'line' | 'polygon' | 'circle';

/**
 * Optional partial-circle range for `kind === 'circle'` shapes. When absent,
 * the shape is a full circle. Angles are degrees, measured clockwise from
 * 3 o'clock (matching SVG screen coordinates). `style` decides how the arc
 * is closed: `'wedge'` adds straight edges back to the center (pie slice),
 * `'chord'` connects the endpoints with a straight line (D-shape), and
 * `'open'` leaves the curve unfilled.
 */
export interface ArcRange {
  start: number;
  end: number;
  style: 'wedge' | 'chord' | 'open';
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
  id: string;
  kind?: 'path' | 'circle' | 'glyphs';
  points: Point[];
  closed: boolean;
  fill: string;
  stroke: string;
  strokeWidth: number;
  /** When null, the project's global bezier value applies. */
  bezierOverride: number | null;
  hidden: boolean;
  locked: boolean;
  /** User-supplied display name. Empty / undefined falls back to "polygon" / "line" / "circle". */
  name?: string;
  /** Partial-circle range. Only meaningful when `kind === 'circle'`. */
  arc?: ArcRange;
  /**
   * CSS `mix-blend-mode` value applied to the rendered shape. Absent / `'normal'`
   * means no blending (the default).
   */
  blendMode?: BlendMode;
  /** Element opacity in [0, 1]. Absent / `1` means fully opaque (the default). */
  opacity?: number;
  /** Baked text outline data. Only meaningful when `kind === 'glyphs'`. */
  glyphs?: GlyphData;
  /**
   * Rotation in degrees, applied around the visual bbox center. Composes with
   * `scale` and (for glyphs) the local-coord translate. Absent / `0` means no
   * rotation. Stored as a transform on top of `points` rather than baked, so
   * the user can adjust it freely; "Apply transform" bakes the current value
   * into the geometry and resets back to `0`.
   */
  rotation?: number;
  /**
   * Uniform scale factor, applied around the visual bbox center. Absent / `1`
   * means no scaling. Same baking semantics as `rotation`.
   */
  scale?: number;
}

/**
 * Vectorized text payload. `d` is the combined SVG path data for every glyph,
 * anchored so that the visible bbox starts at (0, 0) — the renderer just
 * translates by the shape's top-left. `text` / `fontFamily` / `fontSize` are
 * informational only; once vectorized, the text is "frozen" — the path data is
 * the source of truth and does not get re-rasterized.
 */
export interface GlyphData {
  text: string;
  fontFamily: string;
  fontSize: number;
  d: string;
  width: number;
  height: number;
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
  | 'luminosity';

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
];

export interface ProjectSettings {
  /** Allowed snap angles in degrees. Empty array disables snapping. */
  snapAngles: number[];
  /** Global corner rounding amount, 0..1. */
  bezier: number;
  /**
   * Background color (also rendered as a `<rect>` so the SVG previews correctly).
   * `null` means no background — the canvas shows a checkerboard for contrast and
   * the exported SVG omits the bg rect (transparent).
   */
  bg: string | null;
  /**
   * Output rendered size — emitted as the SVG `width`/`height` attributes. Decoupled
   * from the viewBox so a small SVG can hold high-precision coordinates (e.g.
   * `width=100, viewBoxWidth=1000` renders the 1000-unit drawing scaled to 100px).
   */
  width: number;
  height: number;
  /**
   * SVG viewBox — defines the user coordinate system shapes live in and the
   * artboard the editor draws. Defaults to `0 0 width height`, matching the
   * legacy single-dimension behavior. Coordinates of every shape are in this
   * space; changing the viewBox does NOT move shapes (just the visible window
   * onto them).
   */
  viewBoxX: number;
  viewBoxY: number;
  viewBoxWidth: number;
  viewBoxHeight: number;
  /** Grid spacing in canvas units. Must be > 0 to be usable. */
  gridSize: number;
  gridVisible: boolean;
  gridSnap: boolean;
  /** Clip rendered shapes to the artboard rectangle. */
  clip: boolean;
}

export interface ViewState {
  x: number;
  y: number;
  scale: number;
}

export interface Drawing {
  type: 'line' | 'polygon' | 'circle';
  points: Point[];
}
