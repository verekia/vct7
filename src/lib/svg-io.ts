import type { ArcRange, BlendMode, Point, ProjectSettings, Shape } from '../types';
import { BLEND_MODES } from '../types';
import { arcToPath, dist, fmt, isPartialArc, pointsToPath } from './geometry';

const ARC_STYLES: ReadonlySet<ArcRange['style']> = new Set(['wedge', 'chord', 'open']);
const BLEND_MODE_SET: ReadonlySet<string> = new Set(BLEND_MODES);

const parseArcAttr = (raw: string | null): ArcRange | undefined => {
  if (!raw) return undefined;
  const parts = raw.split(',').map((s) => s.trim());
  if (parts.length !== 3) return undefined;
  const start = parseFloat(parts[0]);
  const end = parseFloat(parts[1]);
  const style = parts[2] as ArcRange['style'];
  if (!Number.isFinite(start) || !Number.isFinite(end) || !ARC_STYLES.has(style)) return undefined;
  return { start, end, style };
};

export const DEFAULT_SETTINGS: ProjectSettings = {
  snapAngles: [0, 45, 90, 135, 180, 225, 270, 315],
  bezier: 0.5,
  bg: null,
  width: 100,
  height: 100,
  viewBoxX: 0,
  viewBoxY: 0,
  viewBoxWidth: 100,
  viewBoxHeight: 100,
  gridSize: 5,
  gridVisible: false,
  gridSnap: true,
  clip: false,
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
  const vbX = settings.viewBoxX;
  const vbY = settings.viewBoxY;
  const vbW = settings.viewBoxWidth;
  const vbH = settings.viewBoxHeight;
  lines.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${fmt(vbX)} ${fmt(vbY)} ${fmt(vbW)} ${fmt(
      vbH,
    )}" width="${fmt(settings.width)}" height="${fmt(settings.height)}"` +
      ` data-vh-snap-angles="${escapeAttr(settings.snapAngles.join(','))}"` +
      ` data-vh-bezier="${fmt(settings.bezier)}"` +
      (settings.bg === null
        ? ` data-vh-no-bg="true"`
        : ` data-vh-bg="${escapeAttr(settings.bg)}"`) +
      ` data-vh-grid-size="${fmt(settings.gridSize)}"` +
      ` data-vh-grid-visible="${settings.gridVisible}"` +
      ` data-vh-grid-snap="${settings.gridSnap}"` +
      ` data-vh-clip="${settings.clip}">`,
  );
  if (settings.bg !== null) {
    lines.push(
      `  <rect x="${fmt(vbX)}" y="${fmt(vbY)}" width="${fmt(vbW)}" height="${fmt(
        vbH,
      )}" fill="${escapeAttr(settings.bg)}"/>`,
    );
  }
  if (settings.clip) {
    lines.push(
      `  <defs><clipPath id="vh-artboard-clip"><rect x="${fmt(vbX)}" y="${fmt(vbY)}" width="${fmt(
        vbW,
      )}" height="${fmt(vbH)}"/></clipPath></defs>`,
    );
    lines.push(`  <g clip-path="url(#vh-artboard-clip)">`);
  }
  for (const shape of shapes) {
    const isCircle = shape.kind === 'circle' && shape.points.length >= 2;
    const partialArc = isCircle && isPartialArc(shape.arc) ? shape.arc : undefined;
    const filled = partialArc ? partialArc.style !== 'open' : shape.closed;
    const baseAttrs = [
      `fill="${escapeAttr(filled ? shape.fill : 'none')}"`,
      `stroke="${escapeAttr(shape.stroke)}"`,
      `stroke-width="${fmt(shape.strokeWidth)}"`,
    ];
    if (!isCircle || partialArc) {
      baseAttrs.push(`stroke-linejoin="round"`, `stroke-linecap="round"`);
    }
    if (shape.hidden) baseAttrs.push(`visibility="hidden"`);
    baseAttrs.push(
      `data-vh-points="${shape.points.map((p) => `${fmt(p[0])},${fmt(p[1])}`).join(' ')}"`,
      `data-vh-closed="${shape.closed}"`,
    );
    if (isCircle) baseAttrs.push(`data-vh-kind="circle"`);
    if (partialArc) {
      baseAttrs.push(
        `data-vh-arc="${fmt(partialArc.start)},${fmt(partialArc.end)},${partialArc.style}"`,
      );
    }
    if (!isCircle && shape.bezierOverride !== null) {
      baseAttrs.push(`data-vh-bezier="${fmt(shape.bezierOverride)}"`);
    }
    if (shape.hidden) baseAttrs.push(`data-vh-hidden="true"`);
    if (shape.locked) baseAttrs.push(`data-vh-locked="true"`);
    if (shape.name) baseAttrs.push(`data-vh-name="${escapeAttr(shape.name)}"`);
    if (shape.blendMode && shape.blendMode !== 'normal') {
      // Both: data-vh-blend for round-trip, inline style so external browser
      // viewers honor the blending without our editor metadata.
      baseAttrs.push(
        `data-vh-blend="${shape.blendMode}"`,
        `style="mix-blend-mode:${shape.blendMode}"`,
      );
    }
    if (shape.opacity !== undefined && shape.opacity < 1) {
      baseAttrs.push(`opacity="${fmt(Math.max(0, shape.opacity))}"`);
    }

    if (isCircle && !partialArc) {
      const [cx, cy] = shape.points[0];
      const r = dist(shape.points[0], shape.points[1]);
      lines.push(
        `  <circle cx="${fmt(cx)}" cy="${fmt(cy)}" r="${fmt(r)}" ${baseAttrs.join(' ')}/>`,
      );
    } else if (isCircle && partialArc) {
      const [cx, cy] = shape.points[0];
      const r = dist(shape.points[0], shape.points[1]);
      const d = arcToPath(cx, cy, r, partialArc);
      lines.push(`  <path d="${d}" ${baseAttrs.join(' ')}/>`);
    } else {
      const bz = shape.bezierOverride ?? settings.bezier;
      const d = pointsToPath(shape.points, shape.closed, bz);
      lines.push(`  <path d="${d}" ${baseAttrs.join(' ')}/>`);
    }
  }
  if (settings.clip) lines.push('  </g>');
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

  // Parse the viewBox and width/height attributes independently. When a file
  // has only one, derive the other so legacy SVGs (typical case: viewBox only)
  // round-trip with width === viewBoxWidth, height === viewBoxHeight.
  const vbAttr = svg.getAttribute('viewBox');
  let vbParts: [number, number, number, number] | null = null;
  if (vbAttr) {
    const parts = vbAttr.split(/[\s,]+/).map(Number);
    if (parts.length === 4 && parts.every(Number.isFinite)) {
      vbParts = [parts[0], parts[1], parts[2], parts[3]];
    }
  }
  const widthAttr = parseFloat(svg.getAttribute('width') ?? '');
  const heightAttr = parseFloat(svg.getAttribute('height') ?? '');
  if (vbParts) {
    settings.viewBoxX = vbParts[0];
    settings.viewBoxY = vbParts[1];
    settings.viewBoxWidth = vbParts[2];
    settings.viewBoxHeight = vbParts[3];
  }
  if (Number.isFinite(widthAttr)) settings.width = widthAttr;
  else if (vbParts) settings.width = vbParts[2];
  if (Number.isFinite(heightAttr)) settings.height = heightAttr;
  else if (vbParts) settings.height = vbParts[3];
  // No viewBox in the source: default it to (0, 0, width, height) so the
  // editor's drawing extent matches the legacy interpretation.
  if (!vbParts) {
    settings.viewBoxX = 0;
    settings.viewBoxY = 0;
    settings.viewBoxWidth = settings.width;
    settings.viewBoxHeight = settings.height;
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

  if (svg.getAttribute('data-vh-no-bg') === 'true') {
    settings.bg = null;
  } else {
    const bg = svg.getAttribute('data-vh-bg');
    if (bg) settings.bg = bg;
  }

  const gridSize = svg.getAttribute('data-vh-grid-size');
  if (gridSize) {
    const v = parseFloat(gridSize);
    if (Number.isFinite(v) && v > 0) settings.gridSize = v;
  }
  const gridVisible = svg.getAttribute('data-vh-grid-visible');
  if (gridVisible) settings.gridVisible = gridVisible === 'true';
  const gridSnap = svg.getAttribute('data-vh-grid-snap');
  if (gridSnap) settings.gridSnap = gridSnap === 'true';
  const clip = svg.getAttribute('data-vh-clip');
  if (clip) settings.clip = clip === 'true';

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
    const arc = isCircle ? parseArcAttr(el.getAttribute('data-vh-arc')) : undefined;
    const blendAttr = el.getAttribute('data-vh-blend');
    const blendMode: BlendMode | undefined =
      blendAttr && BLEND_MODE_SET.has(blendAttr) && blendAttr !== 'normal'
        ? (blendAttr as BlendMode)
        : undefined;
    const opacityAttr = el.getAttribute('opacity');
    const opacityNum = opacityAttr === null ? NaN : parseFloat(opacityAttr);
    const opacity =
      Number.isFinite(opacityNum) && opacityNum < 1
        ? Math.max(0, Math.min(1, opacityNum))
        : undefined;
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
      ...(arc ? { arc } : {}),
      ...(blendMode ? { blendMode } : {}),
      ...(opacity !== undefined ? { opacity } : {}),
    });
  }

  return { settings, shapes };
}
