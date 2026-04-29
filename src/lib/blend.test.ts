import { describe, expect, it } from 'bun:test'

import { blendColor, findColorBelow, mix, parseHex, toHex } from './blend'
import { DEFAULT_SETTINGS } from './svg-io'

import type { Shape } from '../types'

const shape = (id: string, fill: string, hidden = false): Shape => ({
  id,
  points: [
    [0, 0],
    [10, 10],
  ],
  closed: true,
  fill,
  stroke: 'none',
  strokeWidth: 1,
  bezierOverride: null,
  hidden,
  locked: false,
})

describe('parseHex / toHex', () => {
  it('parses #rgb shorthand by doubling each nibble', () => {
    expect(parseHex('#f00')).toEqual([1, 0, 0])
    expect(parseHex('#0f0')).toEqual([0, 1, 0])
  })

  it('round-trips a 6-digit hex through toHex', () => {
    expect(toHex(parseHex('#3b82f6')!)).toBe('#3b82f6')
  })

  it('rejects invalid input (rgba(), named colors, none)', () => {
    expect(parseHex('none')).toBe(null)
    expect(parseHex('red')).toBe(null)
    expect(parseHex('rgba(0,0,0,0.5)')).toBe(null)
    expect(parseHex('')).toBe(null)
  })
})

describe('blendColor', () => {
  // Known reference: red (255,0,0) multiplied with mid-gray (128,128,128)
  // should give roughly half-red. Validates the per-channel multiply path.
  it('multiply darkens both inputs', () => {
    const out = blendColor([0.5, 0.5, 0.5], [1, 0, 0], 'multiply')
    expect(out[0]).toBeCloseTo(0.5, 5)
    expect(out[1]).toBeCloseTo(0, 5)
    expect(out[2]).toBeCloseTo(0, 5)
  })

  it('screen on white returns white regardless of top', () => {
    const out = blendColor([1, 1, 1], [0.4, 0.6, 0.2], 'screen')
    expect(out[0]).toBeCloseTo(1, 5)
    expect(out[1]).toBeCloseTo(1, 5)
    expect(out[2]).toBeCloseTo(1, 5)
  })

  it('difference of identical colors is black', () => {
    expect(blendColor([0.3, 0.7, 0.5], [0.3, 0.7, 0.5], 'difference')).toEqual([0, 0, 0])
  })

  it('normal returns the top unchanged', () => {
    expect(blendColor([0.1, 0.2, 0.3], [0.7, 0.8, 0.9], 'normal')).toEqual([0.7, 0.8, 0.9])
  })

  it('darken / lighten pick per-channel min / max', () => {
    expect(blendColor([0.2, 0.8, 0.5], [0.6, 0.4, 0.5], 'darken')).toEqual([0.2, 0.4, 0.5])
    expect(blendColor([0.2, 0.8, 0.5], [0.6, 0.4, 0.5], 'lighten')).toEqual([0.6, 0.8, 0.5])
  })

  it('luminosity transfers brightness from top onto backdrop hue', () => {
    // Pure red backdrop, pure blue top → result keeps red-ish hue with blue's
    // (low) luminance, which clips to black-red in practice.
    const out = blendColor([1, 0, 0], [0, 0, 1], 'luminosity')
    // Lum(blue) = 0.11; the result should be quite dark.
    expect(out[0] + out[1] + out[2]).toBeLessThan(1)
  })
})

describe('mix (source-over alpha compositing)', () => {
  it('alpha=1 returns top, alpha=0 returns bottom', () => {
    expect(mix([0.2, 0.4, 0.6], [1, 0, 0], 1)).toEqual([1, 0, 0])
    expect(mix([0.2, 0.4, 0.6], [1, 0, 0], 0)).toEqual([0.2, 0.4, 0.6])
  })

  it('alpha=0.5 averages each channel', () => {
    const out = mix([1, 1, 1], [0, 0, 0], 0.5)
    expect(out[0]).toBeCloseTo(0.5, 5)
    expect(out[1]).toBeCloseTo(0.5, 5)
    expect(out[2]).toBeCloseTo(0.5, 5)
  })

  it('clamps alpha into [0, 1]', () => {
    expect(mix([0, 0, 0], [1, 1, 1], 2)).toEqual([1, 1, 1])
    expect(mix([0, 0, 0], [1, 1, 1], -1)).toEqual([0, 0, 0])
  })
})

describe('findColorBelow', () => {
  it('returns the first opaque fill below the target', () => {
    const shapes = [shape('bg', '#112233'), shape('mid', '#445566'), shape('top', '#778899')]
    expect(findColorBelow(shapes, DEFAULT_SETTINGS, 'top')).toEqual(parseHex('#445566')!)
  })

  it('skips hidden layers', () => {
    const shapes = [
      shape('bg', '#112233'),
      shape('mid', '#445566', true), // hidden — skip
      shape('top', '#778899'),
    ]
    expect(findColorBelow(shapes, DEFAULT_SETTINGS, 'top')).toEqual(parseHex('#112233')!)
  })

  it('skips layers with non-opaque fills (none) and falls through to bg', () => {
    const shapes = [shape('a', 'none'), shape('b', 'none'), shape('c', '#ff0000')]
    const settings = { ...DEFAULT_SETTINGS, bg: '#abcdef' }
    expect(findColorBelow(shapes, settings, 'c')).toEqual(parseHex('#abcdef')!)
  })

  it('falls back to project bg when nothing is below', () => {
    const shapes = [shape('only', '#ff0000')]
    const settings = { ...DEFAULT_SETTINGS, bg: '#123456' }
    expect(findColorBelow(shapes, settings, 'only')).toEqual(parseHex('#123456')!)
  })
})
