import { state, makeId, DEFAULT_SETTINGS } from "./state.js";
import { pointsToPath, fmt } from "./geometry.js";

function escapeAttr(v) {
  return String(v).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

export function serializeSVG() {
  const s = state.settings;
  const lines = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${fmt(s.width)} ${fmt(s.height)}" width="${fmt(s.width)}" height="${fmt(s.height)}"` +
      ` data-vh-snap-angles="${escapeAttr(s.snapAngles.join(","))}"` +
      ` data-vh-bezier="${fmt(s.bezier)}"` +
      ` data-vh-bg="${escapeAttr(s.bg)}">`,
  );
  lines.push(
    `  <rect x="0" y="0" width="${fmt(s.width)}" height="${fmt(s.height)}" fill="${escapeAttr(s.bg)}"/>`,
  );
  for (const shape of state.shapes) {
    const bz = shape.bezierOverride != null ? shape.bezierOverride : s.bezier;
    const d = pointsToPath(shape.points, shape.closed, bz);
    const attrs = [
      `d="${d}"`,
      `fill="${escapeAttr(shape.closed ? shape.fill : "none")}"`,
      `stroke="${escapeAttr(shape.stroke)}"`,
      `stroke-width="${fmt(shape.strokeWidth)}"`,
      `stroke-linejoin="round"`,
      `stroke-linecap="round"`,
      `data-vh-points="${shape.points.map((p) => `${fmt(p[0])},${fmt(p[1])}`).join(" ")}"`,
      `data-vh-closed="${shape.closed}"`,
    ];
    if (shape.bezierOverride != null) {
      attrs.push(`data-vh-bezier="${fmt(shape.bezierOverride)}"`);
    }
    lines.push(`  <path ${attrs.join(" ")}/>`);
  }
  lines.push("</svg>");
  return lines.join("\n");
}

export function parseSVG(text) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(text, "image/svg+xml");
  const err = doc.querySelector("parsererror");
  if (err) throw new Error("Invalid SVG file");

  const svg = doc.querySelector("svg");
  if (!svg) throw new Error("No <svg> root found");

  const settings = { ...DEFAULT_SETTINGS };

  const vb = svg.getAttribute("viewBox");
  if (vb) {
    const parts = vb.split(/[\s,]+/).map(Number);
    if (parts.length === 4) {
      settings.width = parts[2];
      settings.height = parts[3];
    }
  } else {
    const w = parseFloat(svg.getAttribute("width"));
    const h = parseFloat(svg.getAttribute("height"));
    if (w) settings.width = w;
    if (h) settings.height = h;
  }

  const angles = svg.getAttribute("data-vh-snap-angles");
  if (angles) {
    const parsed = angles
      .split(",")
      .map((s) => parseFloat(s.trim()))
      .filter((n) => Number.isFinite(n));
    if (parsed.length) settings.snapAngles = parsed;
  }

  const bz = svg.getAttribute("data-vh-bezier");
  if (bz != null && bz !== "") {
    const v = parseFloat(bz);
    if (Number.isFinite(v)) settings.bezier = v;
  }

  const bg = svg.getAttribute("data-vh-bg");
  if (bg) settings.bg = bg;

  const shapes = [];
  for (const path of svg.querySelectorAll("path")) {
    const ptsAttr = path.getAttribute("data-vh-points");
    if (!ptsAttr) continue;
    const points = ptsAttr
      .trim()
      .split(/\s+/)
      .map((p) => p.split(",").map(Number))
      .filter((p) => p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]));
    if (points.length === 0) continue;

    const closed = path.getAttribute("data-vh-closed") === "true";
    const fillAttr = path.getAttribute("fill") || (closed ? "#000000" : "none");
    const strokeAttr = path.getAttribute("stroke") || "none";
    const overrideAttr = path.getAttribute("data-vh-bezier");
    const bezierOverride =
      overrideAttr != null && overrideAttr !== "" && Number.isFinite(parseFloat(overrideAttr))
        ? parseFloat(overrideAttr)
        : null;

    shapes.push({
      id: makeId(),
      points,
      closed,
      fill: fillAttr,
      stroke: strokeAttr,
      strokeWidth: parseFloat(path.getAttribute("stroke-width") || "2"),
      bezierOverride,
    });
  }

  return { settings, shapes };
}
