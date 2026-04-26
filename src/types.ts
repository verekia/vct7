export type Point = readonly [number, number];

export type Tool = 'select' | 'line' | 'polygon';

export interface Shape {
  id: string;
  points: Point[];
  closed: boolean;
  fill: string;
  stroke: string;
  strokeWidth: number;
  /** When null, the project's global bezier value applies. */
  bezierOverride: number | null;
}

export interface ProjectSettings {
  /** Allowed snap angles in degrees. Empty array disables snapping. */
  snapAngles: number[];
  /** Global corner rounding amount, 0..1. */
  bezier: number;
  /** Background color (also rendered as a `<rect>` so the SVG previews correctly). */
  bg: string;
  width: number;
  height: number;
  /** Grid spacing in canvas units. Must be > 0 to be usable. */
  gridSize: number;
  gridVisible: boolean;
  gridSnap: boolean;
}

export interface ViewState {
  x: number;
  y: number;
  scale: number;
}

export interface Drawing {
  type: 'line' | 'polygon';
  points: Point[];
}
