import { afterEach, describe, expect, it } from 'vitest';
import { useStore } from './store';
import { DEFAULT_SETTINGS } from './lib/svg-io';

const reset = () => {
  // Replace the Zustand state without losing action references.
  useStore.setState({
    shapes: [],
    selectedShapeId: null,
    selectedVertex: null,
    tool: 'line',
    drawing: null,
    view: { x: 0, y: 0, scale: 1 },
    settings: { ...DEFAULT_SETTINGS },
    cursor: [0, 0],
    rawCursor: [0, 0],
    snapDisabled: false,
    spaceHeld: false,
    panning: false,
    fileName: 'untitled.svg',
    fileHandle: null,
    dirty: false,
    fitNonce: 0,
  });
};

afterEach(reset);

describe('store: commitDrawing', () => {
  // Regression: a polygon committed with only 2 points must NOT serialize as
  // closed (`Z`), otherwise the file ends up with a degenerate polygon that
  // collapses on re-render. Treat it as an open polyline instead.
  it('downgrades a 2-point polygon to an open line on Enter', () => {
    const { startDrawing, appendDrawingPoint, commitDrawing } = useStore.getState();
    startDrawing('polygon', [0, 0]);
    appendDrawingPoint([10, 10]);
    commitDrawing(true);

    const { shapes } = useStore.getState();
    expect(shapes).toHaveLength(1);
    expect(shapes[0].closed).toBe(false);
    expect(shapes[0].fill).toBe('none');
  });

  it('keeps a polygon closed when it has ≥ 3 points', () => {
    const s = useStore.getState();
    s.startDrawing('polygon', [0, 0]);
    s.appendDrawingPoint([10, 0]);
    s.appendDrawingPoint([5, 10]);
    s.commitDrawing(true);

    const shapes = useStore.getState().shapes;
    expect(shapes[0].closed).toBe(true);
    expect(shapes[0].fill).toBe('#000000');
  });

  it('drops a 1-point line silently rather than committing a degenerate shape', () => {
    const s = useStore.getState();
    s.startDrawing('line', [0, 0]);
    s.commitDrawing(false);
    expect(useStore.getState().shapes).toHaveLength(0);
    expect(useStore.getState().drawing).toBe(null);
  });
});

describe('store: deleteVertex', () => {
  // Removing the second-to-last vertex of an existing shape must delete the
  // whole shape (a single-point shape is meaningless), not leave a 1-point
  // ghost behind.
  it('deletes the shape entirely when only 2 vertices remain', () => {
    useStore.setState({
      shapes: [
        {
          id: 's1',
          points: [
            [0, 0],
            [10, 10],
          ],
          closed: false,
          fill: 'none',
          stroke: '#000',
          strokeWidth: 2,
          bezierOverride: null,
        },
      ],
      selectedShapeId: 's1',
      selectedVertex: { shapeId: 's1', index: 0 },
    });
    useStore.getState().deleteVertex('s1', 0);
    expect(useStore.getState().shapes).toEqual([]);
    expect(useStore.getState().selectedShapeId).toBe(null);
  });

  it('removes only the indexed vertex when 3+ remain', () => {
    useStore.setState({
      shapes: [
        {
          id: 's1',
          points: [
            [0, 0],
            [10, 0],
            [10, 10],
            [0, 10],
          ],
          closed: true,
          fill: '#000',
          stroke: 'none',
          strokeWidth: 2,
          bezierOverride: null,
        },
      ],
      selectedShapeId: 's1',
      selectedVertex: { shapeId: 's1', index: 1 },
    });
    useStore.getState().deleteVertex('s1', 1);
    const shape = useStore.getState().shapes[0];
    expect(shape.points).toEqual([
      [0, 0],
      [10, 10],
      [0, 10],
    ]);
    expect(useStore.getState().selectedVertex).toBe(null);
  });
});

describe('store: fit + project lifecycle', () => {
  it('bumps fitNonce on requestFit, setProject, and newProject', () => {
    const s = useStore.getState();
    const start = useStore.getState().fitNonce;
    s.requestFit();
    expect(useStore.getState().fitNonce).toBe(start + 1);
    s.newProject();
    expect(useStore.getState().fitNonce).toBe(start + 2);
    s.setProject({ ...DEFAULT_SETTINGS }, []);
    expect(useStore.getState().fitNonce).toBe(start + 3);
  });

  it('clears dirty on newProject and setProject', () => {
    const s = useStore.getState();
    s.markDirty();
    expect(useStore.getState().dirty).toBe(true);
    s.newProject();
    expect(useStore.getState().dirty).toBe(false);

    s.markDirty();
    s.setProject({ ...DEFAULT_SETTINGS }, []);
    expect(useStore.getState().dirty).toBe(false);
  });
});

describe('store: setTool cancels in-progress drawing', () => {
  // Switching to another tool while drawing is intentional cancellation —
  // confirm the in-progress drawing is dropped (no half-finished shape stuck
  // in state).
  it('clears `drawing` when the tool changes', () => {
    const s = useStore.getState();
    s.startDrawing('polygon', [0, 0]);
    s.appendDrawingPoint([10, 10]);
    expect(useStore.getState().drawing).not.toBe(null);
    s.setTool('select');
    expect(useStore.getState().drawing).toBe(null);
  });
});
