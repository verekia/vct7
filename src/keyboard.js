import { state, requestRender } from "./state.js";
import { setTool, finishDrawing, cancelDrawing, deleteSelection } from "./tools.js";
import { newProject, openFile, saveFile, saveFileAs } from "./file-system.js";

function isEditableTarget(t) {
  if (!t) return false;
  const tag = t.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t.isContentEditable;
}

export function attachKeyboard() {
  window.addEventListener("keydown", (e) => {
    const meta = e.metaKey || e.ctrlKey;

    if (meta && (e.key === "s" || e.key === "S")) {
      e.preventDefault();
      if (e.shiftKey) saveFileAs();
      else saveFile();
      return;
    }
    if (meta && (e.key === "o" || e.key === "O")) {
      e.preventDefault();
      openFile();
      return;
    }
    if (meta && (e.key === "n" || e.key === "N")) {
      e.preventDefault();
      newProject();
      return;
    }

    if (isEditableTarget(e.target)) return;

    if (e.key === "Shift") {
      state.snapDisabled = true;
      requestRender();
      return;
    }
    if (e.key === " " || e.code === "Space") {
      if (!state.spaceHeld) {
        state.spaceHeld = true;
        document.getElementById("canvas").classList.add("space");
      }
      e.preventDefault();
      return;
    }

    if (e.key === "Escape") {
      cancelDrawing();
      state.selectedShapeId = null;
      state.selectedVertex = null;
      requestRender();
      return;
    }
    if (e.key === "Enter") {
      finishDrawing();
      return;
    }
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      deleteSelection();
      return;
    }
    if (e.key === "v" || e.key === "V") setTool("select");
    else if (e.key === "l" || e.key === "L") setTool("line");
    else if (e.key === "p" || e.key === "P") setTool("polygon");
  });

  window.addEventListener("keyup", (e) => {
    if (e.key === "Shift") {
      state.snapDisabled = false;
      requestRender();
    }
    if (e.key === " " || e.code === "Space") {
      state.spaceHeld = false;
      document.getElementById("canvas").classList.remove("space");
    }
  });

  // Drop snap-disable if window loses focus while Shift was held.
  window.addEventListener("blur", () => {
    state.snapDisabled = false;
    state.spaceHeld = false;
    document.getElementById("canvas").classList.remove("space");
    requestRender();
  });
}
