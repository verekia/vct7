import { useEffect, type RefObject } from 'react';
import { useStore, type AppState } from '../store';
import { applySnap, distancePoints, rayIntersections } from '../lib/snap';
import type { Point, Shape } from '../types';

const CLOSE_POLYGON_PX = 12;
/** Magnetic snap pull radius for discrete points (vertices, grid intersections). */
const POINT_SNAP_PX = 16;

interface DragShapeState {
  shapeId: string;
  startCursor: Point;
  startPoints: Point[];
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

export function useCanvasInteractions(svgRef: RefObject<SVGSVGElement | null>) {
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    let panning: PanState | null = null;
    let draggingShape: DragShapeState | null = null;
    let draggingVertex: DragVertexState | null = null;

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
            vertexTargets.push(...rayIntersections(pts[0], pts[pts.length - 1], state.settings.snapAngles));
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

      if (state.tool === 'line' || state.tool === 'polygon') {
        if (!state.drawing) {
          state.startDrawing(state.tool, snapped);
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
        state.selectShape(ref.shapeId);
        state.selectVertex({ shapeId: ref.shapeId, index: idx });
        draggingVertex = { shapeId: ref.shapeId, index: idx };
        state.setVertexDragging(true);
        return;
      }
      if (ref.shapeId) {
        state.selectShape(ref.shapeId);
        const shape = state.shapes.find((s) => s.id === ref.shapeId);
        if (shape) {
          draggingShape = {
            shapeId: shape.id,
            startCursor: state.rawCursor,
            startPoints: shape.points.map((p) => [p[0], p[1]] as Point),
          };
        }
        return;
      }
      state.selectShape(null);
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
      if (draggingShape) {
        const state = useStore.getState();
        const settings = state.settings;
        let dx = raw[0] - draggingShape.startCursor[0];
        let dy = raw[1] - draggingShape.startCursor[1];
        // Snap the *delta* to the grid so the shape preserves its original
        // sub-grid offset and just moves by whole grid steps.
        if (settings.gridSnap && !state.snapDisabled && settings.gridSize > 0) {
          dx = Math.round(dx / settings.gridSize) * settings.gridSize;
          dy = Math.round(dy / settings.gridSize) * settings.gridSize;
        }
        state.moveShape(
          draggingShape.shapeId,
          draggingShape.startPoints.map((p) => [p[0] + dx, p[1] + dy] as Point),
        );
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
      draggingShape = null;
      draggingVertex = null;
      // Drag is over → no anchors / no targets are computed in updateCursor,
      // so clear any leftover indicator immediately rather than waiting for
      // the next pointermove.
      useStore.getState().setSnapTarget(null);
    };

    const onDblClick = () => {
      const state = useStore.getState();
      if (!state.drawing) return;
      state.commitDrawing(state.drawing.type === 'polygon');
    };

    const onContextMenu = (e: MouseEvent) => {
      const state = useStore.getState();
      if (state.drawing) {
        e.preventDefault();
        state.commitDrawing(state.drawing.type === 'polygon');
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
