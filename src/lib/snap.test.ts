import { describe, expect, it } from 'vitest';
import { ANGLE_PRESETS, snapToAngle } from './snap';

describe('snapToAngle', () => {
  it('returns the cursor unchanged when no angles are configured', () => {
    expect(snapToAngle({ x: 0, y: 0 }, { x: 5, y: 7 }, [])).toEqual({ x: 5, y: 7, angle: null });
  });

  it('snaps a near-horizontal cursor to the 0° ray', () => {
    const r = snapToAngle({ x: 0, y: 0 }, { x: 10, y: 0.4 }, [0, 90, 180, 270]);
    expect(r.angle).toBe(0);
    expect(r.x).toBeCloseTo(10, 1);
    expect(r.y).toBeCloseTo(0, 5);
  });

  it('snaps a 45-ish cursor to 45°', () => {
    const r = snapToAngle({ x: 0, y: 0 }, { x: 10, y: 9 }, [0, 45, 90, 135]);
    expect(r.angle).toBe(45);
    // The projection foot lies on the y=x line (in math coords) at length |to|·cos(diff).
    expect(r.x).toBeCloseTo(r.y, 5);
  });

  it('returns origin (and null angle) when from === to', () => {
    const r = snapToAngle({ x: 3, y: 3 }, { x: 3, y: 3 }, [0, 45, 90]);
    expect(r.angle).toBe(null);
    expect(r.x).toBe(3);
    expect(r.y).toBe(3);
  });
});

describe('ANGLE_PRESETS', () => {
  it('has expected presets', () => {
    expect(ANGLE_PRESETS.ortho).toEqual([0, 90, 180, 270]);
    expect(ANGLE_PRESETS['45'].length).toBe(8);
    expect(ANGLE_PRESETS['30'].length).toBe(12);
    expect(ANGLE_PRESETS['15'].length).toBe(24);
  });
});

describe('snapToAngle - normalization', () => {
  // -45° and 315° refer to the same ray; either should snap a south-east
  // cursor to that direction with the same projected coordinates.
  it('treats -45 and 315 as equivalent', () => {
    const a = snapToAngle({ x: 0, y: 0 }, { x: 10, y: 9 }, [-45]);
    const b = snapToAngle({ x: 0, y: 0 }, { x: 10, y: 9 }, [315]);
    expect(a.angle).toBe(b.angle);
    expect(a.x).toBeCloseTo(b.x, 9);
    expect(a.y).toBeCloseTo(b.y, 9);
  });

  // Snapping a cursor that's exactly orthogonal to all configured rays should
  // still pick *some* angle (the closest by distance) rather than crashing or
  // returning the cursor unchanged.
  it('always picks an angle when at least one is provided', () => {
    const r = snapToAngle({ x: 0, y: 0 }, { x: 0, y: 10 }, [0, 180]);
    expect(r.angle).not.toBe(null);
  });

  // With both 0° and 180° configured, cursors on either side snap to the
  // appropriate ray (positive projection in both cases).
  it('snaps to 180° when cursor is on the negative x-axis', () => {
    const r = snapToAngle({ x: 0, y: 0 }, { x: -10, y: 0 }, [0, 180]);
    expect(r.angle).toBe(180);
    expect(r.x).toBeCloseTo(-10, 5);
    expect(r.y).toBeCloseTo(0, 5);
  });
});
