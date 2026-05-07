import { create } from 'zustand'

import { blendColor, findColorBelow, mix, parseHex, toHex } from './lib/blend'
import { DEFAULT_SETTINGS, makeId } from './lib/svg-io'
import {
  applyTransformToPoint,
  defaultMirrorAxis,
  defaultRadialSpec,
  groupBBoxCenter,
  hasTransform,
  isPointOnAxis,
  pairBBoxCenter,
  reflectPoint,
  reflectShape,
  shapeBBoxCenter,
  shapeRotation,
  shapeScale,
  transformPointsAround,
} from './lib/transform'

import type {
  AnimationSpec,
  Drawing,
  GlyphData,
  Group,
  MirrorAxis,
  PaletteColor,
  Point,
  ProjectSettings,
  RadialSpec,
  Shape,
  Tool,
  ViewState,
} from './types'

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
  groups: Group[]
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

/** Shift overrides up by 1 for entries at or after `insertIndex` so they keep
 * pointing at the same vertex once a new point has been spliced in. */
const shiftPointBeziersForInsert = (
  overrides: Record<number, number> | undefined,
  insertIndex: number,
): Record<number, number> | undefined => {
  if (!overrides) return undefined
  const next: Record<number, number> = {}
  for (const [k, v] of Object.entries(overrides)) {
    const i = Number(k)
    next[i >= insertIndex ? i + 1 : i] = v
  }
  return Object.keys(next).length > 0 ? next : undefined
}

/** Tolerance for "are these two vertices the same point" used by mergeShapes. */
const POINT_EQ_TOL = 1e-3
const pointsClose = (a: Point, b: Point): boolean => {
  const dx = a[0] - b[0]
  const dy = a[1] - b[1]
  return dx * dx + dy * dy < POINT_EQ_TOL * POINT_EQ_TOL
}

/**
 * Of the two arcs of a closed point ring split by indices `i` and `j`, return
 * the one with more vertices (the polygon's body, as opposed to the seam edge
 * between two adjacent shared vertices). Both endpoints of the returned arc
 * are the seam vertices `pts[i]` / `pts[j]`. Used by mergeShapes to pick the
 * "outward" arc for each polygon — same shape as mergeMirror's heuristic.
 */
const longerArc = (pts: Point[], i: number, j: number): Point[] => {
  const n = pts.length
  const lo = Math.min(i, j)
  const hi = Math.max(i, j)
  const forward: Point[] = []
  for (let k = lo; k <= hi; k++) forward.push(pts[k])
  const wrap: Point[] = []
  for (let k = hi; k < n; k++) wrap.push(pts[k])
  for (let k = 0; k <= lo; k++) wrap.push(pts[k])
  return forward.length >= wrap.length ? forward : wrap
}

/** First name not already taken by an existing group, in `Group N` form. */
const defaultGroupName = (groups: Group[]): string => {
  const taken = new Set(groups.map(g => g.name))
  for (let n = 1; n <= groups.length + 1; n++) {
    const candidate = `Group ${n}`
    if (!taken.has(candidate)) return candidate
  }
  return `Group ${groups.length + 1}`
}

/**
 * Build a Group[] from shapes whose groupIds reference groups not present in
 * the parser's record list (older files written before the v7-groups attribute,
 * or hand-edited SVGs). Each unique groupId gets a generated display name.
 */
const synthesizeGroupsFromShapes = (shapes: Shape[]): Group[] => {
  const seen = new Set<string>()
  const out: Group[] = []
  for (const sh of shapes) {
    if (!sh.groupId || seen.has(sh.groupId)) continue
    seen.add(sh.groupId)
    out.push({ id: sh.groupId, name: `Group ${out.length + 1}` })
  }
  return out
}

const MAX_HISTORY = 100
/** Repeated pushes with the same coalesceKey within this window replace the top entry. */
const COALESCE_WINDOW_MS = 800
const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now())

const pushSnapshot = (
  s: { past: HistoryEntry[]; shapes: Shape[]; settings: ProjectSettings; groups: Group[] },
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
    groups: s.groups,
    coalesceKey,
    pushedAt: t,
  }
  const past = s.past.length >= MAX_HISTORY ? s.past.slice(-(MAX_HISTORY - 1)) : s.past.slice()
  past.push(entry)
  return { past, future: [] }
}

export interface AppState {
  shapes: Shape[]
  /**
   * Project-level groups. Membership is encoded on each shape via `groupId`;
   * this array is the authoritative list of group records (id + display name)
   * including empty groups, which the layer panel surfaces as drop targets.
   */
  groups: Group[]
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
   * Insert a new vertex between two adjacent points of a path-kind shape, at
   * their straight-line midpoint. "Adjacent" includes wrap-around for closed
   * shapes (first ↔ last). The inserted point becomes the sole selected
   * vertex; no-op when indices aren't adjacent or the shape isn't a path.
   */
  insertPointBetween: (shapeId: string, i: number, j: number) => void
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
   * Enable a live mirror on the shape, anchored at the artboard center. The
   * `axis` argument picks the orientation: `'horizontal'` reflects left/right
   * (vertical axis line, 90°), `'vertical'` reflects top/bottom (horizontal
   * axis line, 0°) — same naming as `flipShapes`. Glyph shapes are
   * unsupported (matching `flipShapes`); the call is a no-op for them.
   */
  enableMirror: (id: string, axis: 'horizontal' | 'vertical') => void
  /**
   * Enable a live radial repeat on the shape, centered on the artboard with
   * the given angular increment. Clears any existing live mirror first
   * (mirror and radial are mutually exclusive at the UI level).
   */
  enableRadial: (id: string, angle: number) => void
  /** Drop the live radial repeat. */
  disableRadial: (id: string) => void
  /** Patch one or more radial-spec fields. Coalesces with continuous slider drags. */
  updateRadial: (id: string, patch: Partial<RadialSpec>) => void
  /** Toggle the orange center-dot indicator on canvas. Doesn't change geometry. */
  toggleRadialCenterVisibility: (id: string) => void
  /** Drop the live mirror without baking the reflection. */
  disableMirror: (id: string) => void
  /** Patch one or more axis fields. Coalesces with continuous axis drags so a slider/handle drag is one undo. */
  updateMirrorAxis: (id: string, patch: Partial<MirrorAxis>) => void
  /** Toggle visibility of the bright-green axis line + handles on canvas. Doesn't change geometry. */
  toggleMirrorAxisVisibility: (id: string) => void
  /**
   * Bake the live mirror into a separate, independent shape inserted right
   * after the source in z-order. Source shape keeps its geometry (and its own
   * rotation), but `mirror` is cleared. Returns the new shape's id, or null
   * when the source has no mirror.
   */
  ejectMirror: (id: string) => string | null
  /**
   * Stitch the source's geometry into the mirror's so the pair becomes one
   * continuous path. Only applicable when the source's points actually meet
   * the axis: a line needs at least one endpoint on the axis (lines with both
   * endpoints on the axis become a closed polygon); a polygon needs exactly
   * two vertices on the axis. Source rotation/scale (which pivots at the
   * combined pair center while a mirror is attached) is baked into the merged
   * points so the result stays at the same visual pose. Returns true on a
   * successful merge, false when the topology doesn't qualify.
   */
  mergeMirror: (id: string) => boolean
  /**
   * Stitch two layers (both polygons or both lines) into a single shape along
   * coincident vertices. For closed polygons the two shapes must share exactly
   * two vertices (the seam); the longer arc of each is concatenated. For open
   * lines at least one endpoint of `idA` must coincide with an endpoint of
   * `idB`; the result is a single polyline (or a closed polygon when both
   * endpoint pairs match). The first id's shape inherits the merged geometry
   * and keeps its position in the z-stack and group; the second is removed.
   * Returns true on success, false when the shapes don't qualify.
   */
  mergeShapes: (idA: string, idB: string) => boolean
  /**
   * Append a new empty group with a default name. Returns the new group id so
   * callers can immediately rename or assign members. The id space is shared
   * with shape ids (`makeId`) so groupId / shapeId references can't collide.
   */
  addGroup: () => string
  /** Remove a group; member shapes lose their `groupId` (no shapes are deleted). */
  removeGroup: (id: string) => void
  /** Rename a group; trims whitespace, ignores empty names. */
  renameGroup: (id: string, name: string) => void
  /**
   * Set or clear a shape's group membership. Pass `undefined` to ungroup.
   * Assigning to a group with existing members reorders the shape next to
   * them so members stay contiguous in the array (lets the renderer wrap
   * each group in one `<g>` element); ungrouping leaves the shape's
   * position untouched.
   */
  setShapeGroup: (shapeId: string, groupId: string | undefined) => void
  /**
   * Patch a group's rotation / scale. The values are applied around the
   * group's combined bbox center via the wrapping `<g transform>`, so
   * sliding live previews without baking. Pass `0` for rotation or `1` for
   * scale to reset the channel.
   */
  setGroupTransform: (groupId: string, patch: { rotation?: number; scale?: number }) => void
  /**
   * Bake the group's rotation/scale into each member's points (around the
   * group's bbox center) and reset the group transform back to identity.
   * Required before editing a member's vertices on a transformed group.
   * Glyph members are unsupported (no path-data baking); the call is a
   * no-op if any member is a glyph.
   */
  applyGroupTransform: (groupId: string) => void
  /** Set or clear the group's entrance animation. */
  setGroupAnimation: (groupId: string, animation: AnimationSpec | undefined) => void
  /**
   * Replace the selection with every shape that belongs to `groupId`. Empty
   * groups produce an empty selection (clears any current selection).
   */
  selectGroup: (groupId: string) => void
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
  setProject: (settings: ProjectSettings, shapes: Shape[], groups?: Group[]) => void
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
  groups: [],
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
  insertPointBetween: (shapeId, i, j) =>
    set(s => {
      const shape = s.shapes.find(sh => sh.id === shapeId)
      if (!shape) return s
      if (shape.kind === 'circle' || shape.kind === 'glyphs') return s
      const n = shape.points.length
      if (i < 0 || i >= n || j < 0 || j >= n || i === j) return s
      const lo = Math.min(i, j)
      const hi = Math.max(i, j)
      let insertAt: number
      if (hi - lo === 1) insertAt = hi
      else if (shape.closed && lo === 0 && hi === n - 1) insertAt = n
      else return s
      const a = shape.points[i]
      const b = shape.points[j]
      const mid: Point = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
      const nextPoints = shape.points.slice()
      nextPoints.splice(insertAt, 0, mid)
      return {
        ...pushSnapshot(s),
        shapes: s.shapes.map(sh =>
          sh.id !== shapeId
            ? sh
            : {
                ...sh,
                points: nextPoints,
                pointBezierOverrides: shiftPointBeziersForInsert(sh.pointBezierOverrides, insertAt),
              },
        ),
        selectedVertices: [{ shapeId, index: insertAt }],
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
  enableMirror: (id, axis) =>
    set(s => {
      const target = s.shapes.find(sh => sh.id === id)
      if (!target) return s
      if (target.kind === 'glyphs') return s
      if (target.mirror) return s
      const cx = s.settings.viewBoxX + s.settings.viewBoxWidth / 2
      const cy = s.settings.viewBoxY + s.settings.viewBoxHeight / 2
      const angle = axis === 'vertical' ? 0 : 90
      const axisSpec = defaultMirrorAxis(cx, cy, angle)
      return {
        ...pushSnapshot(s),
        // Mirror and radial are mutually exclusive at the UI level: enabling
        // one drops the other so the panel never has to render both at once.
        shapes: s.shapes.map(sh => (sh.id === id ? { ...sh, mirror: { axis: axisSpec }, radial: undefined } : sh)),
        dirty: true,
      }
    }),
  enableRadial: (id, angle) =>
    set(s => {
      const target = s.shapes.find(sh => sh.id === id)
      if (!target) return s
      if (target.kind === 'glyphs') return s
      if (!Number.isFinite(angle) || angle <= 0) return s
      const cx = s.settings.viewBoxX + s.settings.viewBoxWidth / 2
      const cy = s.settings.viewBoxY + s.settings.viewBoxHeight / 2
      const spec = defaultRadialSpec(cx, cy, angle)
      return {
        ...pushSnapshot(s),
        shapes: s.shapes.map(sh => (sh.id === id ? { ...sh, radial: spec, mirror: undefined } : sh)),
        dirty: true,
      }
    }),
  disableRadial: id =>
    set(s => {
      const target = s.shapes.find(sh => sh.id === id)
      if (!target?.radial) return s
      return {
        ...pushSnapshot(s),
        shapes: s.shapes.map(sh => (sh.id === id ? { ...sh, radial: undefined } : sh)),
        dirty: true,
      }
    }),
  updateRadial: (id, patch) =>
    set(s => {
      const target = s.shapes.find(sh => sh.id === id)
      if (!target?.radial) return s
      const nextSpec: RadialSpec = { ...target.radial, ...patch }
      if (!Number.isFinite(nextSpec.angle) || nextSpec.angle <= 0) return s
      return {
        ...pushSnapshot(s, `radial:${id}`),
        shapes: s.shapes.map(sh => (sh.id === id && sh.radial ? { ...sh, radial: nextSpec } : sh)),
        dirty: true,
      }
    }),
  toggleRadialCenterVisibility: id =>
    set(s => {
      const target = s.shapes.find(sh => sh.id === id)
      if (!target?.radial) return s
      const next = !target.radial.showCenter
      return {
        shapes: s.shapes.map(sh =>
          sh.id === id && sh.radial ? { ...sh, radial: { ...sh.radial, showCenter: next || undefined } } : sh,
        ),
      }
    }),
  disableMirror: id =>
    set(s => {
      const target = s.shapes.find(sh => sh.id === id)
      if (!target?.mirror) return s
      return {
        ...pushSnapshot(s),
        shapes: s.shapes.map(sh => (sh.id === id ? { ...sh, mirror: undefined } : sh)),
        dirty: true,
      }
    }),
  updateMirrorAxis: (id, patch) =>
    set(s => {
      const target = s.shapes.find(sh => sh.id === id)
      if (!target?.mirror) return s
      const nextAxis: MirrorAxis = { ...target.mirror.axis, ...patch }
      return {
        // Coalesce continuous axis drags (handle move, slider drag) so the
        // whole gesture collapses to one undo entry.
        ...pushSnapshot(s, `mirrorAxis:${id}`),
        shapes: s.shapes.map(sh =>
          sh.id === id && sh.mirror ? { ...sh, mirror: { ...sh.mirror, axis: nextAxis } } : sh,
        ),
        dirty: true,
      }
    }),
  toggleMirrorAxisVisibility: id =>
    set(s => {
      const target = s.shapes.find(sh => sh.id === id)
      if (!target?.mirror) return s
      const next = !target.mirror.showAxis
      return {
        shapes: s.shapes.map(sh =>
          sh.id === id && sh.mirror ? { ...sh, mirror: { ...sh.mirror, showAxis: next || undefined } } : sh,
        ),
      }
    }),
  ejectMirror: id => {
    let newId: string | null = null
    set(s => {
      const idx = s.shapes.findIndex(sh => sh.id === id)
      if (idx === -1) return s
      const source = s.shapes[idx]
      if (!source.mirror) return s
      // Bake the group rotation/scale (which pivots at the combined pair
      // center while a mirror is attached) into both halves so the ejected
      // pair stays at its current visual rest pose. Without baking, the
      // source would jump to its own-bbox-pivoted rotation post-eject and
      // the reflection would lose its rotational alignment entirely.
      const rot = shapeRotation(source)
      const scl = shapeScale(source)
      const [cx, cy] = pairBBoxCenter(source)
      const reflected = reflectShape(source, source.mirror.axis)
      newId = makeId()
      let bakedSourcePoints = source.points
      let bakedSourceArc = source.arc
      let bakedMirrorPoints = reflected.points
      let bakedMirrorArc = reflected.arc
      if (rot !== 0 || scl !== 1) {
        bakedSourcePoints = transformPointsAround(source.points, rot, scl, cx, cy)
        bakedMirrorPoints = transformPointsAround(reflected.points, rot, scl, cx, cy)
        // Arc angles in canvas-frame degrees shift by the baked rotation;
        // mirrors flipShapes' arc-shift logic in `applyTransform`.
        if (rot !== 0) {
          if (source.arc) bakedSourceArc = { ...source.arc, start: source.arc.start + rot, end: source.arc.end + rot }
          if (reflected.arc) {
            bakedMirrorArc = { ...reflected.arc, start: reflected.arc.start + rot, end: reflected.arc.end + rot }
          }
        }
      }
      const next = s.shapes.slice()
      next[idx] = {
        ...source,
        points: bakedSourcePoints,
        rotation: undefined,
        scale: undefined,
        mirror: undefined,
        ...(bakedSourceArc ? { arc: bakedSourceArc } : {}),
      }
      const ejected: Shape = {
        ...reflected,
        id: newId,
        points: bakedMirrorPoints,
        rotation: undefined,
        scale: undefined,
        ...(bakedMirrorArc ? { arc: bakedMirrorArc } : {}),
      }
      // Insert the ejected copy immediately after the source so it sits one
      // step above in z-order — matches the "two layers" mental model.
      next.splice(idx + 1, 0, ejected)
      return {
        ...pushSnapshot(s),
        shapes: next,
        dirty: true,
      }
    })
    return newId
  },
  mergeMirror: id => {
    let merged = false
    set(s => {
      const idx = s.shapes.findIndex(sh => sh.id === id)
      if (idx === -1) return s
      const source = s.shapes[idx]
      if (!source.mirror) return s
      // Circles + glyphs are out of scope: there's no clean "axis touches
      // boundary at point P" semantics for those kinds.
      if (source.kind === 'circle' || source.kind === 'glyphs') return s
      const axis = source.mirror.axis
      const onAxis = source.points.map(p => isPointOnAxis(p, axis))
      const onAxisCount = onAxis.filter(Boolean).length
      const reflected = source.points.map(p => reflectPoint(p, axis))

      let nextPoints: Point[]
      let nextClosed = source.closed
      if (source.closed) {
        // Polygon merge: need exactly two axis-touching vertices. The two
        // axis points split the polygon into two arcs; the one we keep is
        // the "outward" arc — the one with real interior vertices off the
        // axis. The other arc is what would collapse onto the axis line
        // (typically empty between adjacent axis points), so picking by
        // forward index alone fails when the user drew the polygon with
        // its body on the wrap-around side.
        if (onAxisCount !== 2) return s
        const indices = onAxis.map((b, k) => (b ? k : -1)).filter(k => k >= 0)
        const i = indices[0]
        const j = indices[1]
        const n = source.points.length
        const arcForward: Point[] = []
        for (let k = i; k <= j; k++) arcForward.push(source.points[k])
        const arcWrap: Point[] = []
        for (let k = j; k < n; k++) arcWrap.push(source.points[k])
        for (let k = 0; k <= i; k++) arcWrap.push(source.points[k])
        const interiorOffAxis = (arc: Point[]): number => {
          let c = 0
          for (let k = 1; k < arc.length - 1; k++) if (!isPointOnAxis(arc[k], axis)) c++
          return c
        }
        const useArc = interiorOffAxis(arcForward) >= interiorOffAxis(arcWrap) ? arcForward : arcWrap
        const tail: Point[] = []
        for (let k = useArc.length - 2; k > 0; k--) tail.push(reflectPoint(useArc[k], axis))
        nextPoints = [...useArc, ...tail]
      } else {
        // Line merge: at least one endpoint must be on the axis.
        const firstOn = onAxis[0]
        const lastOn = onAxis[onAxis.length - 1]
        if (!firstOn && !lastOn) return s
        if (firstOn && lastOn) {
          // Both endpoints on the axis → the merged shape topologically
          // closes into a polygon. Emit it that way.
          // Walk: source forward (P0..Pn), then mirror in reverse skipping
          // the duplicated endpoints (M(P_{n-1})..M(P_1)).
          nextPoints = [...source.points]
          for (let k = source.points.length - 2; k > 0; k--) nextPoints.push(reflected[k])
          nextClosed = true
        } else if (lastOn) {
          // Source ends on axis: source forward, then mirror in reverse from
          // the *second-to-last* (skip the duplicated axis point).
          nextPoints = [...source.points]
          for (let k = source.points.length - 2; k >= 0; k--) nextPoints.push(reflected[k])
        } else {
          // Source starts on axis: mirror from the end backwards (skip the
          // duplicated axis point at index 0), then the source forward.
          nextPoints = []
          for (let k = source.points.length - 1; k > 0; k--) nextPoints.push(reflected[k])
          nextPoints.push(...source.points)
        }
      }

      // Bake any group rotation/scale (pair-center pivot) into the merged
      // points so the resulting standalone shape stays at the same visual
      // pose. Without this it would jump to its own-bbox-pivoted transform.
      const rot = shapeRotation(source)
      const scl = shapeScale(source)
      let bakedPoints = nextPoints
      let bakedArc = source.arc
      if (rot !== 0 || scl !== 1) {
        const [cx, cy] = pairBBoxCenter(source)
        bakedPoints = transformPointsAround(nextPoints, rot, scl, cx, cy)
        if (rot !== 0 && source.arc)
          bakedArc = { ...source.arc, start: source.arc.start + rot, end: source.arc.end + rot }
      }

      const next = s.shapes.slice()
      next[idx] = {
        ...source,
        points: bakedPoints,
        closed: nextClosed,
        rotation: undefined,
        scale: undefined,
        mirror: undefined,
        // pointBezierOverrides indices no longer line up with the new point
        // list — drop them rather than try to rebuild a guess.
        pointBezierOverrides: undefined,
        ...(bakedArc ? { arc: bakedArc } : {}),
      }
      merged = true
      return {
        ...pushSnapshot(s),
        shapes: next,
        dirty: true,
      }
    })
    return merged
  },
  mergeShapes: (idA, idB) => {
    let merged = false
    set(s => {
      if (idA === idB) return s
      const idxA = s.shapes.findIndex(sh => sh.id === idA)
      const idxB = s.shapes.findIndex(sh => sh.id === idB)
      if (idxA === -1 || idxB === -1) return s
      const a = s.shapes[idxA]
      const b = s.shapes[idxB]
      // Same exclusions as mergeMirror — only path / polygon shapes have a
      // sensible "shared vertices" topology to stitch along.
      if (a.kind === 'circle' || a.kind === 'glyphs') return s
      if (b.kind === 'circle' || b.kind === 'glyphs') return s
      if (a.closed !== b.closed) return s
      // Live transforms (rotation/scale) make the shapes' rendered coords
      // diverge from `points`; coincidence has to be checked at the visual
      // positions. Bake any pending transform into the points first so the
      // merge operates on a single consistent coordinate space.
      const pointsOf = (sh: Shape): Point[] =>
        hasTransform(sh) ? sh.points.map(p => applyTransformToPoint(sh, p)) : sh.points
      const aPoints = pointsOf(a)
      const bPoints = pointsOf(b)

      let nextPoints: Point[] | null = null
      let nextClosed = a.closed
      if (a.closed) {
        // Polygon-to-polygon merge: need exactly two coincident vertex pairs
        // (the seam). The longer arc of each shape is the body we keep; we
        // splice them around the seam vertices, dropping the duplicates.
        const shared: { i: number; j: number }[] = []
        for (let i = 0; i < aPoints.length; i++) {
          for (let j = 0; j < bPoints.length; j++) {
            if (pointsClose(aPoints[i], bPoints[j])) {
              shared.push({ i, j })
              break
            }
          }
        }
        if (shared.length !== 2) return s
        // Both arcs span the seam from one shared vertex to the other, but
        // longerArc may return them in either direction. Normalize so arcA
        // runs v1 → A_interior → v2 and arcB runs v2 → B_interior → v1; that
        // way arcB walked forward continues straight from arcA's terminus,
        // and the polygon's implicit close edge lands back on v1. Without the
        // normalization, mismatched orientations splice in an interior reversed
        // and produce a crossed/twisted polygon.
        const v1 = aPoints[shared[0].i]
        const v2 = aPoints[shared[1].i]
        let arcA = longerArc(aPoints, shared[0].i, shared[1].i)
        let arcB = longerArc(bPoints, shared[0].j, shared[1].j)
        if (!pointsClose(arcA[0], v1)) arcA = arcA.toReversed()
        if (!pointsClose(arcB[0], v2)) arcB = arcB.toReversed()
        // arcB's leading v2 already sits at arcA's tail; arcB's trailing v1
        // is the polygon's first vertex (closes implicitly). Splice the
        // interior in arcB's natural forward order so every connecting edge
        // is an actual edge of B.
        const interiorB = arcB.slice(1, arcB.length - 1)
        nextPoints = [...arcA, ...interiorB]
      } else {
        // Polyline merge: need at least one endpoint of `a` to coincide with
        // an endpoint of `b`. We try the pairings in a fixed order; the first
        // match wins.
        const aStart = aPoints[0]
        const aEnd = aPoints[aPoints.length - 1]
        const bStart = bPoints[0]
        const bEnd = bPoints[bPoints.length - 1]
        if (pointsClose(aEnd, bStart)) {
          nextPoints = [...aPoints, ...bPoints.slice(1)]
        } else if (pointsClose(aStart, bEnd)) {
          nextPoints = [...bPoints, ...aPoints.slice(1)]
        } else if (pointsClose(aStart, bStart)) {
          nextPoints = [...aPoints.toReversed(), ...bPoints.slice(1)]
        } else if (pointsClose(aEnd, bEnd)) {
          const reversed = bPoints.toReversed()
          nextPoints = [...aPoints, ...reversed.slice(1)]
        } else {
          return s
        }
        // When both endpoint pairs coincide the join wraps around — drop the
        // duplicated final point and emit a closed polygon.
        if (nextPoints.length >= 3 && pointsClose(nextPoints[0], nextPoints[nextPoints.length - 1])) {
          nextPoints = nextPoints.slice(0, -1)
          nextClosed = true
        }
      }

      if (!nextPoints || nextPoints.length < 2) return s
      const next = s.shapes.slice()
      next[idxA] = {
        ...a,
        points: nextPoints,
        closed: nextClosed,
        // Baked the transform above (via pointsOf); reset both fields so the
        // merged shape stays at the same visual pose. Per-vertex bezier
        // overrides no longer line up with the new point list — drop them
        // rather than guess; same convention as mergeMirror.
        rotation: undefined,
        scale: undefined,
        pointBezierOverrides: undefined,
        // Mirror modifier on either source is meaningless after a merge —
        // there's no longer a clean axis relationship to preserve.
        mirror: undefined,
      }
      // Remove the second shape; preserve idxA's spot in the array (and group
      // membership) so the merged result keeps its z-order and group. We
      // wrote next[idxA] above before splicing, so when idxB < idxA the
      // merged element simply shifts up by one — both halves still drop the
      // intended shape.
      next.splice(idxB, 1)
      merged = true
      const removedSet = new Set([idB])
      return {
        ...pushSnapshot(s),
        shapes: next,
        selectedShapeIds: [idA],
        selectionAnchorId: idA,
        selectedVertices: s.selectedVertices.filter(v => !removedSet.has(v.shapeId)),
        dirty: true,
      }
    })
    return merged
  },
  addGroup: () => {
    const id = makeId()
    set(s => ({
      ...pushSnapshot(s),
      groups: [...s.groups, { id, name: defaultGroupName(s.groups) }],
      dirty: true,
    }))
    return id
  },
  removeGroup: id =>
    set(s => {
      if (!s.groups.some(g => g.id === id)) return s
      return {
        ...pushSnapshot(s),
        groups: s.groups.filter(g => g.id !== id),
        // Clear the membership pointer on every shape; we keep the shapes
        // themselves so removing a group never deletes user geometry.
        shapes: s.shapes.map(sh => (sh.groupId === id ? { ...sh, groupId: undefined } : sh)),
        dirty: true,
      }
    }),
  renameGroup: (id, name) =>
    set(s => {
      const trimmed = name.trim()
      if (!trimmed) return s
      const idx = s.groups.findIndex(g => g.id === id)
      if (idx === -1) return s
      if (s.groups[idx].name === trimmed) return s
      const groups = s.groups.slice()
      groups[idx] = { ...groups[idx], name: trimmed }
      return {
        ...pushSnapshot(s, `renameGroup:${id}`),
        groups,
        dirty: true,
      }
    }),
  setShapeGroup: (shapeId, groupId) =>
    set(s => {
      const fromIdx = s.shapes.findIndex(sh => sh.id === shapeId)
      if (fromIdx === -1) return s
      const shape = s.shapes[fromIdx]
      // No-op when nothing changes — don't pollute the undo stack.
      if (shape.groupId === groupId) return s
      // Reject unknown group ids so a stale ref can't sneak through; passing
      // undefined to ungroup is always allowed.
      if (groupId !== undefined && !s.groups.some(g => g.id === groupId)) return s
      // Reassign the membership pointer in place first.
      let nextShapes = s.shapes.map(sh => (sh.id === shapeId ? { ...sh, groupId } : sh))
      // Group members must stay contiguous in the array so the renderer can
      // wrap them in a single `<g>` and the layer panel can show them under
      // one header. When assigning to a group with existing members, slide
      // the shape next to them (keeps z-order stable for everyone else
      // because the splice is a single shift). When ungrouping or joining
      // an empty group, leave the position untouched.
      if (groupId !== undefined) {
        const lastMemberIdx = nextShapes.reduce((acc, sh, i) => (sh.groupId === groupId && i !== fromIdx ? i : acc), -1)
        if (lastMemberIdx !== -1) {
          const moved = nextShapes[fromIdx]
          nextShapes = nextShapes.slice()
          nextShapes.splice(fromIdx, 1)
          // The target index shifts left when fromIdx was earlier than it.
          const insertAt = lastMemberIdx > fromIdx ? lastMemberIdx : lastMemberIdx + 1
          nextShapes.splice(insertAt, 0, moved)
        }
      }
      return {
        ...pushSnapshot(s),
        shapes: nextShapes,
        dirty: true,
      }
    }),
  setGroupTransform: (groupId, patch) =>
    set(s => {
      if (!s.groups.some(g => g.id === groupId)) return s
      const cleaned: { rotation?: number; scale?: number } = {}
      if ('rotation' in patch) cleaned.rotation = patch.rotation === 0 ? undefined : patch.rotation
      if ('scale' in patch) cleaned.scale = patch.scale === 1 ? undefined : patch.scale
      return {
        // Coalesce so a slider drag is one undo entry, like updateMirrorAxis.
        ...pushSnapshot(s, `groupTransform:${groupId}:${Object.keys(cleaned).toSorted().join(',')}`),
        groups: s.groups.map(g => (g.id === groupId ? { ...g, ...cleaned } : g)),
        dirty: true,
      }
    }),
  applyGroupTransform: groupId =>
    set(s => {
      const group = s.groups.find(g => g.id === groupId)
      if (!group) return s
      const rot = group.rotation ?? 0
      const scl = group.scale ?? 1
      if (rot === 0 && scl === 1) return s
      const members = s.shapes.filter(sh => sh.groupId === groupId)
      if (members.length === 0) return s
      // Glyphs can't bake a rotation/scale into their path data (same caveat
      // as per-shape applyTransform), so refuse the bake outright rather than
      // leaving the group half-baked.
      if (members.some(sh => sh.kind === 'glyphs')) return s
      const [cx, cy] = groupBBoxCenter(members)
      // For each member, fold the group rotation/scale into its visible
      // position by transforming the member's already-instance-transformed
      // points around the group center, then resetting the member's own
      // transform back to identity so the bake is total. Arc angles in
      // canvas-frame degrees shift by the combined rotation; mirrors the
      // logic in applyTransform / ejectMirror for orientation continuity.
      const totalRotForArc = rot
      const nextShapes = s.shapes.map(sh => {
        if (sh.groupId !== groupId) return sh
        const transformedPoints = sh.points.map(p => applyTransformToPoint(sh, p))
        const baked = transformPointsAround(transformedPoints, rot, scl, cx, cy)
        const patch: Partial<Shape> = { points: baked, rotation: undefined, scale: undefined }
        if (sh.kind === 'circle' && sh.arc && totalRotForArc !== 0) {
          patch.arc = { ...sh.arc, start: sh.arc.start + totalRotForArc, end: sh.arc.end + totalRotForArc }
        }
        return { ...sh, ...patch }
      })
      return {
        ...pushSnapshot(s),
        shapes: nextShapes,
        groups: s.groups.map(g => (g.id === groupId ? { ...g, rotation: undefined, scale: undefined } : g)),
        dirty: true,
      }
    }),
  setGroupAnimation: (groupId, animation) =>
    set(s => {
      if (!s.groups.some(g => g.id === groupId)) return s
      return {
        ...pushSnapshot(s, `groupAnimation:${groupId}`),
        groups: s.groups.map(g => (g.id === groupId ? { ...g, animation } : g)),
        dirty: true,
      }
    }),
  selectGroup: groupId =>
    set(s => {
      const ids = s.shapes.filter(sh => sh.groupId === groupId).map(sh => sh.id)
      return {
        selectedShapeIds: ids,
        selectionAnchorId: ids.length ? ids[ids.length - 1] : null,
        selectedVertices: [],
      }
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
  setProject: (settings, shapes, groups) =>
    set(s => ({
      settings,
      shapes,
      // The parser supplies the authoritative group list (preserving names
      // and including empty groups). When older callers omit it we synthesize
      // entries from the shapes' groupIds so legacy files without explicit
      // group records still get usable defaults.
      groups: groups ?? synthesizeGroupsFromShapes(shapes),
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
      groups: [],
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
        groups: s.groups,
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
        groups: top.groups,
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
        groups: s.groups,
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
        groups: top.groups,
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
