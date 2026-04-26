export const SVG_NS = "http://www.w3.org/2000/svg";

let nextId = 1;
export function makeId() {
  return `s${nextId++}`;
}

export const DEFAULT_SETTINGS = {
  snapAngles: [0, 45, 90, 135, 180, 225, 270, 315],
  bezier: 0,
  bg: "#ffffff",
  width: 800,
  height: 800,
};

export const state = {
  shapes: [],
  selectedShapeId: null,
  selectedVertex: null,
  tool: "select",
  drawing: null,
  view: { x: 0, y: 0, scale: 1 },
  settings: { ...DEFAULT_SETTINGS },
  fileHandle: null,
  fileName: "untitled.svg",
  dirty: false,
  cursor: { x: 0, y: 0 },
  rawCursor: { x: 0, y: 0 },
  snapDisabled: false,
  spaceHeld: false,
  panning: null,
  draggingShape: null,
  draggingVertex: null,
};

let renderRequested = false;
let renderFn = () => {};
let panelFn = () => {};

export function setRenderFn(fn) {
  renderFn = fn;
}
export function setPanelFn(fn) {
  panelFn = fn;
}

export function requestRender() {
  if (renderRequested) return;
  renderRequested = true;
  requestAnimationFrame(() => {
    renderRequested = false;
    renderFn();
    panelFn();
  });
}

export function markDirty() {
  if (!state.dirty) {
    state.dirty = true;
    document.body.classList.add("dirty");
  }
}

export function clearDirty() {
  state.dirty = false;
  document.body.classList.remove("dirty");
}

export function makeShape({ points, closed }) {
  return {
    id: makeId(),
    points,
    closed: !!closed,
    fill: closed ? "#000000" : "none",
    stroke: closed ? "none" : "#000000",
    strokeWidth: 2,
    bezierOverride: null,
  };
}

export function getSelectedShape() {
  return state.shapes.find((s) => s.id === state.selectedShapeId) || null;
}

export function effectiveBezier(shape) {
  if (shape && shape.bezierOverride != null) return shape.bezierOverride;
  return state.settings.bezier;
}
