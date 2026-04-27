import type { BlendMode, ProjectSettings, Shape } from '../types';

export type RGB = [number, number, number];

const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Parse a `#rgb` / `#rrggbb` color into normalized [0, 1] channels, or null. */
export function parseHex(c: string): RGB | null {
  if (!c || !HEX_RE.test(c)) return null;
  let hex = c.slice(1);
  if (hex.length === 3) {
    hex = hex
      .split('')
      .map((ch) => ch + ch)
      .join('');
  }
  const r = parseInt(hex.slice(0, 2), 16) / 255;
  const g = parseInt(hex.slice(2, 4), 16) / 255;
  const b = parseInt(hex.slice(4, 6), 16) / 255;
  return [r, g, b];
}

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

const ch = (n: number): string => {
  const v = Math.round(clamp01(n) * 255);
  return v.toString(16).padStart(2, '0');
};

export const toHex = ([r, g, b]: RGB): string => `#${ch(r)}${ch(g)}${ch(b)}`;

type ChannelFn = (b: number, s: number) => number;

// Separable blend functions — operate on a single channel, b = backdrop, s = source.
const multiply: ChannelFn = (b, s) => b * s;
const screen: ChannelFn = (b, s) => b + s - b * s;
const hardLight: ChannelFn = (b, s) => (s <= 0.5 ? multiply(b, 2 * s) : screen(b, 2 * s - 1));

const sep: Record<string, ChannelFn> = {
  normal: (_b, s) => s,
  multiply,
  screen,
  overlay: (b, s) => hardLight(s, b),
  darken: (b, s) => Math.min(b, s),
  lighten: (b, s) => Math.max(b, s),
  'color-dodge': (b, s) => {
    if (b === 0) return 0;
    if (s === 1) return 1;
    return Math.min(1, b / (1 - s));
  },
  'color-burn': (b, s) => {
    if (b === 1) return 1;
    if (s === 0) return 0;
    return 1 - Math.min(1, (1 - b) / s);
  },
  'hard-light': hardLight,
  'soft-light': (b, s) => {
    if (s <= 0.5) return b - (1 - 2 * s) * b * (1 - b);
    const d = b <= 0.25 ? ((16 * b - 12) * b + 4) * b : Math.sqrt(b);
    return b + (2 * s - 1) * (d - b);
  },
  difference: (b, s) => Math.abs(b - s),
  exclusion: (b, s) => b + s - 2 * b * s,
};

const lum = ([r, g, b]: RGB): number => 0.3 * r + 0.59 * g + 0.11 * b;

const clipColor = (c: RGB): RGB => {
  const l = lum(c);
  const n = Math.min(c[0], c[1], c[2]);
  const x = Math.max(c[0], c[1], c[2]);
  let [r, g, bl] = c;
  if (n < 0) {
    r = l + ((r - l) * l) / (l - n);
    g = l + ((g - l) * l) / (l - n);
    bl = l + ((bl - l) * l) / (l - n);
  }
  if (x > 1) {
    r = l + ((r - l) * (1 - l)) / (x - l);
    g = l + ((g - l) * (1 - l)) / (x - l);
    bl = l + ((bl - l) * (1 - l)) / (x - l);
  }
  return [r, g, bl];
};

const setLum = (c: RGB, l: number): RGB => {
  const d = l - lum(c);
  return clipColor([c[0] + d, c[1] + d, c[2] + d]);
};

const sat = (c: RGB): number => Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2]);

// Stretch the mid-channel toward [0, s] preserving channel ordering — the W3C
// SetSat algorithm (Compositing-1, §10.3).
const setSat = (c: RGB, s: number): RGB => {
  const out: RGB = [c[0], c[1], c[2]];
  const idx = [0, 1, 2].toSorted((a, b) => out[a] - out[b]) as [number, number, number];
  const [iMin, iMid, iMax] = idx;
  if (out[iMax] > out[iMin]) {
    out[iMid] = ((out[iMid] - out[iMin]) * s) / (out[iMax] - out[iMin]);
    out[iMax] = s;
  } else {
    out[iMid] = 0;
    out[iMax] = 0;
  }
  out[iMin] = 0;
  return out;
};

export function blendColor(bottom: RGB, top: RGB, mode: BlendMode): RGB {
  switch (mode) {
    case 'normal':
      return top;
    case 'hue':
      return setLum(setSat(top, sat(bottom)), lum(bottom));
    case 'saturation':
      return setLum(setSat(bottom, sat(top)), lum(bottom));
    case 'color':
      return setLum(top, lum(bottom));
    case 'luminosity':
      return setLum(bottom, lum(top));
    default: {
      const fn = sep[mode];
      return [fn(bottom[0], top[0]), fn(bottom[1], top[1]), fn(bottom[2], top[2])];
    }
  }
}

/**
 * The opaque backdrop color a given shape sits on. Walks the shapes array from
 * just below `shapeId` down to 0, returning the first visible shape's fill that
 * parses as an opaque hex color. Falls back to the project background.
 *
 * Intentionally simplistic: ignores geometry overlap, partial transparency,
 * stroke vs fill distinction, and recursive blending of layers below.
 */
export function findColorBelow(shapes: Shape[], settings: ProjectSettings, shapeId: string): RGB {
  const idx = shapes.findIndex((s) => s.id === shapeId);
  for (let i = idx - 1; i >= 0; i--) {
    const sh = shapes[i];
    if (sh.hidden) continue;
    const rgb = parseHex(sh.fill);
    if (rgb) return rgb;
  }
  return parseHex(settings.bg) ?? [1, 1, 1];
}
