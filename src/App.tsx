import { useEffect } from 'react'

import { Canvas } from './components/Canvas'
import { FontDialog } from './components/FontDialog'
import { LayerPanel } from './components/LayerPanel'
import { ProjectPanel } from './components/ProjectPanel'
import { ShapePanel } from './components/ShapePanel'
import { Statusbar } from './components/Statusbar'
import { Timeline } from './components/Timeline'
import { Topbar } from './components/Topbar'
import { useKeyboard } from './hooks/useKeyboard'
import { openDroppedFile } from './lib/file-ops'
import { useStore } from './store'

import type { FileHandle } from './lib/file-system'

export function App() {
  useKeyboard()

  // Warn before leaving if there are unsaved changes.
  const dirty = useStore(s => s.dirty)
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (!dirty) return
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirty])

  // Load a dropped SVG as the current project.
  useEffect(() => {
    const onDragOver = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes('Files')) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
    }
    const onDrop = (e: DragEvent) => {
      const file = e.dataTransfer?.files?.[0]
      if (!file) return
      e.preventDefault()
      if (!/\.svg$|svg\+xml/i.test(file.name + ' ' + file.type)) {
        alert('Please drop an SVG file.')
        return
      }
      // Try to obtain a writable handle so Cmd+S can save in place. Must be
      // requested synchronously inside the drop handler. Chromium-only.
      const item = e.dataTransfer?.items?.[0] as
        | (DataTransferItem & {
            getAsFileSystemHandle?: () => Promise<{ kind: string } | null>
          })
        | undefined
      const handlePromise = item?.getAsFileSystemHandle
        ? item
            .getAsFileSystemHandle()
            .then(h => (h && h.kind === 'file' ? (h as unknown as FileHandle) : null))
            .catch(() => null)
        : Promise.resolve(null)
      void handlePromise.then(h => openDroppedFile(file, h))
    }
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('drop', onDrop)
    }
  }, [])

  return (
    <>
      <Topbar />
      <main className="grid min-h-0 grid-cols-[240px_1fr_280px]">
        <aside className="panel-surface border-line overflow-y-auto border-r pb-6">
          <ProjectPanel />
          <LayerPanel />
        </aside>
        <Canvas />
        <aside className="panel-surface border-line overflow-y-auto border-l pb-6">
          <ShapePanel />
        </aside>
      </main>
      <Timeline />
      <Statusbar />
      <FontDialog />
    </>
  )
}
