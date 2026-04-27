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
 */
export interface Shape {
  id: string;
  kind?: 'path' | 'circle';
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
