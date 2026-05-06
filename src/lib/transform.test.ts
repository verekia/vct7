import { describe, expect, it } from 'bun:test'

import { defaultMirrorAxis, pairBBoxCenter, reflectPoint, reflectShape, transformPointsAround } from './transform'

import type { Shape } from '../types'

const baseShape = (overrides: Partial<Shape> = {}): Shape => ({
  id: 'a',
  points: [
    [0, 0],
    [10, 0],
    [10, 10],
  ],
  closed: true,
  fill: '#000',
  stroke: 'none',
  strokeWidth: 1,
  bezierOverride: null,
  hidden: false,
  locked: false,
  ...overrides,
})

describe('reflectPoint', () => {
  // Horizontal flip across a vertical line through x=5: (10, 0) → (0, 0).
  it('reflects across a vertical line (angle = 90°)', () => {
    const p = reflectPoint([10, 0], { x: 5, y: 0, angle: 90 })
    expect(p[0]).toBeCloseTo(0)
    expect(p[1]).toBeCloseTo(0)
  })

  // Vertical flip across a horizontal line through y=5: (3, 10) → (3, 0).
  it('reflects across a horizontal line (angle = 0°)', () => {
    const p = reflectPoint([3, 10], { x: 0, y: 5, angle: 0 })
    expect(p[0]).toBeCloseTo(3)
    expect(p[1]).toBeCloseTo(0)
  })

  // Reflection across the line y = x through origin: (3, 0) → (0, 3).
  it('reflects across a 45° line', () => {
    const p = reflectPoint([3, 0], { x: 0, y: 0, angle: 45 })
    expect(p[0]).toBeCloseTo(0)
    expect(p[1]).toBeCloseTo(3)
  })

  // Reflecting a point on the axis itself is identity.
  it('keeps points on the axis unchanged', () => {
    const p = reflectPoint([5, 5], { x: 5, y: 5, angle: 30 })
    expect(p[0]).toBeCloseTo(5)
    expect(p[1]).toBeCloseTo(5)
  })
})

describe('reflectShape', () => {
  it('reflects points and clears mirror to prevent recursion', () => {
    const s = baseShape({ mirror: { axis: { x: 5, y: 0, angle: 90 } } })
    const r = reflectShape(s, s.mirror!.axis)
    expect(r.mirror).toBeUndefined()
    expect(r.points[0][0]).toBeCloseTo(10)
    expect(r.points[1][0]).toBeCloseTo(0)
    expect(r.points[2][0]).toBeCloseTo(0)
  })

  // Live mirror keeps the source's rotation so the renderer can apply it
  // around the combined pivot — different from the destructive flipShapes.
  it('preserves rotation (rotation is applied around the combined pivot at render time)', () => {
    const s = baseShape({ rotation: 30 })
    const r = reflectShape(s, { x: 0, y: 0, angle: 90 })
    expect(r.rotation).toBe(30)
  })

  // Arc start/end swap so the clockwise sweep convention survives a mirror.
  it('mirrors arc angles and swaps start/end', () => {
    const s: Shape = {
      ...baseShape(),
      kind: 'circle',
      points: [
        [10, 10],
        [15, 10],
      ],
      arc: { start: 30, end: 90, style: 'wedge' },
    }
    const r = reflectShape(s, { x: 10, y: 10, angle: 90 })
    // angle 90° (vertical line) → 2θ - α = 180 - α, with start/end swap.
    expect(r.arc).toEqual({ start: 180 - 90, end: 180 - 30, style: 'wedge' })
  })
})

describe('pairBBoxCenter', () => {
  // Mirror axis through x=15 doubles the width of the pair: source bbox spans
  // [0, 10], reflection spans [20, 30]. Combined center is x=15, y=5.
  it('returns the midpoint of the source+reflection bbox', () => {
    const s = baseShape({ mirror: { axis: { x: 15, y: 0, angle: 90 } } })
    const [cx, cy] = pairBBoxCenter(s)
    expect(cx).toBeCloseTo(15)
    expect(cy).toBeCloseTo(5)
  })

  // Without a mirror, falls back to the shape's own bbox center.
  it('falls back to the shape bbox center when no mirror is set', () => {
    const s = baseShape()
    const [cx, cy] = pairBBoxCenter(s)
    expect(cx).toBeCloseTo(5)
    expect(cy).toBeCloseTo(5)
  })
})

describe('transformPointsAround', () => {
  it('returns a copy unchanged when rotation/scale are identity', () => {
    const out = transformPointsAround(
      [
        [1, 2],
        [3, 4],
      ],
      0,
      1,
      0,
      0,
    )
    expect(out).toEqual([
      [1, 2],
      [3, 4],
    ])
  })

  // 90° CW rotation around (0,0): (1, 0) → (0, 1).
  it('rotates points around an explicit pivot', () => {
    const out = transformPointsAround([[1, 0]], 90, 1, 0, 0)
    expect(out[0][0]).toBeCloseTo(0)
    expect(out[0][1]).toBeCloseTo(1)
  })

  it('scales relative to the pivot', () => {
    const out = transformPointsAround([[2, 2]], 0, 0.5, 0, 0)
    expect(out[0][0]).toBeCloseTo(1)
    expect(out[0][1]).toBeCloseTo(1)
  })
})

describe('defaultMirrorAxis', () => {
  it('places a vertical line (angle 90°) through the supplied canvas center by default', () => {
    const a = defaultMirrorAxis(50, 75)
    expect(a.x).toBe(50)
    expect(a.y).toBe(75)
    expect(a.angle).toBe(90)
  })

  it('accepts an explicit angle (0° = horizontal axis line / top-bottom flip)', () => {
    const a = defaultMirrorAxis(50, 75, 0)
    expect(a.angle).toBe(0)
  })
})
