import { describe, expect, it } from 'vitest';
import { parseProject, resetIds, serializeProject } from './svg-io';
import type { ProjectSettings, Shape } from '../types';

const sampleSettings: ProjectSettings = {
  snapAngles: [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330],
  bezier: 0.2,
  bg: '#ffeedd',
  width: 400,
  height: 300,
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
});
