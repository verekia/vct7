import { SVG_NS, state, effectiveBezier } from "./state.js";
import { pointsToPath, fmt } from "./geometry.js";

function el(tag, attrs = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    node.setAttribute(k, String(v));
  }
  return node;
}

function setSize(svg) {
  const wrap = svg.parentElement;
  const cw = Math.max(1, wrap.clientWidth);
  const ch = Math.max(1, wrap.clientHeight);
  svg.setAttribute("viewBox", `0 0 ${cw} ${ch}`);
  return { cw, ch };
}

function shapeGroup(shape, scale) {
  const g = el("g", { "data-shape-id": shape.id });
  const bz = effectiveBezier(shape);
  const d = pointsToPath(shape.points, shape.closed, bz);

  const path = el("path", {
    d,
    fill: shape.closed ? shape.fill : "none",
    stroke: shape.stroke,
    "stroke-width": shape.strokeWidth,
    "stroke-linejoin": "round",
    "stroke-linecap": "round",
    "vector-effect": "non-scaling-stroke",
  });
  g.appendChild(path);

  const hit = el("path", {
    d,
    fill: shape.closed ? "rgba(0,0,0,0.001)" : "none",
    stroke: "rgba(0,0,0,0.001)",
    "stroke-width": Math.max(8 / scale, shape.strokeWidth + 6 / scale),
    "stroke-linejoin": "round",
    "stroke-linecap": "round",
    class: "shape-hit",
    "data-shape-id": shape.id,
  });
  g.appendChild(hit);
  return g;
}

function selectionLayer(shape, scale) {
  const g = el("g");

  // Outline: straight polygon through control points (so user always sees vertices clearly).
  const outline = el("path", {
    d: pointsToPath(shape.points, shape.closed, 0),
    class: "selection-outline",
    "vector-effect": "non-scaling-stroke",
  });
  g.appendChild(outline);

  shape.points.forEach((p, i) => {
    const isSel =
      state.selectedVertex &&
      state.selectedVertex.shapeId === shape.id &&
      state.selectedVertex.index === i;
    const c = el("circle", {
      cx: fmt(p[0]),
      cy: fmt(p[1]),
      r: 5 / scale,
      class: "vertex-handle" + (isSel ? " selected" : ""),
      "data-shape-id": shape.id,
      "data-vertex-index": i,
    });
    g.appendChild(c);
  });

  return g;
}

function previewLayer(scale) {
  const g = el("g");
  const drawing = state.drawing;
  if (!drawing || drawing.points.length === 0) return g;

  const last = drawing.points[drawing.points.length - 1];

  // Snap guides emanating from the last point.
  if (!state.snapDisabled && state.settings.snapAngles.length > 0) {
    const rayLen = (state.settings.width + state.settings.height) * 2;
    for (const a of state.settings.snapAngles) {
      const rad = (a * Math.PI) / 180;
      g.appendChild(
        el("line", {
          x1: fmt(last[0]),
          y1: fmt(last[1]),
          x2: fmt(last[0] + Math.cos(rad) * rayLen),
          y2: fmt(last[1] + Math.sin(rad) * rayLen),
          class: "snap-guide",
          "vector-effect": "non-scaling-stroke",
        }),
      );
    }
  }

  const previewPts = [...drawing.points, [state.cursor.x, state.cursor.y]];

  if (drawing.type === "polygon" && previewPts.length >= 3) {
    g.appendChild(
      el("path", {
        d: pointsToPath(previewPts, true, state.settings.bezier),
        fill: "rgba(255,59,48,0.08)",
        stroke: "none",
        "vector-effect": "non-scaling-stroke",
      }),
    );
  }

  g.appendChild(
    el("path", {
      d: pointsToPath(previewPts, false, state.settings.bezier),
      class: "preview-shape",
      "vector-effect": "non-scaling-stroke",
    }),
  );

  for (const p of drawing.points) {
    g.appendChild(
      el("circle", {
        cx: fmt(p[0]),
        cy: fmt(p[1]),
        r: 3 / scale,
        class: "preview-vertex",
      }),
    );
  }

  return g;
}

export function render() {
  const svg = document.getElementById("canvas");
  if (!svg) return;
  setSize(svg);
  const scale = state.view.scale || 1;

  // Clear.
  while (svg.firstChild) svg.removeChild(svg.firstChild);

  const root = el("g", {
    transform: `translate(${fmt(state.view.x)} ${fmt(state.view.y)}) scale(${fmt(scale)})`,
  });
  svg.appendChild(root);

  // Artboard background + border (1 px regardless of zoom).
  root.appendChild(
    el("rect", {
      x: 0,
      y: 0,
      width: state.settings.width,
      height: state.settings.height,
      fill: state.settings.bg,
    }),
  );
  root.appendChild(
    el("rect", {
      x: 0,
      y: 0,
      width: state.settings.width,
      height: state.settings.height,
      fill: "none",
      stroke: "#3a4150",
      "stroke-width": 1,
      "vector-effect": "non-scaling-stroke",
    }),
  );

  for (const shape of state.shapes) {
    root.appendChild(shapeGroup(shape, scale));
  }

  const selected = state.shapes.find((s) => s.id === state.selectedShapeId);
  if (selected) {
    root.appendChild(selectionLayer(selected, scale));
  }

  root.appendChild(previewLayer(scale));

  // HUD updates.
  const hudCoords = document.getElementById("hud-coords");
  if (hudCoords) {
    hudCoords.textContent = `${Math.round(state.cursor.x)}, ${Math.round(state.cursor.y)}`;
  }
  const hudZoom = document.getElementById("hud-zoom");
  if (hudZoom) {
    hudZoom.textContent = `${Math.round(scale * 100)}%`;
  }
  const hudTool = document.getElementById("hud-tool");
  if (hudTool) {
    hudTool.textContent = state.tool;
  }
}
