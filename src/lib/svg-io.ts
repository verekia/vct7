import type { ArcRange, BlendMode, GlyphData, Point, ProjectSettings, Shape } from '../types';
import { BLEND_MODES } from '../types';
import { arcToPath, dist, fmt, isPartialArc, pointsToPath } from './geometry';
import { composeTransformString, shapeRotation, shapeScale } from './transform';

const ARC_STYLES: ReadonlySet<ArcRange['style']> = new Set(['wedge', 'chord', 'open']);
const BLEND_MODE_SET: ReadonlySet<string> = new Set(BLEND_MODES);

/**
 * Reconstruct a {@link GlyphData} payload from a serialized `<path>`. The path
 * carries both the local-coord `d` (as the path's `d` attribute) and the
 * vectorheart metadata that captures the original text + font label + bbox so
 * the shape round-trips. Returns undefined when required attrs are missing.
 */
const parseGlyphsAttrs = (el: Element): GlyphData | undefined => {
  const d = el.getAttribute('d');
  if (!d) return undefined;
  const text = el.getAttribute('data-vh-text') ?? '';
  const fontFamily = el.getAttribute('data-vh-font-family') ?? '';
  const fontSize = parseFloat(el.getAttribute('data-vh-font-size') ?? '');
  const width = parseFloat(el.getAttribute('data-vh-glyph-w') ?? '');
  const height = parseFloat(el.getAttribute('data-vh-glyph-h') ?? '');
  if (
    !Number.isFinite(fontSize) ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return undefined;
  }
  return { d, text, fontFamily, fontSize, width, height };
};

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
    const isGlyphs = shape.kind === 'glyphs' && !!shape.glyphs && shape.points.length >= 2;
    const isCircle = !isGlyphs && shape.kind === 'circle' && shape.points.length >= 2;
    const partialArc = isCircle && isPartialArc(shape.arc) ? shape.arc : undefined;
    const filled = partialArc ? partialArc.style !== 'open' : shape.closed;
    const baseAttrs = [
      `fill="${escapeAttr(filled ? shape.fill : 'none')}"`,
      `stroke="${escapeAttr(shape.stroke)}"`,
      `stroke-width="${fmt(shape.strokeWidth)}"`,
    ];
    if (!isCircle && !isGlyphs) {
      baseAttrs.push(`stroke-linejoin="round"`, `stroke-linecap="round"`);
    } else if (partialArc) {
      baseAttrs.push(`stroke-linejoin="round"`, `stroke-linecap="round"`);
    }
    if (shape.hidden) baseAttrs.push(`visibility="hidden"`);
    baseAttrs.push(
      `data-vh-points="${shape.points.map((p) => `${fmt(p[0])},${fmt(p[1])}`).join(' ')}"`,
      `data-vh-closed="${shape.closed}"`,
    );
    if (isCircle) baseAttrs.push(`data-vh-kind="circle"`);
    if (isGlyphs && shape.glyphs) {
      const g = shape.glyphs;
      baseAttrs.push(
        `data-vh-kind="glyphs"`,
        `data-vh-text="${escapeAttr(g.text)}"`,
        `data-vh-font-family="${escapeAttr(g.fontFamily)}"`,
        `data-vh-font-size="${fmt(g.fontSize)}"`,
        `data-vh-glyph-w="${fmt(g.width)}"`,
        `data-vh-glyph-h="${fmt(g.height)}"`,
      );
    }
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
    const rot = shapeRotation(shape);
    const scl = shapeScale(shape);
    if (rot !== 0) baseAttrs.push(`data-vh-rotation="${fmt(rot)}"`);
    if (scl !== 1) baseAttrs.push(`data-vh-scale="${fmt(scl)}"`);
    // External viewers respect the SVG transform attribute, so always emit it
    // for transformed shapes (and for glyphs, where the local-coord d needs the
    // base translate). The composed string folds translate + rotate + scale
    // into one attribute value.
    const composedTransform = composeTransformString(shape);

    if (isGlyphs && shape.glyphs) {
      lines.push(
        `  <path d="${shape.glyphs.d}" transform="${composedTransform}" ${baseAttrs.join(' ')}/>`,
      );
    } else if (isCircle && !partialArc) {
      const [cx, cy] = shape.points[0];
      const r = dist(shape.points[0], shape.points[1]);
      const transformAttr = composedTransform ? ` transform="${composedTransform}"` : '';
      lines.push(
        `  <circle cx="${fmt(cx)}" cy="${fmt(cy)}" r="${fmt(r)}"${transformAttr} ${baseAttrs.join(
          ' ',
        )}/>`,
      );
    } else if (isCircle && partialArc) {
      const [cx, cy] = shape.points[0];
      const r = dist(shape.points[0], shape.points[1]);
      const d = arcToPath(cx, cy, r, partialArc);
      const transformAttr = composedTransform ? ` transform="${composedTransform}"` : '';
      lines.push(`  <path d="${d}"${transformAttr} ${baseAttrs.join(' ')}/>`);
    } else {
      const bz = shape.bezierOverride ?? settings.bezier;
      const d = pointsToPath(shape.points, shape.closed, bz);
      const transformAttr = composedTransform ? ` transform="${composedTransform}"` : '';
      lines.push(`  <path d="${d}"${transformAttr} ${baseAttrs.join(' ')}/>`);
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

    const kindAttr = el.getAttribute('data-vh-kind');
    const isGlyphs = kindAttr === 'glyphs';
    const isCircle = !isGlyphs && (el.tagName.toLowerCase() === 'circle' || kindAttr === 'circle');
    const closed = isCircle || isGlyphs ? true : el.getAttribute('data-vh-closed') === 'true';
    const overrideAttr = el.getAttribute('data-vh-bezier');
    const overrideNum = overrideAttr === null ? NaN : parseFloat(overrideAttr);
    const bezierOverride =
      !isCircle && !isGlyphs && Number.isFinite(overrideNum) ? overrideNum : null;
    const glyphs = isGlyphs ? parseGlyphsAttrs(el) : undefined;
    if (isGlyphs && !glyphs) continue;

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
    const rotationAttr = el.getAttribute('data-vh-rotation');
    const rotationNum = rotationAttr === null ? NaN : parseFloat(rotationAttr);
    const rotation = Number.isFinite(rotationNum) && rotationNum !== 0 ? rotationNum : undefined;
    const scaleAttr = el.getAttribute('data-vh-scale');
    const scaleNum = scaleAttr === null ? NaN : parseFloat(scaleAttr);
    const scale = Number.isFinite(scaleNum) && scaleNum !== 1 ? scaleNum : undefined;
    shapes.push({
      id: makeId(),
      ...(isGlyphs ? { kind: 'glyphs' as const } : isCircle ? { kind: 'circle' as const } : {}),
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
      ...(glyphs ? { glyphs } : {}),
      ...(rotation !== undefined ? { rotation } : {}),
      ...(scale !== undefined ? { scale } : {}),
    });
  }

  return { settings, shapes };
}
