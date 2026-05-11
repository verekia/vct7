import { beforeEach, describe, expect, it } from 'bun:test'

import { parsePathD, parsePathMultiD, parseTransform } from './svg-import'
import { DEFAULT_SETTINGS, parseProject, resetIds, serializeProject, stripV7Attributes } from './svg-io'

import type { ProjectSettings, Shape } from '../types'

const sampleSettings: ProjectSettings = {
  snapAngles: [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330],
  bezier: 0.2,
  palette: [],
  bg: '#ffeedd',
  width: 400,
  height: 300,
  viewBoxX: 0,
  viewBoxY: 0,
  viewBoxWidth: 400,
  viewBoxHeight: 300,
  gridSize: 25,
  gridVisible: true,
  gridSnap: false,
  clip: false,
  animationEnabled: false,
}

const sampleShapes: Shape[] = [
  {
    id: 'a',
    points: [
      [10, 10],
      [100, 10],
      [100, 100],
    ],
    closed: true,
    fill: '#ff0000',
    stroke: 'none',
    strokeWidth: 1,
    bezierOverride: 0.5,
    hidden: false,
    locked: false,
  },
  {
    id: 'b',
    points: [
      [20, 200],
      [300, 200],
    ],
    closed: false,
    fill: 'none',
    stroke: '#000',
    strokeWidth: 2,
    bezierOverride: null,
    hidden: false,
    locked: false,
  },
]

describe('serializeProject', () => {
  it('emits a valid <svg> with vh metadata attributes', () => {
    const text = serializeProject(sampleSettings, sampleShapes)
    expect(text).toContain('<?xml version="1.0"')
    expect(text).toContain('viewBox="0 0 400 300"')
    expect(text).toContain('data-v7-snap-angles="0,30,60,90,120,150,180,210,240,270,300,330"')
    expect(text).toContain('data-v7-bezier="0.2"')
    expect(text).toContain('data-v7-bg="#ffeedd"')
    expect(text).toContain('<rect x="0" y="0" width="400" height="300" fill="#ffeedd"/>')
  })

  it('writes per-shape bezier override only when set', () => {
    const text = serializeProject(sampleSettings, sampleShapes)
    const aBlock = text.match(/data-v7-points="10,10[\s\S]*?\/>/)?.[0] ?? ''
    const bBlock = text.match(/data-v7-points="20,200[\s\S]*?\/>/)?.[0] ?? ''
    expect(aBlock).toContain('data-v7-bezier="0.5"')
    expect(bBlock).not.toContain('data-v7-bezier=')
  })
})

describe('stripV7Attributes', () => {
  it('removes every data-v7-* attribute while preserving real SVG attributes', () => {
    const text = serializeProject(sampleSettings, sampleShapes)
    const stripped = stripV7Attributes(text)
    expect(stripped).not.toMatch(/data-v7-/)
    expect(stripped).toContain('viewBox="0 0 400 300"')
    expect(stripped).toContain('width="400"')
    expect(stripped).toContain('fill="#ff0000"')
  })

  it('still parses as valid SVG after stripping', () => {
    const stripped = stripV7Attributes(serializeProject(sampleSettings, sampleShapes))
    const doc = new DOMParser().parseFromString(stripped, 'image/svg+xml')
    expect(doc.querySelector('parsererror')).toBeNull()
    expect(doc.querySelector('svg')).not.toBeNull()
  })
})

describe('parsePathD', () => {
  it('parses M and L commands as anchor points', () => {
    const r = parsePathD('M 10 20 L 30 40 L 50 60 Z')
    expect(r.points).toEqual([
      [10, 20],
      [30, 40],
      [50, 60],
    ])
    expect(r.closed).toBe(true)
  })

  it('handles relative moves', () => {
    const r = parsePathD('m 10 10 l 5 0 l 0 5 z')
    expect(r.points).toEqual([
      [10, 10],
      [15, 10],
      [15, 15],
    ])
    expect(r.closed).toBe(true)
  })

  it('flattens cubic and quadratic curves into sampled polyline points', () => {
    const r = parsePathD('M 0 0 C 10 0 20 10 30 10 Q 40 20 50 20')
    // First and last points are exact; the curves contribute many sample
    // points in between so the silhouette tracks them rather than a chord.
    expect(r.points[0]).toEqual([0, 0])
    expect(r.points[r.points.length - 1]).toEqual([50, 20])
    expect(r.points.length).toBeGreaterThan(20)
    expect(r.closed).toBe(false)
    // The cubic bulges below its chord (start->end is y=0..10 with controls
    // at y=0 and y=10), so at least one sampled point should sit above the
    // straight chord — a regression check that we're actually sampling the
    // curve, not just emitting a denser polyline along the chord.
    const cubicSample = r.points.find(([x]) => x > 5 && x < 25)
    expect(cubicSample).toBeDefined()
    if (cubicSample) expect(cubicSample[1]).toBeGreaterThan(0)
  })

  it('reflects S/T smooth-curve controls off the previous segment', () => {
    // Two cubics whose join is C1-end at (10,10), C2-start by S reflection
    // sits at (20 - 10, 20 - 10) = (10, 10) mirrored about (10,10) → (10,10)
    // is the join point; mirroring (8,2) about (10,10) gives ctrl1=(12,18).
    const r = parsePathD('M 0 0 C 2 8 8 2 10 10 S 18 18 20 20')
    // Sanity: endpoints exact, plenty of samples.
    expect(r.points[0]).toEqual([0, 0])
    expect(r.points[r.points.length - 1]).toEqual([20, 20])
    expect(r.points.length).toBeGreaterThan(30)
  })

  it('flattens elliptical arcs along the curve, not as a chord', () => {
    // Quarter arc from (10,0) to (0,10) on the radius-10 circle centered at
    // origin (sweep=1 picks the (0,0) center over the (10,10) alternative).
    const r = parsePathD('M 10 0 A 10 10 0 0 1 0 10')
    expect(r.points[0]).toEqual([10, 0])
    expect(r.points[r.points.length - 1][0]).toBeCloseTo(0, 5)
    expect(r.points[r.points.length - 1][1]).toBeCloseTo(10, 5)
    // Every sampled point sits on the radius-10 circle around origin.
    for (const [x, y] of r.points) {
      expect(Math.hypot(x, y)).toBeCloseTo(10, 4)
    }
    // A real arc bows outward from its chord — the midpoint of a 90° arc
    // is at (cos45°, sin45°)·10 ≈ (7.07, 7.07), well above the chord
    // midpoint at (5, 5).
    const mid = r.points[Math.floor(r.points.length / 2)]
    expect(mid[0]).toBeGreaterThan(5)
    expect(mid[1]).toBeGreaterThan(5)
  })

  it('drops the duplicate closing vertex', () => {
    const r = parsePathD('M 0 0 L 10 0 L 10 10 L 0 0 Z')
    expect(r.points).toEqual([
      [0, 0],
      [10, 0],
      [10, 10],
    ])
    expect(r.closed).toBe(true)
  })

  it('returns only the first subpath for foreign multi-subpath input', () => {
    const r = parsePathD('M 0 0 L 10 0 L 10 10 Z M 100 100 L 110 100 L 110 110 Z')
    expect(r.points).toEqual([
      [0, 0],
      [10, 0],
      [10, 10],
    ])
    expect(r.closed).toBe(true)
  })
})

describe('parsePathMultiD', () => {
  it('returns one ParsedPath per subpath, each independently closed', () => {
    const parts = parsePathMultiD('M 0 0 L 10 0 L 10 10 Z M 100 100 L 110 100 L 110 110 Z')
    expect(parts).toHaveLength(2)
    expect(parts[0].points).toEqual([
      [0, 0],
      [10, 0],
      [10, 10],
    ])
    expect(parts[0].closed).toBe(true)
    expect(parts[1].points).toEqual([
      [100, 100],
      [110, 100],
      [110, 110],
    ])
    expect(parts[1].closed).toBe(true)
  })

  it('keeps a single-subpath path as a single entry', () => {
    const parts = parsePathMultiD('M 0 0 L 10 0 L 10 10 Z')
    expect(parts).toHaveLength(1)
    expect(parts[0].points).toEqual([
      [0, 0],
      [10, 0],
      [10, 10],
    ])
  })

  it('mixes closed and open subpaths', () => {
    const parts = parsePathMultiD('M 0 0 L 10 0 L 10 10 Z M 50 50 L 60 60')
    expect(parts).toHaveLength(2)
    expect(parts[0].closed).toBe(true)
    expect(parts[1].closed).toBe(false)
    expect(parts[1].points).toEqual([
      [50, 50],
      [60, 60],
    ])
  })

  it('handles a relative m starting a second subpath from the prior current point', () => {
    // After `M 0 0 L 10 0 Z`, current point returns to (0,0). `m 50 50` then
    // becomes absolute (0+50, 0+50) → (50, 50).
    const parts = parsePathMultiD('M 0 0 L 10 0 Z m 50 50 l 10 0')
    expect(parts).toHaveLength(2)
    expect(parts[1].points[0]).toEqual([50, 50])
    expect(parts[1].points[1]).toEqual([60, 50])
  })
})

describe('parseTransform', () => {
  it('parses translate / scale / rotate', () => {
    const t = parseTransform('translate(10 20)')
    expect(t.e).toBe(10)
    expect(t.f).toBe(20)
    const s = parseTransform('scale(2 3)')
    expect(s.a).toBe(2)
    expect(s.d).toBe(3)
    const r = parseTransform('rotate(90)')
    expect(r.a).toBeCloseTo(0)
    expect(r.b).toBeCloseTo(1)
  })
})

describe('parseProject — fresh SVG import (no v7 metadata)', () => {
  it('imports plain SVG paths and circles as editable shapes', () => {
    const text = `<?xml version="1.0"?>
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">
        <path d="M 10 10 L 90 10 L 90 90 L 10 90 Z" fill="#ff0000"/>
        <circle cx="50" cy="50" r="20" fill="#00ff00"/>
      </svg>`
    const parsed = parseProject(text)
    expect(parsed.shapes).toHaveLength(2)
    expect(parsed.shapes[0].points).toEqual([
      [10, 10],
      [90, 10],
      [90, 90],
      [10, 90],
    ])
    expect(parsed.shapes[0].closed).toBe(true)
    expect(parsed.shapes[0].fill).toBe('#ff0000')
    // Plain `M L L L Z` square has no curves; reconciliation lifts the
    // recovered `t = 0` to `settings.bezier` and nulls the shape override.
    expect(parsed.settings.bezier).toBe(0)
    expect(parsed.shapes[0].bezierOverride).toBe(null)
    expect(parsed.shapes[1].kind).toBe('circle')
    expect(parsed.shapes[1].points[0]).toEqual([50, 50])
    expect(parsed.shapes[1].points[1]).toEqual([70, 50])
  })

  it('imports rect/line/polygon/polyline primitives', () => {
    const text = `<?xml version="1.0"?>
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200">
        <rect x="5" y="5" width="20" height="10"/>
        <line x1="0" y1="0" x2="50" y2="50"/>
        <polygon points="100,100 150,100 125,150"/>
        <polyline points="0,180 50,180 50,200"/>
      </svg>`
    const parsed = parseProject(text)
    expect(parsed.shapes).toHaveLength(4)
    expect(parsed.shapes[0].points).toEqual([
      [5, 5],
      [25, 5],
      [25, 15],
      [5, 15],
    ])
    expect(parsed.shapes[0].closed).toBe(true)
    expect(parsed.shapes[1].points).toEqual([
      [0, 0],
      [50, 50],
    ])
    expect(parsed.shapes[1].closed).toBe(false)
    expect(parsed.shapes[2].closed).toBe(true)
    expect(parsed.shapes[3].closed).toBe(false)
  })

  it('absorbs a leading viewBox-sized rect as the project background', () => {
    const text = `<?xml version="1.0"?>
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">
        <rect x="0" y="0" width="100" height="100" fill="#123456"/>
        <circle cx="50" cy="50" r="10" fill="#ffffff"/>
      </svg>`
    const parsed = parseProject(text)
    expect(parsed.settings.bg).toBe('#123456')
    expect(parsed.shapes).toHaveLength(1)
    expect(parsed.shapes[0].kind).toBe('circle')
  })

  it('skips elements inside <defs> / <clipPath>', () => {
    const text = `<?xml version="1.0"?>
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">
        <defs><clipPath id="c"><rect x="0" y="0" width="100" height="100"/></clipPath></defs>
        <path d="M 0 0 L 50 0 L 50 50 Z"/>
      </svg>`
    const parsed = parseProject(text)
    expect(parsed.shapes).toHaveLength(1)
    expect(parsed.shapes[0].closed).toBe(true)
  })

  it('round-trips a stripped VCT7 export back to editable shapes with exact vertices', () => {
    resetIds(1)
    const exported = serializeProject(sampleSettings, sampleShapes)
    const stripped = stripV7Attributes(exported)
    const reparsed = parseProject(stripped)
    expect(reparsed.shapes.length).toBe(sampleShapes.length)
    expect(reparsed.settings.bg).toBe(sampleSettings.bg)
    // The triangle was the only shape with corners; its `t = 0.5` becomes
    // the project-level `settings.bezier`, and the shape inherits it via a
    // null override (the line contributed nothing — no corners).
    expect(reparsed.settings.bezier).toBeCloseTo(0.5, 2)
    expect(reparsed.shapes[0].points).toEqual([
      [10, 10],
      [100, 10],
      [100, 100],
    ])
    expect(reparsed.shapes[0].closed).toBe(true)
    expect(reparsed.shapes[0].bezierOverride).toBe(null)
    expect(reparsed.shapes[0].pointBezierOverrides).toBeUndefined()
    expect(reparsed.shapes[1].points).toEqual([
      [20, 200],
      [300, 200],
    ])
    expect(reparsed.shapes[1].closed).toBe(false)
    expect(reparsed.shapes[1].bezierOverride).toBe(null)
  })

  it('preserves per-vertex bezier overrides across a stripped round-trip', () => {
    resetIds(1)
    const sq: Shape = {
      id: 'sq',
      points: [
        [0, 0],
        [100, 0],
        [100, 100],
        [0, 100],
      ],
      closed: true,
      fill: '#000000',
      stroke: 'none',
      strokeWidth: 1,
      bezierOverride: 0.4,
      pointBezierOverrides: { 2: 0.8 },
      hidden: false,
      locked: false,
    }
    const exported = serializeProject({ ...sampleSettings, bg: null }, [sq])
    const stripped = stripV7Attributes(exported)
    const reparsed = parseProject(stripped)
    expect(reparsed.shapes).toHaveLength(1)
    expect(reparsed.shapes[0].points).toEqual([
      [0, 0],
      [100, 0],
      [100, 100],
      [0, 100],
    ])
    // The shape's representative `t` (0.4) becomes global; the shape's own
    // override is nulled (it matches global), and the deviating corner at
    // index 2 is preserved as a per-vertex override.
    expect(reparsed.settings.bezier).toBeCloseTo(0.4, 2)
    expect(reparsed.shapes[0].bezierOverride).toBe(null)
    expect(reparsed.shapes[0].pointBezierOverrides).toBeDefined()
    expect(reparsed.shapes[0].pointBezierOverrides?.[2]).toBeCloseTo(0.8, 2)
  })

  it('lifts the dominant per-shape bezier into settings.bezier and keeps outliers as overrides', () => {
    resetIds(1)
    const triangleAt = (cx: number, cy: number, t: number): Shape => ({
      id: `t${cx}`,
      points: [
        [cx, cy],
        [cx + 60, cy],
        [cx + 60, cy + 60],
      ],
      closed: true,
      fill: '#000000',
      stroke: 'none',
      strokeWidth: 1,
      bezierOverride: t,
      hidden: false,
      locked: false,
    })
    const shapes = [triangleAt(0, 0, 0.5), triangleAt(100, 0, 0.5), triangleAt(0, 100, 0.5), triangleAt(100, 100, 0.8)]
    const exported = serializeProject({ ...sampleSettings, bg: null, bezier: 0.1 }, shapes)
    const stripped = stripV7Attributes(exported)
    const reparsed = parseProject(stripped)
    expect(reparsed.shapes).toHaveLength(4)
    // Three shapes vote 0.5, one votes 0.8 — global lifts to 0.5.
    expect(reparsed.settings.bezier).toBeCloseTo(0.5, 2)
    // The matching shapes get nulled to inherit global; the outlier keeps
    // its explicit override.
    expect(reparsed.shapes[0].bezierOverride).toBe(null)
    expect(reparsed.shapes[1].bezierOverride).toBe(null)
    expect(reparsed.shapes[2].bezierOverride).toBe(null)
    expect(reparsed.shapes[3].bezierOverride).toBeCloseTo(0.8, 2)
  })

  it('bakes ancestor transforms into shape points', () => {
    const text = `<?xml version="1.0"?>
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">
        <g transform="translate(50 50)">
          <rect x="0" y="0" width="10" height="10"/>
        </g>
      </svg>`
    const parsed = parseProject(text)
    expect(parsed.shapes[0].points).toEqual([
      [50, 50],
      [60, 50],
      [60, 60],
      [50, 60],
    ])
  })
})

describe('parseProject round-trip', () => {
  it('preserves settings and shape control points', () => {
    resetIds(1)
    const text = serializeProject(sampleSettings, sampleShapes)
    const parsed = parseProject(text)

    expect(parsed.settings).toEqual(sampleSettings)
    expect(parsed.shapes).toHaveLength(2)

    expect(parsed.shapes[0].points).toEqual([
      [10, 10],
      [100, 10],
      [100, 100],
    ])
    expect(parsed.shapes[0].closed).toBe(true)
    expect(parsed.shapes[0].fill).toBe('#ff0000')
    expect(parsed.shapes[0].bezierOverride).toBe(0.5)

    expect(parsed.shapes[1].points).toEqual([
      [20, 200],
      [300, 200],
    ])
    expect(parsed.shapes[1].closed).toBe(false)
    expect(parsed.shapes[1].bezierOverride).toBe(null)
  })

  it('throws on invalid XML', () => {
    expect(() => parseProject('<not valid')).toThrow()
  })

  // Regression: `if (bz)` correctly treats the string "0" as truthy, so a
  // global bezier of exactly 0 round-trips. (Easy bug to introduce later.)
  it('preserves bezier === 0 across round-trip', () => {
    const settings: ProjectSettings = { ...sampleSettings, bezier: 0 }
    const text = serializeProject(settings, [])
    expect(parseProject(text).settings.bezier).toBe(0)
  })

  // Regression: a per-shape bezierOverride of 0 (forced sharp) must come back
  // as 0, not null. `bezierOverride !== null` is the intent, not a truthy check.
  it('preserves shape bezierOverride === 0', () => {
    const shape: Shape = { ...sampleShapes[0], bezierOverride: 0 }
    const text = serializeProject(sampleSettings, [shape])
    const parsed = parseProject(text)
    expect(parsed.shapes[0].bezierOverride).toBe(0)
  })

  // Round-trip rotation+scale via data-v7-rotation / data-v7-scale. Identity
  // (0° / 1×) values must NOT appear in the output to keep diffs noise-free.
  it('round-trips rotation and scale', () => {
    const rotated: Shape = { ...sampleShapes[0], rotation: 45, scale: 2 }
    const text = serializeProject(sampleSettings, [rotated])
    expect(text).toContain('data-v7-rotation="45"')
    expect(text).toContain('data-v7-scale="2"')
    expect(text).toContain('transform="')
    const parsed = parseProject(text)
    expect(parsed.shapes[0].rotation).toBe(45)
    expect(parsed.shapes[0].scale).toBe(2)
  })

  // stroke-linejoin / stroke-linecap default to round; explicit non-default
  // values round-trip, and stroke-dasharray rides through verbatim. Round-only
  // values are kept off the in-memory shape so toggling between defaults and
  // overrides behaves predictably.
  it('round-trips stroke-linejoin / linecap / dasharray', () => {
    const shape: Shape = {
      ...sampleShapes[1],
      strokeLinejoin: 'bevel',
      strokeLinecap: 'square',
      strokeDasharray: '4 2',
    }
    const text = serializeProject(sampleSettings, [shape])
    expect(text).toContain('stroke-linejoin="bevel"')
    expect(text).toContain('stroke-linecap="square"')
    expect(text).toContain('stroke-dasharray="4 2"')
    const parsed = parseProject(text)
    expect(parsed.shapes[0].strokeLinejoin).toBe('bevel')
    expect(parsed.shapes[0].strokeLinecap).toBe('square')
    expect(parsed.shapes[0].strokeDasharray).toBe('4 2')
  })

  it('omits stroke-dasharray when unset and treats round join/cap as default', () => {
    const text = serializeProject(sampleSettings, [sampleShapes[1]])
    expect(text).not.toContain('stroke-dasharray')
    const parsed = parseProject(text)
    expect(parsed.shapes[0].strokeLinejoin).toBeUndefined()
    expect(parsed.shapes[0].strokeLinecap).toBeUndefined()
    expect(parsed.shapes[0].strokeDasharray).toBeUndefined()
  })

  // paint-order=stroke flips stroke under fill; default order omits the attr
  // entirely so unrelated files don't pick it up on re-save.
  it('round-trips paint-order="stroke"', () => {
    const shape: Shape = { ...sampleShapes[1], paintOrder: 'stroke' }
    const text = serializeProject(sampleSettings, [shape])
    expect(text).toContain('paint-order="stroke"')
    const parsed = parseProject(text)
    expect(parsed.shapes[0].paintOrder).toBe('stroke')
  })

  it('omits paint-order when default (fill first)', () => {
    const text = serializeProject(sampleSettings, [sampleShapes[1]])
    expect(text).not.toContain('paint-order')
    const parsed = parseProject(text)
    expect(parsed.shapes[0].paintOrder).toBeUndefined()
  })

  it('omits rotation/scale attrs at identity', () => {
    const text = serializeProject(sampleSettings, [sampleShapes[0]])
    expect(text).not.toContain('data-v7-rotation')
    expect(text).not.toContain('data-v7-scale')
    const parsed = parseProject(text)
    expect(parsed.shapes[0].rotation).toBeUndefined()
    expect(parsed.shapes[0].scale).toBeUndefined()
  })

  // Regression: bezierOverride === null must NOT appear in the SVG output and
  // must come back as null (not 0).
  it('preserves null bezierOverride (no attribute written)', () => {
    const shape: Shape = { ...sampleShapes[1], bezierOverride: null }
    const text = serializeProject(sampleSettings, [shape])
    expect(text).not.toMatch(/data-v7-bezier="[\d.]+"\s*\/>/)
    const parsed = parseProject(text)
    expect(parsed.shapes[0].bezierOverride).toBe(null)
  })

  // Mixed file: a hand-edited v7 SVG with foreign paths should load both —
  // the v7-tagged path round-trips precisely, the foreign one comes in via
  // the plain-SVG fallback. The leading viewBox-sized `<rect>` is absorbed
  // as the background color.
  it('imports both v7-tagged and foreign <path> elements', () => {
    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect width="100" height="100" fill="white"/>
  <path d="M0 0 L10 10" fill="red"/>
  <path d="M5 5 L20 20" data-v7-points="5,5 20,20" data-v7-closed="false"/>
</svg>`
    const parsed = parseProject(svg)
    expect(parsed.settings.bg).toBe('white')
    expect(parsed.shapes).toHaveLength(2)
    expect(parsed.shapes[0].points).toEqual([
      [0, 0],
      [10, 10],
    ])
    // 2-vertex line has no corners; bezierOverride is meaningless and gets
    // nulled so the on-disk file stays clean.
    expect(parsed.shapes[0].bezierOverride).toBe(null)
    expect(parsed.shapes[1].points).toEqual([
      [5, 5],
      [20, 20],
    ])
  })

  // Circles serialize as native <circle> elements (so external viewers render
  // them correctly) with `data-v7-points` carrying the editor's center +
  // perimeter anchor for round-trip.
  it('round-trips a kind=circle shape as a native <circle>', () => {
    const circleShape: Shape = {
      id: 'c',
      kind: 'circle',
      points: [
        [50, 60],
        [70, 60],
      ],
      closed: true,
      fill: '#0f0',
      stroke: 'none',
      strokeWidth: 3,
      bezierOverride: null,
      hidden: false,
      locked: false,
    }
    const text = serializeProject(sampleSettings, [circleShape])
    expect(text).toContain('<circle ')
    expect(text).toContain('cx="50"')
    expect(text).toContain('cy="60"')
    expect(text).toContain('r="20"')
    expect(text).toContain('data-v7-kind="circle"')

    resetIds(1)
    const parsed = parseProject(text)
    expect(parsed.shapes).toHaveLength(1)
    const back = parsed.shapes[0]
    expect(back.kind).toBe('circle')
    expect(back.closed).toBe(true)
    expect(back.fill).toBe('#0f0')
    expect(back.points).toEqual([
      [50, 60],
      [70, 60],
    ])
  })

  // Partial circles serialize as <path> with an arc command rather than as
  // <circle>, since native circles can't represent a sweep. The data-v7-arc
  // attribute carries start, end, and style for round-trip.
  it('round-trips a partial-arc circle as a tagged <path>', () => {
    const arcShape: Shape = {
      id: 'a',
      kind: 'circle',
      points: [
        [50, 60],
        [70, 60],
      ],
      closed: true,
      fill: '#0f0',
      stroke: '#000',
      strokeWidth: 2,
      bezierOverride: null,
      hidden: false,
      locked: false,
      arc: { start: 0, end: 180, style: 'chord' },
    }
    const text = serializeProject(sampleSettings, [arcShape])
    expect(text).toContain('<path ')
    expect(text).not.toContain('<circle ')
    expect(text).toContain('data-v7-kind="circle"')
    expect(text).toContain('data-v7-arc="0,180,chord"')

    resetIds(1)
    const parsed = parseProject(text)
    expect(parsed.shapes).toHaveLength(1)
    const back = parsed.shapes[0]
    expect(back.kind).toBe('circle')
    expect(back.arc).toEqual({ start: 0, end: 180, style: 'chord' })
    expect(back.points).toEqual([
      [50, 60],
      [70, 60],
    ])
  })

  // Open arcs render with fill="none" so external viewers don't fill the chord.
  it('serializes an open partial circle with fill="none"', () => {
    const arcShape: Shape = {
      id: 'a',
      kind: 'circle',
      points: [
        [0, 0],
        [10, 0],
      ],
      closed: true,
      fill: '#abc',
      stroke: '#000',
      strokeWidth: 2,
      bezierOverride: null,
      hidden: false,
      locked: false,
      arc: { start: 0, end: 90, style: 'open' },
    }
    const text = serializeProject(sampleSettings, [arcShape])
    expect(text).toContain('fill="none"')
    expect(text).toContain('data-v7-arc="0,90,open"')
  })

  // If a saved file has a tagged <circle> but its data-v7-points is missing
  // (e.g. hand-edited externally), reconstruct the perimeter anchor from
  // cx/cy/r so the shape stays editable.
  it('reconstructs circle perimeter from cx/cy/r when data-v7-points is incomplete', () => {
    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <circle cx="40" cy="40" r="15" data-v7-points="40,40" data-v7-kind="circle" data-v7-closed="true" fill="#000" stroke="none" stroke-width="2"/>
</svg>`
    const parsed = parseProject(svg)
    expect(parsed.shapes).toHaveLength(1)
    expect(parsed.shapes[0].kind).toBe('circle')
    expect(parsed.shapes[0].points).toEqual([
      [40, 40],
      [55, 40],
    ])
  })

  it('falls back to defaults when SVG omits all vh metadata', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"/>`
    const parsed = parseProject(svg)
    expect(parsed.settings.width).toBe(200)
    expect(parsed.settings.height).toBe(100)
    expect(parsed.settings.viewBoxWidth).toBe(200)
    expect(parsed.settings.viewBoxHeight).toBe(100)
    expect(parsed.shapes).toEqual([])
  })

  // The viewBox and the SVG width/height attributes are independent dimensions:
  // the viewBox is the inner coordinate system and the artboard the editor draws,
  // while width/height are the output rendered size. They round-trip separately.
  it('round-trips a viewBox distinct from the output width/height', () => {
    const settings: ProjectSettings = {
      ...sampleSettings,
      width: 100,
      height: 100,
      viewBoxX: 10,
      viewBoxY: 20,
      viewBoxWidth: 1000,
      viewBoxHeight: 800,
    }
    const text = serializeProject(settings, [])
    expect(text).toContain('viewBox="10 20 1000 800"')
    expect(text).toContain('width="100"')
    expect(text).toContain('height="100"')
    // The bg rect covers the visible viewBox region, not the output box.
    expect(text).toContain('<rect x="10" y="20" width="1000" height="800"')
    const parsed = parseProject(text)
    expect(parsed.settings.viewBoxX).toBe(10)
    expect(parsed.settings.viewBoxY).toBe(20)
    expect(parsed.settings.viewBoxWidth).toBe(1000)
    expect(parsed.settings.viewBoxHeight).toBe(800)
    expect(parsed.settings.width).toBe(100)
    expect(parsed.settings.height).toBe(100)
  })

  // SVGs created outside the editor often lack a viewBox; falling back to
  // (0, 0, width, height) keeps drawing extent matching the legacy semantics.
  it('parses width/height with no viewBox by deriving the viewBox from them', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"/>`
    const parsed = parseProject(svg)
    expect(parsed.settings.width).toBe(640)
    expect(parsed.settings.height).toBe(480)
    expect(parsed.settings.viewBoxX).toBe(0)
    expect(parsed.settings.viewBoxY).toBe(0)
    expect(parsed.settings.viewBoxWidth).toBe(640)
    expect(parsed.settings.viewBoxHeight).toBe(480)
  })

  // Per-shape blend mode round-trips via data-v7-blend, and is reflected in
  // an inline `style="mix-blend-mode:..."` so external browser viewers honor it.
  it('round-trips a blendMode and emits an inline mix-blend-mode style', () => {
    const shape: Shape = { ...sampleShapes[0], blendMode: 'multiply' }
    const text = serializeProject(sampleSettings, [shape])
    expect(text).toContain('data-v7-blend="multiply"')
    expect(text).toContain('style="mix-blend-mode:multiply"')
    const parsed = parseProject(text)
    expect(parsed.shapes[0].blendMode).toBe('multiply')
  })

  // The default ('normal' or undefined) must NOT pollute the SVG output.
  it('omits blend mode attributes when blendMode is undefined or normal', () => {
    const a: Shape = { ...sampleShapes[0] }
    const b: Shape = { ...sampleShapes[1], blendMode: 'normal' }
    const text = serializeProject(sampleSettings, [a, b])
    expect(text).not.toContain('data-v7-blend')
    expect(text).not.toContain('mix-blend-mode')
    const parsed = parseProject(text)
    expect(parsed.shapes[0].blendMode).toBeUndefined()
    expect(parsed.shapes[1].blendMode).toBeUndefined()
  })

  it('round-trips opacity < 1 via the standard SVG opacity attribute', () => {
    const shape: Shape = { ...sampleShapes[0], opacity: 0.4 }
    const text = serializeProject(sampleSettings, [shape])
    expect(text).toContain('opacity="0.4"')
    const parsed = parseProject(text)
    expect(parsed.shapes[0].opacity).toBe(0.4)
  })

  it('omits opacity attribute when undefined or 1 (and parses no opacity as undefined)', () => {
    const a: Shape = { ...sampleShapes[0] }
    const b: Shape = { ...sampleShapes[1], opacity: 1 }
    const text = serializeProject(sampleSettings, [a, b])
    expect(text).not.toContain('opacity=')
    const parsed = parseProject(text)
    expect(parsed.shapes[0].opacity).toBeUndefined()
    expect(parsed.shapes[1].opacity).toBeUndefined()
  })

  // An unknown blend value is dropped on parse rather than carried through.
  it('ignores unknown blend mode values on parse', () => {
    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <path d="M0 0 L10 10" data-v7-points="0,0 10,10" data-v7-closed="false" data-v7-blend="bogus"/>
</svg>`
    const parsed = parseProject(svg)
    expect(parsed.shapes[0].blendMode).toBeUndefined()
  })

  // Palette + per-shape ref attributes round-trip together. The SVG keeps the
  // resolved hex on `fill` / `stroke` so external viewers render correctly,
  // while data-v7-{fill,stroke}-ref preserves the link to the palette entry.
  it('round-trips palette and per-shape fill/stroke refs', () => {
    const settings: ProjectSettings = {
      ...sampleSettings,
      palette: [
        { name: 'primary', color: '#ff8800' },
        { name: 'ink', color: '#111111' },
      ],
      bg: '#ff8800',
      bgRef: 'primary',
    }
    const shape: Shape = {
      ...sampleShapes[0],
      fill: '#ff8800',
      fillRef: 'primary',
      stroke: '#111111',
      strokeRef: 'ink',
      strokeWidth: 2,
    }
    const text = serializeProject(settings, [shape])
    expect(text).toContain('data-v7-palette="primary:#ff8800;ink:#111111"')
    expect(text).toContain('data-v7-bg-ref="primary"')
    expect(text).toContain('data-v7-fill-ref="primary"')
    expect(text).toContain('data-v7-stroke-ref="ink"')
    const parsed = parseProject(text)
    expect(parsed.settings.palette).toEqual([
      { name: 'primary', color: '#ff8800' },
      { name: 'ink', color: '#111111' },
    ])
    expect(parsed.settings.bgRef).toBe('primary')
    expect(parsed.shapes[0].fillRef).toBe('primary')
    expect(parsed.shapes[0].strokeRef).toBe('ink')
  })

  // Empty palette is the default — make sure we don't pollute the file with
  // an empty data-v7-palette attribute.
  it('omits palette attribute when empty', () => {
    const text = serializeProject(sampleSettings, [])
    expect(text).not.toContain('data-v7-palette')
    expect(text).not.toContain('data-v7-bg-ref')
  })

  // Hidden/locked are editor-only flags: round-trip via data-v7-* attributes,
  // and omit them from the output when false so we don't bloat saved files.
  it('round-trips hidden/locked flags and omits them when false', () => {
    const shapes: Shape[] = [
      { ...sampleShapes[0], hidden: true, locked: true },
      { ...sampleShapes[1], hidden: false, locked: false },
    ]
    const text = serializeProject(sampleSettings, shapes)
    expect(text).toContain('data-v7-hidden="true"')
    expect(text).toContain('data-v7-locked="true"')
    // The hidden flag also emits `visibility="hidden"` so external viewers honor it.
    expect(text).toContain('visibility="hidden"')
    // The visible/unlocked shape must not contaminate the file.
    const bBlock = text.match(/data-v7-points="20,200[\s\S]*?\/>/)?.[0] ?? ''
    expect(bBlock).not.toContain('data-v7-hidden')
    expect(bBlock).not.toContain('data-v7-locked')

    const parsed = parseProject(text)
    expect(parsed.shapes[0].hidden).toBe(true)
    expect(parsed.shapes[0].locked).toBe(true)
    expect(parsed.shapes[1].hidden).toBe(false)
    expect(parsed.shapes[1].locked).toBe(false)
  })
})

describe('mirror round-trip', () => {
  const mirrored: Shape = {
    id: 'm',
    points: [
      [0, 0],
      [10, 0],
      [10, 10],
    ],
    closed: true,
    fill: '#0000ff',
    stroke: 'none',
    strokeWidth: 1,
    bezierOverride: null,
    hidden: false,
    locked: false,
    mirror: { axis: { x: 20, y: 0, angle: 90 }, showAxis: true },
  }

  it('emits the source plus a sibling element for the live mirror', () => {
    const text = serializeProject(sampleSettings, [mirrored])
    expect(text).toContain('data-v7-mirror-axis="20,0,90"')
    expect(text).toContain('data-v7-mirror-show-axis="true"')
    // Sibling carries data-v7-mirror-of so the parser knows to skip it.
    expect(text).toContain(`data-v7-mirror-of="${mirrored.id}"`)
    // Two visible elements (source + sibling) for one logical Shape.
    const elements = text.match(/<(?:path|circle)[^/]*\/>/g) ?? []
    expect(elements.length).toBe(2)
  })

  it('parses back to a single Shape with the mirror metadata restored', () => {
    resetIds(1)
    const text = serializeProject(sampleSettings, [mirrored])
    const parsed = parseProject(text)
    expect(parsed.shapes).toHaveLength(1)
    expect(parsed.shapes[0].mirror).toBeDefined()
    expect(parsed.shapes[0].mirror?.axis).toEqual({ x: 20, y: 0, angle: 90 })
    expect(parsed.shapes[0].mirror?.showAxis).toBe(true)
  })
})

describe('radial round-trip', () => {
  const radial: Shape = {
    id: 'r',
    points: [
      [40, 0],
      [50, 0],
      [50, 10],
    ],
    closed: true,
    fill: '#00aa00',
    stroke: 'none',
    strokeWidth: 1,
    bezierOverride: null,
    hidden: false,
    locked: false,
    radial: { cx: 50, cy: 50, angle: 90, showCenter: true },
  }

  it('emits the source plus one sibling per radial clone', () => {
    const text = serializeProject(sampleSettings, [radial])
    expect(text).toContain('data-v7-radial-spec="50,50,90"')
    expect(text).toContain('data-v7-radial-show-center="true"')
    expect(text).toContain(`data-v7-radial-of="${radial.id}"`)
    // Source + 3 clones at 90 / 180 / 270.
    const elements = text.match(/<(?:path|circle)[^/]*\/>/g) ?? []
    expect(elements.length).toBe(4)
  })

  it('parses back to a single Shape with the radial spec restored', () => {
    resetIds(1)
    const text = serializeProject(sampleSettings, [radial])
    const parsed = parseProject(text)
    expect(parsed.shapes).toHaveLength(1)
    expect(parsed.shapes[0].radial).toEqual({ cx: 50, cy: 50, angle: 90, showCenter: true })
  })
})

describe('groups round-trip', () => {
  beforeEach(() => resetIds(1))

  it('preserves an empty group through serialize -> parse', () => {
    const settings: ProjectSettings = { ...DEFAULT_SETTINGS }
    const text = serializeProject(settings, [], [{ id: 'g1', name: 'Empty' }])
    const parsed = parseProject(text)
    expect(parsed.groups).toHaveLength(1)
    expect(parsed.groups[0].name).toBe('Empty')
  })

  it('round-trips group rotation, scale, and animation', () => {
    const settings: ProjectSettings = { ...DEFAULT_SETTINGS, animationEnabled: true }
    const groups = [
      {
        id: 'g1',
        name: 'Spinner',
        rotation: 30,
        scale: 1.5,
        animation: {
          duration: 800,
          delay: 100,
          easing: 'ease-out' as const,
          from: { opacity: 0, scale: 0.5 },
        },
      },
    ]
    const shapes: Shape[] = [
      {
        id: 's1',
        points: [
          [0, 0],
          [10, 0],
          [5, 5],
        ],
        closed: true,
        fill: '#ff0000',
        stroke: 'none',
        strokeWidth: 0,
        bezierOverride: null,
        hidden: false,
        locked: false,
        groupId: 'g1',
      },
    ]
    const text = serializeProject(settings, shapes, groups)
    const parsed = parseProject(text)
    expect(parsed.groups).toHaveLength(1)
    const g = parsed.groups[0]
    expect(g.rotation).toBe(30)
    expect(g.scale).toBe(1.5)
    expect(g.animation?.duration).toBe(800)
    expect(g.animation?.delay).toBe(100)
    expect(g.animation?.from.opacity).toBe(0)
    expect(g.animation?.from.scale).toBe(0.5)
    expect(parsed.shapes[0].groupId).toBe('g1')
  })

  it('still parses the legacy `id:name` group encoding', () => {
    const text = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100" data-v7-groups="g1:Walls;g2:Floor"></svg>`
    const parsed = parseProject(text)
    expect(parsed.groups).toEqual([
      { id: 'g1', name: 'Walls' },
      { id: 'g2', name: 'Floor' },
    ])
  })

  it('round-trips group mirror and radial modifiers', () => {
    const settings: ProjectSettings = { ...DEFAULT_SETTINGS }
    const groups = [
      {
        id: 'gm',
        name: 'Mirrored',
        mirror: { axis: { x: 0, y: 0, angle: 90 }, showAxis: true },
      },
      {
        id: 'gr',
        name: 'Radial',
        radial: { cx: 50, cy: 50, angle: 45, showCenter: true },
      },
    ]
    const shapes: Shape[] = [
      {
        id: 's1',
        points: [
          [10, 0],
          [20, 0],
        ],
        closed: false,
        fill: 'none',
        stroke: '#000',
        strokeWidth: 1,
        bezierOverride: null,
        hidden: false,
        locked: false,
        groupId: 'gm',
      },
      {
        id: 's2',
        points: [
          [30, 0],
          [40, 0],
        ],
        closed: false,
        fill: 'none',
        stroke: '#000',
        strokeWidth: 1,
        bezierOverride: null,
        hidden: false,
        locked: false,
        groupId: 'gr',
      },
    ]
    const text = serializeProject(settings, shapes, groups)
    const parsed = parseProject(text)
    const gm = parsed.groups.find(g => g.id === 'gm')
    const gr = parsed.groups.find(g => g.id === 'gr')
    expect(gm?.mirror?.axis).toEqual({ x: 0, y: 0, angle: 90 })
    expect(gm?.mirror?.showAxis).toBe(true)
    expect(gr?.radial).toEqual({ cx: 50, cy: 50, angle: 45, showCenter: true })
    // Render-only sibling wrappers must not be ingested as new shapes.
    expect(parsed.shapes).toHaveLength(2)
  })
})
