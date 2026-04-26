import { afterEach, describe, expect, it } from 'vitest';
import { useStore } from './store';
import { DEFAULT_SETTINGS } from './lib/svg-io';

const reset = () => {
  // Replace the Zustand state without losing action references.
  useStore.setState({
    shapes: [],
    selectedShapeIds: [],
    selectionAnchorId: null,
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
    vertexDragging: false,
    snapTarget: null,
    boxSelect: null,
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

  // Circle: 2 points (center + perimeter), always closed, marked with kind='circle'.
  it('commits a circle from center + perimeter as a closed kind=circle shape', () => {
    const s = useStore.getState();
    s.startDrawing('circle', [10, 10]);
    s.appendDrawingPoint([13, 14]); // radius = 5
    s.commitDrawing(true);

    const shapes = useStore.getState().shapes;
    expect(shapes).toHaveLength(1);
    expect(shapes[0].kind).toBe('circle');
    expect(shapes[0].closed).toBe(true);
    expect(shapes[0].points).toEqual([
      [10, 10],
      [13, 14],
    ]);
  });

  // A 1-point circle is meaningless; the commit should drop the in-progress
  // drawing rather than emit a zero-radius shape.
  it('drops a 1-point circle silently', () => {
    const s = useStore.getState();
    s.startDrawing('circle', [0, 0]);
    s.commitDrawing(true);
    expect(useStore.getState().shapes).toHaveLength(0);
    expect(useStore.getState().drawing).toBe(null);
  });
});

describe('store: moveVertex on circles', () => {
  // Dragging the center handle (index 0) of a circle must translate the whole
  // shape — the perimeter anchor moves with it so the radius is preserved.
  it('translates both points when the center is moved', () => {
    useStore.setState({
      shapes: [
        {
          id: 'c1',
          kind: 'circle',
          points: [
            [10, 10],
            [20, 10],
          ],
          closed: true,
          fill: '#000',
          stroke: 'none',
          strokeWidth: 1,
          bezierOverride: null,
          hidden: false,
          locked: false,
        },
      ],
    });
    useStore.getState().moveVertex('c1', 0, [50, 30]);
    expect(useStore.getState().shapes[0].points).toEqual([
      [50, 30],
      [60, 30],
    ]);
  });

  it('only changes the radius when the perimeter handle is moved', () => {
    useStore.setState({
      shapes: [
        {
          id: 'c1',
          kind: 'circle',
          points: [
            [10, 10],
            [20, 10],
          ],
          closed: true,
          fill: '#000',
          stroke: 'none',
          strokeWidth: 1,
          bezierOverride: null,
          hidden: false,
          locked: false,
        },
      ],
    });
    useStore.getState().moveVertex('c1', 1, [10, 25]);
    expect(useStore.getState().shapes[0].points).toEqual([
      [10, 10],
      [10, 25],
    ]);
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
          hidden: false,
          locked: false,
        },
      ],
      selectedShapeIds: ['s1'],
      selectedVertex: { shapeId: 's1', index: 0 },
    });
    useStore.getState().deleteVertex('s1', 0);
    expect(useStore.getState().shapes).toEqual([]);
    expect(useStore.getState().selectedShapeIds).toEqual([]);
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
          hidden: false,
          locked: false,
        },
      ],
      selectedShapeIds: ['s1'],
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

describe('store: layer ordering and toggles', () => {
  // Last shape in the array renders on top (later = higher z). The layer panel
  // is just a UI inversion of this; reorder operates on the array order.
  const seed = () =>
    useStore.setState({
      shapes: ['a', 'b', 'c', 'd'].map((id) => ({
        id,
        points: [
          [0, 0],
          [10, 10],
        ],
        closed: false,
        fill: 'none',
        stroke: '#000',
        strokeWidth: 1,
        bezierOverride: null,
        hidden: false,
        locked: false,
      })),
    });

  it('moves a shape forward in z-order', () => {
    seed();
    useStore.getState().reorderShape(0, 2);
    expect(useStore.getState().shapes.map((s) => s.id)).toEqual(['b', 'c', 'a', 'd']);
  });

  it('moves a shape back in z-order', () => {
    seed();
    useStore.getState().reorderShape(3, 1);
    expect(useStore.getState().shapes.map((s) => s.id)).toEqual(['a', 'd', 'b', 'c']);
  });

  it('is a no-op for from === to', () => {
    seed();
    const before = useStore.getState().shapes;
    useStore.getState().reorderShape(2, 2);
    expect(useStore.getState().shapes).toBe(before);
  });

  it('toggleShapeVisibility flips the hidden flag', () => {
    seed();
    useStore.getState().toggleShapeVisibility('b');
    expect(useStore.getState().shapes.find((s) => s.id === 'b')!.hidden).toBe(true);
    useStore.getState().toggleShapeVisibility('b');
    expect(useStore.getState().shapes.find((s) => s.id === 'b')!.hidden).toBe(false);
  });

  // Locking the active selection clears it so canvas interactions don't keep
  // operating on a now-uneditable target.
  it('toggleShapeLock clears selection when locking the selected shape', () => {
    seed();
    useStore.setState({
      selectedShapeIds: ['c'],
      selectionAnchorId: 'c',
      selectedVertex: { shapeId: 'c', index: 0 },
    });
    useStore.getState().toggleShapeLock('c');
    expect(useStore.getState().shapes.find((s) => s.id === 'c')!.locked).toBe(true);
    expect(useStore.getState().selectedShapeIds).toEqual([]);
    expect(useStore.getState().selectedVertex).toBe(null);
  });

  it('toggleShapeLock leaves selection alone when locking a different shape', () => {
    seed();
    useStore.setState({ selectedShapeIds: ['a'], selectionAnchorId: 'a' });
    useStore.getState().toggleShapeLock('c');
    expect(useStore.getState().selectedShapeIds).toEqual(['a']);
  });
});

describe('store: multi-selection', () => {
  const seed = () =>
    useStore.setState({
      shapes: ['a', 'b', 'c', 'd'].map((id) => ({
        id,
        points: [
          [0, 0],
          [10, 10],
        ],
        closed: false,
        fill: 'none',
        stroke: '#000',
        strokeWidth: 1,
        bezierOverride: null,
        hidden: false,
        locked: false,
      })),
    });

  it('selectShape replaces selection with [id] and updates anchor', () => {
    seed();
    useStore.getState().selectShape('b');
    expect(useStore.getState().selectedShapeIds).toEqual(['b']);
    expect(useStore.getState().selectionAnchorId).toBe('b');
    useStore.getState().selectShape(null);
    expect(useStore.getState().selectedShapeIds).toEqual([]);
    expect(useStore.getState().selectionAnchorId).toBe(null);
  });

  it('toggleShapeSelection adds and removes individual ids and pins anchor', () => {
    seed();
    useStore.getState().selectShape('a');
    useStore.getState().toggleShapeSelection('c');
    expect(useStore.getState().selectedShapeIds).toEqual(['a', 'c']);
    expect(useStore.getState().selectionAnchorId).toBe('c');
    useStore.getState().toggleShapeSelection('a');
    expect(useStore.getState().selectedShapeIds).toEqual(['c']);
    expect(useStore.getState().selectionAnchorId).toBe('a');
  });

  it('selectShapeRange spans from the anchor to the target by array index', () => {
    seed();
    useStore.getState().selectShape('a');
    useStore.getState().selectShapeRange('c');
    expect(useStore.getState().selectedShapeIds).toEqual(['a', 'b', 'c']);
    // Anchor is preserved on shift+click — successive ranges all extend from 'a'.
    expect(useStore.getState().selectionAnchorId).toBe('a');
    useStore.getState().selectShapeRange('d');
    expect(useStore.getState().selectedShapeIds).toEqual(['a', 'b', 'c', 'd']);
  });

  it('selectShapeRange falls back to single selection when no anchor exists', () => {
    seed();
    useStore.getState().selectShapeRange('c');
    expect(useStore.getState().selectedShapeIds).toEqual(['c']);
    expect(useStore.getState().selectionAnchorId).toBe('c');
  });

  it('deleteShapes removes shapes and trims selection', () => {
    seed();
    useStore.getState().selectShapes(['a', 'b', 'c']);
    useStore.getState().deleteShapes(['a', 'c']);
    expect(useStore.getState().shapes.map((s) => s.id)).toEqual(['b', 'd']);
    expect(useStore.getState().selectedShapeIds).toEqual(['b']);
  });

  it('moveShapes translates each given shape independently', () => {
    seed();
    useStore.getState().moveShapes([
      {
        id: 'a',
        points: [
          [5, 5],
          [15, 15],
        ],
      },
      {
        id: 'c',
        points: [
          [100, 100],
          [110, 110],
        ],
      },
    ]);
    const shapes = useStore.getState().shapes;
    expect(shapes.find((s) => s.id === 'a')!.points).toEqual([
      [5, 5],
      [15, 15],
    ]);
    expect(shapes.find((s) => s.id === 'c')!.points).toEqual([
      [100, 100],
      [110, 110],
    ]);
    // Untouched shapes stay where they were.
    expect(shapes.find((s) => s.id === 'b')!.points).toEqual([
      [0, 0],
      [10, 10],
    ]);
  });

  it('selectVertex collapses multi-selection to the vertex owner', () => {
    seed();
    useStore.getState().selectShapes(['a', 'b']);
    useStore.getState().selectVertex({ shapeId: 'b', index: 0 });
    expect(useStore.getState().selectedShapeIds).toEqual(['b']);
    expect(useStore.getState().selectedVertex).toEqual({ shapeId: 'b', index: 0 });
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
