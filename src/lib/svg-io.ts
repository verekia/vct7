import type { Point, ProjectSettings, Shape } from '../types';
import { dist, fmt, pointsToPath } from './geometry';

export const DEFAULT_SETTINGS: ProjectSettings = {
  snapAngles: [0, 45, 90, 135, 180, 225, 270, 315],
  bezier: 0,
  bg: '#ffffff',
  width: 800,
  height: 800,
  gridSize: 20,
  gridVisible: false,
  gridSnap: false,
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
      ` data-vh-bg="${escapeAttr(settings.bg)}"` +
      ` data-vh-grid-size="${fmt(settings.gridSize)}"` +
      ` data-vh-grid-visible="${settings.gridVisible}"` +
      ` data-vh-grid-snap="${settings.gridSnap}">`,
  );
  lines.push(
    `  <rect x="0" y="0" width="${fmt(settings.width)}" height="${fmt(
      settings.height,
    )}" fill="${escapeAttr(settings.bg)}"/>`,
  );
  for (const shape of shapes) {
    const isCircle = shape.kind === 'circle' && shape.points.length >= 2;
    const baseAttrs = [
      `fill="${escapeAttr(shape.closed ? shape.fill : 'none')}"`,
      `stroke="${escapeAttr(shape.stroke)}"`,
      `stroke-width="${fmt(shape.strokeWidth)}"`,
    ];
    if (!isCircle) {
      baseAttrs.push(`stroke-linejoin="round"`, `stroke-linecap="round"`);
    }
    if (shape.hidden) baseAttrs.push(`visibility="hidden"`);
    baseAttrs.push(
      `data-vh-points="${shape.points.map((p) => `${fmt(p[0])},${fmt(p[1])}`).join(' ')}"`,
      `data-vh-closed="${shape.closed}"`,
    );
    if (isCircle) baseAttrs.push(`data-vh-kind="circle"`);
    if (!isCircle && shape.bezierOverride !== null) {
      baseAttrs.push(`data-vh-bezier="${fmt(shape.bezierOverride)}"`);
    }
    if (shape.hidden) baseAttrs.push(`data-vh-hidden="true"`);
    if (shape.locked) baseAttrs.push(`data-vh-locked="true"`);
    if (shape.name) baseAttrs.push(`data-vh-name="${escapeAttr(shape.name)}"`);

    if (isCircle) {
      const [cx, cy] = shape.points[0];
      const r = dist(shape.points[0], shape.points[1]);
      lines.push(
        `  <circle cx="${fmt(cx)}" cy="${fmt(cy)}" r="${fmt(r)}" ${baseAttrs.join(' ')}/>`,
      );
    } else {
      const bz = shape.bezierOverride ?? settings.bezier;
      const d = pointsToPath(shape.points, shape.closed, bz);
      lines.push(`  <path d="${d}" ${baseAttrs.join(' ')}/>`);
    }
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

  const gridSize = svg.getAttribute('data-vh-grid-size');
  if (gridSize) {
    const v = parseFloat(gridSize);
    if (Number.isFinite(v) && v > 0) settings.gridSize = v;
  }
  const gridVisible = svg.getAttribute('data-vh-grid-visible');
  if (gridVisible) settings.gridVisible = gridVisible === 'true';
  const gridSnap = svg.getAttribute('data-vh-grid-snap');
  if (gridSnap) settings.gridSnap = gridSnap === 'true';

  const shapes: Shape[] = [];
  // Iterate path AND circle elements in document order so z-order survives.
  for (const el of Array.from(svg.querySelectorAll('path, circle'))) {
    const ptsAttr = el.getAttribute('data-vh-points');
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

    const isCircle =
      el.tagName.toLowerCase() === 'circle' || el.getAttribute('data-vh-kind') === 'circle';
    const closed = isCircle ? true : el.getAttribute('data-vh-closed') === 'true';
    const overrideAttr = el.getAttribute('data-vh-bezier');
    const overrideNum = overrideAttr === null ? NaN : parseFloat(overrideAttr);
    const bezierOverride = !isCircle && Number.isFinite(overrideNum) ? overrideNum : null;

    // If a `<circle>` element was tagged but its perimeter anchor is missing
    // (only one point in `data-vh-points`), reconstruct it from `cx`/`r` so
    // the shape stays editable.
    let resolvedPoints: Point[] = points;
    if (isCircle && points.length < 2) {
      const cx = parseFloat(el.getAttribute('cx') ?? '');
      const cy = parseFloat(el.getAttribute('cy') ?? '');
      const r = parseFloat(el.getAttribute('r') ?? '');
      if (Number.isFinite(cx) && Number.isFinite(cy) && Number.isFinite(r)) {
        resolvedPoints = [
          [cx, cy],
          [cx + r, cy],
        ];
      }
    }

    const nameAttr = el.getAttribute('data-vh-name');
    shapes.push({
      id: makeId(),
      ...(isCircle ? { kind: 'circle' as const } : {}),
      points: resolvedPoints,
      closed,
      fill: el.getAttribute('fill') ?? (closed ? '#000000' : 'none'),
      stroke: el.getAttribute('stroke') ?? 'none',
      strokeWidth: parseFloat(el.getAttribute('stroke-width') ?? '2'),
      bezierOverride,
      hidden: el.getAttribute('data-vh-hidden') === 'true',
      locked: el.getAttribute('data-vh-locked') === 'true',
      ...(nameAttr ? { name: nameAttr } : {}),
    });
  }

  return { settings, shapes };
}
