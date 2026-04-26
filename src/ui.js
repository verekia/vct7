import {
  state,
  requestRender,
  markDirty,
  setPanelFn,
  getSelectedShape,
} from "./state.js";
import { setTool } from "./tools.js";
import {
  newProject,
  openFile,
  saveFile,
  saveFileAs,
  fitView,
} from "./file-system.js";

const PRESETS = {
  ortho: [0, 90, 180, 270],
  45: [0, 45, 90, 135, 180, 225, 270, 315],
  30: [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330],
  60: [0, 60, 120, 180, 240, 300],
  15: Array.from({ length: 24 }, (_, i) => i * 15),
};

function $(id) {
  return document.getElementById(id);
}

function parseAngles(text) {
  return text
    .split(/[\s,]+/)
    .map((s) => parseFloat(s))
    .filter((n) => Number.isFinite(n));
}

function bindTopbar() {
  document.querySelectorAll("[data-action]").forEach((b) => {
    b.addEventListener("click", () => {
      const action = b.dataset.action;
      if (action === "new") newProject();
      else if (action === "open") openFile();
      else if (action === "save") saveFile();
      else if (action === "save-as") saveFileAs();
    });
  });
}

function bindTools() {
  document.querySelectorAll(".tool").forEach((b) => {
    b.addEventListener("click", () => setTool(b.dataset.tool));
  });
}

function bindProjectPanel() {
  const angles = $("snap-angles");
  angles.value = state.settings.snapAngles.join(",");
  angles.addEventListener("change", () => {
    const parsed = parseAngles(angles.value);
    state.settings.snapAngles = parsed;
    markDirty();
    requestRender();
  });

  document.querySelectorAll("[data-preset]").forEach((b) => {
    b.addEventListener("click", () => {
      const preset = PRESETS[b.dataset.preset];
      if (!preset) return;
      state.settings.snapAngles = preset;
      angles.value = preset.join(",");
      markDirty();
      requestRender();
    });
  });

  const bezier = $("bezier");
  const bezierReadout = $("bezier-readout");
  bezier.value = state.settings.bezier;
  bezierReadout.textContent = state.settings.bezier.toFixed(2);
  bezier.addEventListener("input", () => {
    state.settings.bezier = parseFloat(bezier.value);
    bezierReadout.textContent = state.settings.bezier.toFixed(2);
    markDirty();
    requestRender();
  });

  const bg = $("bg");
  const bgText = $("bg-text");
  bg.value = state.settings.bg;
  bgText.value = state.settings.bg;
  function setBg(v) {
    state.settings.bg = v;
    bg.value = v;
    bgText.value = v;
    markDirty();
    requestRender();
  }
  bg.addEventListener("input", () => setBg(bg.value));
  bgText.addEventListener("change", () => {
    if (/^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(bgText.value)) setBg(bgText.value);
    else bgText.value = state.settings.bg;
  });

  const cw = $("canvas-w");
  const ch = $("canvas-h");
  cw.value = state.settings.width;
  ch.value = state.settings.height;
  function applyCanvasSize() {
    const w = parseFloat(cw.value);
    const h = parseFloat(ch.value);
    if (Number.isFinite(w) && w > 0) state.settings.width = w;
    if (Number.isFinite(h) && h > 0) state.settings.height = h;
    markDirty();
    fitView();
    requestRender();
  }
  cw.addEventListener("change", applyCanvasSize);
  ch.addEventListener("change", applyCanvasSize);
}

function bindShapePanel() {
  const stroke = $("shape-stroke");
  const strokeText = $("shape-stroke-text");
  const strokeWidth = $("shape-stroke-width");
  const fill = $("shape-fill");
  const fillText = $("shape-fill-text");
  const fillNone = $("shape-fill-none");
  const bezier = $("shape-bezier");
  const bezierReadout = $("shape-bezier-readout");
  const bezierClear = $("bezier-override-clear");
  const del = $("shape-delete");

  function withShape(fn) {
    const shape = getSelectedShape();
    if (!shape) return;
    fn(shape);
    markDirty();
    requestRender();
  }

  stroke.addEventListener("input", () =>
    withShape((s) => {
      s.stroke = stroke.value;
      strokeText.value = stroke.value;
    }),
  );
  strokeText.addEventListener("change", () => {
    if (/^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(strokeText.value)) {
      withShape((s) => {
        s.stroke = strokeText.value;
        stroke.value = strokeText.value;
      });
    }
  });
  strokeWidth.addEventListener("change", () =>
    withShape((s) => {
      const v = parseFloat(strokeWidth.value);
      if (Number.isFinite(v) && v >= 0) s.strokeWidth = v;
    }),
  );

  fill.addEventListener("input", () =>
    withShape((s) => {
      s.fill = fill.value;
      fillText.value = fill.value;
    }),
  );
  fillText.addEventListener("change", () => {
    if (fillText.value === "none" || /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(fillText.value)) {
      withShape((s) => {
        s.fill = fillText.value;
        if (fillText.value !== "none") fill.value = fillText.value;
      });
    }
  });
  fillNone.addEventListener("click", () =>
    withShape((s) => {
      s.fill = "none";
      fillText.value = "none";
    }),
  );

  bezier.addEventListener("input", () =>
    withShape((s) => {
      s.bezierOverride = parseFloat(bezier.value);
      bezierReadout.textContent = s.bezierOverride.toFixed(2);
    }),
  );
  bezierClear.addEventListener("click", () =>
    withShape((s) => {
      s.bezierOverride = null;
    }),
  );

  del.addEventListener("click", () =>
    withShape((s) => {
      const idx = state.shapes.findIndex((x) => x.id === s.id);
      if (idx >= 0) state.shapes.splice(idx, 1);
      state.selectedShapeId = null;
      state.selectedVertex = null;
    }),
  );
}

function syncPanel() {
  const panel = $("shape-panel");
  const shape = getSelectedShape();
  if (!shape) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;
  $("shape-type").textContent = shape.closed ? "polygon" : "line";
  $("shape-points").textContent = String(shape.points.length);

  $("shape-stroke").value = sanitizeColor(shape.stroke);
  $("shape-stroke-text").value = shape.stroke;
  $("shape-stroke-width").value = shape.strokeWidth;

  const fillEl = $("shape-fill");
  const fillText = $("shape-fill-text");
  const fillRow = fillEl.closest(".closed-only");
  if (fillRow) fillRow.style.display = shape.closed ? "" : "none";
  fillEl.value = sanitizeColor(shape.fill);
  fillText.value = shape.fill;

  const bezier = $("shape-bezier");
  const bezierReadout = $("shape-bezier-readout");
  if (shape.bezierOverride != null) {
    bezier.value = shape.bezierOverride;
    bezierReadout.textContent = shape.bezierOverride.toFixed(2);
  } else {
    bezier.value = state.settings.bezier;
    bezierReadout.textContent = `— (global ${state.settings.bezier.toFixed(2)})`;
  }
}

function sanitizeColor(c) {
  if (!c || c === "none") return "#000000";
  if (/^#[0-9a-f]{6}$/i.test(c)) return c;
  if (/^#[0-9a-f]{3}$/i.test(c)) {
    return (
      "#" +
      c
        .slice(1)
        .split("")
        .map((ch) => ch + ch)
        .join("")
    );
  }
  return "#000000";
}

export function syncAllUI() {
  $("snap-angles").value = state.settings.snapAngles.join(",");
  $("bezier").value = state.settings.bezier;
  $("bezier-readout").textContent = state.settings.bezier.toFixed(2);
  $("bg").value = sanitizeColor(state.settings.bg);
  $("bg-text").value = state.settings.bg;
  $("canvas-w").value = state.settings.width;
  $("canvas-h").value = state.settings.height;
  syncPanel();
}

export function initUI() {
  bindTopbar();
  bindTools();
  bindProjectPanel();
  bindShapePanel();
  setPanelFn(syncPanel);
}
