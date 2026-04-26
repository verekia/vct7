import { create } from 'zustand';
import type { Drawing, Point, ProjectSettings, Shape, Tool, ViewState } from './types';
import { DEFAULT_SETTINGS, makeId } from './lib/svg-io';

export interface SelectedVertex {
  shapeId: string;
  index: number;
}

export interface AppState {
  shapes: Shape[];
  selectedShapeId: string | null;
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
  fileName: string;
  fileHandle: unknown;
  dirty: boolean;
  /** Bumped when the canvas should re-fit the artboard to the viewport. */
  fitNonce: number;
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
  startDrawing: (type: 'line' | 'polygon', at: Point) => void;
  appendDrawingPoint: (p: Point) => void;
  cancelDrawing: () => void;
  commitDrawing: (closed: boolean) => void;
  selectShape: (id: string | null) => void;
  selectVertex: (v: SelectedVertex | null) => void;
  updateShape: (id: string, patch: Partial<Shape>) => void;
  moveShape: (id: string, points: Point[]) => void;
  moveVertex: (id: string, index: number, p: Point) => void;
  deleteShape: (id: string) => void;
  deleteVertex: (shapeId: string, index: number) => void;
  toggleShapeVisibility: (id: string) => void;
  toggleShapeLock: (id: string) => void;
  renameShape: (id: string, name: string) => void;
  /** Move the shape at `from` to position `to` in the shape array (z-order). */
  reorderShape: (from: number, to: number) => void;
  setProject: (settings: ProjectSettings, shapes: Shape[]) => void;
  newProject: () => void;
  setFileMeta: (name: string, handle: unknown) => void;
  markDirty: () => void;
  clearDirty: () => void;
  requestFit: () => void;
}

const DEFAULT_VIEW: ViewState = { x: 0, y: 0, scale: 1 };

export const useStore = create<AppState>((set) => ({
  shapes: [],
  selectedShapeId: null,
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
  fileName: 'untitled.svg',
  fileHandle: null,
  dirty: false,
  fitNonce: 0,

  setTool: (t) => set({ tool: t, drawing: null, selectedVertex: null }),
  setSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch }, dirty: true })),
  setView: (patch) => set((s) => ({ view: { ...s.view, ...patch } })),
  setCursor: (cursor, raw) => set({ cursor, rawCursor: raw }),
  setSnapDisabled: (v) => set({ snapDisabled: v }),
  setSpaceHeld: (v) => set({ spaceHeld: v }),
  setPanning: (v) => set({ panning: v }),
  setVertexDragging: (v) => set({ vertexDragging: v }),
  setSnapTarget: (p) => set({ snapTarget: p }),

  startDrawing: (type, at) => set({ drawing: { type, points: [at] } }),
  appendDrawingPoint: (p) =>
    set((s) => (s.drawing ? { drawing: { ...s.drawing, points: [...s.drawing.points, p] } } : s)),
  cancelDrawing: () => set({ drawing: null }),
  commitDrawing: (closed) =>
    set((s) => {
      if (!s.drawing || s.drawing.points.length < 2) return { drawing: null };
      const isPolygon = s.drawing.type === 'polygon';
      // A polygon needs ≥ 3 vertices to be a real fill region; below that, fall
      // back to an open polyline so we never emit a degenerate Z over a chord.
      const willClose = closed && isPolygon && s.drawing.points.length >= 3;
      const newShape: Shape = {
        id: makeId(),
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
        drawing: null,
        shapes: [...s.shapes, newShape],
        selectedShapeId: newShape.id,
        dirty: true,
      };
    }),

  selectShape: (id) => set({ selectedShapeId: id, selectedVertex: null }),
  selectVertex: (v) => set({ selectedVertex: v }),
  updateShape: (id, patch) =>
    set((s) => ({
      shapes: s.shapes.map((sh) => (sh.id === id ? { ...sh, ...patch } : sh)),
      dirty: true,
    })),
  moveShape: (id, points) =>
    set((s) => ({
      shapes: s.shapes.map((sh) => (sh.id === id ? { ...sh, points } : sh)),
      dirty: true,
    })),
  moveVertex: (id, index, p) =>
    set((s) => ({
      shapes: s.shapes.map((sh) => {
        if (sh.id !== id) return sh;
        const next = sh.points.slice();
        next[index] = p;
        return { ...sh, points: next };
      }),
      dirty: true,
    })),
  deleteShape: (id) =>
    set((s) => ({
      shapes: s.shapes.filter((sh) => sh.id !== id),
      selectedShapeId: null,
      selectedVertex: null,
      dirty: true,
    })),
  deleteVertex: (shapeId, index) =>
    set((s) => {
      const shape = s.shapes.find((sh) => sh.id === shapeId);
      if (!shape) return s;
      if (shape.points.length <= 2) {
        return {
          shapes: s.shapes.filter((sh) => sh.id !== shapeId),
          selectedShapeId: null,
          selectedVertex: null,
          dirty: true,
        };
      }
      return {
        shapes: s.shapes.map((sh) =>
          sh.id !== shapeId ? sh : { ...sh, points: sh.points.filter((_, i) => i !== index) },
        ),
        selectedVertex: null,
        dirty: true,
      };
    }),
  toggleShapeVisibility: (id) =>
    set((s) => ({
      shapes: s.shapes.map((sh) => (sh.id === id ? { ...sh, hidden: !sh.hidden } : sh)),
      dirty: true,
    })),
  renameShape: (id, name) =>
    set((s) => {
      const trimmed = name.trim();
      return {
        shapes: s.shapes.map((sh) =>
          sh.id !== id ? sh : { ...sh, name: trimmed || undefined },
        ),
        dirty: true,
      };
    }),
  toggleShapeLock: (id) =>
    set((s) => {
      const target = s.shapes.find((sh) => sh.id === id);
      if (!target) return s;
      const nextLocked = !target.locked;
      // Locking the currently-selected shape clears the selection so canvas
      // interactions don't keep operating on a now-uneditable target.
      const clearSel = nextLocked && s.selectedShapeId === id;
      return {
        shapes: s.shapes.map((sh) => (sh.id === id ? { ...sh, locked: nextLocked } : sh)),
        selectedShapeId: clearSel ? null : s.selectedShapeId,
        selectedVertex: clearSel ? null : s.selectedVertex,
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
      return { shapes: next, dirty: true };
    }),
  setProject: (settings, shapes) =>
    set((s) => ({
      settings,
      shapes,
      selectedShapeId: null,
      selectedVertex: null,
      drawing: null,
      dirty: false,
      fitNonce: s.fitNonce + 1,
    })),
  newProject: () =>
    set((s) => ({
      settings: { ...DEFAULT_SETTINGS },
      shapes: [],
      selectedShapeId: null,
      selectedVertex: null,
      drawing: null,
      fileName: 'untitled.svg',
      fileHandle: null,
      dirty: false,
      fitNonce: s.fitNonce + 1,
    })),
  setFileMeta: (name, handle) => set({ fileName: name, fileHandle: handle }),
  markDirty: () => set({ dirty: true }),
  clearDirty: () => set({ dirty: false }),
  requestFit: () => set((s) => ({ fitNonce: s.fitNonce + 1 })),
}));

export const effectiveBezier = (shape: Shape, settings: ProjectSettings): number =>
  shape.bezierOverride ?? settings.bezier;
