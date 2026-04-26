import { useStore } from '../store';
import {
  downloadText,
  pickAndOpenFile,
  pickSaveHandle,
  supportsFsApi,
  writeToHandle,
  type FileHandle,
} from './file-system';
import { parseProject, serializeProject } from './svg-io';

const confirmDiscard = (): boolean => {
  if (!useStore.getState().dirty) return true;
  return confirm('Discard unsaved changes?');
};

export function newProject(): void {
  if (!confirmDiscard()) return;
  useStore.getState().newProject();
}

export async function openFile(): Promise<void> {
  if (!confirmDiscard()) return;
  const file = await pickAndOpenFile();
  if (!file) return;
  try {
    const { settings, shapes } = parseProject(file.text);
    const store = useStore.getState();
    store.setProject(settings, shapes);
    store.setFileMeta(file.name, file.handle);
  } catch (e) {
    alert(`Open failed: ${(e as Error).message}`);
  }
}

export async function saveFile(): Promise<void> {
  const store = useStore.getState();
  const handle = store.fileHandle as FileHandle | null;
  const text = serializeProject(store.settings, store.shapes);
  if (handle) {
    try {
      await writeToHandle(handle, text);
      store.clearDirty();
      return;
    } catch (e) {
      alert(`Save failed: ${(e as Error).message}`);
      return;
    }
  }
  await saveFileAs();
}

export async function saveFileAs(): Promise<void> {
  const store = useStore.getState();
  const text = serializeProject(store.settings, store.shapes);
  const suggested = store.fileName || 'vectorheart.svg';
  if (!supportsFsApi()) {
    downloadText(suggested, text);
    store.clearDirty();
    return;
  }
  const handle = await pickSaveHandle(suggested);
  if (!handle) return;
  try {
    await writeToHandle(handle, text);
    store.setFileMeta(handle.name, handle);
    store.clearDirty();
  } catch (e) {
    alert(`Save failed: ${(e as Error).message}`);
  }
}
