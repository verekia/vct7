import { useStore } from '../store';
import { newProject, openFile, saveFile, saveFileAs } from '../lib/file-ops';
import { Toolbar } from './Toolbar';

export function Topbar() {
  const fileName = useStore((s) => s.fileName);
  const dirty = useStore((s) => s.dirty);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);

  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark">[ VH ]</span>
        <span className="brand-name">vectorheart</span>
        <span className="file-name">{fileName}</span>
        <span className="dirty-mark">{dirty ? '●' : ''}</span>
      </div>
      <div className="topbar-tools">
        <Toolbar />
      </div>
      <div className="topbar-group">
        <button onClick={undo} disabled={!canUndo} title="Undo (Ctrl/Cmd+Z)">
          Undo
        </button>
        <button onClick={redo} disabled={!canRedo} title="Redo (Ctrl/Cmd+Shift+Z)">
          Redo
        </button>
        <button onClick={newProject} title="New (Ctrl/Cmd+N)">
          New
        </button>
        <button onClick={openFile} title="Open (Ctrl/Cmd+O)">
          Open
        </button>
        <button onClick={saveFile} title="Save (Ctrl/Cmd+S)">
          Save
        </button>
        <button onClick={saveFileAs} title="Save As (Ctrl/Cmd+Shift+S)">
          Save As
        </button>
      </div>
    </header>
  );
}
