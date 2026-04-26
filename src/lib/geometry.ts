import type { Point } from '../types';

const RAD_TO_DEG = 180 / Math.PI;

export const dist = (a: Point, b: Point): number => Math.hypot(a[0] - b[0], a[1] - b[1]);

export const fmt = (n: number): number => (Number.isFinite(n) ? Number(n.toFixed(3)) : 0);

interface CornerSegments {
  /** Point on the previous edge near `cur`, where the rounding starts. */
  a: Point;
  /** Point on the next edge near `cur`, where the rounding ends. */
  b: Point;
  /** Control point for a quadratic bezier from `a` to `b`. */
  control: Point;
  /** Interior angle at `cur` in degrees, in [0, 180]. */
  interiorAngle: number;
}

/**
 * Build the rounded-corner segments at a vertex.
 *
 * Rounding direction is *adaptive* based on the interior angle:
 * - obtuse / right (≥ 90°) → curve bulges TOWARD the vertex (a classic fillet),
 * - acute (< 90°) → curve bulges AWAY from the vertex (an inward cusp).
 *
 * That matches how vectorheart compositions read visually: gentle corners get
 * softened outward, sharp corners pinch inward, which is exactly what a heart's
 * top cusp vs. its side bumps want.
 */
export function corner(prev: Point, cur: Point, next: Point, t: number): CornerSegments {
  const inDx = cur[0] - prev[0];
  const inDy = cur[1] - prev[1];
  const inLen = Math.hypot(inDx, inDy) || 1;
  const outDx = next[0] - cur[0];
  const outDy = next[1] - cur[1];
  const outLen = Math.hypot(outDx, outDy) || 1;

  const radius = Math.max(0, Math.min(1, t)) * 0.5 * Math.min(inLen, outLen);

  const a: Point = [cur[0] - (inDx / inLen) * radius, cur[1] - (inDy / inLen) * radius];
  const b: Point = [cur[0] + (outDx / outLen) * radius, cur[1] + (outDy / outLen) * radius];

  const inUx = -inDx / inLen;
  const inUy = -inDy / inLen;
  const outUx = outDx / outLen;
  const outUy = outDy / outLen;
  const cosInterior = Math.max(-1, Math.min(1, inUx * outUx + inUy * outUy));
  const interiorAngle = Math.acos(cosInterior) * RAD_TO_DEG;

  let control: Point = cur;
  if (interiorAngle < 90) {
    const mx = (a[0] + b[0]) / 2;
    const my = (a[1] + b[1]) / 2;
    control = [2 * mx - cur[0], 2 * my - cur[1]];
  }

  return { a, b, control, interiorAngle };
}

/**
 * Render a polyline (or polygon) as an SVG `d` attribute, with corners rounded
 * by `bezier` ∈ [0, 1]. 0 produces straight `L` segments only.
 */
export function pointsToPath(points: Point[], closed: boolean, bezier: number): string {
  if (points.length === 0) return '';
  if (points.length === 1) {
    const [x, y] = points[0];
    return `M ${fmt(x)} ${fmt(y)}`;
  }

  const t = Math.max(0, Math.min(1, bezier || 0));
  const n = points.length;

  if (t <= 0) {
    let d = `M ${fmt(points[0][0])} ${fmt(points[0][1])}`;
    for (let i = 1; i < n; i++) {
      d += ` L ${fmt(points[i][0])} ${fmt(points[i][1])}`;
    }
    if (closed) d += ' Z';
    return d;
  }

  if (closed && n >= 3) {
    const corners: CornerSegments[] = [];
    for (let i = 0; i < n; i++) {
      corners.push(corner(points[(i - 1 + n) % n], points[i], points[(i + 1) % n], t));
    }
    let d = `M ${fmt(corners[0].b[0])} ${fmt(corners[0].b[1])}`;
    for (let i = 1; i < n; i++) {
      const c = corners[i];
      d += ` L ${fmt(c.a[0])} ${fmt(c.a[1])}`;
      d += ` Q ${fmt(c.control[0])} ${fmt(c.control[1])} ${fmt(c.b[0])} ${fmt(c.b[1])}`;
    }
    const c0 = corners[0];
    d += ` L ${fmt(c0.a[0])} ${fmt(c0.a[1])}`;
    d += ` Q ${fmt(c0.control[0])} ${fmt(c0.control[1])} ${fmt(c0.b[0])} ${fmt(c0.b[1])}`;
    d += ' Z';
    return d;
  }

  let d = `M ${fmt(points[0][0])} ${fmt(points[0][1])}`;
  for (let i = 1; i < n - 1; i++) {
    const c = corner(points[i - 1], points[i], points[i + 1], t);
    d += ` L ${fmt(c.a[0])} ${fmt(c.a[1])}`;
    d += ` Q ${fmt(c.control[0])} ${fmt(c.control[1])} ${fmt(c.b[0])} ${fmt(c.b[1])}`;
  }
  d += ` L ${fmt(points[n - 1][0])} ${fmt(points[n - 1][1])}`;
  if (closed) d += ' Z';
  return d;
}

export function bbox(points: Point[]): { x: number; y: number; w: number; h: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}
