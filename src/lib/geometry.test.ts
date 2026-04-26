import { describe, expect, it } from 'vitest';
import { bbox, corner, fmt, pointsToPath, polygonWinding } from './geometry';
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

  // Acute corner (45°), convex (default): control should be the vertex (fillet).
  // Without winding info we treat the corner as convex, which is correct for
  // open polylines and for spikes sticking out of a closed polygon.
  it('uses vertex as control for a convex acute angle', () => {
    const c = corner([0, 0], [10, 0], [0, 10], 1);
    expect(c.interiorAngle).toBeCloseTo(45, 5);
    expect(c.control).toEqual([10, 0]);
  });

  // Acute corner (45°), reflex: control should be mirrored across the chord
  // (bulges AWAY from vertex). This is what a heart's top cusp wants.
  it('mirrors control for a reflex acute angle', () => {
    const c = corner([0, 0], [10, 0], [0, 10], 1, true);
    expect(c.interiorAngle).toBeCloseTo(45, 5);
    const midX = (c.a[0] + c.b[0]) / 2;
    const midY = (c.a[1] + c.b[1]) / 2;
    expect(c.control[0]).toBeCloseTo(2 * midX - 10, 5);
    expect(c.control[1]).toBeCloseTo(2 * midY - 0, 5);
  });

  it('only mirrors when both acute AND reflex', () => {
    const acuteConvex = corner([0, 0], [10, 0], [0, 5], 1, false); // ~26.6°
    const acuteReflex = corner([0, 0], [10, 0], [0, 5], 1, true);
    const obtuseReflex = corner([0, 0], [10, 0], [20, 1], 1, true); // ~174°
    expect(acuteConvex.control).toEqual([10, 0]);
    expect(acuteReflex.control[1]).toBeGreaterThan(0);
    expect(obtuseReflex.control).toEqual([10, 0]);
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

// The geometry must never emit NaN / Infinity into a `d` attribute, even when
// adjacent vertices coincide (zero-length edges) or are exactly collinear.
const looksValid = (d: string): boolean => !/(NaN|Infinity)/.test(d);

describe('pointsToPath robustness', () => {
  it('handles zero-length edges without emitting NaN', () => {
    const d = pointsToPath(
      [
        [0, 0],
        [0, 0], // duplicate
        [10, 10],
      ],
      false,
      1,
    );
    expect(looksValid(d)).toBe(true);
  });

  it('handles collinear interior vertices', () => {
    const d = pointsToPath(
      [
        [0, 0],
        [5, 0],
        [10, 0],
      ],
      false,
      1,
    );
    expect(looksValid(d)).toBe(true);
  });

  it('clamps bezier outside [0,1] silently', () => {
    expect(() =>
      pointsToPath(
        [
          [0, 0],
          [10, 0],
          [10, 10],
        ],
        true,
        5,
      ),
    ).not.toThrow();
    const d = pointsToPath(
      [
        [0, 0],
        [10, 0],
        [10, 10],
      ],
      true,
      -1,
    );
    expect(d).toBe('M 0 0 L 10 0 L 10 10 Z');
  });

  it('emits one Q per vertex on a closed N-gon', () => {
    const pts: Point[] = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ];
    const d = pointsToPath(pts, true, 0.5);
    expect((d.match(/Q/g) ?? []).length).toBe(pts.length);
    expect(d.endsWith(' Z')).toBe(true);
  });

  it('open polylines never round the endpoints', () => {
    // A straight-line endpoint must remain at the original `M` / final `L`
    // coordinate so users can connect / extend lines reliably.
    const d = pointsToPath(
      [
        [0, 0],
        [50, 0],
        [50, 50],
        [100, 50],
      ],
      false,
      1,
    );
    expect(d.startsWith('M 0 0 ')).toBe(true);
    expect(d.endsWith('100 50')).toBe(true);
  });
});

describe('mixed-angle polygon adaptive rounding', () => {
  // A pentagon with one obviously acute CONVEX vertex (a spike sticking out
  // below the body) and four obtuse vertices. The acute spike is convex —
  // a fillet should round it, NOT mirror it inward.
  const acuteIdx = 0;
  const pentagon: Point[] = [
    [50, 80], // acute spike below
    [0, 0],
    [25, -30],
    [75, -30],
    [100, 0],
  ];

  it('produces a closed path with one Q per vertex and no NaN', () => {
    const d = pointsToPath(pentagon, true, 1);
    expect((d.match(/Q/g) ?? []).length).toBe(pentagon.length);
    expect(/(NaN|Infinity)/.test(d)).toBe(false);
  });

  it('every vertex of a fully-convex polygon filletes (no mirror)', () => {
    for (let i = 0; i < pentagon.length; i++) {
      const prev = pentagon[(i - 1 + pentagon.length) % pentagon.length];
      const cur = pentagon[i];
      const next = pentagon[(i + 1) % pentagon.length];
      const c = corner(prev, cur, next, 1, /* isReflex */ false);
      if (i === acuteIdx) {
        expect(c.interiorAngle).toBeLessThan(90);
      } else {
        expect(c.interiorAngle).toBeGreaterThanOrEqual(90);
      }
      expect(c.control).toEqual(cur);
    }
  });
});

describe('reflex-aware adaptive rounding (heart-style cusp)', () => {
  // A heart-like outline with a sharp cusp dipping down between two lobes.
  // The cusp is the only reflex vertex; everything else is convex.
  const cuspIdx = 3;
  const heart: Point[] = [
    [50, 100], // bottom tip
    [100, 60],
    [75, 20], // right lobe
    [50, 60], // CUSP (reflex acute)
    [25, 20], // left lobe
    [0, 60],
  ];

  it('classifies the cusp as the only reflex vertex and mirrors only there', () => {
    const winding = polygonWinding(heart);
    let mirroredCount = 0;
    for (let i = 0; i < heart.length; i++) {
      const prev = heart[(i - 1 + heart.length) % heart.length];
      const cur = heart[i];
      const next = heart[(i + 1) % heart.length];
      const cross =
        (cur[0] - prev[0]) * (next[1] - cur[1]) - (cur[1] - prev[1]) * (next[0] - cur[0]);
      const isReflex = cross * winding < 0;
      const c = corner(prev, cur, next, 1, isReflex);
      if (i === cuspIdx) {
        expect(isReflex).toBe(true);
        expect(c.interiorAngle).toBeLessThan(90);
        expect(c.control).not.toEqual(cur);
        mirroredCount++;
      } else {
        expect(isReflex).toBe(false);
        expect(c.control).toEqual(cur);
      }
    }
    expect(mirroredCount).toBe(1);
  });
});
