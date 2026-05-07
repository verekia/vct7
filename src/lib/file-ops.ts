import { useStore } from '../store'
import {
  downloadText,
  pickAndOpenFile,
  pickSaveHandle,
  supportsFsApi,
  writeToHandle,
  type FileHandle,
} from './file-system'
import { parseProject, serializeProject, stripV7Attributes } from './svg-io'

const confirmDiscard = (): boolean => {
  if (!useStore.getState().dirty) return true
  return confirm('Discard unsaved changes?')
}

export function newProject(): void {
  if (!confirmDiscard()) return
  useStore.getState().newProject()
}

export async function openFile(): Promise<void> {
  if (!confirmDiscard()) return
  const file = await pickAndOpenFile()
  if (!file) return
  try {
    const { settings, shapes, groups } = parseProject(file.text)
    const store = useStore.getState()
    store.setProject(settings, shapes, groups)
    store.setFileMeta(file.name, file.handle)
  } catch (e) {
    alert(`Open failed: ${(e as Error).message}`)
  }
}

export async function openDroppedFile(file: File, handle: FileHandle | null = null): Promise<void> {
  if (!confirmDiscard()) return
  try {
    const text = await file.text()
    const { settings, shapes, groups } = parseProject(text)
    const store = useStore.getState()
    store.setProject(settings, shapes, groups)
    store.setFileMeta(file.name, handle)
  } catch (e) {
    alert(`Open failed: ${(e as Error).message}`)
  }
}

export async function saveFile(): Promise<void> {
  const store = useStore.getState()
  const handle = store.fileHandle as FileHandle | null
  const text = serializeProject(store.settings, store.shapes, store.groups)
  if (handle) {
    try {
      await writeToHandle(handle, text)
      store.clearDirty()
      return
    } catch (e) {
      alert(`Save failed: ${(e as Error).message}`)
      return
    }
  }
  await saveFileAs()
}

export function exportFile(): void {
  const state = useStore.getState()
  const text = serializeProject(state.settings, state.shapes, state.groups)
  const suggested = state.fileName || 'vct7.svg'
  downloadText(suggested, stripV7Attributes(text))
}

export async function saveFileAs(): Promise<void> {
  const initial = useStore.getState()
  const suggested = initial.fileName || 'vct7.svg'
  if (!supportsFsApi()) {
    // No async dialog — capture and write the current state.
    downloadText(suggested, serializeProject(initial.settings, initial.shapes, initial.groups))
    initial.clearDirty()
    return
  }
  const handle = await pickSaveHandle(suggested)
  if (!handle) return
  // Re-read after the picker resolves so any edits made while the dialog was
  // open are written, not the stale snapshot.
  const fresh = useStore.getState()
  try {
    await writeToHandle(handle, serializeProject(fresh.settings, fresh.shapes, fresh.groups))
    fresh.setFileMeta(handle.name, handle)
    fresh.clearDirty()
  } catch (e) {
    alert(`Save failed: ${(e as Error).message}`)
  }
}
