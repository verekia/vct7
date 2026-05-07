import { exportFile, newProject, openFile, saveFile, saveFileAs } from '../lib/file-ops'
import { useStore } from '../store'
import { CodeButton } from './CodeDialog'
import { Toolbar } from './Toolbar'

export function Topbar() {
  const fileName = useStore(s => s.fileName)
  const dirty = useStore(s => s.dirty)
  const canUndo = useStore(s => s.past.length > 0)
  const canRedo = useStore(s => s.future.length > 0)
  const undo = useStore(s => s.undo)
  const redo = useStore(s => s.redo)

  return (
    <header className="topbar-surface border-line relative grid grid-cols-[1fr_auto_1fr] items-center border-b px-3.5">
      <div className="flex items-baseline gap-2.5">
        <span className="text-accent font-bold tracking-[1px] [text-shadow:0_0_12px_rgba(255,59,48,0.45)]">
          / VCT7 /
        </span>
        <span className="text-muted ml-3 text-[11px] tracking-[0.5px]">{fileName}</span>
        <span className="text-accent inline-block w-2.5 text-center">{dirty ? '●' : ''}</span>
      </div>
      <div className="flex justify-center gap-1 py-1.5">
        <Toolbar />
      </div>
      <div className="flex gap-1 justify-self-end">
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
        <button onClick={exportFile} title="Export plain SVG (no VCT7 metadata)">
          Export
        </button>
        <CodeButton />
      </div>
    </header>
  )
}
