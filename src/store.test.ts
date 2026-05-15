import { afterEach, describe, expect, it } from 'bun:test'

import { DEFAULT_SETTINGS } from './lib/svg-io'
import { useStore } from './store'

const reset = () => {
  // Replace the Zustand state without losing action references.
  useStore.setState({
    shapes: [],
    groups: [],
    selectedShapeIds: [],
    selectionAnchorId: null,
    selectedVertices: [],
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
    past: [],
    future: [],
  })
}

afterEach(reset)

const edgeKey = (p: readonly [number, number], q: readonly [number, number]): string => {
  // Order-independent so an edge matches regardless of traversal direction.
  const a = `${p[0]},${p[1]}`
  const b = `${q[0]},${q[1]}`
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

const makeEdgeSet = (pts: readonly (readonly [number, number])[]): Set<string> => {
  const out = new Set<string>()
  for (let i = 0; i < pts.length; i++) {
    out.add(edgeKey(pts[i], pts[(i + 1) % pts.length]))
  }
  return out
}

describe('store: commitDrawing', () => {
  // Regression: a polygon committed with only 2 points must NOT serialize as
  // closed (`Z`), otherwise the file ends up with a degenerate polygon that
  // collapses on re-render. Treat it as an open polyline instead.
  it('downgrades a 2-point polygon to an open line on Enter', () => {
    const { startDrawing, appendDrawingPoint, commitDrawing } = useStore.getState()
    startDrawing('polygon', [0, 0])
    appendDrawingPoint([10, 10])
    commitDrawing(true)

    const { shapes } = useStore.getState()
    expect(shapes).toHaveLength(1)
    expect(shapes[0].closed).toBe(false)
    expect(shapes[0].fill).toBe('none')
  })

  it('keeps a polygon closed when it has ≥ 3 points', () => {
    const s = useStore.getState()
    s.startDrawing('polygon', [0, 0])
    s.appendDrawingPoint([10, 0])
    s.appendDrawingPoint([5, 10])
    s.commitDrawing(true)

    const shapes = useStore.getState().shapes
    expect(shapes[0].closed).toBe(true)
    expect(shapes[0].fill).toBe('#000000')
  })

  it('drops a 1-point line silently rather than committing a degenerate shape', () => {
    const s = useStore.getState()
    s.startDrawing('line', [0, 0])
    s.commitDrawing(false)
    expect(useStore.getState().shapes).toHaveLength(0)
    expect(useStore.getState().drawing).toBe(null)
  })

  // Circle: 2 points (center + perimeter), always closed, marked with kind='circle'.
  it('commits a circle from center + perimeter as a closed kind=circle shape', () => {
    const s = useStore.getState()
    s.startDrawing('circle', [10, 10])
    s.appendDrawingPoint([13, 14]) // radius = 5
    s.commitDrawing(true)

    const shapes = useStore.getState().shapes
    expect(shapes).toHaveLength(1)
    expect(shapes[0].kind).toBe('circle')
    expect(shapes[0].closed).toBe(true)
    expect(shapes[0].points).toEqual([
      [10, 10],
      [13, 14],
    ])
  })

  // A 1-point circle is meaningless; the commit should drop the in-progress
  // drawing rather than emit a zero-radius shape.
  it('drops a 1-point circle silently', () => {
    const s = useStore.getState()
    s.startDrawing('circle', [0, 0])
    s.commitDrawing(true)
    expect(useStore.getState().shapes).toHaveLength(0)
    expect(useStore.getState().drawing).toBe(null)
  })
})

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
    })
    useStore.getState().moveVertex('c1', 0, [50, 30])
    expect(useStore.getState().shapes[0].points).toEqual([
      [50, 30],
      [60, 30],
    ])
  })

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
    })
    useStore.getState().moveVertex('c1', 1, [10, 25])
    expect(useStore.getState().shapes[0].points).toEqual([
      [10, 10],
      [10, 25],
    ])
  })
})

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
      selectedVertices: [{ shapeId: 's1', index: 0 }],
    })
    useStore.getState().deleteVertex('s1', 0)
    expect(useStore.getState().shapes).toEqual([])
    expect(useStore.getState().selectedShapeIds).toEqual([])
  })

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
      selectedVertices: [{ shapeId: 's1', index: 1 }],
    })
    useStore.getState().deleteVertex('s1', 1)
    const shape = useStore.getState().shapes[0]
    expect(shape.points).toEqual([
      [0, 0],
      [10, 10],
      [0, 10],
    ])
    expect(useStore.getState().selectedVertices).toEqual([])
  })
})

describe('store: fit + project lifecycle', () => {
  it('bumps fitNonce on requestFit, setProject, and newProject', () => {
    const s = useStore.getState()
    const start = useStore.getState().fitNonce
    s.requestFit()
    expect(useStore.getState().fitNonce).toBe(start + 1)
    s.newProject()
    expect(useStore.getState().fitNonce).toBe(start + 2)
    s.setProject({ ...DEFAULT_SETTINGS }, [])
    expect(useStore.getState().fitNonce).toBe(start + 3)
  })

  it('clears dirty on newProject and setProject', () => {
    const s = useStore.getState()
    s.markDirty()
    expect(useStore.getState().dirty).toBe(true)
    s.newProject()
    expect(useStore.getState().dirty).toBe(false)

    s.markDirty()
    s.setProject({ ...DEFAULT_SETTINGS }, [])
    expect(useStore.getState().dirty).toBe(false)
  })
})

describe('store: layer ordering and toggles', () => {
  // Last shape in the array renders on top (later = higher z). The layer panel
  // is just a UI inversion of this; reorder operates on the array order.
  const seed = () =>
    useStore.setState({
      shapes: ['a', 'b', 'c', 'd'].map(id => ({
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
    })

  it('moves a shape forward in z-order', () => {
    seed()
    useStore.getState().reorderShape(0, 2)
    expect(useStore.getState().shapes.map(s => s.id)).toEqual(['b', 'c', 'a', 'd'])
  })

  it('moves a shape back in z-order', () => {
    seed()
    useStore.getState().reorderShape(3, 1)
    expect(useStore.getState().shapes.map(s => s.id)).toEqual(['a', 'd', 'b', 'c'])
  })

  it('is a no-op for from === to', () => {
    seed()
    const before = useStore.getState().shapes
    useStore.getState().reorderShape(2, 2)
    expect(useStore.getState().shapes).toBe(before)
  })

  it('toggleShapeVisibility flips the hidden flag', () => {
    seed()
    useStore.getState().toggleShapeVisibility('b')
    expect(useStore.getState().shapes.find(s => s.id === 'b')!.hidden).toBe(true)
    useStore.getState().toggleShapeVisibility('b')
    expect(useStore.getState().shapes.find(s => s.id === 'b')!.hidden).toBe(false)
  })

  // Locking the active selection clears it so canvas interactions don't keep
  // operating on a now-uneditable target.
  it('toggleShapeLock clears selection when locking the selected shape', () => {
    seed()
    useStore.setState({
      selectedShapeIds: ['c'],
      selectionAnchorId: 'c',
      selectedVertices: [{ shapeId: 'c', index: 0 }],
    })
    useStore.getState().toggleShapeLock('c')
    expect(useStore.getState().shapes.find(s => s.id === 'c')!.locked).toBe(true)
    expect(useStore.getState().selectedShapeIds).toEqual([])
    expect(useStore.getState().selectedVertices).toEqual([])
  })

  it('toggleShapeLock leaves selection alone when locking a different shape', () => {
    seed()
    useStore.setState({ selectedShapeIds: ['a'], selectionAnchorId: 'a' })
    useStore.getState().toggleShapeLock('c')
    expect(useStore.getState().selectedShapeIds).toEqual(['a'])
  })
})

describe('store: multi-selection', () => {
  const seed = () =>
    useStore.setState({
      shapes: ['a', 'b', 'c', 'd'].map(id => ({
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
    })

  it('selectShape replaces selection with [id] and updates anchor', () => {
    seed()
    useStore.getState().selectShape('b')
    expect(useStore.getState().selectedShapeIds).toEqual(['b'])
    expect(useStore.getState().selectionAnchorId).toBe('b')
    useStore.getState().selectShape(null)
    expect(useStore.getState().selectedShapeIds).toEqual([])
    expect(useStore.getState().selectionAnchorId).toBe(null)
  })

  it('toggleShapeSelection adds and removes individual ids and pins anchor', () => {
    seed()
    useStore.getState().selectShape('a')
    useStore.getState().toggleShapeSelection('c')
    expect(useStore.getState().selectedShapeIds).toEqual(['a', 'c'])
    expect(useStore.getState().selectionAnchorId).toBe('c')
    useStore.getState().toggleShapeSelection('a')
    expect(useStore.getState().selectedShapeIds).toEqual(['c'])
    expect(useStore.getState().selectionAnchorId).toBe('a')
  })

  it('selectShapeRange spans from the anchor to the target by array index', () => {
    seed()
    useStore.getState().selectShape('a')
    useStore.getState().selectShapeRange('c')
    expect(useStore.getState().selectedShapeIds).toEqual(['a', 'b', 'c'])
    // Anchor is preserved on shift+click — successive ranges all extend from 'a'.
    expect(useStore.getState().selectionAnchorId).toBe('a')
    useStore.getState().selectShapeRange('d')
    expect(useStore.getState().selectedShapeIds).toEqual(['a', 'b', 'c', 'd'])
  })

  it('selectShapeRange falls back to single selection when no anchor exists', () => {
    seed()
    useStore.getState().selectShapeRange('c')
    expect(useStore.getState().selectedShapeIds).toEqual(['c'])
    expect(useStore.getState().selectionAnchorId).toBe('c')
  })

  it('deleteShapes removes shapes and trims selection', () => {
    seed()
    useStore.getState().selectShapes(['a', 'b', 'c'])
    useStore.getState().deleteShapes(['a', 'c'])
    expect(useStore.getState().shapes.map(s => s.id)).toEqual(['b', 'd'])
    expect(useStore.getState().selectedShapeIds).toEqual(['b'])
  })

  it('moveShapes translates each given shape independently', () => {
    seed()
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
    ])
    const shapes = useStore.getState().shapes
    expect(shapes.find(s => s.id === 'a')!.points).toEqual([
      [5, 5],
      [15, 15],
    ])
    expect(shapes.find(s => s.id === 'c')!.points).toEqual([
      [100, 100],
      [110, 110],
    ])
    // Untouched shapes stay where they were.
    expect(shapes.find(s => s.id === 'b')!.points).toEqual([
      [0, 0],
      [10, 10],
    ])
  })

  it('selectVertex collapses multi-selection to the vertex owner', () => {
    seed()
    useStore.getState().selectShapes(['a', 'b'])
    useStore.getState().selectVertex({ shapeId: 'b', index: 0 })
    expect(useStore.getState().selectedShapeIds).toEqual(['b'])
    expect(useStore.getState().selectedVertices).toEqual([{ shapeId: 'b', index: 0 }])
  })

  it('selectVertices replaces vertex selection and forces single-shape owner', () => {
    seed()
    useStore.getState().selectShapes(['a', 'b'])
    useStore.getState().selectVertices([
      { shapeId: 'b', index: 0 },
      { shapeId: 'b', index: 1 },
    ])
    expect(useStore.getState().selectedShapeIds).toEqual(['b'])
    expect(useStore.getState().selectedVertices).toEqual([
      { shapeId: 'b', index: 0 },
      { shapeId: 'b', index: 1 },
    ])
  })

  it('toggleVertexSelection adds, removes, and rescopes to the vertex owner', () => {
    seed()
    useStore.getState().selectShape('a')
    useStore.getState().toggleVertexSelection({ shapeId: 'a', index: 0 })
    useStore.getState().toggleVertexSelection({ shapeId: 'a', index: 1 })
    expect(useStore.getState().selectedVertices).toEqual([
      { shapeId: 'a', index: 0 },
      { shapeId: 'a', index: 1 },
    ])
    useStore.getState().toggleVertexSelection({ shapeId: 'a', index: 0 })
    expect(useStore.getState().selectedVertices).toEqual([{ shapeId: 'a', index: 1 }])
    // Toggling a vertex on a different shape collapses to that single vertex.
    useStore.getState().toggleVertexSelection({ shapeId: 'b', index: 0 })
    expect(useStore.getState().selectedShapeIds).toEqual(['b'])
    expect(useStore.getState().selectedVertices).toEqual([{ shapeId: 'b', index: 0 }])
  })

  it('moveVertices translates a subset of a shape’s points in a single update', () => {
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
          strokeWidth: 1,
          bezierOverride: null,
          hidden: false,
          locked: false,
        },
      ],
    })
    useStore.getState().moveVertices('s1', [
      { index: 0, point: [5, 5] },
      { index: 2, point: [15, 15] },
    ])
    expect(useStore.getState().shapes[0].points).toEqual([
      [5, 5],
      [10, 0],
      [15, 15],
      [0, 10],
    ])
  })

  it('deleteVertices drops the listed indices and removes shapes that fall below 2 points', () => {
    useStore.setState({
      shapes: [
        {
          id: 'keep',
          points: [
            [0, 0],
            [10, 0],
            [10, 10],
            [0, 10],
          ],
          closed: true,
          fill: '#000',
          stroke: 'none',
          strokeWidth: 1,
          bezierOverride: null,
          hidden: false,
          locked: false,
        },
        {
          id: 'doomed',
          points: [
            [0, 0],
            [5, 5],
            [10, 10],
          ],
          closed: false,
          fill: 'none',
          stroke: '#000',
          strokeWidth: 1,
          bezierOverride: null,
          hidden: false,
          locked: false,
        },
      ],
      selectedShapeIds: ['keep', 'doomed'],
      selectionAnchorId: 'doomed',
      selectedVertices: [
        { shapeId: 'keep', index: 1 },
        { shapeId: 'doomed', index: 0 },
        { shapeId: 'doomed', index: 1 },
      ],
    })
    useStore.getState().deleteVertices([
      { shapeId: 'keep', index: 1 },
      { shapeId: 'doomed', index: 0 },
      { shapeId: 'doomed', index: 1 },
    ])
    const shapes = useStore.getState().shapes
    expect(shapes.map(s => s.id)).toEqual(['keep'])
    expect(shapes[0].points).toEqual([
      [0, 0],
      [10, 10],
      [0, 10],
    ])
    expect(useStore.getState().selectedShapeIds).toEqual(['keep'])
    expect(useStore.getState().selectionAnchorId).toBe(null)
    expect(useStore.getState().selectedVertices).toEqual([])
  })
})

describe('store: setTool cancels in-progress drawing', () => {
  // Switching to another tool while drawing is intentional cancellation —
  // confirm the in-progress drawing is dropped (no half-finished shape stuck
  // in state).
  it('clears `drawing` when the tool changes', () => {
    const s = useStore.getState()
    s.startDrawing('polygon', [0, 0])
    s.appendDrawingPoint([10, 10])
    expect(useStore.getState().drawing).not.toBe(null)
    s.setTool('select')
    expect(useStore.getState().drawing).toBe(null)
  })
})

describe('store: undo / redo', () => {
  const seed = () =>
    useStore.setState({
      shapes: ['a', 'b'].map(id => ({
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
    })

  it('undo restores shapes after delete; redo re-applies the delete', () => {
    seed()
    const before = useStore.getState().shapes
    useStore.getState().deleteShape('a')
    expect(useStore.getState().shapes.map(s => s.id)).toEqual(['b'])

    useStore.getState().undo()
    expect(useStore.getState().shapes).toEqual(before)

    useStore.getState().redo()
    expect(useStore.getState().shapes.map(s => s.id)).toEqual(['b'])
  })

  it('a new mutation after undo discards the redo stack', () => {
    seed()
    useStore.getState().deleteShape('a')
    useStore.getState().undo()
    expect(useStore.getState().future.length).toBe(1)

    useStore.getState().deleteShape('b')
    expect(useStore.getState().future.length).toBe(0)
    // Only one undo-able step remains: removing 'b'. Undoing it brings 'b'
    // back; the previously redoable delete-of-'a' is gone for good.
    useStore.getState().undo()
    expect(useStore.getState().shapes.map(s => s.id)).toEqual(['a', 'b'])
  })

  it('coalesces consecutive setSettings calls with the same patch shape into one entry', () => {
    seed()
    const s = useStore.getState()
    s.setSettings({ gridSize: 10 })
    s.setSettings({ gridSize: 20 })
    s.setSettings({ gridSize: 30 })
    // All three slider ticks collapse to a single undo step that returns to
    // the pre-drag value.
    expect(useStore.getState().past.length).toBe(1)
    useStore.getState().undo()
    expect(useStore.getState().settings.gridSize).toBe(DEFAULT_SETTINGS.gridSize)
  })

  it('coalesces updateShape calls with the same id and key set', () => {
    seed()
    const s = useStore.getState()
    s.updateShape('a', { fill: '#111' })
    s.updateShape('a', { fill: '#222' })
    s.updateShape('a', { fill: '#333' })
    expect(useStore.getState().past.length).toBe(1)
    useStore.getState().undo()
    expect(useStore.getState().shapes.find(sh => sh.id === 'a')!.fill).toBe('none')
  })

  it('does not coalesce updateShape across different shape ids', () => {
    seed()
    const s = useStore.getState()
    s.updateShape('a', { fill: '#111' })
    s.updateShape('b', { fill: '#222' })
    expect(useStore.getState().past.length).toBe(2)
  })

  it('move ops do not snapshot themselves; history must come from pushHistory()', () => {
    seed()
    const s = useStore.getState()
    s.moveShape('a', [
      [5, 5],
      [15, 15],
    ])
    s.moveShape('a', [
      [6, 6],
      [16, 16],
    ])
    // No auto-snapshot for continuous moves — undo would do nothing.
    expect(useStore.getState().past.length).toBe(0)

    // Simulate the pointerdown handler taking a single snapshot, then dragging.
    s.pushHistory()
    s.moveShape('a', [
      [100, 100],
      [110, 110],
    ])
    s.moveShape('a', [
      [200, 200],
      [210, 210],
    ])
    expect(useStore.getState().past.length).toBe(1)
    s.undo()
    // Undo returns to the state captured at pushHistory() — i.e. the second
    // moveShape result above ([6,6] / [16,16]).
    expect(useStore.getState().shapes.find(sh => sh.id === 'a')!.points).toEqual([
      [6, 6],
      [16, 16],
    ])
  })

  it('setProject clears past and future', () => {
    seed()
    useStore.getState().deleteShape('a')
    expect(useStore.getState().past.length).toBeGreaterThan(0)
    useStore.getState().setProject({ ...DEFAULT_SETTINGS }, [])
    expect(useStore.getState().past).toEqual([])
    expect(useStore.getState().future).toEqual([])
  })

  it('undo prunes selection to ids that exist in the restored state', () => {
    seed()
    const s = useStore.getState()
    // Create a third shape via commitDrawing and select it.
    s.startDrawing('line', [0, 0])
    s.appendDrawingPoint([5, 5])
    s.commitDrawing(false)
    const newId = useStore.getState().shapes[2].id
    s.selectShapes(['a', newId])
    expect(useStore.getState().selectedShapeIds).toEqual(['a', newId])

    s.undo() // Removes the new shape.
    // After undo, the new shape is gone — selection drops it but keeps 'a'.
    expect(useStore.getState().shapes.map(sh => sh.id)).toEqual(['a', 'b'])
    expect(useStore.getState().selectedShapeIds).toEqual(['a'])
  })

  it('undo / redo are no-ops when their stacks are empty', () => {
    seed()
    const before = useStore.getState()
    useStore.getState().undo()
    useStore.getState().redo()
    const after = useStore.getState()
    expect(after.shapes).toBe(before.shapes)
    expect(after.settings).toBe(before.settings)
    expect(after.past).toEqual([])
    expect(after.future).toEqual([])
  })
})

describe('store: applyBlending', () => {
  // Bake a multiply-blend layer atop a red backdrop into a static fill so the
  // exported SVG renders identically in viewers that ignore mix-blend-mode.
  it('bakes the blend mode into the fill and clears blendMode', () => {
    useStore.setState({
      shapes: [
        {
          id: 'bg',
          points: [
            [0, 0],
            [10, 10],
          ],
          closed: true,
          fill: '#ff0000',
          stroke: 'none',
          strokeWidth: 1,
          bezierOverride: null,
          hidden: false,
          locked: false,
        },
        {
          id: 'top',
          points: [
            [2, 2],
            [8, 8],
          ],
          closed: true,
          fill: '#808080',
          stroke: 'none',
          strokeWidth: 1,
          bezierOverride: null,
          hidden: false,
          locked: false,
          blendMode: 'multiply',
        },
      ],
    })
    useStore.getState().applyBlending(['top'])
    const top = useStore.getState().shapes.find(s => s.id === 'top')!
    expect(top.blendMode).toBeUndefined()
    // 0x80/255 ≈ 0.502, multiply with red (1,0,0) → (~0.502, 0, 0) → #800000.
    expect(top.fill).toBe('#800000')
  })

  it('is a no-op for shapes with no blend mode', () => {
    useStore.setState({
      shapes: [
        {
          id: 'a',
          points: [
            [0, 0],
            [10, 10],
          ],
          closed: true,
          fill: '#123456',
          stroke: 'none',
          strokeWidth: 1,
          bezierOverride: null,
          hidden: false,
          locked: false,
        },
      ],
    })
    const before = useStore.getState().shapes
    useStore.getState().applyBlending(['a'])
    expect(useStore.getState().shapes).toBe(before)
    expect(useStore.getState().past).toEqual([])
  })
})

describe('store: applyOpacity', () => {
  // Bake α=0.5 white over red into the static fill so the SVG has no opacity
  // attribute and renders identically. mix(red, white, 0.5) = (1, 0.5, 0.5).
  it('alpha-composites the fill against the layer below and clears opacity', () => {
    useStore.setState({
      shapes: [
        {
          id: 'bg',
          points: [
            [0, 0],
            [10, 10],
          ],
          closed: true,
          fill: '#ff0000',
          stroke: 'none',
          strokeWidth: 1,
          bezierOverride: null,
          hidden: false,
          locked: false,
        },
        {
          id: 'top',
          points: [
            [2, 2],
            [8, 8],
          ],
          closed: true,
          fill: '#ffffff',
          stroke: 'none',
          strokeWidth: 1,
          bezierOverride: null,
          hidden: false,
          locked: false,
          opacity: 0.5,
        },
      ],
    })
    useStore.getState().applyOpacity(['top'])
    const top = useStore.getState().shapes.find(s => s.id === 'top')!
    expect(top.opacity).toBeUndefined()
    // 0.5*1 + 0.5*1 = 1 (R), 0.5*1 + 0.5*0 = 0.5 (G/B) → #ff8080.
    expect(top.fill).toBe('#ff8080')
  })

  it('is a no-op when opacity is undefined or 1', () => {
    useStore.setState({
      shapes: [
        {
          id: 'a',
          points: [
            [0, 0],
            [10, 10],
          ],
          closed: true,
          fill: '#123456',
          stroke: 'none',
          strokeWidth: 1,
          bezierOverride: null,
          hidden: false,
          locked: false,
        },
      ],
    })
    const before = useStore.getState().shapes
    useStore.getState().applyOpacity(['a'])
    expect(useStore.getState().shapes).toBe(before)
    expect(useStore.getState().past).toEqual([])
  })
})

describe('store: live mirror', () => {
  const seed = () =>
    useStore.setState({
      shapes: [
        {
          id: 'a',
          points: [
            [0, 0],
            [10, 0],
            [10, 10],
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
    })

  it('enableMirror "horizontal" sets a vertical axis (angle 90°) through the canvas center', () => {
    seed()
    useStore.getState().enableMirror('a', 'horizontal')
    const sh = useStore.getState().shapes[0]
    const settings = useStore.getState().settings
    expect(sh.mirror).toBeDefined()
    expect(sh.mirror?.axis.angle).toBe(90)
    expect(sh.mirror?.axis.x).toBeCloseTo(settings.viewBoxX + settings.viewBoxWidth / 2)
    expect(sh.mirror?.axis.y).toBeCloseTo(settings.viewBoxY + settings.viewBoxHeight / 2)
  })

  it('enableMirror "vertical" sets a horizontal axis (angle 0°) through the canvas center', () => {
    seed()
    useStore.getState().enableMirror('a', 'vertical')
    const sh = useStore.getState().shapes[0]
    const settings = useStore.getState().settings
    expect(sh.mirror?.axis.angle).toBe(0)
    expect(sh.mirror?.axis.x).toBeCloseTo(settings.viewBoxX + settings.viewBoxWidth / 2)
    expect(sh.mirror?.axis.y).toBeCloseTo(settings.viewBoxY + settings.viewBoxHeight / 2)
  })

  it('enableMirror is a no-op on glyph shapes (matches flipShapes guard)', () => {
    useStore.setState({
      shapes: [
        {
          id: 'g',
          kind: 'glyphs',
          points: [
            [0, 0],
            [50, 50],
          ],
          closed: true,
          fill: '#000',
          stroke: 'none',
          strokeWidth: 0,
          bezierOverride: null,
          hidden: false,
          locked: false,
          glyphs: { d: 'M0 0', text: 'X', fontFamily: 'serif', fontSize: 50, width: 50, height: 50 },
        },
      ],
    })
    useStore.getState().enableMirror('g', 'horizontal')
    expect(useStore.getState().shapes[0].mirror).toBeUndefined()
  })

  it('updateMirrorAxis patches axis fields and coalesces drags', () => {
    seed()
    useStore.getState().enableMirror('a', 'horizontal')
    const before = useStore.getState().past.length
    useStore.getState().updateMirrorAxis('a', { angle: 45 })
    useStore.getState().updateMirrorAxis('a', { angle: 60 })
    useStore.getState().updateMirrorAxis('a', { x: 0 })
    const sh = useStore.getState().shapes[0]
    expect(sh.mirror?.axis.angle).toBe(60)
    expect(sh.mirror?.axis.x).toBe(0)
    // Coalesced: all three writes share one history entry on top of enableMirror's.
    expect(useStore.getState().past.length).toBe(before + 1)
  })

  it('toggleMirrorAxisVisibility flips the showAxis flag', () => {
    seed()
    useStore.getState().enableMirror('a', 'horizontal')
    expect(useStore.getState().shapes[0].mirror?.showAxis).toBeUndefined()
    useStore.getState().toggleMirrorAxisVisibility('a')
    expect(useStore.getState().shapes[0].mirror?.showAxis).toBe(true)
    useStore.getState().toggleMirrorAxisVisibility('a')
    expect(useStore.getState().shapes[0].mirror?.showAxis).toBeUndefined()
  })

  it('disableMirror removes the modifier without baking', () => {
    seed()
    useStore.getState().enableMirror('a', 'horizontal')
    useStore.getState().disableMirror('a')
    expect(useStore.getState().shapes).toHaveLength(1)
    expect(useStore.getState().shapes[0].mirror).toBeUndefined()
  })

  it('convertMirrorToGroup inserts a baked sibling and groups both halves', () => {
    seed()
    useStore.getState().enableMirror('a', 'horizontal')
    // Move axis to x=20 so the reflection lands at x ∈ [30..40].
    useStore.getState().updateMirrorAxis('a', { x: 20, angle: 90 })
    const groupId = useStore.getState().convertMirrorToGroup('a')!
    const state = useStore.getState()
    expect(state.shapes).toHaveLength(2)
    expect(state.shapes[0].id).toBe('a')
    expect(state.shapes[0].mirror).toBeUndefined()
    expect(state.shapes[0].groupId).toBe(groupId)
    expect(state.shapes[1].groupId).toBe(groupId)
    expect(state.groups.some(g => g.id === groupId)).toBe(true)
    // Source point (10, 0) reflects across vertical line at x=20 → (30, 0).
    expect(state.shapes[1].points[1][0]).toBeCloseTo(30)
    expect(state.shapes[1].points[1][1]).toBeCloseTo(0)
  })

  it('convertMirrorToGroup bakes the group rotation into both halves', () => {
    seed()
    useStore.getState().enableMirror('a', 'horizontal')
    useStore.getState().updateShape('a', { rotation: 90 })
    const groupId = useStore.getState().convertMirrorToGroup('a')!
    const shapes = useStore.getState().shapes
    expect(shapes.every(sh => sh.groupId === groupId)).toBe(true)
    expect(shapes.every(sh => sh.rotation === undefined)).toBe(true)
  })

  it('convertMirrorToGroup is a no-op when mirror is not set', () => {
    seed()
    expect(useStore.getState().convertMirrorToGroup('a')).toBeNull()
    expect(useStore.getState().shapes).toHaveLength(1)
    expect(useStore.getState().groups).toHaveLength(0)
  })

  const expectPointsClose = (actual: readonly (readonly [number, number])[], expected: number[][]) => {
    expect(actual).toHaveLength(expected.length)
    for (let i = 0; i < expected.length; i++) {
      expect(actual[i][0]).toBeCloseTo(expected[i][0])
      expect(actual[i][1]).toBeCloseTo(expected[i][1])
    }
  }

  it('mergeMirror stitches a line whose last point sits on the axis', () => {
    // Source line: (0,0) → (5,0) → (10,0). Mirror across vertical line x=10.
    useStore.setState({
      shapes: [
        {
          id: 'a',
          points: [
            [0, 0],
            [5, 0],
            [10, 0],
          ],
          closed: false,
          fill: 'none',
          stroke: '#000',
          strokeWidth: 1,
          bezierOverride: null,
          hidden: false,
          locked: false,
          mirror: { axis: { x: 10, y: 0, angle: 90 } },
        },
      ],
    })
    expect(useStore.getState().mergeMirror('a')).toBe(true)
    const shapes = useStore.getState().shapes
    expect(shapes).toHaveLength(1)
    expect(shapes[0].mirror).toBeUndefined()
    expect(shapes[0].closed).toBe(false)
    // Walk: source forward (0,0), (5,0), (10,0), then mirror in reverse from
    // (5,0)' = (15,0) and (0,0)' = (20,0). The duplicated axis point at (10,0)
    // appears once.
    expectPointsClose(shapes[0].points as readonly (readonly [number, number])[], [
      [0, 0],
      [5, 0],
      [10, 0],
      [15, 0],
      [20, 0],
    ])
  })

  it('mergeMirror promotes a both-endpoints-on-axis line to a closed polygon', () => {
    useStore.setState({
      shapes: [
        {
          id: 'a',
          points: [
            [0, 0],
            [5, 5],
            [0, 10],
          ],
          closed: false,
          fill: 'none',
          stroke: '#000',
          strokeWidth: 1,
          bezierOverride: null,
          hidden: false,
          locked: false,
          mirror: { axis: { x: 0, y: 0, angle: 0 } }, // horizontal axis through origin
        },
      ],
    })
    // Both (0,0) and (0,10) lie on the horizontal axis y=0? No — wait:
    // Axis at angle 0° through (0,0) is the x-axis (line y=0). Point (0,0)
    // is on it; (0,10) is not. Switch to a vertical axis (90°) at x=0 so
    // both endpoints (0,0) and (0,10) qualify.
    useStore.getState().updateMirrorAxis('a', { angle: 90 })
    expect(useStore.getState().mergeMirror('a')).toBe(true)
    const shape = useStore.getState().shapes[0]
    expect(shape.closed).toBe(true)
    expectPointsClose(shape.points as readonly (readonly [number, number])[], [
      [0, 0],
      [5, 5],
      [0, 10],
      [-5, 5],
    ])
  })

  it('mergeMirror combines a polygon along two axis-touching vertices', () => {
    // D-shape: source has 5 points, indices 0 and 4 on the axis (x=0).
    useStore.setState({
      shapes: [
        {
          id: 'a',
          points: [
            [0, 0],
            [1, 0],
            [2, 1],
            [1, 2],
            [0, 2],
          ],
          closed: true,
          fill: '#000',
          stroke: 'none',
          strokeWidth: 1,
          bezierOverride: null,
          hidden: false,
          locked: false,
          mirror: { axis: { x: 0, y: 0, angle: 90 } },
        },
      ],
    })
    expect(useStore.getState().mergeMirror('a')).toBe(true)
    const shape = useStore.getState().shapes[0]
    expect(shape.closed).toBe(true)
    expect(shape.mirror).toBeUndefined()
    expectPointsClose(shape.points as readonly (readonly [number, number])[], [
      [0, 0],
      [1, 0],
      [2, 1],
      [1, 2],
      [0, 2],
      [-1, 2],
      [-2, 1],
      [-1, 0],
    ])
  })

  it('mergeMirror picks the off-axis arc when the polygon was drawn winding the other way', () => {
    // Same D-shape geometry as the previous test, but the user drew it
    // starting from the body and ending on the axis pair — so the two axis
    // vertices are at indices 4 and 0 (adjacent in the wrap), and the
    // forward arc 0..4 is the empty/degenerate one. The merge must still
    // pick the wrap-around arc with the real content rather than collapse.
    useStore.setState({
      shapes: [
        {
          id: 'a',
          points: [
            [0, 2], // index 0 — on axis
            [-1, 2],
            [-2, 1],
            [-1, 0],
            [0, 0], // index 4 — on axis
          ],
          closed: true,
          fill: '#000',
          stroke: 'none',
          strokeWidth: 1,
          bezierOverride: null,
          hidden: false,
          locked: false,
          mirror: { axis: { x: 0, y: 0, angle: 90 } },
        },
      ],
    })
    expect(useStore.getState().mergeMirror('a')).toBe(true)
    const shape = useStore.getState().shapes[0]
    expect(shape.points.length).toBeGreaterThan(2)
    // Body vertices were on negative-x; their reflection adds positive-x
    // vertices. After merge we expect both sides represented.
    const xs = shape.points.map(p => p[0])
    expect(xs.some(x => x > 0)).toBe(true)
    expect(xs.some(x => x < 0)).toBe(true)
  })

  it('mergeMirror is a no-op when topology does not qualify', () => {
    useStore.setState({
      shapes: [
        {
          id: 'a',
          points: [
            [5, 0],
            [10, 0],
          ],
          closed: false,
          fill: 'none',
          stroke: '#000',
          strokeWidth: 1,
          bezierOverride: null,
          hidden: false,
          locked: false,
          mirror: { axis: { x: 100, y: 0, angle: 90 } }, // axis far away — no endpoint touches
        },
      ],
    })
    expect(useStore.getState().mergeMirror('a')).toBe(false)
    expect(useStore.getState().shapes[0].mirror).toBeDefined()
  })
})

describe('store: mergeShapes', () => {
  it('stitches two open lines that share an endpoint into a single polyline', () => {
    useStore.setState({
      shapes: [
        {
          id: 'a',
          points: [
            [0, 0],
            [10, 0],
            [10, 10],
          ],
          closed: false,
          fill: 'none',
          stroke: '#000',
          strokeWidth: 1,
          bezierOverride: null,
          hidden: false,
          locked: false,
        },
        {
          id: 'b',
          points: [
            [10, 10],
            [20, 10],
            [20, 0],
          ],
          closed: false,
          fill: 'none',
          stroke: '#000',
          strokeWidth: 1,
          bezierOverride: null,
          hidden: false,
          locked: false,
        },
      ],
    })
    expect(useStore.getState().mergeShapes('a', 'b')).toBe(true)
    const shapes = useStore.getState().shapes
    expect(shapes).toHaveLength(1)
    expect(shapes[0].id).toBe('a')
    expect(shapes[0].closed).toBe(false)
    expect(shapes[0].points).toEqual([
      [0, 0],
      [10, 0],
      [10, 10],
      [20, 10],
      [20, 0],
    ])
    expect(useStore.getState().selectedShapeIds).toEqual(['a'])
  })

  it('closes into a polygon when both endpoints of two lines coincide', () => {
    useStore.setState({
      shapes: [
        {
          id: 'a',
          points: [
            [0, 0],
            [10, 0],
            [10, 10],
          ],
          closed: false,
          fill: 'none',
          stroke: '#000',
          strokeWidth: 1,
          bezierOverride: null,
          hidden: false,
          locked: false,
        },
        {
          id: 'b',
          points: [
            [10, 10],
            [0, 10],
            [0, 0],
          ],
          closed: false,
          fill: 'none',
          stroke: '#000',
          strokeWidth: 1,
          bezierOverride: null,
          hidden: false,
          locked: false,
        },
      ],
    })
    expect(useStore.getState().mergeShapes('a', 'b')).toBe(true)
    const shapes = useStore.getState().shapes
    expect(shapes).toHaveLength(1)
    expect(shapes[0].closed).toBe(true)
    // Walking forward from a then through b's interior should give 4 vertices
    // of a unit square (the duplicated junctions are dropped).
    expect(shapes[0].points).toHaveLength(4)
  })

  it('merges two polygons that share exactly two vertices along the seam', () => {
    // Triangle A (0,0)-(10,0)-(5,5) and triangle B (10,0)-(15,5)-(5,5),
    // sharing the edge between (10,0) and (5,5).
    useStore.setState({
      shapes: [
        {
          id: 'a',
          points: [
            [0, 0],
            [10, 0],
            [5, 5],
          ],
          closed: true,
          fill: '#000',
          stroke: 'none',
          strokeWidth: 0,
          bezierOverride: null,
          hidden: false,
          locked: false,
        },
        {
          id: 'b',
          points: [
            [10, 0],
            [15, 5],
            [5, 5],
          ],
          closed: true,
          fill: '#000',
          stroke: 'none',
          strokeWidth: 0,
          bezierOverride: null,
          hidden: false,
          locked: false,
        },
      ],
    })
    expect(useStore.getState().mergeShapes('a', 'b')).toBe(true)
    const shapes = useStore.getState().shapes
    expect(shapes).toHaveLength(1)
    expect(shapes[0].closed).toBe(true)
    expect(shapes[0].points).toHaveLength(4)
  })

  it('does not twist when polygon point arrays orient the seam differently', () => {
    // Regression: with both polygons having multiple interior vertices on the
    // outward arc, a naive splice walks one arc in the wrong direction and
    // produces edges that cross at the seam (a "bow-tie" shape). The merged
    // polygon must use only edges that actually exist in either source — so
    // every consecutive pair (and the closing pair) is a real seam or arc edge.
    useStore.setState({
      shapes: [
        {
          id: 'a',
          // V1=(0,0), V2=(20,0). Two interior verts on the outward arc.
          points: [
            [0, 0],
            [5, -5],
            [15, -5],
            [20, 0],
            [10, -8],
          ],
          closed: true,
          fill: '#000',
          stroke: 'none',
          strokeWidth: 0,
          bezierOverride: null,
          hidden: false,
          locked: false,
        },
        {
          id: 'b',
          // V2=(20,0) at index 0, V1=(0,0) at index 3. Two interior verts on
          // the outward (forward) arc — the seam direction in B's array is
          // opposite of A's, so a naive splice walks one arc backward.
          points: [
            [20, 0],
            [15, 5],
            [5, 5],
            [0, 0],
            [10, 8],
          ],
          closed: true,
          fill: '#000',
          stroke: 'none',
          strokeWidth: 0,
          bezierOverride: null,
          hidden: false,
          locked: false,
        },
      ],
    })
    expect(useStore.getState().mergeShapes('a', 'b')).toBe(true)
    const merged = useStore.getState().shapes[0]
    expect(merged.closed).toBe(true)
    // Every edge of the merged polygon (including the closing edge) must be
    // an edge of A or B — no jumps that skip over an intermediate vertex.
    const aEdges = makeEdgeSet([
      [0, 0],
      [5, -5],
      [15, -5],
      [20, 0],
      [10, -8],
    ])
    const bEdges = makeEdgeSet([
      [20, 0],
      [15, 5],
      [5, 5],
      [0, 0],
      [10, 8],
    ])
    const allowed = new Set<string>([...aEdges, ...bEdges])
    for (let k = 0; k < merged.points.length; k++) {
      const p = merged.points[k]
      const q = merged.points[(k + 1) % merged.points.length]
      const key = edgeKey(p, q)
      expect(allowed.has(key)).toBe(true)
    }
  })

  it('refuses to merge mismatched kinds (open vs closed)', () => {
    useStore.setState({
      shapes: [
        {
          id: 'a',
          points: [
            [0, 0],
            [10, 0],
          ],
          closed: false,
          fill: 'none',
          stroke: '#000',
          strokeWidth: 1,
          bezierOverride: null,
          hidden: false,
          locked: false,
        },
        {
          id: 'b',
          points: [
            [0, 0],
            [10, 0],
            [5, 5],
          ],
          closed: true,
          fill: '#000',
          stroke: 'none',
          strokeWidth: 0,
          bezierOverride: null,
          hidden: false,
          locked: false,
        },
      ],
    })
    expect(useStore.getState().mergeShapes('a', 'b')).toBe(false)
    expect(useStore.getState().shapes).toHaveLength(2)
  })

  it('refuses to merge two lines without coincident endpoints', () => {
    useStore.setState({
      shapes: [
        {
          id: 'a',
          points: [
            [0, 0],
            [10, 0],
          ],
          closed: false,
          fill: 'none',
          stroke: '#000',
          strokeWidth: 1,
          bezierOverride: null,
          hidden: false,
          locked: false,
        },
        {
          id: 'b',
          points: [
            [50, 50],
            [60, 60],
          ],
          closed: false,
          fill: 'none',
          stroke: '#000',
          strokeWidth: 1,
          bezierOverride: null,
          hidden: false,
          locked: false,
        },
      ],
    })
    expect(useStore.getState().mergeShapes('a', 'b')).toBe(false)
    expect(useStore.getState().shapes).toHaveLength(2)
  })
})

describe('store: groups', () => {
  it('addGroup appends a uniquely-named record and returns its id', () => {
    const id1 = useStore.getState().addGroup()
    const id2 = useStore.getState().addGroup()
    const groups = useStore.getState().groups
    expect(groups).toHaveLength(2)
    expect(groups[0].id).toBe(id1)
    expect(groups[1].id).toBe(id2)
    expect(groups[0].name).not.toBe(groups[1].name)
  })

  it('setShapeGroup assigns and clears membership', () => {
    useStore.setState({
      shapes: [
        {
          id: 's1',
          points: [
            [0, 0],
            [10, 0],
          ],
          closed: false,
          fill: 'none',
          stroke: '#000',
          strokeWidth: 1,
          bezierOverride: null,
          hidden: false,
          locked: false,
        },
      ],
    })
    const gid = useStore.getState().addGroup()
    useStore.getState().setShapeGroup('s1', gid)
    expect(useStore.getState().shapes[0].groupId).toBe(gid)
    useStore.getState().setShapeGroup('s1', undefined)
    expect(useStore.getState().shapes[0].groupId).toBeUndefined()
  })

  it('rejects setShapeGroup pointing at an unknown group id', () => {
    useStore.setState({
      shapes: [
        {
          id: 's1',
          points: [
            [0, 0],
            [10, 0],
          ],
          closed: false,
          fill: 'none',
          stroke: '#000',
          strokeWidth: 1,
          bezierOverride: null,
          hidden: false,
          locked: false,
        },
      ],
    })
    useStore.getState().setShapeGroup('s1', 'nonexistent')
    expect(useStore.getState().shapes[0].groupId).toBeUndefined()
  })

  it('removeGroup unlinks members but does not delete shapes', () => {
    useStore.setState({
      shapes: [
        {
          id: 's1',
          points: [
            [0, 0],
            [10, 0],
          ],
          closed: false,
          fill: 'none',
          stroke: '#000',
          strokeWidth: 1,
          bezierOverride: null,
          hidden: false,
          locked: false,
        },
      ],
    })
    const gid = useStore.getState().addGroup()
    useStore.getState().setShapeGroup('s1', gid)
    useStore.getState().removeGroup(gid)
    expect(useStore.getState().groups).toHaveLength(0)
    expect(useStore.getState().shapes).toHaveLength(1)
    expect(useStore.getState().shapes[0].groupId).toBeUndefined()
  })

  it('setShapeGroup keeps members contiguous in the array', () => {
    // Initial z-order: a, b (ungrouped), c (ungrouped). After grouping a + c
    // into the same group, c must move next to a so the group's `<g>`
    // wrapper can render them as one contiguous block. b shifts to absorb
    // the move.
    useStore.setState({
      shapes: [
        {
          id: 'a',
          points: [
            [0, 0],
            [1, 0],
          ],
          closed: false,
          fill: 'none',
          stroke: '#000',
          strokeWidth: 1,
          bezierOverride: null,
          hidden: false,
          locked: false,
        },
        {
          id: 'b',
          points: [
            [2, 0],
            [3, 0],
          ],
          closed: false,
          fill: 'none',
          stroke: '#000',
          strokeWidth: 1,
          bezierOverride: null,
          hidden: false,
          locked: false,
        },
        {
          id: 'c',
          points: [
            [4, 0],
            [5, 0],
          ],
          closed: false,
          fill: 'none',
          stroke: '#000',
          strokeWidth: 1,
          bezierOverride: null,
          hidden: false,
          locked: false,
        },
      ],
    })
    const gid = useStore.getState().addGroup()
    useStore.getState().setShapeGroup('a', gid)
    useStore.getState().setShapeGroup('c', gid)
    const ids = useStore.getState().shapes.map(sh => sh.id)
    // a and c must end up adjacent regardless of which order they were
    // assigned; b sits outside the group block.
    const aIdx = ids.indexOf('a')
    const cIdx = ids.indexOf('c')
    expect(Math.abs(aIdx - cIdx)).toBe(1)
  })

  it('setGroupTransform updates the group rotation/scale (no per-shape mutation)', () => {
    useStore.setState({
      shapes: [
        {
          id: 'm1',
          points: [
            [0, 0],
            [10, 0],
            [5, 5],
          ],
          closed: true,
          fill: '#000',
          stroke: 'none',
          strokeWidth: 0,
          bezierOverride: null,
          hidden: false,
          locked: false,
        },
      ],
    })
    const gid = useStore.getState().addGroup()
    useStore.getState().setShapeGroup('m1', gid)
    useStore.getState().setGroupTransform(gid, { rotation: 30, scale: 1.5 })
    const g = useStore.getState().groups.find(x => x.id === gid)!
    expect(g.rotation).toBe(30)
    expect(g.scale).toBe(1.5)
    // Crucially, the member's own rotation/scale stay at identity — the
    // group transform is applied at render time on the wrapping `<g>`.
    const m = useStore.getState().shapes.find(sh => sh.id === 'm1')!
    expect(m.rotation).toBeUndefined()
    expect(m.scale).toBeUndefined()
  })

  it('applyGroupTransform bakes the group rotation/scale into member points', () => {
    // 90° rotation around (0,0) sends (10,0) -> (0,10). With members at
    // (10,0) and a 90° group rotation, baking should set the points to the
    // rotated positions and clear the group transform.
    useStore.setState({
      shapes: [
        {
          id: 'm1',
          points: [
            [10, 0],
            [10, 0],
          ],
          closed: false,
          fill: 'none',
          stroke: '#000',
          strokeWidth: 1,
          bezierOverride: null,
          hidden: false,
          locked: false,
        },
      ],
    })
    const gid = useStore.getState().addGroup()
    useStore.getState().setShapeGroup('m1', gid)
    // Pivot is the group's bbox center == (10, 0) for the single point at
    // (10,0). A rotation around its own location is a no-op for that point;
    // exercise a center we control by adding a second member at the origin
    // so the bbox center sits at (5, 0).
    useStore.setState(s => ({
      shapes: [
        ...s.shapes,
        {
          id: 'm2',
          points: [
            [0, 0],
            [0, 0],
          ],
          closed: false,
          fill: 'none',
          stroke: '#000',
          strokeWidth: 1,
          bezierOverride: null,
          hidden: false,
          locked: false,
          groupId: gid,
        },
      ],
    }))
    useStore.getState().setGroupTransform(gid, { rotation: 90 })
    useStore.getState().applyGroupTransform(gid)
    const g = useStore.getState().groups.find(x => x.id === gid)!
    expect(g.rotation).toBeUndefined()
    // Both members' points were rotated 90° around the bbox center (5, 0).
    // Point (10, 0) -> (5, 5); point (0, 0) -> (5, -5). Allow tiny float drift.
    const m1 = useStore.getState().shapes.find(sh => sh.id === 'm1')!
    expect(m1.points[0][0]).toBeCloseTo(5, 3)
    expect(m1.points[0][1]).toBeCloseTo(5, 3)
    const m2 = useStore.getState().shapes.find(sh => sh.id === 'm2')!
    expect(m2.points[0][0]).toBeCloseTo(5, 3)
    expect(m2.points[0][1]).toBeCloseTo(-5, 3)
  })

  it('setGroupAnimation stores and clears the group entrance animation', () => {
    const gid = useStore.getState().addGroup()
    useStore.getState().setGroupAnimation(gid, {
      duration: 600,
      delay: 0,
      easing: 'ease-out',
      from: { opacity: 0, scale: 0.5 },
    })
    expect(useStore.getState().groups.find(g => g.id === gid)?.animation?.duration).toBe(600)
    useStore.getState().setGroupAnimation(gid, undefined)
    expect(useStore.getState().groups.find(g => g.id === gid)?.animation).toBeUndefined()
  })

  it('selectGroup replaces selection with every member of the group', () => {
    useStore.setState({
      shapes: [
        {
          id: 's1',
          points: [
            [0, 0],
            [1, 0],
          ],
          closed: false,
          fill: 'none',
          stroke: '#000',
          strokeWidth: 1,
          bezierOverride: null,
          hidden: false,
          locked: false,
        },
        {
          id: 's2',
          points: [
            [2, 0],
            [3, 0],
          ],
          closed: false,
          fill: 'none',
          stroke: '#000',
          strokeWidth: 1,
          bezierOverride: null,
          hidden: false,
          locked: false,
        },
        {
          id: 's3',
          points: [
            [4, 0],
            [5, 0],
          ],
          closed: false,
          fill: 'none',
          stroke: '#000',
          strokeWidth: 1,
          bezierOverride: null,
          hidden: false,
          locked: false,
        },
      ],
    })
    const gid = useStore.getState().addGroup()
    useStore.getState().setShapeGroup('s1', gid)
    useStore.getState().setShapeGroup('s3', gid)
    useStore.getState().selectGroup(gid)
    expect(useStore.getState().selectedShapeIds).toEqual(['s1', 's3'])
  })

  it('enableGroupMirror sets a default axis and is mutually exclusive with radial', () => {
    useStore.setState({
      shapes: [
        {
          id: 'm1',
          points: [
            [10, 0],
            [20, 0],
          ],
          closed: false,
          fill: 'none',
          stroke: '#000',
          strokeWidth: 1,
          bezierOverride: null,
          hidden: false,
          locked: false,
        },
      ],
    })
    const gid = useStore.getState().addGroup()
    useStore.getState().setShapeGroup('m1', gid)
    useStore.getState().enableGroupRadial(gid, 90)
    expect(useStore.getState().groups.find(g => g.id === gid)?.radial?.angle).toBe(90)
    // Enabling mirror clears radial.
    useStore.getState().enableGroupMirror(gid, 'horizontal')
    const g = useStore.getState().groups.find(x => x.id === gid)
    expect(g?.mirror?.axis).toBeDefined()
    expect(g?.radial).toBeUndefined()
  })

  it('convertGroupMirror inserts a reflected sibling for every member into the same group', () => {
    useStore.setState({
      shapes: [
        {
          id: 'a',
          points: [
            [10, 0],
            [20, 0],
          ],
          closed: false,
          fill: 'none',
          stroke: '#000',
          strokeWidth: 1,
          bezierOverride: null,
          hidden: false,
          locked: false,
        },
        {
          id: 'b',
          points: [
            [30, 0],
            [40, 0],
          ],
          closed: false,
          fill: 'none',
          stroke: '#000',
          strokeWidth: 1,
          bezierOverride: null,
          hidden: false,
          locked: false,
        },
      ],
    })
    const gid = useStore.getState().addGroup()
    useStore.getState().setShapeGroup('a', gid)
    useStore.getState().setShapeGroup('b', gid)
    // Vertical line at x=0 → reflection across the y-axis.
    useStore.getState().updateGroupMirrorAxis(gid, { x: 0, y: 0, angle: 90 })
    // Wait — we have to enable mirror first before updateGroupMirrorAxis takes effect.
    useStore.getState().enableGroupMirror(gid, 'horizontal')
    useStore.getState().updateGroupMirrorAxis(gid, { x: 0, y: 0, angle: 90 })
    const ok = useStore.getState().convertGroupMirror(gid)
    expect(ok).toBe(true)
    const state = useStore.getState()
    expect(state.groups.find(g => g.id === gid)?.mirror).toBeUndefined()
    // Each original member now has a reflected sibling immediately after it.
    const memberIds = state.shapes.filter(sh => sh.groupId === gid).map(sh => sh.id)
    expect(memberIds.length).toBe(4)
    // Reflection of (10,0)/(20,0) across x=0 is (-10,0)/(-20,0).
    const ejectedAfterA = state.shapes[1]
    expect(ejectedAfterA.points[0][0]).toBeCloseTo(-10, 3)
    expect(ejectedAfterA.points[1][0]).toBeCloseTo(-20, 3)
    expect(ejectedAfterA.groupId).toBe(gid)
  })

  it('convertGroupRadial duplicates each member around the radial center', () => {
    useStore.setState({
      shapes: [
        {
          id: 'a',
          points: [
            [10, 0],
            [10, 0],
          ],
          closed: false,
          fill: 'none',
          stroke: '#000',
          strokeWidth: 1,
          bezierOverride: null,
          hidden: false,
          locked: false,
        },
      ],
    })
    const gid = useStore.getState().addGroup()
    useStore.getState().setShapeGroup('a', gid)
    useStore.getState().enableGroupRadial(gid, 90)
    useStore.getState().updateGroupRadial(gid, { cx: 0, cy: 0, angle: 90 })
    const ok = useStore.getState().convertGroupRadial(gid)
    expect(ok).toBe(true)
    const state = useStore.getState()
    expect(state.groups.find(g => g.id === gid)?.radial).toBeUndefined()
    // 90° increment around origin: 4 copies (source + 3 clones).
    const members = state.shapes.filter(sh => sh.groupId === gid)
    expect(members.length).toBe(4)
    // Source unchanged; clone at 90° rotates (10,0) → (0, 10).
    expect(members[1].points[0][0]).toBeCloseTo(0, 3)
    expect(members[1].points[0][1]).toBeCloseTo(10, 3)
  })

  it('disableGroupMirror clears the modifier without changing shapes', () => {
    const gid = useStore.getState().addGroup()
    useStore.setState(s => ({
      shapes: [
        {
          id: 'a',
          points: [
            [0, 0],
            [1, 0],
          ],
          closed: false,
          fill: 'none',
          stroke: '#000',
          strokeWidth: 1,
          bezierOverride: null,
          hidden: false,
          locked: false,
          groupId: gid,
        },
      ],
      groups: s.groups,
    }))
    useStore.getState().enableGroupMirror(gid, 'horizontal')
    expect(useStore.getState().groups.find(g => g.id === gid)?.mirror).toBeDefined()
    useStore.getState().disableGroupMirror(gid)
    expect(useStore.getState().groups.find(g => g.id === gid)?.mirror).toBeUndefined()
    expect(useStore.getState().shapes).toHaveLength(1)
  })

  it('group mirror is rejected when any member is a glyph', () => {
    const gid = useStore.getState().addGroup()
    useStore.setState(s => ({
      shapes: [
        {
          id: 'g1',
          kind: 'glyphs',
          points: [
            [0, 0],
            [10, 10],
          ],
          closed: true,
          fill: '#000',
          stroke: 'none',
          strokeWidth: 0,
          bezierOverride: null,
          hidden: false,
          locked: false,
          glyphs: { text: 'A', fontFamily: 'X', fontSize: 10, d: 'M0,0', width: 10, height: 10 },
          groupId: gid,
        },
      ],
      groups: s.groups,
    }))
    useStore.getState().enableGroupMirror(gid, 'horizontal')
    expect(useStore.getState().groups.find(g => g.id === gid)?.mirror).toBeUndefined()
  })
})
