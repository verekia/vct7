import { describe, expect, it } from 'bun:test'

import { parseProject, resetIds, serializeProject } from './svg-io'

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

  // Foreign / pre-existing `<path>` elements without `data-v7-points` must not
  // be imported as editable shapes — the editor only owns paths it tagged.
  it('ignores <path> elements without data-v7-points', () => {
    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect width="100" height="100" fill="white"/>
  <path d="M0 0 L10 10" fill="red"/>
  <path d="M5 5 L20 20" data-v7-points="5,5 20,20" data-v7-closed="false"/>
</svg>`
    const parsed = parseProject(svg)
    expect(parsed.shapes).toHaveLength(1)
    expect(parsed.shapes[0].points).toEqual([
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
