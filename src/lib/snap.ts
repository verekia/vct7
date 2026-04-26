import type { Point } from '../types';

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

const normalize = (a: number): number => ((a % 360) + 360) % 360;

export interface SnapResult {
  x: number;
  y: number;
  /** Which allowed angle (deg) was chosen, or null if snapping was skipped. */
  angle: number | null;
}

/**
 * Project `to` onto a ray from `from` along the nearest of `angles` (degrees).
 *
 * The projected point is the perpendicular foot of `to` on the chosen ray, so
 * the cursor visibly snaps to the closest allowed direction without locking the
 * length. If `angles` is empty, returns `to` unchanged.
 */
export function snapToAngle(
  from: { x: number; y: number },
  to: { x: number; y: number },
  angles: number[],
): SnapResult {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  if (angles.length === 0 || len < 1e-6) {
    return { x: to.x, y: to.y, angle: null };
  }
  const cur = normalize(Math.atan2(dy, dx) * RAD_TO_DEG);
  let bestAngle = angles[0];
  let bestDiff = Infinity;
  for (const a of angles) {
    const an = normalize(a);
    const raw = Math.abs(an - cur);
    const diff = Math.min(raw, 360 - raw);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestAngle = an;
    }
  }
  const rad = bestAngle * DEG_TO_RAD;
  const projLen = len * Math.cos(bestDiff * DEG_TO_RAD);
  return {
    x: from.x + projLen * Math.cos(rad),
    y: from.y + projLen * Math.sin(rad),
    angle: bestAngle,
  };
}

/** Sentinel angle sets useful as project presets. */
export const ANGLE_PRESETS: Record<string, number[]> = {
  ortho: [0, 90, 180, 270],
  '45': [0, 45, 90, 135, 180, 225, 270, 315],
  '30': [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330],
  '60': [0, 60, 120, 180, 240, 300],
  '15': Array.from({ length: 24 }, (_, i) => i * 15),
};

export const distancePoints = (a: Point, b: Point): number => Math.hypot(a[0] - b[0], a[1] - b[1]);
