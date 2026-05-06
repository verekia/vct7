import { create } from 'zustand'

import { blendColor, findColorBelow, mix, parseHex, toHex } from './lib/blend'
import { DEFAULT_SETTINGS, makeId } from './lib/svg-io'
import { applyTransformToPoint, hasTransform, shapeBBoxCenter, shapeRotation } from './lib/transform'

import type { Drawing, GlyphData, PaletteColor, Point, ProjectSettings, Shape, Tool, ViewState } from './types'

export interface SelectedVertex {
  shapeId: string
  index: number
}

export interface BoxSelect {
  start: Point
  end: Point
}

interface HistoryEntry {
  shapes: Shape[]
  settings: ProjectSettings
  /** Identifies a logical edit so rapid repeats (slider drags) collapse. */
  coalesceKey?: string
  pushedAt: number
}

/**
 * Drop overrides for indices in `dropped` and shift the rest down so the
 * map stays aligned with the new compacted points array. Returns undefined
 * when the result is empty so the shape stays tidy.
 */
const reindexPointBeziers = (
  overrides: Record<number, number> | undefined,
  dropped: ReadonlySet<number>,
): Record<number, number> | undefined => {
  if (!overrides) return undefined
  const sortedDrops = [...dropped].toSorted((a, b) => a - b)
  const next: Record<number, number> = {}
  for (const [k, v] of Object.entries(overrides)) {
    const i = Number(k)
    if (dropped.has(i)) continue
    let shift = 0
    for (const d of sortedDrops) {
      if (d < i) shift++
      else break
    }
    next[i - shift] = v
  }
  return Object.keys(next).length > 0 ? next : undefined
}

const MAX_HISTORY = 100
/** Repeated pushes with the same coalesceKey within this window replace the top entry. */
const COALESCE_WINDOW_MS = 800
const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now())

const pushSnapshot = (
  s: { past: HistoryEntry[]; shapes: Shape[]; settings: ProjectSettings },
  coalesceKey?: string,
): { past: HistoryEntry[]; future: HistoryEntry[] } => {
  const t = now()
  const top = s.past[s.past.length - 1]
  if (coalesceKey && top && top.coalesceKey === coalesceKey && t - top.pushedAt < COALESCE_WINDOW_MS) {
    // The existing top already captured the pre-edit state; just slide the
    // window forward so a continuous drag keeps coalescing.
    const past = s.past.slice()
    past[past.length - 1] = { ...top, pushedAt: t }
    return { past, future: [] }
  }
  const entry: HistoryEntry = {
    shapes: s.shapes,
    settings: s.settings,
    coalesceKey,
    pushedAt: t,
  }
  const past = s.past.length >= MAX_HISTORY ? s.past.slice(-(MAX_HISTORY - 1)) : s.past.slice()
  past.push(entry)
  return { past, future: [] }
}

export interface AppState {
  shapes: Shape[]
  selectedShapeIds: string[]
  /** Last shape id that anchored the selection (plain or cmd click). Drives shift+click range. */
  selectionAnchorId: string | null
  /**
   * Multi-vertex selection. Always belongs to a single shape — selecting a
   * vertex collapses any multi-shape selection to that vertex's owner. Empty
   * array means no vertex is selected.
   */
  selectedVertices: SelectedVertex[]
  tool: Tool
  drawing: Drawing | null
  view: ViewState
  settings: ProjectSettings
  cursor: Point
  rawCursor: Point
  snapDisabled: boolean
  spaceHeld: boolean
  panning: boolean
  /** True while the user is actively dragging a vertex; drives snap-ray rendering. */
  vertexDragging: boolean
  /** Canvas-space point the cursor is currently magnetically locked to, or null. */
  snapTarget: Point | null
  /** Active marquee in canvas coordinates, or null when not box-selecting. */
  boxSelect: BoxSelect | null
  fileName: string
  fileHandle: unknown
  dirty: boolean
  /** Bumped when the canvas should re-fit the artboard to the viewport. */
  fitNonce: number
  /** Modal "Add text" dialog visibility. The dialog itself owns its inputs. */
  fontDialogOpen: boolean
  /**
   * Animation timeline scrubber position in milliseconds. `null` means no
   * scrub is active and the canvas renders the rest state. When set, every
   * animated shape interpolates from its `animation.from` toward rest based on
   * its own delay+duration window. Transient view state — never persisted.
   */
  previewT: number | null
  /** True while the timeline is auto-advancing previewT via rAF. */
  previewPlaying: boolean
  /**
   * Bumped each time the user (re)triggers play. Canvas keys the animation
   * wrapper on this so React re-mounts and the animation restarts cleanly,
   * even when previewT happened to already be 0.
   */
  previewNonce: number
  /** Render an additional ghosted copy of every animated shape at its from-state. */
  onionSkin: boolean
  /** History stacks for undo/redo. Entries snapshot `{shapes, settings}` only. */
  past: HistoryEntry[]
  future: HistoryEntry[]
  // Imperative helpers
  setTool: (t: Tool) => void
  setSettings: (patch: Partial<ProjectSettings>) => void
  setView: (patch: Partial<ViewState>) => void
  setCursor: (cursor: Point, raw: Point) => void
  setSnapDisabled: (v: boolean) => void
  setSpaceHeld: (v: boolean) => void
  setPanning: (v: boolean) => void
  setVertexDragging: (v: boolean) => void
  setSnapTarget: (p: Point | null) => void
  setBoxSelect: (b: BoxSelect | null) => void
  startDrawing: (type: 'line' | 'polygon' | 'circle', at: Point) => void
  appendDrawingPoint: (p: Point) => void
  cancelDrawing: () => void
  commitDrawing: (closed: boolean) => void
  /** Open / close the "Add text" dialog. */
  setFontDialogOpen: (v: boolean) => void
  setPreviewT: (t: number | null) => void
  setPreviewPlaying: (v: boolean) => void
  /** Bump the play nonce so the canvas re-keys (and restarts) the animation. */
  triggerPlayNonce: () => void
  setOnionSkin: (v: boolean) => void
  /**
   * Insert a vectorized text shape, centered on the current artboard. Selects
   * it so the user can immediately tweak fill / position from the side panel.
   */
  addGlyphs: (data: GlyphData) => void
  /** Replace selection with [id] (or clear if null). Updates the range anchor. */
  selectShape: (id: string | null) => void
  /** Replace selection with the given ids. Anchor becomes the last id, or null. */
  selectShapes: (ids: string[]) => void
  /** Add or remove a single id from the selection. Anchor becomes id. */
  toggleShapeSelection: (id: string) => void
  /** Select every shape between the anchor and toId (inclusive) by array index. */
  selectShapeRange: (toId: string) => void
  /** Replace selection with [v] (or clear if null). Collapses shape selection to v's owner. */
  selectVertex: (v: SelectedVertex | null) => void
  /** Replace vertex selection with the given list. All entries must share a shape id. */
  selectVertices: (vs: SelectedVertex[]) => void
  /** Add or remove a single vertex from the selection (shift/meta-click). */
  toggleVertexSelection: (v: SelectedVertex) => void
  updateShape: (id: string, patch: Partial<Shape>) => void
  moveShape: (id: string, points: Point[]) => void
  moveShapes: (deltas: { id: string; points: Point[] }[]) => void
  moveVertex: (id: string, index: number, p: Point) => void
  /**
   * Move multiple vertices of a single shape to new positions in one update.
   * Used for multi-vertex drag — caller computes a translated `Point[]` and
   * passes the indices that changed.
   */
  moveVertices: (shapeId: string, items: { index: number; point: Point }[]) => void
  deleteShape: (id: string) => void
  deleteShapes: (ids: string[]) => void
  /**
   * Duplicate `ids` in place — each copy is inserted immediately after its
   * source so it sits one step above in z-order. Copies share every property
   * (geometry, fill, animation, …) but receive fresh ids. Selection moves to
   * the copies. Returns the new ids in the same order as `ids`, which lets
   * callers (alt-drag) immediately drive the duplicates without a re-read.
   */
  duplicateShapes: (ids: string[]) => string[]
  /**
   * Append `shapes` to the document with fresh ids — used by paste, where
   * the clipboard holds shape templates whose original ids may collide or
   * have been deleted. Selection moves to the appended shapes.
   */
  addShapes: (shapes: Shape[]) => void
  deleteVertex: (shapeId: string, index: number) => void
  /**
   * Delete every selected vertex from its owning shape. If a shape ends up
   * with fewer than 2 points, the shape itself is removed. Always pushes a
   * single history entry.
   */
  deleteVertices: (items: SelectedVertex[]) => void
  toggleShapeVisibility: (id: string) => void
  toggleShapeLock: (id: string) => void
  renameShape: (id: string, name: string) => void
  /** Move the shape at `from` to position `to` in the shape array (z-order). */
  reorderShape: (from: number, to: number) => void
  /**
   * Bake the shape's blend mode into its fill / stroke by pre-computing the
   * blended color against whatever opaque layer sits underneath, then clear the
   * blend mode. Lets the SVG render correctly in viewers that don't support
   * `mix-blend-mode`. Multi-shape calls apply bottom-to-top so each shape sees
   * the already-baked layers below it (matching what was on screen).
   */
  applyBlending: (ids: string[]) => void
  /**
   * Bake the shape's opacity into its fill / stroke via source-over alpha
   * compositing against the layer beneath, then clear opacity to 1. Same
   * "single opaque backdrop" assumption as applyBlending. For visual fidelity
   * when both opacity and a non-normal blend mode are set, run applyBlending
   * first — applyOpacity always uses straight α-over.
   */
  applyOpacity: (ids: string[]) => void
  /**
   * Bake `rotation` / `scale` into `points` (transformed around the shape's
   * bbox center) and reset both back to identity. Glyph shapes are skipped:
   * their geometry lives in `glyphs.d` which we'd need a path-string parser to
   * mutate; for now glyphs keep their transform live. Partial-arc circles also
   * shift `arc.start` / `arc.end` so the wedge keeps its visual orientation.
   */
  applyTransform: (ids: string[]) => void
  /**
   * Mirror shapes across their visual bbox center on the chosen axis. Each
   * shape's points are reflected and its rotation is negated so the on-screen
   * result matches a true mirror flip even for rotated shapes (R reflects to
   * −R; the matrix derivation is M·R·M = R⁻¹ for an axis-aligned reflection
   * M). Partial-circle arc angles are mirrored and start/end swap so the
   * arc keeps its clockwise-sweep convention. Glyph shapes are skipped — the
   * model has no separable scale-x/scale-y to encode a glyph mirror, same
   * caveat as `applyTransform`.
   */
  flipShapes: (ids: string[], axis: 'horizontal' | 'vertical') => void
  /**
   * Add a new palette entry. The name must be unique and non-empty; if either
   * condition fails the call is a no-op so callers don't have to guard.
   */
  addPaletteColor: (name: string, color: string) => void
  /**
   * Update a palette entry — rename and/or recolor. When the color changes,
   * every shape with `fillRef` / `strokeRef` matching this entry has its
   * resolved `fill` / `stroke` synced (and `bg` if `bgRef` matches), so the
   * SVG output keeps the palette and the rendered colors in sync. When the
   * name changes, all matching refs get rewritten too.
   */
  updatePaletteColor: (oldName: string, next: PaletteColor) => void
  /**
   * Drop a palette entry. Shapes referencing this name keep their resolved
   * color (so nothing visually changes) but lose the ref pointer.
   */
  removePaletteColor: (name: string) => void
  /**
   * Link a shape's fill or stroke to a palette entry. Sets the ref *and*
   * snaps the resolved color to the palette entry's value.
   */
  setShapePaletteRef: (id: string, channel: 'fill' | 'stroke', name: string | undefined) => void
  /** Same as above for the project background. */
  setBgPaletteRef: (name: string | undefined) => void
  setProject: (settings: ProjectSettings, shapes: Shape[]) => void
  newProject: () => void
  setFileMeta: (name: string, handle: unknown) => void
  markDirty: () => void
  clearDirty: () => void
  requestFit: () => void
  /**
   * Snapshot the current document state into the undo stack. Atomic mutators
   * call this themselves; continuous mutators (move shapes/vertices) do not, so
   * callers (canvas hooks) must invoke this once at drag start. A repeat call
   * with the same `coalesceKey` within the coalesce window replaces the top
   * entry instead of pushing — this is what makes a slider drag a single undo.
   */
  pushHistory: (coalesceKey?: string) => void
  undo: () => void
  redo: () => void
}

const DEFAULT_VIEW: ViewState = { x: 0, y: 0, scale: 1 }

export const useStore = create<AppState>(set => ({
  shapes: [],
  selectedShapeIds: [],
  selectionAnchorId: null,
  selectedVertices: [],
  tool: 'polygon',
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
  fontDialogOpen: false,
  previewT: null,
  previewPlaying: false,
  previewNonce: 0,
  onionSkin: false,
  past: [],
  future: [],

  setTool: t => set({ tool: t, drawing: null, selectedVertices: [] }),
  setSettings: patch =>
    set(s => {
      // Same off-palette guard as updateShape: a manual `bg` change drops the
      // bgRef so the saved SVG can't claim a palette link that doesn't match.
      const autoPatch: Partial<ProjectSettings> = {}
      if ('bg' in patch && !('bgRef' in patch)) autoPatch.bgRef = undefined
      const finalPatch = { ...patch, ...autoPatch }
      return {
        ...pushSnapshot(s, `settings:${Object.keys(finalPatch).toSorted().join(',')}`),
        settings: { ...s.settings, ...finalPatch },
        dirty: true,
      }
    }),
  setView: patch => set(s => ({ view: { ...s.view, ...patch } })),
  setCursor: (cursor, raw) => set({ cursor, rawCursor: raw }),
  setSnapDisabled: v => set({ snapDisabled: v }),
  setSpaceHeld: v => set({ spaceHeld: v }),
  setPanning: v => set({ panning: v }),
  setVertexDragging: v => set({ vertexDragging: v }),
  setSnapTarget: p => set({ snapTarget: p }),
  setBoxSelect: b => set({ boxSelect: b }),

  setFontDialogOpen: v => set({ fontDialogOpen: v }),
  setPreviewT: t => set({ previewT: t }),
  setPreviewPlaying: v => set({ previewPlaying: v }),
  triggerPlayNonce: () => set(s => ({ previewNonce: s.previewNonce + 1 })),
  setOnionSkin: v => set({ onionSkin: v }),
  addGlyphs: data =>
    set(s => {
      const cx = s.settings.viewBoxX + s.settings.viewBoxWidth / 2
      const cy = s.settings.viewBoxY + s.settings.viewBoxHeight / 2
      const tlx = cx - data.width / 2
      const tly = cy - data.height / 2
      const newShape: Shape = {
        id: makeId(),
        kind: 'glyphs',
        // points[0] = top-left in canvas coords; points[1] = bottom-right.
        // Both translate together when the shape is moved.
        points: [
          [tlx, tly],
          [tlx + data.width, tly + data.height],
        ],
        closed: true,
        fill: '#000000',
        stroke: 'none',
        strokeWidth: 0,
        bezierOverride: null,
        hidden: false,
        locked: false,
        glyphs: data,
      }
      return {
        ...pushSnapshot(s),
        shapes: [...s.shapes, newShape],
        selectedShapeIds: [newShape.id],
        selectionAnchorId: newShape.id,
        selectedVertices: [],
        fontDialogOpen: false,
        dirty: true,
      }
    }),

  startDrawing: (type, at) => set({ drawing: { type, points: [at] } }),
  appendDrawingPoint: p => set(s => (s.drawing ? { drawing: { ...s.drawing, points: [...s.drawing.points, p] } } : s)),
  cancelDrawing: () => set({ drawing: null }),
  commitDrawing: closed =>
    set(s => {
      if (!s.drawing || s.drawing.points.length < 2) return { drawing: null }
      const isPolygon = s.drawing.type === 'polygon'
      const isCircle = s.drawing.type === 'circle'
      // A polygon needs ≥ 3 vertices to be a real fill region; below that, fall
      // back to an open polyline so we never emit a degenerate Z over a chord.
      // A circle is always closed (center + perimeter point describe a region).
      const willClose = isCircle || (closed && isPolygon && s.drawing.points.length >= 3)
      const newShape: Shape = {
        id: makeId(),
        kind: isCircle ? 'circle' : 'path',
        points: s.drawing.points.map(p => [p[0], p[1]] as Point),
        closed: willClose,
        fill: willClose ? '#000000' : 'none',
        stroke: willClose ? 'none' : '#000000',
        strokeWidth: 2,
        bezierOverride: null,
        hidden: false,
        locked: false,
      }
      return {
        ...pushSnapshot(s),
        drawing: null,
        shapes: [...s.shapes, newShape],
        selectedShapeIds: [newShape.id],
        selectionAnchorId: newShape.id,
        dirty: true,
      }
    }),

  selectShape: id =>
    set({
      selectedShapeIds: id ? [id] : [],
      selectionAnchorId: id,
      selectedVertices: [],
    }),
  selectShapes: ids =>
    set({
      selectedShapeIds: ids.slice(),
      selectionAnchorId: ids.length ? ids[ids.length - 1] : null,
      selectedVertices: [],
    }),
  toggleShapeSelection: id =>
    set(s => {
      const has = s.selectedShapeIds.includes(id)
      const next = has ? s.selectedShapeIds.filter(x => x !== id) : [...s.selectedShapeIds, id]
      return {
        selectedShapeIds: next,
        // Anchor on the most recent click — even when removing — so the next
        // shift+click extends from where the user just clicked.
        selectionAnchorId: id,
        selectedVertices: [],
      }
    }),
  selectShapeRange: toId =>
    set(s => {
      const toIdx = s.shapes.findIndex(sh => sh.id === toId)
      if (toIdx === -1) return s
      const anchorIdx = s.selectionAnchorId ? s.shapes.findIndex(sh => sh.id === s.selectionAnchorId) : -1
      // No anchor → degrade to a single-shape select. This matches Finder /
      // most file managers when shift-click happens with nothing selected.
      if (anchorIdx === -1) {
        return {
          selectedShapeIds: [toId],
          selectionAnchorId: toId,
          selectedVertices: [],
        }
      }
      const lo = Math.min(anchorIdx, toIdx)
      const hi = Math.max(anchorIdx, toIdx)
      const range = s.shapes.slice(lo, hi + 1).map(sh => sh.id)
      return {
        selectedShapeIds: range,
        // Anchor stays put on shift+click — successive shift+clicks all
        // extend from the same origin, the standard range-select behavior.
        selectedVertices: [],
      }
    }),
  selectVertex: v =>
    set(s => {
      if (!v) return { selectedVertices: [] }
      // Selecting a vertex implies single-shape selection; collapse multi-select.
      if (s.selectedShapeIds.length === 1 && s.selectedShapeIds[0] === v.shapeId) {
        return { selectedVertices: [v] }
      }
      return {
        selectedVertices: [v],
        selectedShapeIds: [v.shapeId],
        selectionAnchorId: v.shapeId,
      }
    }),
  selectVertices: vs =>
    set(s => {
      if (vs.length === 0) return { selectedVertices: [] }
      // Vertex selection is single-shape: trust the first id and force the
      // shape selection to match. (Caller is expected to pass entries from one shape.)
      const shapeId = vs[0].shapeId
      const same = s.selectedShapeIds.length === 1 && s.selectedShapeIds[0] === shapeId
      return {
        selectedVertices: vs.slice(),
        ...(same
          ? {}
          : {
              selectedShapeIds: [shapeId],
              selectionAnchorId: shapeId,
            }),
      }
    }),
  toggleVertexSelection: v =>
    set(s => {
      // Toggling a vertex on a different shape collapses to a single-vertex pick.
      if (s.selectedShapeIds.length !== 1 || s.selectedShapeIds[0] !== v.shapeId) {
        return {
          selectedVertices: [v],
          selectedShapeIds: [v.shapeId],
          selectionAnchorId: v.shapeId,
        }
      }
      const has = s.selectedVertices.some(x => x.shapeId === v.shapeId && x.index === v.index)
      const next = has
        ? s.selectedVertices.filter(x => !(x.shapeId === v.shapeId && x.index === v.index))
        : [...s.selectedVertices, v]
      return { selectedVertices: next }
    }),
  updateShape: (id, patch) =>
    set(s => {
      // Editing fill/stroke directly off-palette should drop a stale ref —
      // otherwise the saved SVG would claim a palette link that no longer
      // matches the rendered color. Only auto-clear when the caller didn't
      // explicitly include the ref in the patch (e.g. setShapePaletteRef
      // sends both at once and we honor that).
      const autoPatch: Partial<Shape> = {}
      if ('fill' in patch && !('fillRef' in patch)) autoPatch.fillRef = undefined
      if ('stroke' in patch && !('strokeRef' in patch)) autoPatch.strokeRef = undefined
      const finalPatch = { ...patch, ...autoPatch }
      return {
        ...pushSnapshot(s, `updateShape:${id}:${Object.keys(finalPatch).toSorted().join(',')}`),
        shapes: s.shapes.map(sh => (sh.id === id ? { ...sh, ...finalPatch } : sh)),
        dirty: true,
      }
    }),
  moveShape: (id, points) =>
    set(s => ({
      shapes: s.shapes.map(sh => (sh.id === id ? { ...sh, points } : sh)),
      dirty: true,
    })),
  moveShapes: deltas =>
    set(s => {
      if (deltas.length === 0) return s
      const map = new Map(deltas.map(d => [d.id, d.points]))
      return {
        shapes: s.shapes.map(sh => {
          const next = map.get(sh.id)
          return next ? { ...sh, points: next } : sh
        }),
        dirty: true,
      }
    }),
  moveVertex: (id, index, p) =>
    set(s => ({
      shapes: s.shapes.map(sh => {
        if (sh.id !== id) return sh
        // Circle center (index 0) is a translation handle: dragging it must
        // carry the perimeter anchor along so the radius is preserved. The
        // perimeter anchor (index 1) is the resize handle and just moves on
        // its own — `dist(center, perimeter)` becomes the new radius.
        if (sh.kind === 'circle' && index === 0 && sh.points.length >= 2) {
          const [cx, cy] = sh.points[0]
          const dx = p[0] - cx
          const dy = p[1] - cy
          return {
            ...sh,
            points: sh.points.map(([x, y]) => [x + dx, y + dy] as Point),
          }
        }
        const next = sh.points.slice()
        next[index] = p
        return { ...sh, points: next }
      }),
      dirty: true,
    })),
  moveVertices: (shapeId, items) =>
    set(s => {
      if (items.length === 0) return s
      return {
        shapes: s.shapes.map(sh => {
          if (sh.id !== shapeId) return sh
          const next = sh.points.slice()
          for (const { index, point } of items) {
            if (index >= 0 && index < next.length) next[index] = point
          }
          return { ...sh, points: next }
        }),
        dirty: true,
      }
    }),
  deleteShape: id =>
    set(s => {
      const remaining = s.selectedShapeIds.filter(x => x !== id)
      return {
        ...pushSnapshot(s),
        shapes: s.shapes.filter(sh => sh.id !== id),
        selectedShapeIds: remaining,
        selectionAnchorId: s.selectionAnchorId === id ? null : s.selectionAnchorId,
        selectedVertices: s.selectedVertices.filter(v => v.shapeId !== id),
        dirty: true,
      }
    }),
  deleteShapes: ids =>
    set(s => {
      if (ids.length === 0) return s
      const idSet = new Set(ids)
      return {
        ...pushSnapshot(s),
        shapes: s.shapes.filter(sh => !idSet.has(sh.id)),
        selectedShapeIds: s.selectedShapeIds.filter(x => !idSet.has(x)),
        selectionAnchorId: s.selectionAnchorId && idSet.has(s.selectionAnchorId) ? null : s.selectionAnchorId,
        selectedVertices: s.selectedVertices.filter(v => !idSet.has(v.shapeId)),
        dirty: true,
      }
    }),
  duplicateShapes: ids => {
    // Captured by the set callback; returned to the caller after set runs
    // synchronously. Lets alt-drag start translating the duplicates without
    // a follow-up store read.
    const newIds: string[] = []
    set(s => {
      if (ids.length === 0) return s
      const idSet = new Set(ids)
      const idToNew = new Map<string, string>()
      const next: Shape[] = []
      for (const sh of s.shapes) {
        next.push(sh)
        if (!idSet.has(sh.id)) continue
        const newId = makeId()
        idToNew.set(sh.id, newId)
        // Clone the points array so later edits to the source don't leak
        // through the shared reference. Other nested fields (glyphs, arc,
        // animation, …) are treated immutably elsewhere, so sharing is safe.
        next.push({
          ...sh,
          id: newId,
          points: sh.points.map(p => [p[0], p[1]] as Point),
        })
      }
      for (const id of ids) {
        const ni = idToNew.get(id)
        if (ni) newIds.push(ni)
      }
      return {
        ...pushSnapshot(s),
        shapes: next,
        selectedShapeIds: newIds.slice(),
        selectionAnchorId: newIds.length ? newIds[newIds.length - 1] : null,
        selectedVertices: [],
        dirty: true,
      }
    })
    return newIds
  },
  addShapes: shapes =>
    set(s => {
      if (shapes.length === 0) return s
      const added = shapes.map(sh => ({
        ...sh,
        id: makeId(),
        points: sh.points.map(p => [p[0], p[1]] as Point),
      }))
      const newIds = added.map(sh => sh.id)
      return {
        ...pushSnapshot(s),
        shapes: [...s.shapes, ...added],
        selectedShapeIds: newIds,
        selectionAnchorId: newIds[newIds.length - 1],
        selectedVertices: [],
        dirty: true,
      }
    }),
  deleteVertex: (shapeId, index) =>
    set(s => {
      const shape = s.shapes.find(sh => sh.id === shapeId)
      if (!shape) return s
      if (shape.points.length <= 2) {
        return {
          ...pushSnapshot(s),
          shapes: s.shapes.filter(sh => sh.id !== shapeId),
          selectedShapeIds: s.selectedShapeIds.filter(x => x !== shapeId),
          selectionAnchorId: s.selectionAnchorId === shapeId ? null : s.selectionAnchorId,
          selectedVertices: [],
          dirty: true,
        }
      }
      const dropped = new Set([index])
      return {
        ...pushSnapshot(s),
        shapes: s.shapes.map(sh =>
          sh.id !== shapeId
            ? sh
            : {
                ...sh,
                points: sh.points.filter((_, i) => i !== index),
                pointBezierOverrides: reindexPointBeziers(sh.pointBezierOverrides, dropped),
              },
        ),
        selectedVertices: [],
        dirty: true,
      }
    }),
  deleteVertices: items =>
    set(s => {
      if (items.length === 0) return s
      // Group indices by shape so each shape is rebuilt once.
      const byShape = new Map<string, Set<number>>()
      for (const { shapeId, index } of items) {
        let bucket = byShape.get(shapeId)
        if (!bucket) {
          bucket = new Set()
          byShape.set(shapeId, bucket)
        }
        bucket.add(index)
      }
      const removedShapeIds = new Set<string>()
      const nextShapes: Shape[] = []
      for (const sh of s.shapes) {
        const drop = byShape.get(sh.id)
        if (!drop) {
          nextShapes.push(sh)
          continue
        }
        // Filtering points whose original index is in `drop`. If the result has
        // fewer than 2 points the shape is no longer a real geometry — drop it.
        const kept = sh.points.filter((_, i) => !drop.has(i))
        if (kept.length < 2) {
          removedShapeIds.add(sh.id)
          continue
        }
        nextShapes.push({
          ...sh,
          points: kept,
          pointBezierOverrides: reindexPointBeziers(sh.pointBezierOverrides, drop),
        })
      }
      return {
        ...pushSnapshot(s),
        shapes: nextShapes,
        selectedShapeIds: removedShapeIds.size
          ? s.selectedShapeIds.filter(id => !removedShapeIds.has(id))
          : s.selectedShapeIds,
        selectionAnchorId: s.selectionAnchorId && removedShapeIds.has(s.selectionAnchorId) ? null : s.selectionAnchorId,
        selectedVertices: [],
        dirty: true,
      }
    }),
  toggleShapeVisibility: id =>
    set(s => ({
      ...pushSnapshot(s),
      shapes: s.shapes.map(sh => (sh.id === id ? { ...sh, hidden: !sh.hidden } : sh)),
      dirty: true,
    })),
  renameShape: (id, name) =>
    set(s => {
      const trimmed = name.trim()
      return {
        ...pushSnapshot(s, `renameShape:${id}`),
        shapes: s.shapes.map(sh => (sh.id !== id ? sh : { ...sh, name: trimmed || undefined })),
        dirty: true,
      }
    }),
  toggleShapeLock: id =>
    set(s => {
      const target = s.shapes.find(sh => sh.id === id)
      if (!target) return s
      const nextLocked = !target.locked
      // Locking a shape removes it from the selection so canvas interactions
      // don't keep operating on a now-uneditable target.
      const stripSel = nextLocked && s.selectedShapeIds.includes(id)
      const nextSel = stripSel ? s.selectedShapeIds.filter(x => x !== id) : s.selectedShapeIds
      return {
        ...pushSnapshot(s),
        shapes: s.shapes.map(sh => (sh.id === id ? { ...sh, locked: nextLocked } : sh)),
        selectedShapeIds: nextSel,
        selectionAnchorId: stripSel && s.selectionAnchorId === id ? null : s.selectionAnchorId,
        selectedVertices:
          stripSel && s.selectedVertices.some(v => v.shapeId === id)
            ? s.selectedVertices.filter(v => v.shapeId !== id)
            : s.selectedVertices,
        dirty: true,
      }
    }),
  reorderShape: (from, to) =>
    set(s => {
      if (from === to) return s
      if (from < 0 || from >= s.shapes.length) return s
      const clamped = Math.max(0, Math.min(s.shapes.length - 1, to))
      const next = s.shapes.slice()
      const [moved] = next.splice(from, 1)
      next.splice(clamped, 0, moved)
      return { ...pushSnapshot(s), shapes: next, dirty: true }
    }),
  applyBlending: ids =>
    set(s => {
      if (ids.length === 0) return s
      const idSet = new Set(ids)
      // Process in array order (bottom-to-top z): each baked shape becomes the
      // backdrop for shapes above it, matching what was visually rendered.
      let next = s.shapes
      let changed = false
      for (let i = 0; i < next.length; i++) {
        const sh = next[i]
        if (!idSet.has(sh.id)) continue
        const mode = sh.blendMode
        if (!mode || mode === 'normal') continue
        const bottom = findColorBelow(next, s.settings, sh.id)
        const fillRgb = parseHex(sh.fill)
        const strokeRgb = parseHex(sh.stroke)
        const patch: Partial<Shape> = { blendMode: undefined }
        if (fillRgb) patch.fill = toHex(blendColor(bottom, fillRgb, mode))
        if (strokeRgb) patch.stroke = toHex(blendColor(bottom, strokeRgb, mode))
        if (next === s.shapes) next = s.shapes.slice()
        next[i] = { ...sh, ...patch }
        changed = true
      }
      if (!changed) return s
      return { ...pushSnapshot(s), shapes: next, dirty: true }
    }),
  applyOpacity: ids =>
    set(s => {
      if (ids.length === 0) return s
      const idSet = new Set(ids)
      let next = s.shapes
      let changed = false
      for (let i = 0; i < next.length; i++) {
        const sh = next[i]
        if (!idSet.has(sh.id)) continue
        const op = sh.opacity
        if (op === undefined || op >= 1) continue
        const bottom = findColorBelow(next, s.settings, sh.id)
        const fillRgb = parseHex(sh.fill)
        const strokeRgb = parseHex(sh.stroke)
        const patch: Partial<Shape> = { opacity: undefined }
        if (fillRgb) patch.fill = toHex(mix(bottom, fillRgb, op))
        if (strokeRgb) patch.stroke = toHex(mix(bottom, strokeRgb, op))
        if (next === s.shapes) next = s.shapes.slice()
        next[i] = { ...sh, ...patch }
        changed = true
      }
      if (!changed) return s
      return { ...pushSnapshot(s), shapes: next, dirty: true }
    }),
  applyTransform: ids =>
    set(s => {
      if (ids.length === 0) return s
      const idSet = new Set(ids)
      let next = s.shapes
      let changed = false
      for (let i = 0; i < next.length; i++) {
        const sh = next[i]
        if (!idSet.has(sh.id)) continue
        if (!hasTransform(sh)) continue
        if (sh.kind === 'glyphs') continue
        const rot = shapeRotation(sh)
        const newPoints = sh.points.map(p => applyTransformToPoint(sh, p))
        const patch: Partial<Shape> = {
          points: newPoints,
          rotation: undefined,
          scale: undefined,
        }
        if (sh.kind === 'circle' && sh.arc && rot !== 0) {
          // Arc angles are in canvas-frame degrees, so a baked rotation must
          // shift them; otherwise the wedge would snap back to its pre-rotation
          // orientation when rotation resets to 0.
          patch.arc = { ...sh.arc, start: sh.arc.start + rot, end: sh.arc.end + rot }
        }
        if (next === s.shapes) next = s.shapes.slice()
        next[i] = { ...sh, ...patch }
        changed = true
      }
      if (!changed) return s
      return { ...pushSnapshot(s), shapes: next, dirty: true }
    }),
  flipShapes: (ids, axis) =>
    set(s => {
      if (ids.length === 0) return s
      const idSet = new Set(ids)
      const flipH = axis === 'horizontal'
      let next = s.shapes
      let changed = false
      for (let i = 0; i < next.length; i++) {
        const sh = next[i]
        if (!idSet.has(sh.id)) continue
        if (sh.kind === 'glyphs') continue
        const [cx, cy] = shapeBBoxCenter(sh)
        const newPoints = sh.points.map(p => (flipH ? [2 * cx - p[0], p[1]] : [p[0], 2 * cy - p[1]]) as Point)
        const patch: Partial<Shape> = { points: newPoints }
        const rot = shapeRotation(sh)
        if (rot !== 0) patch.rotation = -rot
        if (sh.kind === 'circle' && sh.arc) {
          // Arc angles measure clockwise from 3 o'clock, so an H-flip mirrors
          // each across the vertical axis (θ → 180°−θ) and a V-flip across
          // the horizontal axis (θ → −θ). The sweep direction also reverses,
          // so swap start/end to keep the clockwise-sweep convention.
          const a = sh.arc
          patch.arc = flipH ? { ...a, start: 180 - a.end, end: 180 - a.start } : { ...a, start: -a.end, end: -a.start }
        }
        if (next === s.shapes) next = s.shapes.slice()
        next[i] = { ...sh, ...patch }
        changed = true
      }
      if (!changed) return s
      return { ...pushSnapshot(s), shapes: next, dirty: true }
    }),
  addPaletteColor: (name, color) =>
    set(s => {
      const trimmed = name.trim()
      if (!trimmed) return s
      if (s.settings.palette.some(p => p.name === trimmed)) return s
      return {
        ...pushSnapshot(s),
        settings: {
          ...s.settings,
          palette: [...s.settings.palette, { name: trimmed, color }],
        },
        dirty: true,
      }
    }),
  updatePaletteColor: (oldName, next) =>
    set(s => {
      const idx = s.settings.palette.findIndex(p => p.name === oldName)
      if (idx === -1) return s
      const newName = next.name.trim()
      if (!newName) return s
      // Reject a rename that would collide with another existing entry.
      if (newName !== oldName && s.settings.palette.some(p => p.name === newName)) return s
      const palette = s.settings.palette.slice()
      palette[idx] = { name: newName, color: next.color }
      const renamed = newName !== oldName
      // Coalesce repeat color-only edits (slider drags) into one history entry.
      const coalesce = renamed ? undefined : `palette:${oldName}`
      const settings: ProjectSettings = { ...s.settings, palette }
      if (s.settings.bgRef === oldName) {
        settings.bg = next.color
        if (renamed) settings.bgRef = newName
      }
      const shapes = s.shapes.map(sh => {
        let patch: Partial<Shape> | null = null
        if (sh.fillRef === oldName) {
          patch = { fill: next.color }
          if (renamed) patch.fillRef = newName
        }
        if (sh.strokeRef === oldName) {
          patch = { ...patch, stroke: next.color }
          if (renamed) patch = { ...patch, strokeRef: newName }
        }
        return patch ? { ...sh, ...patch } : sh
      })
      return {
        ...pushSnapshot(s, coalesce),
        settings,
        shapes,
        dirty: true,
      }
    }),
  removePaletteColor: name =>
    set(s => {
      if (!s.settings.palette.some(p => p.name === name)) return s
      const settings: ProjectSettings = {
        ...s.settings,
        palette: s.settings.palette.filter(p => p.name !== name),
      }
      if (s.settings.bgRef === name) settings.bgRef = undefined
      const shapes = s.shapes.map(sh => {
        if (sh.fillRef !== name && sh.strokeRef !== name) return sh
        const patch: Partial<Shape> = {}
        if (sh.fillRef === name) patch.fillRef = undefined
        if (sh.strokeRef === name) patch.strokeRef = undefined
        return { ...sh, ...patch }
      })
      return { ...pushSnapshot(s), settings, shapes, dirty: true }
    }),
  setShapePaletteRef: (id, channel, name) =>
    set(s => {
      const shape = s.shapes.find(sh => sh.id === id)
      if (!shape) return s
      const refKey = channel === 'fill' ? 'fillRef' : 'strokeRef'
      const colorKey = channel
      let patch: Partial<Shape>
      if (name === undefined) {
        // Unlink: drop the ref but keep the resolved color (no visual change).
        patch = { [refKey]: undefined } as Partial<Shape>
      } else {
        const entry = s.settings.palette.find(p => p.name === name)
        if (!entry) return s
        patch = { [refKey]: name, [colorKey]: entry.color } as Partial<Shape>
      }
      return {
        ...pushSnapshot(s, `paletteRef:${id}:${channel}`),
        shapes: s.shapes.map(sh => (sh.id === id ? { ...sh, ...patch } : sh)),
        dirty: true,
      }
    }),
  setBgPaletteRef: name =>
    set(s => {
      if (name === undefined) {
        if (s.settings.bgRef === undefined) return s
        return {
          ...pushSnapshot(s),
          settings: { ...s.settings, bgRef: undefined },
          dirty: true,
        }
      }
      const entry = s.settings.palette.find(p => p.name === name)
      if (!entry) return s
      return {
        ...pushSnapshot(s, `bgRef`),
        settings: { ...s.settings, bg: entry.color, bgRef: name },
        dirty: true,
      }
    }),
  setProject: (settings, shapes) =>
    set(s => ({
      settings,
      shapes,
      selectedShapeIds: [],
      selectionAnchorId: null,
      selectedVertices: [],
      drawing: null,
      dirty: false,
      fitNonce: s.fitNonce + 1,
      previewT: null,
      previewPlaying: false,
      // Loading a fresh document discards any existing undo trail — undoing
      // back into the previous file's state would surprise the user.
      past: [],
      future: [],
    })),
  newProject: () =>
    set(s => ({
      settings: { ...DEFAULT_SETTINGS },
      shapes: [],
      selectedShapeIds: [],
      selectionAnchorId: null,
      selectedVertices: [],
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
  requestFit: () => set(s => ({ fitNonce: s.fitNonce + 1 })),
  pushHistory: coalesceKey => set(s => pushSnapshot(s, coalesceKey)),
  undo: () =>
    set(s => {
      const top = s.past[s.past.length - 1]
      if (!top) return s
      const past = s.past.slice(0, -1)
      const redoEntry: HistoryEntry = {
        shapes: s.shapes,
        settings: s.settings,
        pushedAt: now(),
      }
      const future = [...s.future, redoEntry]
      // Selection prune: keep only ids that still exist in the restored shapes.
      const restoredIds = new Set(top.shapes.map(sh => sh.id))
      const selectedShapeIds = s.selectedShapeIds.filter(id => restoredIds.has(id))
      return {
        past,
        future,
        shapes: top.shapes,
        settings: top.settings,
        selectedShapeIds,
        selectionAnchorId: s.selectionAnchorId && restoredIds.has(s.selectionAnchorId) ? s.selectionAnchorId : null,
        selectedVertices: [],
        drawing: null,
        dirty: true,
      }
    }),
  redo: () =>
    set(s => {
      const top = s.future[s.future.length - 1]
      if (!top) return s
      const future = s.future.slice(0, -1)
      const undoEntry: HistoryEntry = {
        shapes: s.shapes,
        settings: s.settings,
        pushedAt: now(),
      }
      const past = [...s.past, undoEntry]
      const restoredIds = new Set(top.shapes.map(sh => sh.id))
      const selectedShapeIds = s.selectedShapeIds.filter(id => restoredIds.has(id))
      return {
        past,
        future,
        shapes: top.shapes,
        settings: top.settings,
        selectedShapeIds,
        selectionAnchorId: s.selectionAnchorId && restoredIds.has(s.selectionAnchorId) ? s.selectionAnchorId : null,
        selectedVertices: [],
        drawing: null,
        dirty: true,
      }
    }),
}))

export const effectiveBezier = (shape: Shape, settings: ProjectSettings): number =>
  shape.bezierOverride ?? settings.bezier
