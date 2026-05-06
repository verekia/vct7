import { useEffect, type RefObject } from 'react'

import { applySnap, distancePoints, rayIntersections } from '../lib/snap'
import { applyTransformToPoint, hasTransform, visualBBox } from '../lib/transform'
import { useStore, type AppState } from '../store'

import type { Point, Shape } from '../types'

const CLOSE_POLYGON_PX = 12
/** Magnetic snap pull radius for discrete points (vertices, grid intersections). */
const POINT_SNAP_PX = 16
/**
 * Pixel radius the pointer must move before a "click + drag" pattern is
 * upgraded to a real drag. Smaller and incidental hand jitter triggers a
 * marquee or shape move; larger and the user feels the click "stick".
 */
const DRAG_THRESHOLD_PX = 3

interface DragShapesState {
  ids: string[]
  startCursor: Point
  startPoints: Map<string, Point[]>
}

interface DragVertexState {
  shapeId: string
  /** The vertex actually under the pointer — drives snap anchors / targets. */
  index: number
  /** Every selected vertex index in `shapeId`. Multi-drag translates them all by the same delta. */
  indices: number[]
  /** Frozen pre-drag positions keyed by vertex index. */
  startPoints: Map<number, Point>
  /** Pre-drag canvas cursor — delta is computed against this. */
  startCursor: Point
}

interface DragMirrorAxisState {
  shapeId: string
  /** `pos` translates the axis center; `rot` orbits the rotation handle around the center. */
  mode: 'pos' | 'rot'
  /** Pre-drag axis snapshot so the gesture coalesces into a single undo. */
  startAxisX: number
  startAxisY: number
  startAxisAngle: number
  /** Pre-drag canvas cursor (in the source's untransformed coord space). */
  startCursor: Point
}

interface PanState {
  startX: number
  startY: number
  viewX: number
  viewY: number
}

/**
 * Click-to-select that may upgrade into a marquee or a shape move once the
 * pointer travels past `DRAG_THRESHOLD_PX`. We need the deferred decision so
 * a plain click on an unselected shape selects it (no drag) while the same
 * gesture with movement starts a marquee per the user's spec.
 */
interface PendingSelectState {
  /** Shape under the pointer at mousedown, or null for empty canvas. */
  shapeId: string | null
  /** True iff the clicked shape is currently part of the selection. */
  hitSelected: boolean
  startScreenX: number
  startScreenY: number
  startCanvas: Point
  shift: boolean
  meta: boolean
  /** Alt/Option held — drag duplicates the shape(s) instead of moving them. */
  alt: boolean
  /** Once true, the pointer has moved past threshold and is committed to a drag. */
  becameDrag: boolean
}

const findShapeRef = (
  target: EventTarget | null,
): { shapeId?: string; vertexIndex?: string; mirrorHandle?: string } => {
  let node: Element | null = target as Element | null
  while (node && node !== document.body) {
    const ds = (node as HTMLElement).dataset
    if (ds && (ds.shapeId || ds.vertexIndex || ds.mirrorHandle)) {
      return { shapeId: ds.shapeId, vertexIndex: ds.vertexIndex, mirrorHandle: ds.mirrorHandle }
    }
    node = node.parentElement
  }
  return {}
}

const vertexAnchors = (shape: Shape, index: number): Point[] => {
  // Circle: center (index 0) is a translation handle — no neighbors to anchor
  // an angle ray to. The perimeter point (index 1) anchors to the center so
  // the user can axis-align the radius.
  if (shape.kind === 'circle') {
    return index === 1 && shape.points.length >= 1 ? [shape.points[0]] : []
  }
  const n = shape.points.length
  const anchors: Point[] = []
  if (index > 0) anchors.push(shape.points[index - 1])
  else if (shape.closed && n > 1) anchors.push(shape.points[n - 1])
  if (index < n - 1) anchors.push(shape.points[index + 1])
  else if (shape.closed && n > 1) anchors.push(shape.points[0])
  return anchors
}

/**
 * Collect every vertex the cursor is allowed to magnetically lock onto.
 *
 * Excluded: the vertex actively being dragged (would lock to itself), and the
 * drawing's last point during drawing (lets the user lay down consecutive
 * points without the cursor sticking to the one just placed). Included: every
 * other shape vertex, plus the in-progress drawing's earlier points so a new
 * point can join an existing line or close a polygon.
 */
const collectVertexTargets = (state: AppState, exclude: DragVertexState | null): Point[] => {
  const targets: Point[] = []
  // Exclude every vertex currently being moved (multi-drag): they're moving
  // alongside the cursor and would create false magnetic locks if included.
  const excludedIndices = exclude ? new Set(exclude.indices) : null
  for (const shape of state.shapes) {
    const transformed = hasTransform(shape)
    for (let i = 0; i < shape.points.length; i++) {
      if (exclude && exclude.shapeId === shape.id && excludedIndices!.has(i)) continue
      // Snap targets need to live where the user *sees* the vertex, so apply
      // the shape's rotation/scale before exposing them.
      targets.push(transformed ? applyTransformToPoint(shape, shape.points[i]) : shape.points[i])
    }
  }
  if (state.drawing) {
    const pts = state.drawing.points
    for (let i = 0; i < pts.length - 1; i++) targets.push(pts[i])
  }
  return targets
}

interface AABB {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

const shapeBBox = (shape: Shape): AABB | null => {
  if (shape.points.length === 0) return null
  // visualBBox applies the shape's rotation/scale + handles circle radius and
  // glyph local extents — keeps marquee selection honest for transformed shapes.
  const b = visualBBox(shape)
  return { minX: b.x, minY: b.y, maxX: b.x + b.w, maxY: b.y + b.h }
}

const intersects = (a: AABB, b: AABB): boolean =>
  !(a.maxX < b.minX || a.minX > b.maxX || a.maxY < b.minY || a.minY > b.maxY)

const shapesInBox = (shapes: Shape[], box: AABB): string[] => {
  const ids: string[] = []
  for (const s of shapes) {
    if (s.hidden || s.locked) continue
    const bb = shapeBBox(s)
    if (bb && intersects(bb, box)) ids.push(s.id)
  }
  return ids
}

const verticesInBox = (shape: Shape, box: AABB): number[] => {
  const out: number[] = []
  for (let i = 0; i < shape.points.length; i++) {
    const [x, y] = shape.points[i]
    if (x >= box.minX && x <= box.maxX && y >= box.minY && y <= box.maxY) out.push(i)
  }
  return out
}

export function useCanvasInteractions(svgRef: RefObject<SVGSVGElement | null>) {
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return

    let panning: PanState | null = null
    let draggingShapes: DragShapesState | null = null
    let draggingVertex: DragVertexState | null = null
    let draggingMirrorAxis: DragMirrorAxisState | null = null
    let pendingSelect: PendingSelectState | null = null
    /**
     * Active marquee. `shape` mode picks shapes (default — replaces / extends
     * the shape selection); `vertex` mode fires when one shape is selected and
     * picks vertex indices within it. Mode is decided at drag-upgrade time.
     */
    let marquee: { start: Point; mode: 'shape' } | { start: Point; mode: 'vertex'; shapeId: string } | null = null

    const screenToCanvas = (clientX: number, clientY: number): Point => {
      const rect = svg.getBoundingClientRect()
      const v = useStore.getState().view
      return [(clientX - rect.left - v.x) / v.scale, (clientY - rect.top - v.y) / v.scale]
    }

    const updateCursor = (clientX: number, clientY: number): { snapped: Point; raw: Point } => {
      const raw = screenToCanvas(clientX, clientY)
      const state = useStore.getState()
      let anchors: Point[] = []
      let vertexTargets: Point[] = []
      if (state.drawing && state.drawing.points.length > 0) {
        const pts = state.drawing.points
        anchors = [pts[pts.length - 1]]
        // For polygons, also anchor angle snaps to the first point so the user
        // can line up the closing edge with rays from the start vertex.
        if (state.drawing.type === 'polygon' && pts.length >= 2) {
          anchors.push(pts[0])
          if (state.settings.snapAngles.length > 0) {
            vertexTargets = collectVertexTargets(state, null)
            vertexTargets.push(...rayIntersections(pts[0], pts[pts.length - 1], state.settings.snapAngles))
          } else {
            vertexTargets = collectVertexTargets(state, null)
          }
        } else {
          vertexTargets = collectVertexTargets(state, null)
        }
      } else if (draggingVertex) {
        const shape = state.shapes.find(s => s.id === draggingVertex!.shapeId)
        if (shape) anchors = vertexAnchors(shape, draggingVertex.index)
        vertexTargets = collectVertexTargets(state, draggingVertex)
        // With two neighbors, every pair of dashed angle rays from each anchor
        // crosses at a point — make those crossings magnetic so the cursor
        // locks at the intersection the user is visually targeting.
        if (anchors.length === 2 && state.settings.snapAngles.length > 0) {
          vertexTargets.push(...rayIntersections(anchors[0], anchors[1], state.settings.snapAngles))
        }
      }
      const { snapped, snapPoint } = applySnap(raw, {
        anchors,
        vertexTargets,
        snapAngles: state.settings.snapAngles,
        gridSize: state.settings.gridSize,
        gridSnap: state.settings.gridSnap,
        pointThresholdCanvas: POINT_SNAP_PX / state.view.scale,
        snapDisabled: state.snapDisabled,
      })
      state.setCursor(snapped, raw)
      state.setSnapTarget(snapPoint)
      return { snapped, raw }
    }

    const onPointerDown = (e: PointerEvent) => {
      if (e.button === 1 || (e.button === 0 && useStore.getState().spaceHeld)) {
        e.preventDefault()
        const state = useStore.getState()
        panning = {
          startX: e.clientX,
          startY: e.clientY,
          viewX: state.view.x,
          viewY: state.view.y,
        }
        state.setPanning(true)
        return
      }
      if (e.button !== 0) return

      const { snapped } = updateCursor(e.clientX, e.clientY)
      const ref = findShapeRef(e.target)
      let state = useStore.getState()

      // Clicking a vertex handle of the selected shape always means "edit this
      // vertex" — even mid-drawing. Handles only render for the selected
      // shape, so a hit unambiguously expresses edit intent. Auto-switch to
      // select so the existing vertex-drag path runs as-is.
      if (ref.shapeId && ref.vertexIndex !== undefined && state.tool !== 'select') {
        state.setTool('select')
        state = useStore.getState()
      }

      if (state.tool === 'line' || state.tool === 'polygon' || state.tool === 'circle') {
        if (!state.drawing) {
          state.startDrawing(state.tool, snapped)
          return
        }
        // Circles take exactly two clicks: center, then a perimeter anchor.
        // The second click appends the perimeter point and commits.
        if (state.drawing.type === 'circle') {
          state.appendDrawingPoint(snapped)
          state.commitDrawing(true)
          return
        }
        // Should we close the polygon by clicking the first point?
        if (state.drawing.type === 'polygon' && state.drawing.points.length >= 3) {
          const first = state.drawing.points[0]
          const screenDist = distancePoints([first[0], first[1]], snapped) * state.view.scale
          if (screenDist <= CLOSE_POLYGON_PX) {
            state.commitDrawing(true)
            return
          }
        }
        state.appendDrawingPoint(snapped)
        return
      }

      // Select tool
      if (ref.shapeId && ref.mirrorHandle) {
        const target = state.shapes.find(sh => sh.id === ref.shapeId)
        if (target?.mirror && !hasTransform(target)) {
          draggingMirrorAxis = {
            shapeId: ref.shapeId,
            mode: ref.mirrorHandle === 'rot' ? 'rot' : 'pos',
            startAxisX: target.mirror.axis.x,
            startAxisY: target.mirror.axis.y,
            startAxisAngle: target.mirror.axis.angle,
            startCursor: snapped,
          }
          // Snapshot before the gesture so the whole drag collapses to one
          // undo. updateMirrorAxis already coalesces follow-up writes.
          state.pushHistory()
          return
        }
      }
      if (ref.shapeId && ref.vertexIndex !== undefined) {
        const idx = parseInt(ref.vertexIndex, 10)
        const shapeId = ref.shapeId
        const isShift = e.shiftKey
        const isMeta = e.metaKey || e.ctrlKey
        const alreadySelected = state.selectedVertices.some(v => v.shapeId === shapeId && v.index === idx)
        const ownerSelected = state.selectedShapeIds.length === 1 && state.selectedShapeIds[0] === shapeId
        // Decide vertex selection in three cases:
        //   - shift / meta: toggle vertex in / out, keep multi-select
        //   - clicking an unselected vertex without modifiers: replace with [v]
        //   - clicking an already-selected vertex without modifiers: keep the
        //     existing multi-selection so the drag translates the whole group
        if (isShift || isMeta) {
          state.toggleVertexSelection({ shapeId, index: idx })
        } else if (!alreadySelected || !ownerSelected) {
          state.selectVertex({ shapeId, index: idx })
        }
        // Re-read state because the actions above just mutated it.
        const nextState = useStore.getState()
        const indices = nextState.selectedVertices.filter(v => v.shapeId === shapeId).map(v => v.index)
        // No vertices selected after toggle (shift-clicked the last one off) →
        // nothing to drag. Skip pushing history / starting a drag.
        if (indices.length === 0) {
          return
        }
        const shape = nextState.shapes.find(sh => sh.id === shapeId)
        if (!shape) return
        const startPoints = new Map<number, Point>()
        for (const i of indices) startPoints.set(i, [shape.points[i][0], shape.points[i][1]])
        draggingVertex = {
          shapeId,
          index: idx,
          indices,
          startPoints,
          startCursor: snapped,
        }
        state.setVertexDragging(true)
        // Snapshot the pre-drag state so the whole drag collapses to one undo.
        // moveVertex / moveVertices don't push history themselves.
        state.pushHistory()
        return
      }

      // Defer the select / box-select decision until we see whether the user
      // moves the pointer. A plain click selects; movement upgrades to either
      // a marquee (clicked on empty canvas / unselected shape) or a multi-
      // shape move (clicked on a member of the current selection).
      pendingSelect = {
        shapeId: ref.shapeId ?? null,
        hitSelected: !!ref.shapeId && state.selectedShapeIds.includes(ref.shapeId),
        startScreenX: e.clientX,
        startScreenY: e.clientY,
        startCanvas: snapped,
        shift: e.shiftKey,
        meta: e.metaKey || e.ctrlKey,
        alt: e.altKey,
        becameDrag: false,
      }
    }

    const onPointerMove = (e: PointerEvent) => {
      if (panning) {
        const state = useStore.getState()
        state.setView({
          x: panning.viewX + (e.clientX - panning.startX),
          y: panning.viewY + (e.clientY - panning.startY),
        })
        return
      }

      const { snapped, raw } = updateCursor(e.clientX, e.clientY)

      if (draggingMirrorAxis) {
        const state = useStore.getState()
        if (draggingMirrorAxis.mode === 'pos') {
          // Translate axis by the cursor delta.
          const dx = raw[0] - draggingMirrorAxis.startCursor[0]
          const dy = raw[1] - draggingMirrorAxis.startCursor[1]
          state.updateMirrorAxis(draggingMirrorAxis.shapeId, {
            x: draggingMirrorAxis.startAxisX + dx,
            y: draggingMirrorAxis.startAxisY + dy,
          })
        } else {
          // Rotate axis: angle from center to cursor, in canvas degrees.
          const dx = raw[0] - draggingMirrorAxis.startAxisX
          const dy = raw[1] - draggingMirrorAxis.startAxisY
          const angle = (Math.atan2(dy, dx) * 180) / Math.PI
          state.updateMirrorAxis(draggingMirrorAxis.shapeId, { angle })
        }
        return
      }
      if (draggingVertex) {
        const state = useStore.getState()
        // Translate every selected vertex by the snapped delta. We snap the
        // *primary* vertex (the one under the pointer at drag start) and
        // shift the rest by the same vector so their relative arrangement is
        // preserved.
        const dx = snapped[0] - draggingVertex.startCursor[0]
        const dy = snapped[1] - draggingVertex.startCursor[1]
        if (draggingVertex.indices.length === 1) {
          // Single vertex: keep the original moveVertex path — it has special
          // circle-center logic (translates the whole shape) we want to retain.
          state.moveVertex(draggingVertex.shapeId, draggingVertex.index, snapped)
        } else {
          const items: { index: number; point: Point }[] = []
          for (const i of draggingVertex.indices) {
            const start = draggingVertex.startPoints.get(i)
            if (!start) continue
            items.push({ index: i, point: [start[0] + dx, start[1] + dy] })
          }
          state.moveVertices(draggingVertex.shapeId, items)
        }
        return
      }
      if (draggingShapes) {
        const state = useStore.getState()
        const settings = state.settings
        let dx = raw[0] - draggingShapes.startCursor[0]
        let dy = raw[1] - draggingShapes.startCursor[1]
        // Snap the *delta* to the grid so the shapes preserve their original
        // sub-grid offsets and just move by whole grid steps.
        if (settings.gridSnap && !state.snapDisabled && settings.gridSize > 0) {
          dx = Math.round(dx / settings.gridSize) * settings.gridSize
          dy = Math.round(dy / settings.gridSize) * settings.gridSize
        }
        const moves: { id: string; points: Point[] }[] = []
        for (const id of draggingShapes.ids) {
          const start = draggingShapes.startPoints.get(id)
          if (!start) continue
          moves.push({ id, points: start.map(p => [p[0] + dx, p[1] + dy] as Point) })
        }
        state.moveShapes(moves)
        return
      }
      if (marquee) {
        useStore.getState().setBoxSelect({ start: marquee.start, end: raw })
        return
      }

      // Pending click that may now be becoming a drag.
      if (pendingSelect && !pendingSelect.becameDrag) {
        const moved = Math.hypot(e.clientX - pendingSelect.startScreenX, e.clientY - pendingSelect.startScreenY)
        if (moved < DRAG_THRESHOLD_PX) return
        pendingSelect.becameDrag = true

        const state = useStore.getState()
        // Alt-drag duplicates the shape(s) and drags the duplicates so the
        // originals stay anchored. Hitting a selection-member duplicates the
        // whole selection; hitting a non-member duplicates just that shape so
        // the gesture matches the visible click target. duplicateShapes
        // already pushes a history snapshot — moveShapes won't push, so the
        // whole alt-drag collapses to one undo step.
        if (pendingSelect.alt && pendingSelect.shapeId) {
          const sourceIds = pendingSelect.hitSelected ? state.selectedShapeIds.slice() : [pendingSelect.shapeId]
          const newIds = state.duplicateShapes(sourceIds)
          if (newIds.length > 0) {
            const idSet = new Set(newIds)
            const startPoints = new Map<string, Point[]>()
            for (const sh of useStore.getState().shapes) {
              if (idSet.has(sh.id)) {
                startPoints.set(
                  sh.id,
                  sh.points.map(p => [p[0], p[1]] as Point),
                )
              }
            }
            draggingShapes = {
              ids: newIds,
              startCursor: pendingSelect.startCanvas,
              startPoints,
            }
            pendingSelect = null
            return
          }
        }
        if (pendingSelect.hitSelected && !pendingSelect.shift && !pendingSelect.meta) {
          // Drag-move the entire current selection together.
          const ids = state.selectedShapeIds.slice()
          const startPoints = new Map<string, Point[]>()
          for (const sh of state.shapes) {
            if (!ids.includes(sh.id)) continue
            startPoints.set(
              sh.id,
              sh.points.map(p => [p[0], p[1]] as Point),
            )
          }
          draggingShapes = {
            ids,
            startCursor: pendingSelect.startCanvas,
            startPoints,
          }
          // One undo entry for the whole translate gesture.
          state.pushHistory()
          pendingSelect = null
          return
        }

        // Otherwise upgrade to a marquee. With shift/meta, the marquee adds
        // to the existing selection rather than replacing it (handled at up).
        // When a single shape is already selected, the marquee picks vertices
        // of *that* shape instead of shapes — the user has expressed intent to
        // operate on one layer, so dragging on the canvas refines the
        // operation to the points of that layer. Glyph shapes are excluded
        // (their corner points are bbox-only, not user-editable vertices) —
        // marquee falls back to shape mode.
        const onlyShape =
          state.selectedShapeIds.length === 1 ? state.shapes.find(sh => sh.id === state.selectedShapeIds[0]) : null
        if (onlyShape && onlyShape.kind !== 'glyphs') {
          marquee = {
            start: pendingSelect.startCanvas,
            mode: 'vertex',
            shapeId: onlyShape.id,
          }
        } else {
          marquee = { start: pendingSelect.startCanvas, mode: 'shape' }
        }
        state.setBoxSelect({ start: pendingSelect.startCanvas, end: raw })
        return
      }
    }

    const onPointerUp = () => {
      if (panning) {
        panning = null
        useStore.getState().setPanning(false)
      }
      if (draggingVertex) {
        useStore.getState().setVertexDragging(false)
      }

      if (marquee) {
        const m = marquee
        const state = useStore.getState()
        const box = state.boxSelect
        if (box) {
          const aabb: AABB = {
            minX: Math.min(box.start[0], box.end[0]),
            minY: Math.min(box.start[1], box.end[1]),
            maxX: Math.max(box.start[0], box.end[0]),
            maxY: Math.max(box.start[1], box.end[1]),
          }
          const additive = pendingSelect?.shift || pendingSelect?.meta
          if (m.mode === 'vertex') {
            const shape = state.shapes.find(sh => sh.id === m.shapeId)
            if (shape) {
              const hit = verticesInBox(shape, aabb)
              const newOnes = hit.map(index => ({ shapeId: shape.id, index }))
              if (additive) {
                const seen = new Set(state.selectedVertices.filter(v => v.shapeId === shape.id).map(v => v.index))
                const merged = state.selectedVertices.slice()
                for (const v of newOnes) {
                  if (!seen.has(v.index)) {
                    merged.push(v)
                    seen.add(v.index)
                  }
                }
                state.selectVertices(merged)
              } else {
                state.selectVertices(newOnes)
              }
            }
          } else {
            const hit = shapesInBox(state.shapes, aabb)
            // Shift / meta extend the existing selection; without them, the
            // marquee replaces what was there.
            if (additive) {
              const set = new Set(state.selectedShapeIds)
              for (const id of hit) set.add(id)
              state.selectShapes(Array.from(set))
            } else {
              state.selectShapes(hit)
            }
          }
        }
        state.setBoxSelect(null)
        marquee = null
      } else if (pendingSelect && !pendingSelect.becameDrag) {
        // Pure click — apply selection now.
        const state = useStore.getState()
        if (pendingSelect.shapeId) {
          if (pendingSelect.shift) {
            state.selectShapeRange(pendingSelect.shapeId)
          } else if (pendingSelect.meta) {
            state.toggleShapeSelection(pendingSelect.shapeId)
          } else {
            state.selectShape(pendingSelect.shapeId)
          }
        } else if (!pendingSelect.shift && !pendingSelect.meta) {
          // Clicking empty canvas without a modifier clears the selection.
          state.selectShape(null)
        }
      }

      pendingSelect = null
      draggingShapes = null
      draggingVertex = null
      draggingMirrorAxis = null
      // Drag is over → no anchors / no targets are computed in updateCursor,
      // so clear any leftover indicator immediately rather than waiting for
      // the next pointermove.
      useStore.getState().setSnapTarget(null)
    }

    const onDblClick = () => {
      const state = useStore.getState()
      if (!state.drawing) return
      state.commitDrawing(state.drawing.type !== 'line')
    }

    const onContextMenu = (e: MouseEvent) => {
      const state = useStore.getState()
      if (state.drawing) {
        e.preventDefault()
        state.commitDrawing(state.drawing.type !== 'line')
      }
    }

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const v = useStore.getState().view
      if (e.ctrlKey || e.metaKey) {
        const rect = svg.getBoundingClientRect()
        const mx = e.clientX - rect.left
        const my = e.clientY - rect.top
        const cx = (mx - v.x) / v.scale
        const cy = (my - v.y) / v.scale
        const factor = Math.exp(-e.deltaY * 0.015)
        const next = Math.max(0.05, Math.min(40, v.scale * factor))
        useStore.getState().setView({
          scale: next,
          x: mx - cx * next,
          y: my - cy * next,
        })
      } else {
        useStore.getState().setView({
          scale: v.scale,
          x: v.x - e.deltaX,
          y: v.y - e.deltaY,
        })
      }
    }

    svg.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    svg.addEventListener('dblclick', onDblClick)
    svg.addEventListener('contextmenu', onContextMenu)
    svg.addEventListener('wheel', onWheel, { passive: false })

    return () => {
      svg.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      svg.removeEventListener('dblclick', onDblClick)
      svg.removeEventListener('contextmenu', onContextMenu)
      svg.removeEventListener('wheel', onWheel)
    }
  }, [svgRef])
}
