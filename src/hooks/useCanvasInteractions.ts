import { useEffect, type RefObject } from 'react';
import { useStore, type AppState } from '../store';
import { applySnap, distancePoints, rayIntersections } from '../lib/snap';
import { dist } from '../lib/geometry';
import type { Point, Shape } from '../types';

const CLOSE_POLYGON_PX = 12;
/** Magnetic snap pull radius for discrete points (vertices, grid intersections). */
const POINT_SNAP_PX = 16;
/**
 * Pixel radius the pointer must move before a "click + drag" pattern is
 * upgraded to a real drag. Smaller and incidental hand jitter triggers a
 * marquee or shape move; larger and the user feels the click "stick".
 */
const DRAG_THRESHOLD_PX = 3;

interface DragShapesState {
  ids: string[];
  startCursor: Point;
  startPoints: Map<string, Point[]>;
}

interface DragVertexState {
  shapeId: string;
  index: number;
}

interface PanState {
  startX: number;
  startY: number;
  viewX: number;
  viewY: number;
}

/**
 * Click-to-select that may upgrade into a marquee or a shape move once the
 * pointer travels past `DRAG_THRESHOLD_PX`. We need the deferred decision so
 * a plain click on an unselected shape selects it (no drag) while the same
 * gesture with movement starts a marquee per the user's spec.
 */
interface PendingSelectState {
  /** Shape under the pointer at mousedown, or null for empty canvas. */
  shapeId: string | null;
  /** True iff the clicked shape is currently part of the selection. */
  hitSelected: boolean;
  startScreenX: number;
  startScreenY: number;
  startCanvas: Point;
  shift: boolean;
  meta: boolean;
  /** Once true, the pointer has moved past threshold and is committed to a drag. */
  becameDrag: boolean;
}

const findShapeRef = (target: EventTarget | null): { shapeId?: string; vertexIndex?: string } => {
  let node: Element | null = target as Element | null;
  while (node && node !== document.body) {
    const ds = (node as HTMLElement).dataset;
    if (ds && (ds.shapeId || ds.vertexIndex)) {
      return { shapeId: ds.shapeId, vertexIndex: ds.vertexIndex };
    }
    node = node.parentElement;
  }
  return {};
};

const vertexAnchors = (shape: Shape, index: number): Point[] => {
  // Circle: center (index 0) is a translation handle — no neighbors to anchor
  // an angle ray to. The perimeter point (index 1) anchors to the center so
  // the user can axis-align the radius.
  if (shape.kind === 'circle') {
    return index === 1 && shape.points.length >= 1 ? [shape.points[0]] : [];
  }
  const n = shape.points.length;
  const anchors: Point[] = [];
  if (index > 0) anchors.push(shape.points[index - 1]);
  else if (shape.closed && n > 1) anchors.push(shape.points[n - 1]);
  if (index < n - 1) anchors.push(shape.points[index + 1]);
  else if (shape.closed && n > 1) anchors.push(shape.points[0]);
  return anchors;
};

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
  const targets: Point[] = [];
  for (const shape of state.shapes) {
    for (let i = 0; i < shape.points.length; i++) {
      if (exclude && exclude.shapeId === shape.id && exclude.index === i) continue;
      targets.push(shape.points[i]);
    }
  }
  if (state.drawing) {
    const pts = state.drawing.points;
    for (let i = 0; i < pts.length - 1; i++) targets.push(pts[i]);
  }
  return targets;
};

interface AABB {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

const shapeBBox = (shape: Shape): AABB | null => {
  if (shape.kind === 'circle' && shape.points.length >= 2) {
    const [cx, cy] = shape.points[0];
    const r = dist(shape.points[0], shape.points[1]);
    return { minX: cx - r, minY: cy - r, maxX: cx + r, maxY: cy + r };
  }
  if (shape.points.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of shape.points) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
};

const intersects = (a: AABB, b: AABB): boolean =>
  !(a.maxX < b.minX || a.minX > b.maxX || a.maxY < b.minY || a.minY > b.maxY);

const shapesInBox = (shapes: Shape[], box: AABB): string[] => {
  const ids: string[] = [];
  for (const s of shapes) {
    if (s.hidden || s.locked) continue;
    const bb = shapeBBox(s);
    if (bb && intersects(bb, box)) ids.push(s.id);
  }
  return ids;
};

export function useCanvasInteractions(svgRef: RefObject<SVGSVGElement | null>) {
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    let panning: PanState | null = null;
    let draggingShapes: DragShapesState | null = null;
    let draggingVertex: DragVertexState | null = null;
    let pendingSelect: PendingSelectState | null = null;
    let marquee: { start: Point } | null = null;

    const screenToCanvas = (clientX: number, clientY: number): Point => {
      const rect = svg.getBoundingClientRect();
      const v = useStore.getState().view;
      return [(clientX - rect.left - v.x) / v.scale, (clientY - rect.top - v.y) / v.scale];
    };

    const updateCursor = (clientX: number, clientY: number): { snapped: Point; raw: Point } => {
      const raw = screenToCanvas(clientX, clientY);
      const state = useStore.getState();
      let anchors: Point[] = [];
      let vertexTargets: Point[] = [];
      if (state.drawing && state.drawing.points.length > 0) {
        const pts = state.drawing.points;
        anchors = [pts[pts.length - 1]];
        // For polygons, also anchor angle snaps to the first point so the user
        // can line up the closing edge with rays from the start vertex.
        if (state.drawing.type === 'polygon' && pts.length >= 2) {
          anchors.push(pts[0]);
          if (state.settings.snapAngles.length > 0) {
            vertexTargets = collectVertexTargets(state, null);
            vertexTargets.push(
              ...rayIntersections(pts[0], pts[pts.length - 1], state.settings.snapAngles),
            );
          } else {
            vertexTargets = collectVertexTargets(state, null);
          }
        } else {
          vertexTargets = collectVertexTargets(state, null);
        }
      } else if (draggingVertex) {
        const shape = state.shapes.find((s) => s.id === draggingVertex!.shapeId);
        if (shape) anchors = vertexAnchors(shape, draggingVertex.index);
        vertexTargets = collectVertexTargets(state, draggingVertex);
        // With two neighbors, every pair of dashed angle rays from each anchor
        // crosses at a point — make those crossings magnetic so the cursor
        // locks at the intersection the user is visually targeting.
        if (anchors.length === 2 && state.settings.snapAngles.length > 0) {
          vertexTargets.push(
            ...rayIntersections(anchors[0], anchors[1], state.settings.snapAngles),
          );
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
      });
      state.setCursor(snapped, raw);
      state.setSnapTarget(snapPoint);
      return { snapped, raw };
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.button === 1 || (e.button === 0 && useStore.getState().spaceHeld)) {
        e.preventDefault();
        const state = useStore.getState();
        panning = {
          startX: e.clientX,
          startY: e.clientY,
          viewX: state.view.x,
          viewY: state.view.y,
        };
        state.setPanning(true);
        return;
      }
      if (e.button !== 0) return;

      const { snapped } = updateCursor(e.clientX, e.clientY);
      const state = useStore.getState();

      if (state.tool === 'line' || state.tool === 'polygon' || state.tool === 'circle') {
        if (!state.drawing) {
          state.startDrawing(state.tool, snapped);
          return;
        }
        // Circles take exactly two clicks: center, then a perimeter anchor.
        // The second click appends the perimeter point and commits.
        if (state.drawing.type === 'circle') {
          state.appendDrawingPoint(snapped);
          state.commitDrawing(true);
          return;
        }
        // Should we close the polygon by clicking the first point?
        if (state.drawing.type === 'polygon' && state.drawing.points.length >= 3) {
          const first = state.drawing.points[0];
          const screenDist = distancePoints([first[0], first[1]], snapped) * state.view.scale;
          if (screenDist <= CLOSE_POLYGON_PX) {
            state.commitDrawing(true);
            return;
          }
        }
        state.appendDrawingPoint(snapped);
        return;
      }

      // Select tool
      const ref = findShapeRef(e.target);
      if (ref.shapeId && ref.vertexIndex !== undefined) {
        const idx = parseInt(ref.vertexIndex, 10);
        // Vertex editing is single-shape only — collapse multi-select to this one.
        state.selectShape(ref.shapeId);
        state.selectVertex({ shapeId: ref.shapeId, index: idx });
        draggingVertex = { shapeId: ref.shapeId, index: idx };
        state.setVertexDragging(true);
        // Snapshot the pre-drag state so the whole drag collapses to one undo.
        // moveVertex() itself doesn't push history.
        state.pushHistory();
        return;
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
        becameDrag: false,
      };
    };

    const onPointerMove = (e: PointerEvent) => {
      if (panning) {
        const state = useStore.getState();
        state.setView({
          x: panning.viewX + (e.clientX - panning.startX),
          y: panning.viewY + (e.clientY - panning.startY),
        });
        return;
      }

      const { snapped, raw } = updateCursor(e.clientX, e.clientY);

      if (draggingVertex) {
        useStore.getState().moveVertex(draggingVertex.shapeId, draggingVertex.index, snapped);
        return;
      }
      if (draggingShapes) {
        const state = useStore.getState();
        const settings = state.settings;
        let dx = raw[0] - draggingShapes.startCursor[0];
        let dy = raw[1] - draggingShapes.startCursor[1];
        // Snap the *delta* to the grid so the shapes preserve their original
        // sub-grid offsets and just move by whole grid steps.
        if (settings.gridSnap && !state.snapDisabled && settings.gridSize > 0) {
          dx = Math.round(dx / settings.gridSize) * settings.gridSize;
          dy = Math.round(dy / settings.gridSize) * settings.gridSize;
        }
        const moves: { id: string; points: Point[] }[] = [];
        for (const id of draggingShapes.ids) {
          const start = draggingShapes.startPoints.get(id);
          if (!start) continue;
          moves.push({ id, points: start.map((p) => [p[0] + dx, p[1] + dy] as Point) });
        }
        state.moveShapes(moves);
        return;
      }
      if (marquee) {
        useStore.getState().setBoxSelect({ start: marquee.start, end: raw });
        return;
      }

      // Pending click that may now be becoming a drag.
      if (pendingSelect && !pendingSelect.becameDrag) {
        const moved = Math.hypot(
          e.clientX - pendingSelect.startScreenX,
          e.clientY - pendingSelect.startScreenY,
        );
        if (moved < DRAG_THRESHOLD_PX) return;
        pendingSelect.becameDrag = true;

        const state = useStore.getState();
        if (pendingSelect.hitSelected && !pendingSelect.shift && !pendingSelect.meta) {
          // Drag-move the entire current selection together.
          const ids = state.selectedShapeIds.slice();
          const startPoints = new Map<string, Point[]>();
          for (const sh of state.shapes) {
            if (!ids.includes(sh.id)) continue;
            startPoints.set(
              sh.id,
              sh.points.map((p) => [p[0], p[1]] as Point),
            );
          }
          draggingShapes = {
            ids,
            startCursor: pendingSelect.startCanvas,
            startPoints,
          };
          // One undo entry for the whole translate gesture.
          state.pushHistory();
          pendingSelect = null;
          return;
        }

        // Otherwise upgrade to a marquee. With shift/meta, the marquee adds
        // to the existing selection rather than replacing it (handled at up).
        marquee = { start: pendingSelect.startCanvas };
        state.setBoxSelect({ start: pendingSelect.startCanvas, end: raw });
        return;
      }
    };

    const onPointerUp = () => {
      if (panning) {
        panning = null;
        useStore.getState().setPanning(false);
      }
      if (draggingVertex) {
        useStore.getState().setVertexDragging(false);
      }

      if (marquee) {
        const state = useStore.getState();
        const box = state.boxSelect;
        if (box) {
          const aabb: AABB = {
            minX: Math.min(box.start[0], box.end[0]),
            minY: Math.min(box.start[1], box.end[1]),
            maxX: Math.max(box.start[0], box.end[0]),
            maxY: Math.max(box.start[1], box.end[1]),
          };
          const hit = shapesInBox(state.shapes, aabb);
          // Shift / meta extend the existing selection; without them, the
          // marquee replaces what was there.
          const additive = pendingSelect?.shift || pendingSelect?.meta;
          if (additive) {
            const set = new Set(state.selectedShapeIds);
            for (const id of hit) set.add(id);
            state.selectShapes(Array.from(set));
          } else {
            state.selectShapes(hit);
          }
        }
        state.setBoxSelect(null);
        marquee = null;
      } else if (pendingSelect && !pendingSelect.becameDrag) {
        // Pure click — apply selection now.
        const state = useStore.getState();
        if (pendingSelect.shapeId) {
          if (pendingSelect.shift) {
            state.selectShapeRange(pendingSelect.shapeId);
          } else if (pendingSelect.meta) {
            state.toggleShapeSelection(pendingSelect.shapeId);
          } else {
            state.selectShape(pendingSelect.shapeId);
          }
        } else if (!pendingSelect.shift && !pendingSelect.meta) {
          // Clicking empty canvas without a modifier clears the selection.
          state.selectShape(null);
        }
      }

      pendingSelect = null;
      draggingShapes = null;
      draggingVertex = null;
      // Drag is over → no anchors / no targets are computed in updateCursor,
      // so clear any leftover indicator immediately rather than waiting for
      // the next pointermove.
      useStore.getState().setSnapTarget(null);
    };

    const onDblClick = () => {
      const state = useStore.getState();
      if (!state.drawing) return;
      state.commitDrawing(state.drawing.type !== 'line');
    };

    const onContextMenu = (e: MouseEvent) => {
      const state = useStore.getState();
      if (state.drawing) {
        e.preventDefault();
        state.commitDrawing(state.drawing.type !== 'line');
      }
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const v = useStore.getState().view;
      if (e.ctrlKey || e.metaKey) {
        const rect = svg.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const cx = (mx - v.x) / v.scale;
        const cy = (my - v.y) / v.scale;
        const factor = Math.exp(-e.deltaY * 0.015);
        const next = Math.max(0.05, Math.min(40, v.scale * factor));
        useStore.getState().setView({
          scale: next,
          x: mx - cx * next,
          y: my - cy * next,
        });
      } else {
        useStore.getState().setView({
          scale: v.scale,
          x: v.x - e.deltaX,
          y: v.y - e.deltaY,
        });
      }
    };

    svg.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    svg.addEventListener('dblclick', onDblClick);
    svg.addEventListener('contextmenu', onContextMenu);
    svg.addEventListener('wheel', onWheel, { passive: false });

    return () => {
      svg.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      svg.removeEventListener('dblclick', onDblClick);
      svg.removeEventListener('contextmenu', onContextMenu);
      svg.removeEventListener('wheel', onWheel);
    };
  }, [svgRef]);
}
