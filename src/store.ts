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
  fileName: string;
  fileHandle: unknown;
  dirty: boolean;
  // Imperative helpers
  setTool: (t: Tool) => void;
  setSettings: (patch: Partial<ProjectSettings>) => void;
  setView: (patch: Partial<ViewState>) => void;
  setCursor: (cursor: Point, raw: Point) => void;
  setSnapDisabled: (v: boolean) => void;
  setSpaceHeld: (v: boolean) => void;
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
  setProject: (settings: ProjectSettings, shapes: Shape[]) => void;
  newProject: () => void;
  setFileMeta: (name: string, handle: unknown) => void;
  markDirty: () => void;
  clearDirty: () => void;
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
  fileName: 'untitled.svg',
  fileHandle: null,
  dirty: false,

  setTool: (t) => set({ tool: t, drawing: null, selectedVertex: null }),
  setSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch }, dirty: true })),
  setView: (patch) => set((s) => ({ view: { ...s.view, ...patch } })),
  setCursor: (cursor, raw) => set({ cursor, rawCursor: raw }),
  setSnapDisabled: (v) => set({ snapDisabled: v }),
  setSpaceHeld: (v) => set({ spaceHeld: v }),

  startDrawing: (type, at) => set({ drawing: { type, points: [at] } }),
  appendDrawingPoint: (p) =>
    set((s) => (s.drawing ? { drawing: { ...s.drawing, points: [...s.drawing.points, p] } } : s)),
  cancelDrawing: () => set({ drawing: null }),
  commitDrawing: (closed) =>
    set((s) => {
      if (!s.drawing || s.drawing.points.length < 2) return { drawing: null };
      const isPolygon = s.drawing.type === 'polygon';
      const newShape: Shape = {
        id: makeId(),
        points: s.drawing.points.map((p) => [p[0], p[1]] as Point),
        closed: closed && isPolygon,
        fill: isPolygon ? '#000000' : 'none',
        stroke: isPolygon ? 'none' : '#000000',
        strokeWidth: 2,
        bezierOverride: null,
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
  setProject: (settings, shapes) =>
    set({
      settings,
      shapes,
      selectedShapeId: null,
      selectedVertex: null,
      drawing: null,
      dirty: false,
    }),
  newProject: () =>
    set({
      settings: { ...DEFAULT_SETTINGS },
      shapes: [],
      selectedShapeId: null,
      selectedVertex: null,
      drawing: null,
      fileName: 'untitled.svg',
      fileHandle: null,
      dirty: false,
    }),
  setFileMeta: (name, handle) => set({ fileName: name, fileHandle: handle }),
  markDirty: () => set({ dirty: true }),
  clearDirty: () => set({ dirty: false }),
}));

export const effectiveBezier = (shape: Shape, settings: ProjectSettings): number =>
  shape.bezierOverride ?? settings.bezier;
