import { describe, expect, it } from 'bun:test'

import {
  arcSweep,
  arcToPath,
  bbox,
  buildPerPointSpecMap,
  corner,
  fmt,
  isPartialArc,
  pointsToPath,
  resolveCornerRadius,
} from './geometry'

import type { ArcRange, Point } from '../types'

describe('fmt', () => {
  it('rounds to 3 decimals', () => {
    expect(fmt(1.23456)).toBe(1.235)
  })
  it('returns 0 for non-finite', () => {
    expect(fmt(NaN)).toBe(0)
    expect(fmt(Infinity)).toBe(0)
  })
})

describe('pointsToPath - straight', () => {
  it('returns empty for zero points', () => {
    expect(pointsToPath([], false, 0)).toBe('')
  })

  it('returns just M for a single point', () => {
    expect(pointsToPath([[5, 5]], false, 0)).toBe('M 5 5')
  })

  it('emits L segments when bezier is 0', () => {
    const d = pointsToPath(
      [
        [0, 0],
        [10, 0],
        [10, 10],
      ],
      false,
      0,
    )
    expect(d).toBe('M 0 0 L 10 0 L 10 10')
  })

  it('closes with Z when closed is true', () => {
    const d = pointsToPath(
      [
        [0, 0],
        [10, 0],
        [10, 10],
      ],
      true,
      0,
    )
    expect(d).toBe('M 0 0 L 10 0 L 10 10 Z')
  })
})

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
    )
    expect(d).toContain('Q')
    expect(d.startsWith('M 0 0')).toBe(true)
    expect(d.endsWith('10 10')).toBe(true)
  })

  it('produces a fully rounded path for a closed triangle', () => {
    const d = pointsToPath(
      [
        [0, 0],
        [10, 0],
        [10, 10],
      ],
      true,
      1,
    )
    const qCount = (d.match(/Q/g) ?? []).length
    expect(qCount).toBe(3)
    expect(d.endsWith('Z')).toBe(true)
  })
})

describe('corner', () => {
  it('uses vertex as control for a 90° angle', () => {
    const c = corner([0, 0], [10, 0], [10, 10], 1)
    expect(c.interiorAngle).toBeCloseTo(90, 5)
    expect(c.control).toEqual([10, 0])
  })

  it('uses vertex as control for an obtuse angle', () => {
    const c = corner([0, 0], [10, 0], [20, 10], 1)
    expect(c.interiorAngle).toBeCloseTo(135, 5)
    expect(c.control).toEqual([10, 0])
  })

  it('uses vertex as control for an acute angle', () => {
    const c = corner([0, 0], [10, 0], [0, 10], 1)
    expect(c.interiorAngle).toBeCloseTo(45, 5)
    expect(c.control).toEqual([10, 0])
  })
})

describe('bbox', () => {
  it('returns extents of a list of points', () => {
    const pts: Point[] = [
      [10, 20],
      [50, -5],
      [0, 30],
    ]
    expect(bbox(pts)).toEqual({ x: 0, y: -5, w: 50, h: 35 })
  })
})

// The geometry must never emit NaN / Infinity into a `d` attribute, even when
// adjacent vertices coincide (zero-length edges) or are exactly collinear.
const looksValid = (d: string): boolean => !/(NaN|Infinity)/.test(d)

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
    )
    expect(looksValid(d)).toBe(true)
  })

  it('handles collinear interior vertices', () => {
    const d = pointsToPath(
      [
        [0, 0],
        [5, 0],
        [10, 0],
      ],
      false,
      1,
    )
    expect(looksValid(d)).toBe(true)
  })

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
    ).not.toThrow()
    const d = pointsToPath(
      [
        [0, 0],
        [10, 0],
        [10, 10],
      ],
      true,
      -1,
    )
    expect(d).toBe('M 0 0 L 10 0 L 10 10 Z')
  })

  it('emits one Q per vertex on a closed N-gon', () => {
    const pts: Point[] = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ]
    const d = pointsToPath(pts, true, 0.5)
    expect((d.match(/Q/g) ?? []).length).toBe(pts.length)
    expect(d.endsWith(' Z')).toBe(true)
  })

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
    )
    expect(d.startsWith('M 0 0 ')).toBe(true)
    expect(d.endsWith('100 50')).toBe(true)
  })
})

describe('mixed-angle polygon rounding', () => {
  const pentagon: Point[] = [
    [50, 80],
    [0, 0],
    [25, -30],
    [75, -30],
    [100, 0],
  ]

  it('produces a closed path with one Q per vertex and no NaN', () => {
    const d = pointsToPath(pentagon, true, 1)
    expect((d.match(/Q/g) ?? []).length).toBe(pentagon.length)
    expect(/(NaN|Infinity)/.test(d)).toBe(false)
  })

  it('every vertex filletes regardless of angle or polygon winding', () => {
    for (let i = 0; i < pentagon.length; i++) {
      const prev = pentagon[(i - 1 + pentagon.length) % pentagon.length]
      const cur = pentagon[i]
      const next = pentagon[(i + 1) % pentagon.length]
      const c = corner(prev, cur, next, 1)
      expect(c.control).toEqual(cur)
    }
  })
})

describe('resolveCornerRadius', () => {
  it('proportional matches the legacy t × 0.5 × min formula', () => {
    expect(resolveCornerRadius({ mode: 'proportional', value: 0.5 }, 100, 100, 0)).toBe(25)
    expect(resolveCornerRadius({ mode: 'proportional', value: 1 }, 100, 100, 0)).toBe(50)
  })

  it('absolute uses the raw value and clamps to half-min-neighbor', () => {
    expect(resolveCornerRadius({ mode: 'absolute', value: 30 }, 100, 100, 0)).toBe(30)
    expect(resolveCornerRadius({ mode: 'absolute', value: 999 }, 100, 100, 0)).toBe(50)
  })

  it('relative scales the value by canvasRef', () => {
    expect(resolveCornerRadius({ mode: 'relative', value: 0.05 }, 1000, 1000, 100)).toBe(5)
    expect(resolveCornerRadius({ mode: 'relative', value: 0.05 }, 1000, 1000, 200)).toBe(10)
  })

  it('clamps negative values to 0', () => {
    expect(resolveCornerRadius({ mode: 'absolute', value: -5 }, 100, 100, 0)).toBe(0)
    expect(resolveCornerRadius({ mode: 'relative', value: -1 }, 100, 100, 100)).toBe(0)
  })
})

describe('buildPerPointSpecMap', () => {
  it('returns undefined when there are no point overrides', () => {
    expect(buildPerPointSpecMap(undefined, undefined)).toBeUndefined()
    expect(buildPerPointSpecMap({}, undefined)).toBeUndefined()
  })

  it('pairs each value with its mode override, defaulting to proportional', () => {
    expect(buildPerPointSpecMap({ 0: 0.5, 2: 0.8 }, { 0: 'absolute' })).toEqual({
      0: { mode: 'absolute', value: 0.5 },
      2: { mode: 'proportional', value: 0.8 },
    })
  })
})

describe('pointsToPath bezier modes', () => {
  const triangle: Point[] = [
    [0, 0],
    [10, 0],
    [5, 100],
  ]
  it('proportional and oversize-absolute paths agree at the cap', () => {
    const dProp = pointsToPath(triangle, true, 1)
    const dAbs = pointsToPath(triangle, true, { mode: 'absolute', value: 1000 })
    expect(dAbs).toBe(dProp)
  })

  it('relative mode emits curves and scales with canvasRef', () => {
    const small = pointsToPath(triangle, true, { mode: 'relative', value: 0.05 }, undefined, 100)
    const big = pointsToPath(triangle, true, { mode: 'relative', value: 0.05 }, undefined, 1000)
    expect(small).toContain('Q')
    expect(big).toContain('Q')
    expect(small).not.toBe(big)
  })
})

describe('arc helpers', () => {
  it('arcSweep treats start === end as a full turn', () => {
    expect(arcSweep({ start: 0, end: 0, style: 'chord' })).toBe(360)
    expect(arcSweep({ start: 90, end: 450, style: 'chord' })).toBe(360)
  })

  it('arcSweep handles wrap-around (end < start)', () => {
    expect(arcSweep({ start: 350, end: 10, style: 'chord' })).toBe(20)
  })

  it('isPartialArc rejects undefined and full sweeps', () => {
    expect(isPartialArc(undefined)).toBe(false)
    expect(isPartialArc({ start: 0, end: 360, style: 'chord' })).toBe(false)
    expect(isPartialArc({ start: 0, end: 180, style: 'chord' })).toBe(true)
  })

  // A 90° wedge centred at the origin should start at the centre, line to
  // (r, 0), arc to (0, r), and close.
  it('arcToPath emits a wedge path with M to centre and Z', () => {
    const arc: ArcRange = { start: 0, end: 90, style: 'wedge' }
    const d = arcToPath(0, 0, 10, arc)
    expect(d.startsWith('M 0 0 L 10 0 ')).toBe(true)
    expect(d).toContain('A 10 10 0 0 1 ')
    expect(d.endsWith(' Z')).toBe(true)
  })

  // Chord style omits the line back to centre — start IS the first arc point.
  it('arcToPath chord style starts at the first arc point', () => {
    const d = arcToPath(0, 0, 10, { start: 0, end: 90, style: 'chord' })
    expect(d.startsWith('M 10 0 ')).toBe(true)
    expect(d.endsWith(' Z')).toBe(true)
    expect(d).not.toContain('L')
  })

  // Open style is just the curve — no Z, no L.
  it('arcToPath open style omits the closing segment', () => {
    const d = arcToPath(0, 0, 10, { start: 0, end: 90, style: 'open' })
    expect(d.startsWith('M 10 0 ')).toBe(true)
    expect(d.endsWith(' Z')).toBe(false)
    expect(d).not.toContain('L')
  })

  // The large-arc flag must flip when sweep exceeds 180°.
  it('arcToPath uses large-arc flag for sweeps over 180°', () => {
    const small = arcToPath(0, 0, 10, { start: 0, end: 90, style: 'open' })
    const large = arcToPath(0, 0, 10, { start: 0, end: 270, style: 'open' })
    expect(small).toContain('A 10 10 0 0 1 ')
    expect(large).toContain('A 10 10 0 1 1 ')
  })
})
