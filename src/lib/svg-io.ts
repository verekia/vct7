import type { ProjectSettings, Shape } from '../types';
import { fmt, pointsToPath } from './geometry';

export const DEFAULT_SETTINGS: ProjectSettings = {
  snapAngles: [0, 45, 90, 135, 180, 225, 270, 315],
  bezier: 0,
  bg: '#ffffff',
  width: 800,
  height: 800,
};

const escapeAttr = (v: string): string =>
  v.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');

let nextId = 1;
export const makeId = (): string => `s${nextId++}`;
export const resetIds = (n = 1): void => {
  nextId = n;
};

export function serializeProject(settings: ProjectSettings, shapes: Shape[]): string {
  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${fmt(settings.width)} ${fmt(
      settings.height,
    )}" width="${fmt(settings.width)}" height="${fmt(settings.height)}"` +
      ` data-vh-snap-angles="${escapeAttr(settings.snapAngles.join(','))}"` +
      ` data-vh-bezier="${fmt(settings.bezier)}"` +
      ` data-vh-bg="${escapeAttr(settings.bg)}">`,
  );
  lines.push(
    `  <rect x="0" y="0" width="${fmt(settings.width)}" height="${fmt(
      settings.height,
    )}" fill="${escapeAttr(settings.bg)}"/>`,
  );
  for (const shape of shapes) {
    const bz = shape.bezierOverride ?? settings.bezier;
    const d = pointsToPath(shape.points, shape.closed, bz);
    const attrs = [
      `d="${d}"`,
      `fill="${escapeAttr(shape.closed ? shape.fill : 'none')}"`,
      `stroke="${escapeAttr(shape.stroke)}"`,
      `stroke-width="${fmt(shape.strokeWidth)}"`,
      `stroke-linejoin="round"`,
      `stroke-linecap="round"`,
      `data-vh-points="${shape.points.map((p) => `${fmt(p[0])},${fmt(p[1])}`).join(' ')}"`,
      `data-vh-closed="${shape.closed}"`,
    ];
    if (shape.bezierOverride !== null) {
      attrs.push(`data-vh-bezier="${fmt(shape.bezierOverride)}"`);
    }
    lines.push(`  <path ${attrs.join(' ')}/>`);
  }
  lines.push('</svg>');
  return lines.join('\n');
}

export interface ParsedProject {
  settings: ProjectSettings;
  shapes: Shape[];
}

export function parseProject(text: string): ParsedProject {
  const parser = new DOMParser();
  const doc = parser.parseFromString(text, 'image/svg+xml');
  if (doc.querySelector('parsererror')) {
    throw new Error('Invalid SVG file');
  }

  const svg = doc.querySelector('svg');
  if (!svg) throw new Error('No <svg> root found');

  const settings: ProjectSettings = { ...DEFAULT_SETTINGS };

  const vb = svg.getAttribute('viewBox');
  if (vb) {
    const parts = vb.split(/[\s,]+/).map(Number);
    if (parts.length === 4 && parts.every(Number.isFinite)) {
      settings.width = parts[2];
      settings.height = parts[3];
    }
  } else {
    const w = parseFloat(svg.getAttribute('width') ?? '');
    const h = parseFloat(svg.getAttribute('height') ?? '');
    if (Number.isFinite(w)) settings.width = w;
    if (Number.isFinite(h)) settings.height = h;
  }

  const angles = svg.getAttribute('data-vh-snap-angles');
  if (angles) {
    const parsed = angles
      .split(',')
      .map((s) => parseFloat(s.trim()))
      .filter((n) => Number.isFinite(n));
    if (parsed.length > 0) settings.snapAngles = parsed;
  }

  const bz = svg.getAttribute('data-vh-bezier');
  if (bz) {
    const v = parseFloat(bz);
    if (Number.isFinite(v)) settings.bezier = v;
  }

  const bg = svg.getAttribute('data-vh-bg');
  if (bg) settings.bg = bg;

  const shapes: Shape[] = [];
  for (const path of Array.from(svg.querySelectorAll('path'))) {
    const ptsAttr = path.getAttribute('data-vh-points');
    if (!ptsAttr) continue;
    const points = ptsAttr
      .trim()
      .split(/\s+/)
      .map((p) => {
        const [x, y] = p.split(',').map(Number);
        return [x, y] as [number, number];
      })
      .filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
    if (points.length === 0) continue;

    const closed = path.getAttribute('data-vh-closed') === 'true';
    const overrideAttr = path.getAttribute('data-vh-bezier');
    const overrideNum = overrideAttr === null ? NaN : parseFloat(overrideAttr);
    const bezierOverride = Number.isFinite(overrideNum) ? overrideNum : null;

    shapes.push({
      id: makeId(),
      points,
      closed,
      fill: path.getAttribute('fill') ?? (closed ? '#000000' : 'none'),
      stroke: path.getAttribute('stroke') ?? 'none',
      strokeWidth: parseFloat(path.getAttribute('stroke-width') ?? '2'),
      bezierOverride,
    });
  }

  return { settings, shapes };
}
