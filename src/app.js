import { setRenderFn, requestRender } from "./state.js";
import { render } from "./render.js";
import { attachCanvasHandlers, setTool } from "./tools.js";
import { initUI, syncAllUI } from "./ui.js";
import { attachKeyboard } from "./keyboard.js";
import { fitView } from "./file-system.js";

function warnUnsavedOnExit() {
  window.addEventListener("beforeunload", (e) => {
    if (document.body.classList.contains("dirty")) {
      e.preventDefault();
      e.returnValue = "";
    }
  });
}

function init() {
  setRenderFn(render);
  initUI();
  attachCanvasHandlers();
  attachKeyboard();
  warnUnsavedOnExit();

  setTool("line");
  fitView();
  syncAllUI();
  requestRender();

  let resizeRaf = 0;
  window.addEventListener("resize", () => {
    cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(() => requestRender());
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
