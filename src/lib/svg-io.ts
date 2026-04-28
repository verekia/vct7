import type {
  AnimationFromState,
  AnimationSpec,
  ArcRange,
  BlendMode,
  Easing,
  GlyphData,
  Point,
  ProjectSettings,
  Shape,
} from '../types';
import { BLEND_MODES, EASINGS } from '../types';
import { arcToPath, dist, fmt, isPartialArc, pointsToPath } from './geometry';
import { composeTransformString, shapeRotation, shapeScale } from './transform';
import { animationHasPaint, buildKeyframesStyle } from './animation';

const ARC_STYLES: ReadonlySet<ArcRange['style']> = new Set(['wedge', 'chord', 'open']);
const BLEND_MODE_SET: ReadonlySet<string> = new Set(BLEND_MODES);
const EASING_SET: ReadonlySet<string> = new Set(EASINGS);

/** Coerce an unknown value to a finite number, defaulting to undefined. */
const numOpt = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined;

/**
 * Decode a `data-vh-anim` JSON blob back into an {@link AnimationSpec},
 * tolerating malformed input by returning undefined (in which case the shape
 * loads as a non-animated rest pose). Numeric fields are guarded with
 * `Number.isFinite` so a stray `NaN` slips into a missing-channel undefined.
 */
const HEX_COLOR = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const colorOpt = (v: unknown): string | undefined =>
  typeof v === 'string' && HEX_COLOR.test(v) ? v : undefined;

const parseAnimationAttr = (raw: string | null): AnimationSpec | undefined => {
  if (!raw) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== 'object') return undefined;
  const obj = parsed as Record<string, unknown>;
  const duration = typeof obj.duration === 'number' ? obj.duration : NaN;
  const delay = typeof obj.delay === 'number' ? obj.delay : 0;
  const easing = typeof obj.easing === 'string' ? obj.easing : '';
  if (!Number.isFinite(duration) || duration < 0) return undefined;
  if (!EASING_SET.has(easing)) return undefined;
  const fromRaw =
    obj.from && typeof obj.from === 'object' ? (obj.from as Record<string, unknown>) : {};
  const from: AnimationFromState = {
    opacity: numOpt(fromRaw.opacity),
    rotation: numOpt(fromRaw.rotation),
    scale: numOpt(fromRaw.scale),
    translateX: numOpt(fromRaw.translateX),
    translateY: numOpt(fromRaw.translateY),
    fill: colorOpt(fromRaw.fill),
    stroke: colorOpt(fromRaw.stroke),
  };
  // Strip undefined keys so the in-memory shape stays compact.
  const compactFrom: AnimationFromState = {};
  if (from.opacity !== undefined) compactFrom.opacity = from.opacity;
  if (from.rotation !== undefined) compactFrom.rotation = from.rotation;
  if (from.scale !== undefined) compactFrom.scale = from.scale;
  if (from.translateX !== undefined) compactFrom.translateX = from.translateX;
  if (from.translateY !== undefined) compactFrom.translateY = from.translateY;
  if (from.fill !== undefined) compactFrom.fill = from.fill;
  if (from.stroke !== undefined) compactFrom.stroke = from.stroke;
  return {
    duration,
    delay: Number.isFinite(delay) && delay >= 0 ? delay : 0,
    easing: easing as Easing,
    from: compactFrom,
  };
};

/**
 * JSON-encode an {@link AnimationSpec} for storage on the shape element.
 * Channels left undefined are omitted so the saved file stays tidy. Reading
 * is via {@link parseAnimationAttr} which tolerates the omissions.
 */
const animationToAttr = (anim: AnimationSpec): string => {
  const from: Record<string, number | string> = {};
  if (anim.from.opacity !== undefined) from.opacity = anim.from.opacity;
  if (anim.from.rotation !== undefined) from.rotation = anim.from.rotation;
  if (anim.from.scale !== undefined) from.scale = anim.from.scale;
  if (anim.from.translateX !== undefined) from.translateX = anim.from.translateX;
  if (anim.from.translateY !== undefined) from.translateY = anim.from.translateY;
  if (anim.from.fill !== undefined) from.fill = anim.from.fill;
  if (anim.from.stroke !== undefined) from.stroke = anim.from.stroke;
  return JSON.stringify({
    duration: anim.duration,
    delay: anim.delay,
    easing: anim.easing,
    from,
  });
};

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
  animationEnabled: false,
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
      ` data-vh-clip="${settings.clip}"` +
      (settings.animationEnabled ? ` data-vh-animation-enabled="true"` : '') +
      `>`,
  );

  // Animation CSS is emitted only when enabled — turning the project switch
  // off removes every animation byte from the saved file, matching the
  // "nothing animation related" requirement.
  if (settings.animationEnabled) {
    const style = buildKeyframesStyle(shapes);
    if (style) {
      lines.push(`  <style>${style}</style>`);
    }
  }
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
    // Animation metadata is only emitted when the project switch is on, so the
    // file is byte-identical to a non-animated project when the user toggles
    // animation off.
    const emitsAnimation = settings.animationEnabled && !!shape.animation;
    if (emitsAnimation && shape.animation) {
      baseAttrs.push(`data-vh-anim="${escapeAttr(animationToAttr(shape.animation))}"`);
      // The transform/opacity animation lives on the wrapper <g>; the
      // paint animation has to live on the inner element because CSS `fill`
      // on the wrapper is shadowed by the inner element's `fill="..."` attr.
      if (animationHasPaint(shape)) {
        baseAttrs.push(`class="vh-anim-${shape.id}-paint"`);
      }
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

    let element: string;
    if (isGlyphs && shape.glyphs) {
      element = `<path d="${shape.glyphs.d}" transform="${composedTransform}" ${baseAttrs.join(' ')}/>`;
    } else if (isCircle && !partialArc) {
      const [cx, cy] = shape.points[0];
      const r = dist(shape.points[0], shape.points[1]);
      const transformAttr = composedTransform ? ` transform="${composedTransform}"` : '';
      element = `<circle cx="${fmt(cx)}" cy="${fmt(cy)}" r="${fmt(r)}"${transformAttr} ${baseAttrs.join(' ')}/>`;
    } else if (isCircle && partialArc) {
      const [cx, cy] = shape.points[0];
      const r = dist(shape.points[0], shape.points[1]);
      const d = arcToPath(cx, cy, r, partialArc);
      const transformAttr = composedTransform ? ` transform="${composedTransform}"` : '';
      element = `<path d="${d}"${transformAttr} ${baseAttrs.join(' ')}/>`;
    } else {
      const bz = shape.bezierOverride ?? settings.bezier;
      const d = pointsToPath(shape.points, shape.closed, bz);
      const transformAttr = composedTransform ? ` transform="${composedTransform}"` : '';
      element = `<path d="${d}"${transformAttr} ${baseAttrs.join(' ')}/>`;
    }

    // Wrap animated shapes in a <g> the CSS keyframes can target. Only when
    // animationEnabled — otherwise emit the raw element (no extra DOM node).
    if (settings.animationEnabled && shape.animation) {
      lines.push(`  <g class="vh-anim-${shape.id}">`);
      lines.push(`    ${element}`);
      lines.push(`  </g>`);
    } else {
      lines.push(`  ${element}`);
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
  if (svg.getAttribute('data-vh-animation-enabled') === 'true') {
    settings.animationEnabled = true;
  }

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
    const animation = parseAnimationAttr(el.getAttribute('data-vh-anim'));
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
      ...(animation ? { animation } : {}),
    });
  }

  return { settings, shapes };
}
