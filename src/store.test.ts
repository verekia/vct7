import { afterEach, describe, expect, it } from 'bun:test'

import { DEFAULT_SETTINGS } from './lib/svg-io'
import { useStore } from './store'

const reset = () => {
  // Replace the Zustand state without losing action references.
  useStore.setState({
    shapes: [],
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
    s.setSettings({ bezier: 0.1 })
    s.setSettings({ bezier: 0.2 })
    s.setSettings({ bezier: 0.3 })
    // All three slider ticks collapse to a single undo step that returns to
    // the pre-drag value.
    expect(useStore.getState().past.length).toBe(1)
    useStore.getState().undo()
    expect(useStore.getState().settings.bezier).toBe(DEFAULT_SETTINGS.bezier)
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

  it('enableMirror sets a default vertical axis through the canvas center', () => {
    seed()
    useStore.getState().enableMirror('a')
    const sh = useStore.getState().shapes[0]
    const settings = useStore.getState().settings
    expect(sh.mirror).toBeDefined()
    expect(sh.mirror?.axis.angle).toBe(90)
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
    useStore.getState().enableMirror('g')
    expect(useStore.getState().shapes[0].mirror).toBeUndefined()
  })

  it('updateMirrorAxis patches axis fields and coalesces drags', () => {
    seed()
    useStore.getState().enableMirror('a')
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
    useStore.getState().enableMirror('a')
    expect(useStore.getState().shapes[0].mirror?.showAxis).toBeUndefined()
    useStore.getState().toggleMirrorAxisVisibility('a')
    expect(useStore.getState().shapes[0].mirror?.showAxis).toBe(true)
    useStore.getState().toggleMirrorAxisVisibility('a')
    expect(useStore.getState().shapes[0].mirror?.showAxis).toBeUndefined()
  })

  it('disableMirror removes the modifier without baking', () => {
    seed()
    useStore.getState().enableMirror('a')
    useStore.getState().disableMirror('a')
    expect(useStore.getState().shapes).toHaveLength(1)
    expect(useStore.getState().shapes[0].mirror).toBeUndefined()
  })

  it('ejectMirror inserts a baked sibling right after the source', () => {
    seed()
    useStore.getState().enableMirror('a')
    // Move axis to x=20 so the reflection lands at x ∈ [30..40].
    useStore.getState().updateMirrorAxis('a', { x: 20, angle: 90 })
    const newId = useStore.getState().ejectMirror('a')
    expect(newId).not.toBeNull()
    const shapes = useStore.getState().shapes
    expect(shapes).toHaveLength(2)
    expect(shapes[0].id).toBe('a')
    expect(shapes[0].mirror).toBeUndefined()
    expect(shapes[1].id).toBe(newId as string)
    // Source point (10, 0) reflects across vertical line at x=20 → (30, 0).
    expect(shapes[1].points[1][0]).toBeCloseTo(30)
    expect(shapes[1].points[1][1]).toBeCloseTo(0)
  })

  it('ejectMirror bakes the group rotation into both halves', () => {
    seed()
    useStore.getState().enableMirror('a')
    useStore.getState().updateShape('a', { rotation: 90 })
    const newId = useStore.getState().ejectMirror('a')!
    const shapes = useStore.getState().shapes
    expect(shapes[0].rotation).toBeUndefined()
    expect(shapes.find(s => s.id === newId)?.rotation).toBeUndefined()
  })

  it('ejectMirror is a no-op when mirror is not set', () => {
    seed()
    expect(useStore.getState().ejectMirror('a')).toBeNull()
    expect(useStore.getState().shapes).toHaveLength(1)
  })
})
