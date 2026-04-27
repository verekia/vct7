import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store';
import { isLocalFontsSupported, loadLocalFonts, vectorizeText, type FontEntry } from '../lib/fonts';
import type { GlyphData } from '../types';

const PREVIEW_BG = '#0a0b0f';
const PREVIEW_FG = '#e3e6ec';
const PREVIEW_VB_PAD = 12;

export function FontDialog() {
  const open = useStore((s) => s.fontDialogOpen);
  if (!open) return null;
  return <FontDialogInner />;
}

function FontDialogInner() {
  const setFontDialogOpen = useStore((s) => s.setFontDialogOpen);
  const addGlyphs = useStore((s) => s.addGlyphs);

  const supported = isLocalFontsSupported();
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const [fonts, setFonts] = useState<FontEntry[] | null>(null);
  const [loadingFonts, setLoadingFonts] = useState(false);
  const [filter, setFilter] = useState('');
  const [selectedPs, setSelectedPs] = useState<string | null>(null);
  const [text, setText] = useState('vectorheart');
  const [fontSize, setFontSize] = useState(72);

  const [preview, setPreview] = useState<GlyphData | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [vectorizing, setVectorizing] = useState(false);

  const filterInputRef = useRef<HTMLInputElement>(null);

  // Esc closes the dialog. Set up once the modal mounts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setFontDialogOpen(false);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [setFontDialogOpen]);

  const grant = async () => {
    setPermissionError(null);
    setLoadingFonts(true);
    try {
      const list = await loadLocalFonts();
      setFonts(list);
      if (list.length > 0) setSelectedPs(list[0].postscriptName);
      setTimeout(() => filterInputRef.current?.focus(), 0);
    } catch (e) {
      setPermissionError((e as Error).message);
    } finally {
      setLoadingFonts(false);
    }
  };

  // Recompute the preview whenever the inputs settle. Cheap enough that we
  // run it inline; opentype parses the font once per session and caches it.
  useEffect(() => {
    if (!selectedPs) {
      setPreview(null);
      setPreviewError(null);
      return;
    }
    const trimmed = text;
    if (trimmed.length === 0) {
      setPreview(null);
      setPreviewError('Type something to preview.');
      return;
    }
    let cancelled = false;
    setPreviewError(null);
    void vectorizeText(selectedPs, trimmed, fontSize).then(
      (data) => {
        if (!cancelled) setPreview(data);
      },
      (e: Error) => {
        if (!cancelled) {
          setPreview(null);
          setPreviewError(e.message);
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [selectedPs, text, fontSize]);

  const filtered = useMemo(() => {
    if (!fonts) return [];
    const q = filter.trim().toLowerCase();
    if (!q) return fonts;
    return fonts.filter(
      (f) =>
        f.family.toLowerCase().includes(q) ||
        f.fullName.toLowerCase().includes(q) ||
        f.style.toLowerCase().includes(q),
    );
  }, [fonts, filter]);

  const onAdd = () => {
    if (!preview || vectorizing) return;
    setVectorizing(true);
    // We already have the vectorized data from the live preview — reuse it
    // verbatim so what the user sees is exactly what gets placed.
    addGlyphs(preview);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-[2px]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setFontDialogOpen(false);
      }}
    >
      <div className="panel-surface border border-line w-[760px] max-w-[92vw] max-h-[88vh] flex flex-col shadow-2xl">
        <header className="flex items-center justify-between px-4 py-2.5 border-b border-line">
          <h2 className="tracking-[2px] uppercase text-xs font-semibold text-text">Add text</h2>
          <button
            type="button"
            className="text-[11px] px-2 py-[2px]"
            onClick={() => setFontDialogOpen(false)}
          >
            Close
          </button>
        </header>

        {!supported ? (
          <div className="p-4">
            <p className="text-[12px] text-muted leading-[1.55]">
              This browser doesn&apos;t expose the Local Font Access API. Try Chrome, Edge or
              another Chromium-based browser to use installed fonts.
            </p>
          </div>
        ) : !fonts ? (
          <div className="p-4 flex flex-col gap-3">
            <p className="text-[12px] text-muted leading-[1.55]">
              vectorheart needs your permission to read the list of fonts installed on this
              computer. Nothing is uploaded — fonts are parsed locally and only their outlines are
              embedded in the canvas.
            </p>
            <div>
              <button type="button" onClick={grant} disabled={loadingFonts}>
                {loadingFonts ? 'Loading…' : 'Grant local-font access'}
              </button>
            </div>
            {permissionError && (
              <p className="text-[11px] text-accent leading-[1.5]">{permissionError}</p>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-[260px_1fr] flex-1 min-h-0">
            <aside className="border-r border-line flex flex-col min-h-0">
              <div className="p-2 border-b border-line">
                <input
                  ref={filterInputRef}
                  type="text"
                  placeholder={`Filter ${fonts.length} fonts…`}
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                />
              </div>
              <ul className="flex-1 overflow-y-auto text-[12px]">
                {filtered.map((f) => (
                  <li
                    key={f.postscriptName}
                    className={`px-3 py-1.5 cursor-pointer border-l-2 ${
                      selectedPs === f.postscriptName
                        ? 'bg-bg-3 border-accent text-text'
                        : 'border-transparent text-muted hover:text-text hover:bg-bg-2'
                    }`}
                    onClick={() => setSelectedPs(f.postscriptName)}
                  >
                    <div className="truncate">{f.fullName}</div>
                    <div className="truncate text-[10px] text-muted-2">{f.family}</div>
                  </li>
                ))}
                {filtered.length === 0 && (
                  <li className="px-3 py-2 text-muted text-[11px]">No matching fonts.</li>
                )}
              </ul>
            </aside>

            <section className="flex flex-col min-h-0">
              <div className="p-3 border-b border-line grid grid-cols-[1fr_auto] gap-2 items-end">
                <label>
                  <span>Text</span>
                  <input
                    type="text"
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    autoFocus
                  />
                </label>
                <label>
                  <span>Size</span>
                  <input
                    type="number"
                    min={1}
                    step={1}
                    value={fontSize}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value);
                      if (Number.isFinite(v) && v > 0) setFontSize(v);
                    }}
                  />
                </label>
              </div>

              <div className="flex-1 min-h-0 p-3 flex flex-col gap-2">
                <PreviewArea preview={preview} error={previewError} />
                {preview && (
                  <p className="text-[10px] text-muted-2 tabular-nums">
                    {preview.width.toFixed(1)} × {preview.height.toFixed(1)} u · path length{' '}
                    {preview.d.length} chars
                  </p>
                )}
              </div>

              <footer className="p-3 border-t border-line flex justify-end gap-2">
                <button type="button" onClick={() => setFontDialogOpen(false)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="bg-accent text-white border-accent hover:bg-[#e0322a] hover:border-[#e0322a]"
                  disabled={!preview || vectorizing}
                  onClick={onAdd}
                >
                  Vectorize and add
                </button>
              </footer>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}

function PreviewArea({ preview, error }: { preview: GlyphData | null; error: string | null }) {
  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center text-[11px] text-muted border border-dashed border-line">
        {error}
      </div>
    );
  }
  if (!preview) {
    return (
      <div className="flex-1 flex items-center justify-center text-[11px] text-muted border border-dashed border-line">
        Pick a font to preview.
      </div>
    );
  }
  const pad = PREVIEW_VB_PAD;
  const vbW = preview.width + pad * 2;
  const vbH = preview.height + pad * 2;
  return (
    <div
      className="flex-1 min-h-0 border border-line overflow-hidden"
      style={{ background: PREVIEW_BG }}
    >
      <svg
        viewBox={`${-pad} ${-pad} ${vbW} ${vbH}`}
        preserveAspectRatio="xMidYMid meet"
        width="100%"
        height="100%"
      >
        <path d={preview.d} fill={PREVIEW_FG} />
      </svg>
    </div>
  );
}
