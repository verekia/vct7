import { describe, expect, it } from 'vitest';
import { parseProject, resetIds, serializeProject } from './svg-io';
import type { ProjectSettings, Shape } from '../types';

const sampleSettings: ProjectSettings = {
  snapAngles: [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330],
  bezier: 0.2,
  bg: '#ffeedd',
  width: 400,
  height: 300,
  gridSize: 25,
  gridVisible: true,
  gridSnap: false,
};

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
];

describe('serializeProject', () => {
  it('emits a valid <svg> with vh metadata attributes', () => {
    const text = serializeProject(sampleSettings, sampleShapes);
    expect(text).toContain('<?xml version="1.0"');
    expect(text).toContain('viewBox="0 0 400 300"');
    expect(text).toContain('data-vh-snap-angles="0,30,60,90,120,150,180,210,240,270,300,330"');
    expect(text).toContain('data-vh-bezier="0.2"');
    expect(text).toContain('data-vh-bg="#ffeedd"');
    expect(text).toContain('<rect x="0" y="0" width="400" height="300" fill="#ffeedd"/>');
  });

  it('writes per-shape bezier override only when set', () => {
    const text = serializeProject(sampleSettings, sampleShapes);
    const aBlock = text.match(/data-vh-points="10,10[\s\S]*?\/>/)?.[0] ?? '';
    const bBlock = text.match(/data-vh-points="20,200[\s\S]*?\/>/)?.[0] ?? '';
    expect(aBlock).toContain('data-vh-bezier="0.5"');
    expect(bBlock).not.toContain('data-vh-bezier=');
  });
});

describe('parseProject round-trip', () => {
  it('preserves settings and shape control points', () => {
    resetIds(1);
    const text = serializeProject(sampleSettings, sampleShapes);
    const parsed = parseProject(text);

    expect(parsed.settings).toEqual(sampleSettings);
    expect(parsed.shapes).toHaveLength(2);

    expect(parsed.shapes[0].points).toEqual([
      [10, 10],
      [100, 10],
      [100, 100],
    ]);
    expect(parsed.shapes[0].closed).toBe(true);
    expect(parsed.shapes[0].fill).toBe('#ff0000');
    expect(parsed.shapes[0].bezierOverride).toBe(0.5);

    expect(parsed.shapes[1].points).toEqual([
      [20, 200],
      [300, 200],
    ]);
    expect(parsed.shapes[1].closed).toBe(false);
    expect(parsed.shapes[1].bezierOverride).toBe(null);
  });

  it('throws on invalid XML', () => {
    expect(() => parseProject('<not valid')).toThrow();
  });

  // Regression: `if (bz)` correctly treats the string "0" as truthy, so a
  // global bezier of exactly 0 round-trips. (Easy bug to introduce later.)
  it('preserves bezier === 0 across round-trip', () => {
    const settings: ProjectSettings = { ...sampleSettings, bezier: 0 };
    const text = serializeProject(settings, []);
    expect(parseProject(text).settings.bezier).toBe(0);
  });

  // Regression: a per-shape bezierOverride of 0 (forced sharp) must come back
  // as 0, not null. `bezierOverride !== null` is the intent, not a truthy check.
  it('preserves shape bezierOverride === 0', () => {
    const shape: Shape = { ...sampleShapes[0], bezierOverride: 0 };
    const text = serializeProject(sampleSettings, [shape]);
    const parsed = parseProject(text);
    expect(parsed.shapes[0].bezierOverride).toBe(0);
  });

  // Regression: bezierOverride === null must NOT appear in the SVG output and
  // must come back as null (not 0).
  it('preserves null bezierOverride (no attribute written)', () => {
    const shape: Shape = { ...sampleShapes[1], bezierOverride: null };
    const text = serializeProject(sampleSettings, [shape]);
    expect(text).not.toMatch(/data-vh-bezier="[\d.]+"\s*\/>/);
    const parsed = parseProject(text);
    expect(parsed.shapes[0].bezierOverride).toBe(null);
  });

  // Foreign / pre-existing `<path>` elements without `data-vh-points` must not
  // be imported as editable shapes — the editor only owns paths it tagged.
  it('ignores <path> elements without data-vh-points', () => {
    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect width="100" height="100" fill="white"/>
  <path d="M0 0 L10 10" fill="red"/>
  <path d="M5 5 L20 20" data-vh-points="5,5 20,20" data-vh-closed="false"/>
</svg>`;
    const parsed = parseProject(svg);
    expect(parsed.shapes).toHaveLength(1);
    expect(parsed.shapes[0].points).toEqual([
      [5, 5],
      [20, 20],
    ]);
  });

  // Circles serialize as native <circle> elements (so external viewers render
  // them correctly) with `data-vh-points` carrying the editor's center +
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
    };
    const text = serializeProject(sampleSettings, [circleShape]);
    expect(text).toContain('<circle ');
    expect(text).toContain('cx="50"');
    expect(text).toContain('cy="60"');
    expect(text).toContain('r="20"');
    expect(text).toContain('data-vh-kind="circle"');

    resetIds(1);
    const parsed = parseProject(text);
    expect(parsed.shapes).toHaveLength(1);
    const back = parsed.shapes[0];
    expect(back.kind).toBe('circle');
    expect(back.closed).toBe(true);
    expect(back.fill).toBe('#0f0');
    expect(back.points).toEqual([
      [50, 60],
      [70, 60],
    ]);
  });

  // If a saved file has a tagged <circle> but its data-vh-points is missing
  // (e.g. hand-edited externally), reconstruct the perimeter anchor from
  // cx/cy/r so the shape stays editable.
  it('reconstructs circle perimeter from cx/cy/r when data-vh-points is incomplete', () => {
    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <circle cx="40" cy="40" r="15" data-vh-points="40,40" data-vh-kind="circle" data-vh-closed="true" fill="#000" stroke="none" stroke-width="2"/>
</svg>`;
    const parsed = parseProject(svg);
    expect(parsed.shapes).toHaveLength(1);
    expect(parsed.shapes[0].kind).toBe('circle');
    expect(parsed.shapes[0].points).toEqual([
      [40, 40],
      [55, 40],
    ]);
  });

  it('falls back to defaults when SVG omits all vh metadata', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"/>`;
    const parsed = parseProject(svg);
    expect(parsed.settings.width).toBe(200);
    expect(parsed.settings.height).toBe(100);
    expect(parsed.settings.bezier).toBe(0);
    expect(parsed.shapes).toEqual([]);
  });

  // Hidden/locked are editor-only flags: round-trip via data-vh-* attributes,
  // and omit them from the output when false so we don't bloat saved files.
  it('round-trips hidden/locked flags and omits them when false', () => {
    const shapes: Shape[] = [
      { ...sampleShapes[0], hidden: true, locked: true },
      { ...sampleShapes[1], hidden: false, locked: false },
    ];
    const text = serializeProject(sampleSettings, shapes);
    expect(text).toContain('data-vh-hidden="true"');
    expect(text).toContain('data-vh-locked="true"');
    // The hidden flag also emits `visibility="hidden"` so external viewers honor it.
    expect(text).toContain('visibility="hidden"');
    // The visible/unlocked shape must not contaminate the file.
    const bBlock = text.match(/data-vh-points="20,200[\s\S]*?\/>/)?.[0] ?? '';
    expect(bBlock).not.toContain('data-vh-hidden');
    expect(bBlock).not.toContain('data-vh-locked');

    const parsed = parseProject(text);
    expect(parsed.shapes[0].hidden).toBe(true);
    expect(parsed.shapes[0].locked).toBe(true);
    expect(parsed.shapes[1].hidden).toBe(false);
    expect(parsed.shapes[1].locked).toBe(false);
  });
});
