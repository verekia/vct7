import opentype from 'opentype.js';
import type { GlyphData } from '../types';

/**
 * Local Font Access API surface — Chromium-only as of 2026. We declare the
 * shape we use rather than depending on @types/dom-local-font-access.
 */
interface FontDataLike {
  family: string;
  fullName: string;
  postscriptName: string;
  style: string;
  blob(): Promise<Blob>;
}

interface QueryLocalFontsWindow {
  queryLocalFonts?: () => Promise<FontDataLike[]>;
}

export const isLocalFontsSupported = (): boolean =>
  typeof (window as unknown as QueryLocalFontsWindow).queryLocalFonts === 'function';

/** One row in the font picker. Multiple rows can share `family` (different styles). */
export interface FontEntry {
  /** PostScript name — unique key, used to look up the blob. */
  postscriptName: string;
  family: string;
  fullName: string;
  style: string;
}

/**
 * Module-scope caches survive across dialog open/close so the user only pays
 * the queryLocalFonts permission round-trip + opentype parse cost once per
 * session, per font.
 */
let cachedEntries: FontEntry[] | null = null;
const rawFontData = new Map<string, FontDataLike>();
const blobCache = new Map<string, Blob>();
const fontCache = new Map<string, opentype.Font>();

/**
 * Trigger the Local Font Access permission prompt (must be called from a user
 * gesture) and return the available fonts. Subsequent calls return the cached
 * list without re-prompting.
 */
export async function loadLocalFonts(): Promise<FontEntry[]> {
  if (cachedEntries) return cachedEntries;
  const w = window as unknown as QueryLocalFontsWindow;
  if (!w.queryLocalFonts) {
    throw new Error('Local Font Access API not supported in this browser');
  }
  const fonts = await w.queryLocalFonts();
  const entries: FontEntry[] = [];
  for (const f of fonts) {
    entries.push({
      postscriptName: f.postscriptName,
      family: f.family,
      fullName: f.fullName,
      style: f.style,
    });
    // Hold onto the FontData so we can fetch its blob later by postscriptName.
    rawFontData.set(f.postscriptName, f);
  }
  entries.sort((a, b) => a.family.localeCompare(b.family) || a.style.localeCompare(b.style));
  cachedEntries = entries;
  return entries;
}

async function getFont(postscriptName: string): Promise<opentype.Font> {
  const cached = fontCache.get(postscriptName);
  if (cached) return cached;
  let blob = blobCache.get(postscriptName);
  if (!blob) {
    const data = rawFontData.get(postscriptName);
    if (!data) throw new Error(`Font not found: ${postscriptName}`);
    blob = await data.blob();
    blobCache.set(postscriptName, blob);
  }
  const buffer = await blob.arrayBuffer();
  const font = opentype.parse(buffer);
  fontCache.set(postscriptName, font);
  return font;
}

/**
 * Vectorize `text` in the given font at `fontSize` user units. The returned
 * `d` is anchored so the visible bbox starts at (0, 0): the renderer just
 * applies a translate(topLeft) to position the block. `width` / `height` are
 * the bbox dimensions, used to derive `points[1]` (bottom-right) on the shape.
 *
 * Empty / whitespace-only text raises — opentype emits an empty path and we
 * have nothing meaningful to place on the canvas.
 */
export async function vectorizeText(
  postscriptName: string,
  text: string,
  fontSize: number,
): Promise<GlyphData> {
  const font = await getFont(postscriptName);
  // First pass at (0, 0) gives the bbox; a second pass shifts the path so the
  // visible top-left lands at exactly (0, 0). Cheaper than walking the path
  // commands manually and stays correct for fonts with negative side bearings.
  const probe = font.getPath(text, 0, 0, fontSize);
  const bbox = probe.getBoundingBox();
  const width = bbox.x2 - bbox.x1;
  const height = bbox.y2 - bbox.y1;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error('No visible glyphs for this text + font');
  }
  const path = font.getPath(text, -bbox.x1, -bbox.y1, fontSize);
  const d = path.toPathData(3);
  return {
    text,
    fontFamily: font.names.fontFamily?.en ?? font.names.fullName?.en ?? postscriptName,
    fontSize,
    d,
    width,
    height,
  };
}
