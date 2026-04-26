import { useEffect, type RefObject } from 'react';
import { useStore } from '../store';
import { distancePoints, snapToAngle } from '../lib/snap';
import type { Point } from '../types';

const CLOSE_POLYGON_PX = 12;

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
      let snapped: Point = raw;
      if (state.drawing && state.drawing.points.length > 0 && !state.snapDisabled) {
        const last = state.drawing.points[state.drawing.points.length - 1];
        const r = snapToAngle(
          { x: last[0], y: last[1] },
          { x: raw[0], y: raw[1] },
          state.settings.snapAngles,
        );
        snapped = [r.x, r.y];
      }
      state.setCursor(snapped, raw);
      return { snapped, raw };
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.button === 1 || (e.button === 0 && useStore.getState().spaceHeld)) {
        e.preventDefault();
        const v = useStore.getState().view;
        panning = { startX: e.clientX, startY: e.clientY, viewX: v.x, viewY: v.y };
        svg.classList.add('panning');
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

      const { raw } = updateCursor(e.clientX, e.clientY);

      if (draggingVertex) {
        useStore.getState().moveVertex(draggingVertex.shapeId, draggingVertex.index, raw);
        return;
      }
      if (draggingShape) {
        const dx = raw[0] - draggingShape.startCursor[0];
        const dy = raw[1] - draggingShape.startCursor[1];
        useStore.getState().moveShape(
          draggingShape.shapeId,
          draggingShape.startPoints.map((p) => [p[0] + dx, p[1] + dy] as Point),
        );
      }
    };

    const onPointerUp = () => {
      if (panning) {
        panning = null;
        svg.classList.remove('panning');
      }
      draggingShape = null;
      draggingVertex = null;
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
      const rect = svg.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const v = useStore.getState().view;
      const cx = (mx - v.x) / v.scale;
      const cy = (my - v.y) / v.scale;
      const factor = Math.exp(-e.deltaY * 0.0015);
      const next = Math.max(0.05, Math.min(40, v.scale * factor));
      useStore.getState().setView({
        scale: next,
        x: mx - cx * next,
        y: my - cy * next,
      });
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
