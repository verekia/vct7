import { describe, expect, it } from 'vitest';
import { bbox, corner, fmt, pointsToPath } from './geometry';
import type { Point } from '../types';

describe('fmt', () => {
  it('rounds to 3 decimals', () => {
    expect(fmt(1.23456)).toBe(1.235);
  });
  it('returns 0 for non-finite', () => {
    expect(fmt(NaN)).toBe(0);
    expect(fmt(Infinity)).toBe(0);
  });
});

describe('pointsToPath - straight', () => {
  it('returns empty for zero points', () => {
    expect(pointsToPath([], false, 0)).toBe('');
  });

  it('returns just M for a single point', () => {
    expect(pointsToPath([[5, 5]], false, 0)).toBe('M 5 5');
  });

  it('emits L segments when bezier is 0', () => {
    const d = pointsToPath(
      [
        [0, 0],
        [10, 0],
        [10, 10],
      ],
      false,
      0,
    );
    expect(d).toBe('M 0 0 L 10 0 L 10 10');
  });

  it('closes with Z when closed is true', () => {
    const d = pointsToPath(
      [
        [0, 0],
        [10, 0],
        [10, 10],
      ],
      true,
      0,
    );
    expect(d).toBe('M 0 0 L 10 0 L 10 10 Z');
  });
});

describe('pointsToPath - rounded', () => {
  it('emits Q segments at interior vertices for open polylines', () => {
    const d = pointsToPath(
      [
        [0, 0],
        [10, 0],
        [10, 10],
      ],
      false,
      1,
    );
    expect(d).toContain('Q');
    expect(d.startsWith('M 0 0')).toBe(true);
    expect(d.endsWith('10 10')).toBe(true);
  });

  it('produces a fully rounded path for a closed triangle', () => {
    const d = pointsToPath(
      [
        [0, 0],
        [10, 0],
        [10, 10],
      ],
      true,
      1,
    );
    const qCount = (d.match(/Q/g) ?? []).length;
    expect(qCount).toBe(3);
    expect(d.endsWith('Z')).toBe(true);
  });
});

describe('corner adaptive direction', () => {
  // 90° corner of a square: (0,0) → (10,0) → (10,10).
  // Interior angle is exactly 90°; threshold is `< 90°`, so the curve uses the
  // vertex itself as the control point (bulges TOWARD the corner).
  it('uses vertex as control for a 90° angle', () => {
    const c = corner([0, 0], [10, 0], [10, 10], 1);
    expect(c.interiorAngle).toBeCloseTo(90, 5);
    expect(c.control).toEqual([10, 0]);
  });

  // Obtuse corner (135°): control should still be the vertex.
  it('uses vertex as control for an obtuse angle', () => {
    // (0,0) → (10,0) → (20, 10): angle at (10,0) is 135°.
    const c = corner([0, 0], [10, 0], [20, 10], 1);
    expect(c.interiorAngle).toBeCloseTo(135, 5);
    expect(c.control).toEqual([10, 0]);
  });

  // Acute corner (45°): control should be mirrored across the chord (bulges AWAY from vertex).
  it('mirrors control for an acute angle', () => {
    // (0,0) → (10,0) → (0,10): angle at (10,0) is 45°.
    const c = corner([0, 0], [10, 0], [0, 10], 1);
    expect(c.interiorAngle).toBeCloseTo(45, 5);
    // Control is reflection of (10,0) through midpoint of (a,b).
    const midX = (c.a[0] + c.b[0]) / 2;
    const midY = (c.a[1] + c.b[1]) / 2;
    expect(c.control[0]).toBeCloseTo(2 * midX - 10, 5);
    expect(c.control[1]).toBeCloseTo(2 * midY - 0, 5);
  });

  it('curve direction visibly differs across the 90° threshold', () => {
    const acute = corner([0, 0], [10, 0], [0, 5], 1); // ~26.6°
    const obtuse = corner([0, 0], [10, 0], [20, 1], 1); // ~174°
    // For the acute case, control_y > 0 (mirrored upward); for the obtuse case, control = vertex.
    expect(acute.control[1]).toBeGreaterThan(0);
    expect(obtuse.control).toEqual([10, 0]);
  });
});

describe('bbox', () => {
  it('returns extents of a list of points', () => {
    const pts: Point[] = [
      [10, 20],
      [50, -5],
      [0, 30],
    ];
    expect(bbox(pts)).toEqual({ x: 0, y: -5, w: 50, h: 35 });
  });
});
