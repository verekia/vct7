import { create } from 'zustand';
import type { Drawing, Point, ProjectSettings, Shape, Tool, ViewState } from './types';
import { DEFAULT_SETTINGS, makeId } from './lib/svg-io';
import { blendColor, findColorBelow, mix, parseHex, toHex } from './lib/blend';

export interface SelectedVertex {
  shapeId: string;
  index: number;
}

export interface BoxSelect {
  start: Point;
  end: Point;
}

interface HistoryEntry {
  shapes: Shape[];
  settings: ProjectSettings;
  /** Identifies a logical edit so rapid repeats (slider drags) collapse. */
  coalesceKey?: string;
  pushedAt: number;
}

const MAX_HISTORY = 100;
/** Repeated pushes with the same coalesceKey within this window replace the top entry. */
const COALESCE_WINDOW_MS = 800;
const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

const pushSnapshot = (
  s: { past: HistoryEntry[]; shapes: Shape[]; settings: ProjectSettings },
  coalesceKey?: string,
): { past: HistoryEntry[]; future: HistoryEntry[] } => {
  const t = now();
  const top = s.past[s.past.length - 1];
  if (
    coalesceKey &&
    top &&
    top.coalesceKey === coalesceKey &&
    t - top.pushedAt < COALESCE_WINDOW_MS
  ) {
    // The existing top already captured the pre-edit state; just slide the
    // window forward so a continuous drag keeps coalescing.
    const past = s.past.slice();
    past[past.length - 1] = { ...top, pushedAt: t };
    return { past, future: [] };
  }
  const entry: HistoryEntry = {
    shapes: s.shapes,
    settings: s.settings,
    coalesceKey,
    pushedAt: t,
  };
  const past = s.past.length >= MAX_HISTORY ? s.past.slice(-(MAX_HISTORY - 1)) : s.past.slice();
  past.push(entry);
  return { past, future: [] };
};

export interface AppState {
  shapes: Shape[];
  selectedShapeIds: string[];
  /** Last shape id that anchored the selection (plain or cmd click). Drives shift+click range. */
  selectionAnchorId: string | null;
  selectedVertex: SelectedVertex | null;
  tool: Tool;
  drawing: Drawing | null;
  view: ViewState;
  settings: ProjectSettings;
  cursor: Point;
  rawCursor: Point;
  snapDisabled: boolean;
  spaceHeld: boolean;
  panning: boolean;
  /** True while the user is actively dragging a vertex; drives snap-ray rendering. */
  vertexDragging: boolean;
  /** Canvas-space point the cursor is currently magnetically locked to, or null. */
  snapTarget: Point | null;
  /** Active marquee in canvas coordinates, or null when not box-selecting. */
  boxSelect: BoxSelect | null;
  fileName: string;
  fileHandle: unknown;
  dirty: boolean;
  /** Bumped when the canvas should re-fit the artboard to the viewport. */
  fitNonce: number;
  /** History stacks for undo/redo. Entries snapshot `{shapes, settings}` only. */
  past: HistoryEntry[];
  future: HistoryEntry[];
  // Imperative helpers
  setTool: (t: Tool) => void;
  setSettings: (patch: Partial<ProjectSettings>) => void;
  setView: (patch: Partial<ViewState>) => void;
  setCursor: (cursor: Point, raw: Point) => void;
  setSnapDisabled: (v: boolean) => void;
  setSpaceHeld: (v: boolean) => void;
  setPanning: (v: boolean) => void;
  setVertexDragging: (v: boolean) => void;
  setSnapTarget: (p: Point | null) => void;
  setBoxSelect: (b: BoxSelect | null) => void;
  startDrawing: (type: 'line' | 'polygon' | 'circle', at: Point) => void;
  appendDrawingPoint: (p: Point) => void;
  cancelDrawing: () => void;
  commitDrawing: (closed: boolean) => void;
  /** Replace selection with [id] (or clear if null). Updates the range anchor. */
  selectShape: (id: string | null) => void;
  /** Replace selection with the given ids. Anchor becomes the last id, or null. */
  selectShapes: (ids: string[]) => void;
  /** Add or remove a single id from the selection. Anchor becomes id. */
  toggleShapeSelection: (id: string) => void;
  /** Select every shape between the anchor and toId (inclusive) by array index. */
  selectShapeRange: (toId: string) => void;
  selectVertex: (v: SelectedVertex | null) => void;
  updateShape: (id: string, patch: Partial<Shape>) => void;
  moveShape: (id: string, points: Point[]) => void;
  moveShapes: (deltas: { id: string; points: Point[] }[]) => void;
  moveVertex: (id: string, index: number, p: Point) => void;
  deleteShape: (id: string) => void;
  deleteShapes: (ids: string[]) => void;
  deleteVertex: (shapeId: string, index: number) => void;
  toggleShapeVisibility: (id: string) => void;
  toggleShapeLock: (id: string) => void;
  renameShape: (id: string, name: string) => void;
  /** Move the shape at `from` to position `to` in the shape array (z-order). */
  reorderShape: (from: number, to: number) => void;
  /**
   * Bake the shape's blend mode into its fill / stroke by pre-computing the
   * blended color against whatever opaque layer sits underneath, then clear the
   * blend mode. Lets the SVG render correctly in viewers that don't support
   * `mix-blend-mode`. Multi-shape calls apply bottom-to-top so each shape sees
   * the already-baked layers below it (matching what was on screen).
   */
  applyBlending: (ids: string[]) => void;
  /**
   * Bake the shape's opacity into its fill / stroke via source-over alpha
   * compositing against the layer beneath, then clear opacity to 1. Same
   * "single opaque backdrop" assumption as applyBlending. For visual fidelity
   * when both opacity and a non-normal blend mode are set, run applyBlending
   * first — applyOpacity always uses straight α-over.
   */
  applyOpacity: (ids: string[]) => void;
  setProject: (settings: ProjectSettings, shapes: Shape[]) => void;
  newProject: () => void;
  setFileMeta: (name: string, handle: unknown) => void;
  markDirty: () => void;
  clearDirty: () => void;
  requestFit: () => void;
  /**
   * Snapshot the current document state into the undo stack. Atomic mutators
   * call this themselves; continuous mutators (move shapes/vertices) do not, so
   * callers (canvas hooks) must invoke this once at drag start. A repeat call
   * with the same `coalesceKey` within the coalesce window replaces the top
   * entry instead of pushing — this is what makes a slider drag a single undo.
   */
  pushHistory: (coalesceKey?: string) => void;
  undo: () => void;
  redo: () => void;
}

const DEFAULT_VIEW: ViewState = { x: 0, y: 0, scale: 1 };

export const useStore = create<AppState>((set) => ({
  shapes: [],
  selectedShapeIds: [],
  selectionAnchorId: null,
  selectedVertex: null,
  tool: 'line',
  drawing: null,
  view: { ...DEFAULT_VIEW },
  settings: { ...DEFAULT_SETTINGS },
  cursor: [0, 0],
  rawCursor: [0, 0],
  snapDisabled: false,
  spaceHeld: false,
  panning: false,
  vertexDragging: false,
  snapTarget: null,
  boxSelect: null,
  fileName: 'untitled.svg',
  fileHandle: null,
  dirty: false,
  fitNonce: 0,
  past: [],
  future: [],

  setTool: (t) => set({ tool: t, drawing: null, selectedVertex: null }),
  setSettings: (patch) =>
    set((s) => ({
      ...pushSnapshot(s, `settings:${Object.keys(patch).toSorted().join(',')}`),
      settings: { ...s.settings, ...patch },
      dirty: true,
    })),
  setView: (patch) => set((s) => ({ view: { ...s.view, ...patch } })),
  setCursor: (cursor, raw) => set({ cursor, rawCursor: raw }),
  setSnapDisabled: (v) => set({ snapDisabled: v }),
  setSpaceHeld: (v) => set({ spaceHeld: v }),
  setPanning: (v) => set({ panning: v }),
  setVertexDragging: (v) => set({ vertexDragging: v }),
  setSnapTarget: (p) => set({ snapTarget: p }),
  setBoxSelect: (b) => set({ boxSelect: b }),

  startDrawing: (type, at) => set({ drawing: { type, points: [at] } }),
  appendDrawingPoint: (p) =>
    set((s) => (s.drawing ? { drawing: { ...s.drawing, points: [...s.drawing.points, p] } } : s)),
  cancelDrawing: () => set({ drawing: null }),
  commitDrawing: (closed) =>
    set((s) => {
      if (!s.drawing || s.drawing.points.length < 2) return { drawing: null };
      const isPolygon = s.drawing.type === 'polygon';
      const isCircle = s.drawing.type === 'circle';
      // A polygon needs ≥ 3 vertices to be a real fill region; below that, fall
      // back to an open polyline so we never emit a degenerate Z over a chord.
      // A circle is always closed (center + perimeter point describe a region).
      const willClose = isCircle || (closed && isPolygon && s.drawing.points.length >= 3);
      const newShape: Shape = {
        id: makeId(),
        kind: isCircle ? 'circle' : 'path',
        points: s.drawing.points.map((p) => [p[0], p[1]] as Point),
        closed: willClose,
        fill: willClose ? '#000000' : 'none',
        stroke: willClose ? 'none' : '#000000',
        strokeWidth: 2,
        bezierOverride: null,
        hidden: false,
        locked: false,
      };
      return {
        ...pushSnapshot(s),
        drawing: null,
        shapes: [...s.shapes, newShape],
        selectedShapeIds: [newShape.id],
        selectionAnchorId: newShape.id,
        dirty: true,
      };
    }),

  selectShape: (id) =>
    set({
      selectedShapeIds: id ? [id] : [],
      selectionAnchorId: id,
      selectedVertex: null,
    }),
  selectShapes: (ids) =>
    set({
      selectedShapeIds: ids.slice(),
      selectionAnchorId: ids.length ? ids[ids.length - 1] : null,
      selectedVertex: null,
    }),
  toggleShapeSelection: (id) =>
    set((s) => {
      const has = s.selectedShapeIds.includes(id);
      const next = has ? s.selectedShapeIds.filter((x) => x !== id) : [...s.selectedShapeIds, id];
      return {
        selectedShapeIds: next,
        // Anchor on the most recent click — even when removing — so the next
        // shift+click extends from where the user just clicked.
        selectionAnchorId: id,
        selectedVertex: null,
      };
    }),
  selectShapeRange: (toId) =>
    set((s) => {
      const toIdx = s.shapes.findIndex((sh) => sh.id === toId);
      if (toIdx === -1) return s;
      const anchorIdx = s.selectionAnchorId
        ? s.shapes.findIndex((sh) => sh.id === s.selectionAnchorId)
        : -1;
      // No anchor → degrade to a single-shape select. This matches Finder /
      // most file managers when shift-click happens with nothing selected.
      if (anchorIdx === -1) {
        return {
          selectedShapeIds: [toId],
          selectionAnchorId: toId,
          selectedVertex: null,
        };
      }
      const lo = Math.min(anchorIdx, toIdx);
      const hi = Math.max(anchorIdx, toIdx);
      const range = s.shapes.slice(lo, hi + 1).map((sh) => sh.id);
      return {
        selectedShapeIds: range,
        // Anchor stays put on shift+click — successive shift+clicks all
        // extend from the same origin, the standard range-select behavior.
        selectedVertex: null,
      };
    }),
  selectVertex: (v) =>
    set((s) => {
      if (!v) return { selectedVertex: null };
      // Selecting a vertex implies single-shape selection; collapse multi-select.
      if (s.selectedShapeIds.length === 1 && s.selectedShapeIds[0] === v.shapeId) {
        return { selectedVertex: v };
      }
      return {
        selectedVertex: v,
        selectedShapeIds: [v.shapeId],
        selectionAnchorId: v.shapeId,
      };
    }),
  updateShape: (id, patch) =>
    set((s) => ({
      ...pushSnapshot(s, `updateShape:${id}:${Object.keys(patch).toSorted().join(',')}`),
      shapes: s.shapes.map((sh) => (sh.id === id ? { ...sh, ...patch } : sh)),
      dirty: true,
    })),
  moveShape: (id, points) =>
    set((s) => ({
      shapes: s.shapes.map((sh) => (sh.id === id ? { ...sh, points } : sh)),
      dirty: true,
    })),
  moveShapes: (deltas) =>
    set((s) => {
      if (deltas.length === 0) return s;
      const map = new Map(deltas.map((d) => [d.id, d.points]));
      return {
        shapes: s.shapes.map((sh) => {
          const next = map.get(sh.id);
          return next ? { ...sh, points: next } : sh;
        }),
        dirty: true,
      };
    }),
  moveVertex: (id, index, p) =>
    set((s) => ({
      shapes: s.shapes.map((sh) => {
        if (sh.id !== id) return sh;
        // Circle center (index 0) is a translation handle: dragging it must
        // carry the perimeter anchor along so the radius is preserved. The
        // perimeter anchor (index 1) is the resize handle and just moves on
        // its own — `dist(center, perimeter)` becomes the new radius.
        if (sh.kind === 'circle' && index === 0 && sh.points.length >= 2) {
          const [cx, cy] = sh.points[0];
          const dx = p[0] - cx;
          const dy = p[1] - cy;
          return {
            ...sh,
            points: sh.points.map(([x, y]) => [x + dx, y + dy] as Point),
          };
        }
        const next = sh.points.slice();
        next[index] = p;
        return { ...sh, points: next };
      }),
      dirty: true,
    })),
  deleteShape: (id) =>
    set((s) => {
      const remaining = s.selectedShapeIds.filter((x) => x !== id);
      return {
        ...pushSnapshot(s),
        shapes: s.shapes.filter((sh) => sh.id !== id),
        selectedShapeIds: remaining,
        selectionAnchorId: s.selectionAnchorId === id ? null : s.selectionAnchorId,
        selectedVertex: s.selectedVertex?.shapeId === id ? null : s.selectedVertex,
        dirty: true,
      };
    }),
  deleteShapes: (ids) =>
    set((s) => {
      if (ids.length === 0) return s;
      const idSet = new Set(ids);
      return {
        ...pushSnapshot(s),
        shapes: s.shapes.filter((sh) => !idSet.has(sh.id)),
        selectedShapeIds: s.selectedShapeIds.filter((x) => !idSet.has(x)),
        selectionAnchorId:
          s.selectionAnchorId && idSet.has(s.selectionAnchorId) ? null : s.selectionAnchorId,
        selectedVertex:
          s.selectedVertex && idSet.has(s.selectedVertex.shapeId) ? null : s.selectedVertex,
        dirty: true,
      };
    }),
  deleteVertex: (shapeId, index) =>
    set((s) => {
      const shape = s.shapes.find((sh) => sh.id === shapeId);
      if (!shape) return s;
      if (shape.points.length <= 2) {
        return {
          ...pushSnapshot(s),
          shapes: s.shapes.filter((sh) => sh.id !== shapeId),
          selectedShapeIds: s.selectedShapeIds.filter((x) => x !== shapeId),
          selectionAnchorId: s.selectionAnchorId === shapeId ? null : s.selectionAnchorId,
          selectedVertex: null,
          dirty: true,
        };
      }
      return {
        ...pushSnapshot(s),
        shapes: s.shapes.map((sh) =>
          sh.id !== shapeId ? sh : { ...sh, points: sh.points.filter((_, i) => i !== index) },
        ),
        selectedVertex: null,
        dirty: true,
      };
    }),
  toggleShapeVisibility: (id) =>
    set((s) => ({
      ...pushSnapshot(s),
      shapes: s.shapes.map((sh) => (sh.id === id ? { ...sh, hidden: !sh.hidden } : sh)),
      dirty: true,
    })),
  renameShape: (id, name) =>
    set((s) => {
      const trimmed = name.trim();
      return {
        ...pushSnapshot(s, `renameShape:${id}`),
        shapes: s.shapes.map((sh) => (sh.id !== id ? sh : { ...sh, name: trimmed || undefined })),
        dirty: true,
      };
    }),
  toggleShapeLock: (id) =>
    set((s) => {
      const target = s.shapes.find((sh) => sh.id === id);
      if (!target) return s;
      const nextLocked = !target.locked;
      // Locking a shape removes it from the selection so canvas interactions
      // don't keep operating on a now-uneditable target.
      const stripSel = nextLocked && s.selectedShapeIds.includes(id);
      const nextSel = stripSel ? s.selectedShapeIds.filter((x) => x !== id) : s.selectedShapeIds;
      return {
        ...pushSnapshot(s),
        shapes: s.shapes.map((sh) => (sh.id === id ? { ...sh, locked: nextLocked } : sh)),
        selectedShapeIds: nextSel,
        selectionAnchorId: stripSel && s.selectionAnchorId === id ? null : s.selectionAnchorId,
        selectedVertex: stripSel && s.selectedVertex?.shapeId === id ? null : s.selectedVertex,
        dirty: true,
      };
    }),
  reorderShape: (from, to) =>
    set((s) => {
      if (from === to) return s;
      if (from < 0 || from >= s.shapes.length) return s;
      const clamped = Math.max(0, Math.min(s.shapes.length - 1, to));
      const next = s.shapes.slice();
      const [moved] = next.splice(from, 1);
      next.splice(clamped, 0, moved);
      return { ...pushSnapshot(s), shapes: next, dirty: true };
    }),
  applyBlending: (ids) =>
    set((s) => {
      if (ids.length === 0) return s;
      const idSet = new Set(ids);
      // Process in array order (bottom-to-top z): each baked shape becomes the
      // backdrop for shapes above it, matching what was visually rendered.
      let next = s.shapes;
      let changed = false;
      for (let i = 0; i < next.length; i++) {
        const sh = next[i];
        if (!idSet.has(sh.id)) continue;
        const mode = sh.blendMode;
        if (!mode || mode === 'normal') continue;
        const bottom = findColorBelow(next, s.settings, sh.id);
        const fillRgb = parseHex(sh.fill);
        const strokeRgb = parseHex(sh.stroke);
        const patch: Partial<Shape> = { blendMode: undefined };
        if (fillRgb) patch.fill = toHex(blendColor(bottom, fillRgb, mode));
        if (strokeRgb) patch.stroke = toHex(blendColor(bottom, strokeRgb, mode));
        if (next === s.shapes) next = s.shapes.slice();
        next[i] = { ...sh, ...patch };
        changed = true;
      }
      if (!changed) return s;
      return { ...pushSnapshot(s), shapes: next, dirty: true };
    }),
  applyOpacity: (ids) =>
    set((s) => {
      if (ids.length === 0) return s;
      const idSet = new Set(ids);
      let next = s.shapes;
      let changed = false;
      for (let i = 0; i < next.length; i++) {
        const sh = next[i];
        if (!idSet.has(sh.id)) continue;
        const op = sh.opacity;
        if (op === undefined || op >= 1) continue;
        const bottom = findColorBelow(next, s.settings, sh.id);
        const fillRgb = parseHex(sh.fill);
        const strokeRgb = parseHex(sh.stroke);
        const patch: Partial<Shape> = { opacity: undefined };
        if (fillRgb) patch.fill = toHex(mix(bottom, fillRgb, op));
        if (strokeRgb) patch.stroke = toHex(mix(bottom, strokeRgb, op));
        if (next === s.shapes) next = s.shapes.slice();
        next[i] = { ...sh, ...patch };
        changed = true;
      }
      if (!changed) return s;
      return { ...pushSnapshot(s), shapes: next, dirty: true };
    }),
  setProject: (settings, shapes) =>
    set((s) => ({
      settings,
      shapes,
      selectedShapeIds: [],
      selectionAnchorId: null,
      selectedVertex: null,
      drawing: null,
      dirty: false,
      fitNonce: s.fitNonce + 1,
      // Loading a fresh document discards any existing undo trail — undoing
      // back into the previous file's state would surprise the user.
      past: [],
      future: [],
    })),
  newProject: () =>
    set((s) => ({
      settings: { ...DEFAULT_SETTINGS },
      shapes: [],
      selectedShapeIds: [],
      selectionAnchorId: null,
      selectedVertex: null,
      drawing: null,
      fileName: 'untitled.svg',
      fileHandle: null,
      dirty: false,
      fitNonce: s.fitNonce + 1,
      past: [],
      future: [],
    })),
  setFileMeta: (name, handle) => set({ fileName: name, fileHandle: handle }),
  markDirty: () => set({ dirty: true }),
  clearDirty: () => set({ dirty: false }),
  requestFit: () => set((s) => ({ fitNonce: s.fitNonce + 1 })),
  pushHistory: (coalesceKey) => set((s) => pushSnapshot(s, coalesceKey)),
  undo: () =>
    set((s) => {
      const top = s.past[s.past.length - 1];
      if (!top) return s;
      const past = s.past.slice(0, -1);
      const redoEntry: HistoryEntry = {
        shapes: s.shapes,
        settings: s.settings,
        pushedAt: now(),
      };
      const future = [...s.future, redoEntry];
      // Selection prune: keep only ids that still exist in the restored shapes.
      const restoredIds = new Set(top.shapes.map((sh) => sh.id));
      const selectedShapeIds = s.selectedShapeIds.filter((id) => restoredIds.has(id));
      return {
        past,
        future,
        shapes: top.shapes,
        settings: top.settings,
        selectedShapeIds,
        selectionAnchorId:
          s.selectionAnchorId && restoredIds.has(s.selectionAnchorId) ? s.selectionAnchorId : null,
        selectedVertex: null,
        drawing: null,
        dirty: true,
      };
    }),
  redo: () =>
    set((s) => {
      const top = s.future[s.future.length - 1];
      if (!top) return s;
      const future = s.future.slice(0, -1);
      const undoEntry: HistoryEntry = {
        shapes: s.shapes,
        settings: s.settings,
        pushedAt: now(),
      };
      const past = [...s.past, undoEntry];
      const restoredIds = new Set(top.shapes.map((sh) => sh.id));
      const selectedShapeIds = s.selectedShapeIds.filter((id) => restoredIds.has(id));
      return {
        past,
        future,
        shapes: top.shapes,
        settings: top.settings,
        selectedShapeIds,
        selectionAnchorId:
          s.selectionAnchorId && restoredIds.has(s.selectionAnchorId) ? s.selectionAnchorId : null,
        selectedVertex: null,
        drawing: null,
        dirty: true,
      };
    }),
}));

export const effectiveBezier = (shape: Shape, settings: ProjectSettings): number =>
  shape.bezierOverride ?? settings.bezier;
