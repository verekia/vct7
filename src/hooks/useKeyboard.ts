import { useEffect } from 'react';
import { useStore } from '../store';
import { newProject, openFile, saveFile, saveFileAs } from '../lib/file-ops';

const isEditableTarget = (t: EventTarget | null): boolean => {
  if (!(t instanceof HTMLElement)) return false;
  const tag = t.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable;
};

export function useKeyboard() {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;

      if (meta && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        if (e.shiftKey) void saveFileAs();
        else void saveFile();
        return;
      }
      if (meta && (e.key === 'o' || e.key === 'O')) {
        e.preventDefault();
        void openFile();
        return;
      }
      if (meta && (e.key === 'n' || e.key === 'N')) {
        e.preventDefault();
        newProject();
        return;
      }

      if (isEditableTarget(e.target)) return;

      const state = useStore.getState();

      if (e.key === 'Shift') {
        state.setSnapDisabled(true);
        return;
      }
      if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        if (!state.spaceHeld) state.setSpaceHeld(true);
        return;
      }
      if (e.key === 'Escape') {
        state.cancelDrawing();
        state.selectShape(null);
        return;
      }
      if (e.key === 'Enter') {
        if (state.drawing) state.commitDrawing(state.drawing.type !== 'line');
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        if (state.selectedVertex) {
          state.deleteVertex(state.selectedVertex.shapeId, state.selectedVertex.index);
        } else if (state.selectedShapeId) {
          state.deleteShape(state.selectedShapeId);
        }
        return;
      }
      if (e.key === 'v' || e.key === 'V') state.setTool('select');
      else if (e.key === 'l' || e.key === 'L') state.setTool('line');
      else if (e.key === 'p' || e.key === 'P') state.setTool('polygon');
      else if (e.key === 'c' || e.key === 'C') state.setTool('circle');
      else if (e.key === 'f' || e.key === 'F') state.requestFit();
      else if (e.key === 'g' || e.key === 'G')
        state.setSettings({ gridVisible: !state.settings.gridVisible });
    };

    const onKeyUp = (e: KeyboardEvent) => {
      const state = useStore.getState();
      if (e.key === 'Shift') state.setSnapDisabled(false);
      if (e.key === ' ' || e.code === 'Space') state.setSpaceHeld(false);
    };

    const onBlur = () => {
      const state = useStore.getState();
      state.setSnapDisabled(false);
      state.setSpaceHeld(false);
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, []);
}
