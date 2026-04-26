import {
  state,
  clearDirty,
  requestRender,
  DEFAULT_SETTINGS,
} from "./state.js";
import { serializeSVG, parseSVG } from "./svg-io.js";

const FILE_TYPES = [
  { description: "SVG", accept: { "image/svg+xml": [".svg"] } },
];

function setFileName(name) {
  state.fileName = name || "untitled.svg";
  const el = document.getElementById("file-name");
  if (el) el.textContent = state.fileName;
}

export function newProject() {
  if (state.dirty && !confirm("Discard unsaved changes?")) return;
  state.shapes = [];
  state.selectedShapeId = null;
  state.selectedVertex = null;
  state.drawing = null;
  state.fileHandle = null;
  state.settings = { ...DEFAULT_SETTINGS };
  setFileName("untitled.svg");
  clearDirty();
  fitView();
  requestRender();
}

export async function openFile() {
  if (!window.showOpenFilePicker) {
    return openFileFallback();
  }
  if (state.dirty && !confirm("Discard unsaved changes?")) return;
  let handle;
  try {
    [handle] = await window.showOpenFilePicker({ types: FILE_TYPES });
  } catch (e) {
    if (e && e.name === "AbortError") return;
    throw e;
  }
  const file = await handle.getFile();
  const text = await file.text();
  loadFromText(text);
  state.fileHandle = handle;
  setFileName(handle.name || file.name || "untitled.svg");
  clearDirty();
  fitView();
  requestRender();
}

function openFileFallback() {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".svg,image/svg+xml";
    input.onchange = async () => {
      const file = input.files && input.files[0];
      if (!file) return resolve();
      const text = await file.text();
      loadFromText(text);
      state.fileHandle = null;
      setFileName(file.name);
      clearDirty();
      fitView();
      requestRender();
      resolve();
    };
    input.click();
  });
}

function loadFromText(text) {
  const { settings, shapes } = parseSVG(text);
  state.settings = settings;
  state.shapes = shapes;
  state.selectedShapeId = null;
  state.selectedVertex = null;
  state.drawing = null;
}

export async function saveFile() {
  if (!state.fileHandle) return saveFileAs();
  try {
    const writable = await state.fileHandle.createWritable();
    await writable.write(serializeSVG());
    await writable.close();
    clearDirty();
  } catch (e) {
    console.error(e);
    alert("Save failed: " + (e && e.message ? e.message : e));
  }
}

export async function saveFileAs() {
  const data = serializeSVG();
  if (!window.showSaveFilePicker) {
    downloadFallback(data);
    return;
  }
  let handle;
  try {
    handle = await window.showSaveFilePicker({
      suggestedName: state.fileName || "vectorheart.svg",
      types: FILE_TYPES,
    });
  } catch (e) {
    if (e && e.name === "AbortError") return;
    throw e;
  }
  state.fileHandle = handle;
  setFileName(handle.name || "untitled.svg");
  await saveFile();
}

function downloadFallback(data) {
  const blob = new Blob([data], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = state.fileName || "vectorheart.svg";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  clearDirty();
}

// Reset view to fit the canvas in the viewport.
export function fitView() {
  const wrap = document.querySelector(".canvas-wrap");
  if (!wrap) return;
  const cw = wrap.clientWidth || 1;
  const ch = wrap.clientHeight || 1;
  const pad = 40;
  const sx = (cw - pad * 2) / state.settings.width;
  const sy = (ch - pad * 2) / state.settings.height;
  const scale = Math.min(sx, sy);
  state.view.scale = scale > 0 ? scale : 1;
  state.view.x = (cw - state.settings.width * state.view.scale) / 2;
  state.view.y = (ch - state.settings.height * state.view.scale) / 2;
}
