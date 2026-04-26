import { state, makeShape, requestRender, markDirty } from "./state.js";
import { snapToAngle, dist } from "./geometry.js";

const VERTEX_HIT_PX = 10;
const CLOSE_POLYGON_PX = 12;

function screenToCanvas(clientX, clientY) {
  const svg = document.getElementById("canvas");
  const rect = svg.getBoundingClientRect();
  const x = (clientX - rect.left - state.view.x) / state.view.scale;
  const y = (clientY - rect.top - state.view.y) / state.view.scale;
  return { x, y };
}

function applySnap(from, to) {
  if (state.snapDisabled) return { x: to.x, y: to.y };
  return snapToAngle(from, to, state.settings.snapAngles);
}

function findShapeAt(target) {
  // event delegation: walk up to find data-shape-id on hit zone
  let node = target;
  while (node && node !== document) {
    if (node.dataset && node.dataset.shapeId) {
      return { shapeId: node.dataset.shapeId, vertexIndex: node.dataset.vertexIndex };
    }
    node = node.parentNode;
  }
  return null;
}

export function setTool(name) {
  state.tool = name;
  state.drawing = null;
  state.selectedVertex = null;
  document.querySelectorAll(".tool").forEach((b) => {
    b.classList.toggle("active", b.dataset.tool === name);
  });
  const svg = document.getElementById("canvas");
  if (svg) {
    svg.classList.toggle("tool-select", name === "select");
  }
  const hint = document.getElementById("tool-hint");
  if (hint) {
    hint.textContent =
      name === "line"
        ? "Click to place points. Enter / dbl-click to finish. Esc to cancel."
        : name === "polygon"
          ? "Click to place points. Click first point or Enter to close."
          : "Click a shape to select. Drag vertex handles to edit.";
  }
  requestRender();
}

function pointerCanvas(e) {
  return screenToCanvas(e.clientX, e.clientY);
}

function trackedCursor(e) {
  const raw = pointerCanvas(e);
  state.rawCursor = raw;
  if (state.drawing && state.drawing.points.length > 0) {
    const from = state.drawing.points[state.drawing.points.length - 1];
    const snapped = applySnap({ x: from[0], y: from[1] }, raw);
    state.cursor = { x: snapped.x, y: snapped.y };
  } else {
    state.cursor = raw;
  }
  return state.cursor;
}

function shouldCloseDrawing() {
  if (!state.drawing) return false;
  const pts = state.drawing.points;
  if (state.drawing.type !== "polygon" || pts.length < 3) return false;
  const first = pts[0];
  const last = state.cursor;
  const screenDist = dist([first[0], first[1]], [last.x, last.y]) * state.view.scale;
  return screenDist <= CLOSE_POLYGON_PX;
}

function commitDrawing(closed) {
  if (!state.drawing) return;
  const pts = state.drawing.points;
  if (pts.length < 2) {
    state.drawing = null;
    requestRender();
    return;
  }
  const shape = makeShape({
    points: pts.map((p) => [p[0], p[1]]),
    closed: closed && state.drawing.type === "polygon",
  });
  if (state.drawing.type === "line") {
    shape.fill = "none";
    shape.stroke = "#000000";
  } else {
    shape.fill = "#000000";
    shape.stroke = "none";
  }
  state.shapes.push(shape);
  state.selectedShapeId = shape.id;
  state.drawing = null;
  markDirty();
  requestRender();
}

function cancelDrawing() {
  if (state.drawing) {
    state.drawing = null;
    requestRender();
  }
}

function startPan(e) {
  state.panning = {
    startX: e.clientX,
    startY: e.clientY,
    viewX: state.view.x,
    viewY: state.view.y,
  };
  document.getElementById("canvas").classList.add("panning");
}

function endPan() {
  state.panning = null;
  document.getElementById("canvas").classList.remove("panning");
}

function onPointerDown(e) {
  if (e.button === 1 || (e.button === 0 && state.spaceHeld)) {
    e.preventDefault();
    startPan(e);
    return;
  }
  if (e.button !== 0) return;

  const target = e.target;
  trackedCursor(e);

  if (state.tool === "line" || state.tool === "polygon") {
    if (!state.drawing) {
      state.drawing = { type: state.tool, points: [[state.cursor.x, state.cursor.y]] };
    } else {
      if (shouldCloseDrawing()) {
        commitDrawing(true);
        return;
      }
      state.drawing.points.push([state.cursor.x, state.cursor.y]);
    }
    requestRender();
    return;
  }

  if (state.tool === "select") {
    const hit = findShapeAt(target);
    if (hit && hit.vertexIndex != null) {
      state.selectedShapeId = hit.shapeId;
      state.selectedVertex = { shapeId: hit.shapeId, index: parseInt(hit.vertexIndex, 10) };
      state.draggingVertex = {
        shapeId: hit.shapeId,
        index: parseInt(hit.vertexIndex, 10),
      };
      requestRender();
      return;
    }
    if (hit && hit.shapeId) {
      state.selectedShapeId = hit.shapeId;
      state.selectedVertex = null;
      const shape = state.shapes.find((s) => s.id === hit.shapeId);
      if (shape) {
        state.draggingShape = {
          shapeId: shape.id,
          startCursor: { x: state.rawCursor.x, y: state.rawCursor.y },
          startPoints: shape.points.map((p) => [p[0], p[1]]),
        };
      }
      requestRender();
      return;
    }
    state.selectedShapeId = null;
    state.selectedVertex = null;
    requestRender();
  }
}

function onPointerMove(e) {
  if (state.panning) {
    state.view.x = state.panning.viewX + (e.clientX - state.panning.startX);
    state.view.y = state.panning.viewY + (e.clientY - state.panning.startY);
    requestRender();
    return;
  }

  trackedCursor(e);

  if (state.draggingVertex) {
    const shape = state.shapes.find((s) => s.id === state.draggingVertex.shapeId);
    if (shape) {
      shape.points[state.draggingVertex.index] = [state.rawCursor.x, state.rawCursor.y];
      markDirty();
    }
    requestRender();
    return;
  }

  if (state.draggingShape) {
    const shape = state.shapes.find((s) => s.id === state.draggingShape.shapeId);
    if (shape) {
      const dx = state.rawCursor.x - state.draggingShape.startCursor.x;
      const dy = state.rawCursor.y - state.draggingShape.startCursor.y;
      shape.points = state.draggingShape.startPoints.map((p) => [p[0] + dx, p[1] + dy]);
      markDirty();
    }
    requestRender();
    return;
  }

  // Always rerender for snap guides / preview cursor.
  requestRender();
}

function onPointerUp(e) {
  if (state.panning) {
    endPan();
    return;
  }
  state.draggingShape = null;
  state.draggingVertex = null;
}

function onDblClick(e) {
  if (state.drawing) {
    if (state.drawing.type === "polygon") commitDrawing(true);
    else commitDrawing(false);
  }
}

function onWheel(e) {
  e.preventDefault();
  const svg = document.getElementById("canvas");
  const rect = svg.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;
  const cx = (mx - state.view.x) / state.view.scale;
  const cy = (my - state.view.y) / state.view.scale;
  const factor = Math.exp(-e.deltaY * 0.0015);
  const next = Math.max(0.05, Math.min(40, state.view.scale * factor));
  state.view.scale = next;
  state.view.x = mx - cx * next;
  state.view.y = my - cy * next;
  requestRender();
}

export function attachCanvasHandlers() {
  const svg = document.getElementById("canvas");
  svg.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
  svg.addEventListener("dblclick", onDblClick);
  svg.addEventListener("contextmenu", (e) => {
    if (state.drawing) {
      e.preventDefault();
      commitDrawing(state.drawing.type === "polygon");
    }
  });
  svg.addEventListener("wheel", onWheel, { passive: false });
}

export function finishDrawing() {
  if (!state.drawing) return;
  if (state.drawing.type === "polygon") commitDrawing(true);
  else commitDrawing(false);
}

export { cancelDrawing };

export function deleteSelection() {
  if (state.selectedVertex) {
    const shape = state.shapes.find((s) => s.id === state.selectedVertex.shapeId);
    if (shape && shape.points.length > 2) {
      shape.points.splice(state.selectedVertex.index, 1);
      state.selectedVertex = null;
      markDirty();
      requestRender();
      return;
    }
    // Fall through: removing last vertex deletes the shape.
    state.selectedShapeId = state.selectedVertex.shapeId;
    state.selectedVertex = null;
  }
  if (state.selectedShapeId) {
    const idx = state.shapes.findIndex((s) => s.id === state.selectedShapeId);
    if (idx >= 0) {
      state.shapes.splice(idx, 1);
      state.selectedShapeId = null;
      markDirty();
      requestRender();
    }
  }
}
