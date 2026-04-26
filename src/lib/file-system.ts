interface SaveFilePickerOptions {
  suggestedName?: string;
  types?: { description: string; accept: Record<string, string[]> }[];
}

interface OpenFilePickerOptions {
  types?: { description: string; accept: Record<string, string[]> }[];
  multiple?: boolean;
}

interface FileSystemFileHandleLike {
  name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<FileSystemWritableLike>;
  // Present on handles obtained via drag-and-drop; absent on the picker's
  // handle (which is already granted readwrite by the user gesture).
  requestPermission?: (descriptor: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>;
}

interface FileSystemWritableLike {
  write(data: BufferSource | Blob | string): Promise<void>;
  close(): Promise<void>;
}

declare global {
  interface Window {
    showOpenFilePicker?: (opts?: OpenFilePickerOptions) => Promise<FileSystemFileHandleLike[]>;
    showSaveFilePicker?: (opts?: SaveFilePickerOptions) => Promise<FileSystemFileHandleLike>;
  }
}

const FILE_TYPES = [{ description: 'SVG', accept: { 'image/svg+xml': ['.svg'] } }];

export type FileHandle = FileSystemFileHandleLike;

export const supportsFsApi = (): boolean =>
  typeof window !== 'undefined' && typeof window.showSaveFilePicker === 'function';

export interface OpenedFile {
  name: string;
  text: string;
  handle: FileHandle | null;
}

export async function pickAndOpenFile(): Promise<OpenedFile | null> {
  if (window.showOpenFilePicker) {
    try {
      const [handle] = await window.showOpenFilePicker({ types: FILE_TYPES });
      const file = await handle.getFile();
      const text = await file.text();
      return { name: handle.name, text, handle };
    } catch (e) {
      if ((e as DOMException)?.name === 'AbortError') return null;
      throw e;
    }
  }
  return openFileFallback();
}

function openFileFallback(): Promise<OpenedFile | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.svg,image/svg+xml';
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      const text = await file.text();
      resolve({ name: file.name, text, handle: null });
    });
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}

export async function writeToHandle(handle: FileHandle, text: string): Promise<void> {
  if (handle.requestPermission) {
    const state = await handle.requestPermission({ mode: 'readwrite' });
    if (state !== 'granted') throw new Error('Write permission denied');
  }
  const writable = await handle.createWritable();
  await writable.write(text);
  await writable.close();
}

export async function pickSaveHandle(suggestedName: string): Promise<FileHandle | null> {
  if (!window.showSaveFilePicker) return null;
  try {
    return await window.showSaveFilePicker({ suggestedName, types: FILE_TYPES });
  } catch (e) {
    if ((e as DOMException)?.name === 'AbortError') return null;
    throw e;
  }
}

export function downloadText(name: string, text: string, mime = 'image/svg+xml'): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
