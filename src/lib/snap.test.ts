import { describe, expect, it } from 'bun:test'

import { ANGLE_PRESETS, applySnap, rayIntersections, snapToAngle, snapToGrid, type SnapOptions } from './snap'

import type { Point } from '../types'

describe('snapToAngle', () => {
  it('returns the cursor unchanged when no angles are configured', () => {
    expect(snapToAngle({ x: 0, y: 0 }, { x: 5, y: 7 }, [])).toEqual({ x: 5, y: 7, angle: null })
  })

  it('snaps a near-horizontal cursor to the 0° ray', () => {
    const r = snapToAngle({ x: 0, y: 0 }, { x: 10, y: 0.4 }, [0, 90, 180, 270])
    expect(r.angle).toBe(0)
    expect(r.x).toBeCloseTo(10, 1)
    expect(r.y).toBeCloseTo(0, 5)
  })

  it('snaps a 45-ish cursor to 45°', () => {
    const r = snapToAngle({ x: 0, y: 0 }, { x: 10, y: 9 }, [0, 45, 90, 135])
    expect(r.angle).toBe(45)
    // The projection foot lies on the y=x line (in math coords) at length |to|·cos(diff).
    expect(r.x).toBeCloseTo(r.y, 5)
  })

  it('returns origin (and null angle) when from === to', () => {
    const r = snapToAngle({ x: 3, y: 3 }, { x: 3, y: 3 }, [0, 45, 90])
    expect(r.angle).toBe(null)
    expect(r.x).toBe(3)
    expect(r.y).toBe(3)
  })
})

describe('ANGLE_PRESETS', () => {
  it('has expected presets', () => {
    expect(ANGLE_PRESETS.ortho).toEqual([0, 90, 180, 270])
    expect(ANGLE_PRESETS['45'].length).toBe(8)
    expect(ANGLE_PRESETS['30'].length).toBe(12)
    expect(ANGLE_PRESETS['15'].length).toBe(24)
  })
})

describe('snapToAngle - normalization', () => {
  // -45° and 315° refer to the same ray; either should snap a south-east
  // cursor to that direction with the same projected coordinates.
  it('treats -45 and 315 as equivalent', () => {
    const a = snapToAngle({ x: 0, y: 0 }, { x: 10, y: 9 }, [-45])
    const b = snapToAngle({ x: 0, y: 0 }, { x: 10, y: 9 }, [315])
    expect(a.angle).toBe(b.angle)
    expect(a.x).toBeCloseTo(b.x, 9)
    expect(a.y).toBeCloseTo(b.y, 9)
  })

  // Snapping a cursor that's exactly orthogonal to all configured rays should
  // still pick *some* angle (the closest by distance) rather than crashing or
  // returning the cursor unchanged.
  it('always picks an angle when at least one is provided', () => {
    const r = snapToAngle({ x: 0, y: 0 }, { x: 0, y: 10 }, [0, 180])
    expect(r.angle).not.toBe(null)
  })

  // With both 0° and 180° configured, cursors on either side snap to the
  // appropriate ray (positive projection in both cases).
  it('snaps to 180° when cursor is on the negative x-axis', () => {
    const r = snapToAngle({ x: 0, y: 0 }, { x: -10, y: 0 }, [0, 180])
    expect(r.angle).toBe(180)
    expect(r.x).toBeCloseTo(-10, 5)
    expect(r.y).toBeCloseTo(0, 5)
  })
})

describe('snapToGrid', () => {
  it('snaps to the nearest grid intersection', () => {
    expect(snapToGrid([23, 17], 20)).toEqual([20, 20])
    expect(snapToGrid([31, 12], 20)).toEqual([40, 20])
    expect(snapToGrid([-7, -13], 20)).toEqual([-0, -20])
  })

  // A non-positive grid size would produce NaN/Infinity; the helper should
  // pass the point through unchanged so callers can be uniform.
  it('returns the point unchanged for non-positive sizes', () => {
    expect(snapToGrid([5, 7], 0)).toEqual([5, 7])
    expect(snapToGrid([5, 7], -10)).toEqual([5, 7])
    expect(snapToGrid([5, 7], NaN)).toEqual([5, 7])
  })
})

describe('applySnap', () => {
  const baseOpts: SnapOptions = {
    anchors: [],
    vertexTargets: [],
    snapAngles: [],
    gridSize: 0,
    gridSnap: false,
    pointThresholdCanvas: 10,
    snapDisabled: false,
  }

  it('passes the cursor through unchanged when snap is disabled', () => {
    const out = applySnap([5.7, 3.2], {
      ...baseOpts,
      snapAngles: [0, 90, 180, 270],
      vertexTargets: [[5, 3] as Point],
      anchors: [[0, 0] as Point],
      snapDisabled: true,
    })
    expect(out.snapped).toEqual([5.7, 3.2])
    expect(out.snapPoint).toBe(null)
  })

  // Magnetic vertex snap: cursor within the threshold of an existing vertex
  // jumps exactly to that vertex, overriding any continuous snaps.
  it('locks to a nearby vertex within the threshold', () => {
    const out = applySnap([102, 49], {
      ...baseOpts,
      vertexTargets: [[100, 50] as Point],
      anchors: [[0, 0] as Point],
      snapAngles: [0, 90, 180, 270],
      pointThresholdCanvas: 10,
    })
    expect(out.snapped).toEqual([100, 50])
    expect(out.snapPoint).toEqual([100, 50])
  })

  it('does not lock to a vertex outside the threshold', () => {
    const out = applySnap([120, 50], {
      ...baseOpts,
      vertexTargets: [[100, 50] as Point],
      pointThresholdCanvas: 10,
    })
    expect(out.snapPoint).toBe(null)
  })

  // With grid snap on, a cursor near a grid intersection should magnetically
  // lock to it (returned as snapPoint) rather than just rounded.
  it('locks to a nearby grid intersection when grid snap is on', () => {
    const out = applySnap([22, 19], {
      ...baseOpts,
      gridSnap: true,
      gridSize: 20,
      pointThresholdCanvas: 5,
    })
    expect(out.snapped).toEqual([20, 20])
    expect(out.snapPoint).toEqual([20, 20])
  })

  // Far from a grid intersection, grid snap still rounds (legacy behaviour),
  // but does not report a magnetic lock.
  it('rounds to grid without reporting a snapPoint when far from intersections', () => {
    const out = applySnap([29, 31], {
      ...baseOpts,
      gridSnap: true,
      gridSize: 20,
      pointThresholdCanvas: 5,
    })
    expect(out.snapped).toEqual([20, 40])
    expect(out.snapPoint).toBe(null)
  })

  // No vertex/grid hit → falls back to continuous angle projection.
  it('falls back to angle snap when no point target is in range', () => {
    const out = applySnap([10, 0.4], {
      ...baseOpts,
      anchors: [[0, 0] as Point],
      snapAngles: [0, 90, 180, 270],
      pointThresholdCanvas: 1,
    })
    expect(out.snapped[0]).toBeCloseTo(10, 1)
    expect(out.snapped[1]).toBeCloseTo(0, 5)
    expect(out.snapPoint).toBe(null)
  })

  // Vertex snap takes priority over both angle and grid snap.
  it('prefers vertex snap over grid round and angle projection', () => {
    const out = applySnap([21, 21], {
      ...baseOpts,
      vertexTargets: [[20, 20] as Point],
      gridSnap: true,
      gridSize: 20,
      anchors: [[0, 0] as Point],
      snapAngles: [0, 45, 90],
      pointThresholdCanvas: 10,
    })
    expect(out.snapped).toEqual([20, 20])
    expect(out.snapPoint).toEqual([20, 20])
  })
})

describe('rayIntersections', () => {
  // Horizontal line through A and vertical line through B → form a right angle
  // whose corner sits directly above (or below) B.
  it('intersects orthogonal rays from two anchors', () => {
    const out = rayIntersections([0, 0], [10, 10], [0, 90])
    // Pairs: (0,0) parallel, (90,90) parallel; (0,90) and (90,0) yield the
    // two right-angle corners — same line set, so the points are (10,0) and
    // (0,10).
    const pts = out.map(p => `${p[0].toFixed(3)},${p[1].toFixed(3)}`).toSorted()
    expect(pts).toEqual(['0.000,10.000', '10.000,0.000'])
  })

  // The classic "where do the two diagonals meet" case: 45° ray from origin
  // crosses 135° ray from (10, 0) at (5, 5).
  it('intersects 45/135 diagonals at the expected midpoint', () => {
    const out = rayIntersections([0, 0], [10, 0], [45, 135])
    // Find the (5, 5) intersection — the other crossings sit far away.
    const five = out.find(p => Math.abs(p[0] - 5) < 1e-6 && Math.abs(p[1] - 5) < 1e-6)
    expect(five).toBeDefined()
  })

  // Parallel rays (same angle) have no unique intersection and must be
  // skipped silently rather than emitting Infinity/NaN points.
  it('skips parallel ray pairs', () => {
    const out = rayIntersections([0, 0], [10, 5], [0])
    expect(out).toEqual([])
  })

  it('returns no points when angles is empty', () => {
    expect(rayIntersections([0, 0], [10, 10], [])).toEqual([])
  })
})
