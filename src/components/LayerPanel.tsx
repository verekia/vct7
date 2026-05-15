import { useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent } from 'react'

import { bbox, dist, pointsToPath } from '../lib/geometry'
import { useStore, effectiveBezier } from '../store'

import type { ShapeBezier } from '../store'
import type { Group, Shape } from '../types'

interface DropTarget {
  id: string
  position: 'above' | 'below'
}

export function LayerPanel() {
  const shapes = useStore(s => s.shapes)
  const groups = useStore(s => s.groups)
  const selectedShapeIds = useStore(s => s.selectedShapeIds)
  const settings = useStore(s => s.settings)
  const selectShape = useStore(s => s.selectShape)
  const selectGroup = useStore(s => s.selectGroup)
  const toggleShapeSelection = useStore(s => s.toggleShapeSelection)
  const selectShapeRange = useStore(s => s.selectShapeRange)
  const toggleShapeVisibility = useStore(s => s.toggleShapeVisibility)
  const toggleShapeLock = useStore(s => s.toggleShapeLock)
  const reorderShape = useStore(s => s.reorderShape)
  const renameShape = useStore(s => s.renameShape)
  const addGroup = useStore(s => s.addGroup)
  const removeGroup = useStore(s => s.removeGroup)
  const renameGroup = useStore(s => s.renameGroup)
  const setShapeGroup = useStore(s => s.setShapeGroup)
  const selectedSet = useMemo(() => new Set(selectedShapeIds), [selectedShapeIds])
  const groupById = useMemo(() => {
    const map = new Map<string, Group>()
    for (const g of groups) map.set(g.id, g)
    return map
  }, [groups])
  const groupMemberCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const sh of shapes) {
      if (!sh.groupId) continue
      counts.set(sh.groupId, (counts.get(sh.groupId) ?? 0) + 1)
    }
    return counts
  }, [shapes])

  // Walk shapes in visual z-order (top-of-list = highest in stack) and emit
  // a tree: a group header above the first encountered member, indented
  // member rows below it, transitioning back to ungrouped rows when the
  // running groupId changes. Empty groups (no members yet) are surfaced at
  // the top so they remain visible drop targets.
  const tree = useMemo<TreeNode[]>(() => {
    const visual = shapes.toReversed()
    const nodes: TreeNode[] = []
    const seenGroups = new Set<string>()
    let lastGroupId: string | undefined
    for (const sh of visual) {
      const gid = sh.groupId
      if (gid !== lastGroupId) {
        const g = gid ? groupById.get(gid) : undefined
        if (g) {
          // First time we see this group at its z-position — emit its header
          // above the run. Contiguity (enforced by setShapeGroup) means each
          // group surfaces exactly once.
          nodes.push({ kind: 'group-header', group: g })
          seenGroups.add(g.id)
        }
        lastGroupId = gid
      }
      nodes.push({ kind: 'shape', shape: sh, depth: gid ? 1 : 0 })
    }
    // Empty groups have no shape rows to anchor a header — bubble them to
    // the top so the user can drag layers onto them or rename / delete.
    const emptyHeaders: TreeNode[] = []
    for (const g of groups) {
      if (seenGroups.has(g.id)) continue
      emptyHeaders.push({ kind: 'group-header', group: g })
    }
    return [...emptyHeaders, ...nodes]
  }, [shapes, groups, groupById])

  const onShapeRowClick = (e: MouseEvent<HTMLLIElement>, id: string) => {
    if (e.shiftKey) {
      selectShapeRange(id)
    } else if (e.metaKey || e.ctrlKey) {
      toggleShapeSelection(id)
    } else {
      selectShape(id)
    }
  }

  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null)
  /** Group header currently hovered while dragging a layer — drop assigns. */
  const [groupDropTargetId, setGroupDropTargetId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null)

  const clearDrag = () => {
    setDraggingId(null)
    setDropTarget(null)
    setGroupDropTargetId(null)
  }

  const onShapeDragStart = (e: DragEvent<HTMLLIElement>, id: string) => {
    setDraggingId(id)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', id)
  }

  const onShapeDragOver = (e: DragEvent<HTMLLIElement>, id: string) => {
    if (!draggingId) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (groupDropTargetId) setGroupDropTargetId(null)
    if (id === draggingId) {
      if (dropTarget) setDropTarget(null)
      return
    }
    const rect = e.currentTarget.getBoundingClientRect()
    const position: 'above' | 'below' = e.clientY < rect.top + rect.height / 2 ? 'above' : 'below'
    if (dropTarget?.id !== id || dropTarget?.position !== position) {
      setDropTarget({ id, position })
    }
  }

  const onGroupDragOver = (e: DragEvent<HTMLLIElement>, groupId: string) => {
    if (!draggingId) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (dropTarget) setDropTarget(null)
    if (groupDropTargetId !== groupId) setGroupDropTargetId(groupId)
  }

  const onDrop = (e: DragEvent<HTMLElement>) => {
    e.preventDefault()
    if (!draggingId) {
      clearDrag()
      return
    }
    if (groupDropTargetId) {
      // Drop on a group header → assign membership. setShapeGroup keeps the
      // group's members contiguous (slides the shape next to existing ones)
      // so the tree layout stays well-formed.
      setShapeGroup(draggingId, groupDropTargetId)
      clearDrag()
      return
    }
    if (!dropTarget) {
      clearDrag()
      return
    }
    const fromArr = shapes.findIndex(s => s.id === draggingId)
    if (fromArr === -1) return clearDrag()
    // Container detection: when the user drops between rows, infer membership
    // from the target row's groupId. Drops onto a member of group G inherit
    // G; drops onto an ungrouped row leave the dragged shape ungrouped.
    const targetShape = shapes.find(s => s.id === dropTarget.id)
    const targetGroupId = targetShape?.groupId
    const dragged = shapes[fromArr]
    if ((targetGroupId ?? undefined) !== (dragged.groupId ?? undefined)) {
      setShapeGroup(draggingId, targetGroupId)
    }
    // The setShapeGroup call may have shifted indices; re-read the array.
    const refreshed = useStore.getState().shapes
    const newFromIdx = refreshed.findIndex(s => s.id === draggingId)
    if (newFromIdx === -1) return clearDrag()
    const temp = refreshed.slice()
    temp.splice(newFromIdx, 1)
    const targetTempIdx = temp.findIndex(s => s.id === dropTarget.id)
    if (targetTempIdx === -1) return clearDrag()
    // Visual list is reversed (top of list = last array element / top of
    // z-stack), so dropping "above" the target means inserting *after* it
    // in the array.
    const insertAt = dropTarget.position === 'above' ? targetTempIdx + 1 : targetTempIdx
    reorderShape(newFromIdx, insertAt)
    clearDrag()
  }

  return (
    <section className="border-line relative border-b px-3.5 py-3 last:border-b-0">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-muted text-[10px] tracking-[0.5px] uppercase">Layers</span>
        <button
          type="button"
          className="px-[7px] py-[2px] text-[11px]"
          onClick={() => addGroup()}
          title="Create a new empty group. Drag layers onto its header to add members."
        >
          + Add group
        </button>
      </div>
      {tree.length === 0 ? (
        <p className="text-muted mt-1 text-[11px] leading-[1.55] tracking-[0.3px]">
          No layers yet — draw a line, polygon, or circle.
        </p>
      ) : (
        <ol
          className="m-0 flex list-none flex-col gap-px p-0"
          onDrop={onDrop}
          onDragOver={e => {
            if (draggingId) e.preventDefault()
          }}
        >
          {tree.map(node => {
            if (node.kind === 'group-header') {
              const g = node.group
              const count = groupMemberCounts.get(g.id) ?? 0
              return (
                <GroupHeaderRow
                  key={`g-${g.id}`}
                  group={g}
                  count={count}
                  draggingId={draggingId}
                  hot={groupDropTargetId === g.id}
                  editing={editingGroupId === g.id}
                  onSelect={() => selectGroup(g.id)}
                  onStartRename={() => setEditingGroupId(g.id)}
                  onCancelRename={() => setEditingGroupId(null)}
                  onCommitRename={v => {
                    renameGroup(g.id, v)
                    setEditingGroupId(null)
                  }}
                  onRemove={() => removeGroup(g.id)}
                  onDragOver={onGroupDragOver}
                  onDrop={onDrop}
                  onDragLeave={() => setGroupDropTargetId(null)}
                />
              )
            }
            const shape = node.shape
            return (
              <ShapeRow
                key={shape.id}
                shape={shape}
                depth={node.depth}
                bezier={effectiveBezier(shape, settings)}
                isSelected={selectedSet.has(shape.id)}
                isDragging={shape.id === draggingId}
                drop={dropTarget?.id === shape.id ? dropTarget.position : null}
                editing={editingId === shape.id}
                onClick={onShapeRowClick}
                onDragStart={onShapeDragStart}
                onDragOver={onShapeDragOver}
                onDragEnd={clearDrag}
                onStartRename={() => setEditingId(shape.id)}
                onCancelRename={() => setEditingId(null)}
                onCommitRename={v => {
                  renameShape(shape.id, v)
                  setEditingId(null)
                }}
                onToggleVisibility={() => toggleShapeVisibility(shape.id)}
                onToggleLock={() => toggleShapeLock(shape.id)}
                onUngroup={() => setShapeGroup(shape.id, undefined)}
              />
            )
          })}
        </ol>
      )}
    </section>
  )
}

type TreeNode = { kind: 'group-header'; group: Group } | { kind: 'shape'; shape: Shape; depth: number }

function GroupHeaderRow({
  group,
  count,
  draggingId,
  hot,
  editing,
  onSelect,
  onStartRename,
  onCancelRename,
  onCommitRename,
  onRemove,
  onDragOver,
  onDrop,
  onDragLeave,
}: {
  group: Group
  count: number
  draggingId: string | null
  hot: boolean
  editing: boolean
  onSelect: () => void
  onStartRename: () => void
  onCancelRename: () => void
  onCommitRename: (value: string) => void
  onRemove: () => void
  onDragOver: (e: DragEvent<HTMLLIElement>, id: string) => void
  onDrop: (e: DragEvent<HTMLElement>) => void
  onDragLeave: () => void
}) {
  const cls = [
    'group/grow flex items-center gap-1.5 px-1.5 py-1 border border-l-2 cursor-pointer',
    'text-[11px] tracking-[0.4px] select-none transition-[background,border-color] duration-75',
    hot
      ? 'border-accent bg-[rgba(255,59,48,0.08)] text-text border-dashed'
      : 'border-line bg-bg-2 text-muted hover:bg-bg-3 border-dashed',
  ].join(' ')
  return (
    <li
      className={cls}
      onDragOver={e => onDragOver(e, group.id)}
      onDrop={onDrop}
      onDragLeave={onDragLeave}
      onClick={onSelect}
      title={
        draggingId
          ? `Drop to add the dragged layer to "${group.name}"`
          : `Click to select all ${count} member${count === 1 ? '' : 's'}`
      }
    >
      <FolderIcon />
      {editing ? (
        <NameInput initial={group.name} onCommit={onCommitRename} onCancel={onCancelRename} />
      ) : (
        <span
          className="text-text min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap"
          onDoubleClick={e => {
            e.stopPropagation()
            onStartRename()
          }}
        >
          {group.name}
        </span>
      )}
      <span className="text-muted-2 tabular-nums" aria-label={`${count} members`}>
        {count}
      </span>
      <button
        type="button"
        className="text-muted hover:text-accent border-transparent bg-transparent px-1 py-px"
        title="Delete group (members keep their layers)"
        onClick={e => {
          e.stopPropagation()
          onRemove()
        }}
      >
        ×
      </button>
    </li>
  )
}

function ShapeRow({
  shape,
  depth,
  bezier,
  isSelected,
  isDragging,
  drop,
  editing,
  onClick,
  onDragStart,
  onDragOver,
  onDragEnd,
  onStartRename,
  onCancelRename,
  onCommitRename,
  onToggleVisibility,
  onToggleLock,
  onUngroup,
}: {
  shape: Shape
  depth: number
  bezier: ShapeBezier
  isSelected: boolean
  isDragging: boolean
  drop: 'above' | 'below' | null
  editing: boolean
  onClick: (e: MouseEvent<HTMLLIElement>, id: string) => void
  onDragStart: (e: DragEvent<HTMLLIElement>, id: string) => void
  onDragOver: (e: DragEvent<HTMLLIElement>, id: string) => void
  onDragEnd: () => void
  onStartRename: () => void
  onCancelRename: () => void
  onCommitRename: (v: string) => void
  onToggleVisibility: () => void
  onToggleLock: () => void
  onUngroup: () => void
}) {
  const base =
    'group/row relative flex items-center gap-1.5 pr-1.5 py-1 border border-l-2 border-transparent cursor-pointer text-[11px] text-text select-none tracking-[0.4px] transition-[background,border-color] duration-75'
  const stateBg = isSelected
    ? 'bg-[linear-gradient(90deg,rgba(255,59,48,0.12),transparent_60%)] border-l-accent'
    : 'bg-bg-2 hover:bg-bg-3'
  const cls = [
    base,
    stateBg,
    isDragging ? 'opacity-40' : '',
    drop === 'above' ? 'drop-above' : '',
    drop === 'below' ? 'drop-below' : '',
  ]
    .filter(Boolean)
    .join(' ')
  // Each tree level adds a fixed indent so members visually nest under their
  // group header. The first-column padding (pl-1) is folded into this so the
  // ungrouped baseline matches the previous flat layout.
  const indent = depth > 0 ? `${4 + depth * 12}px` : '4px'
  const handleCursor = isDragging ? 'cursor-grabbing' : 'cursor-grab'
  const showHighlighted = shape.hidden ? 'text-accent' : ''
  const lockHighlighted = shape.locked ? 'text-accent' : ''
  return (
    <li
      className={cls}
      style={{ paddingLeft: indent }}
      draggable
      onDragStart={e => onDragStart(e, shape.id)}
      onDragOver={e => onDragOver(e, shape.id)}
      onDragEnd={onDragEnd}
      onClick={e => onClick(e, shape.id)}
    >
      <span className={`text-muted-2 group-hover/row:text-muted flex items-center px-px ${handleCursor}`} aria-hidden>
        <DragHandleIcon />
      </span>
      <button
        type="button"
        className={`hover:text-text flex items-center justify-center border-transparent bg-transparent px-[3px] py-[2px] tracking-normal hover:bg-black/30 ${showHighlighted || 'text-muted'}`}
        title={shape.hidden ? 'Show layer' : 'Hide layer'}
        onClick={e => {
          e.stopPropagation()
          onToggleVisibility()
        }}
      >
        {shape.hidden ? <EyeOffIcon /> : <EyeIcon />}
      </button>
      <button
        type="button"
        className={`hover:text-text flex items-center justify-center border-transparent bg-transparent px-[3px] py-[2px] tracking-normal hover:bg-black/30 ${lockHighlighted || 'text-muted'}`}
        title={shape.locked ? 'Unlock layer' : 'Lock layer'}
        onClick={e => {
          e.stopPropagation()
          onToggleLock()
        }}
      >
        {shape.locked ? <LockIcon /> : <UnlockIcon />}
      </button>
      <ShapePreview shape={shape} bezier={bezier} dim={shape.hidden} />
      <Swatches shape={shape} dim={shape.hidden} />
      {editing ? (
        <NameInput
          initial={shape.name ?? defaultLayerName(shape)}
          onCommit={onCommitRename}
          onCancel={onCancelRename}
        />
      ) : (
        <span
          className={`min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap ${
            shape.hidden ? 'text-muted-2 italic' : ''
          }`}
          onDoubleClick={e => {
            e.stopPropagation()
            onStartRename()
          }}
        >
          {shape.name || defaultLayerName(shape)}
        </span>
      )}
      {shape.mirror && (
        <span
          className="text-muted-2 shrink-0"
          title="Live mirror modifier — eject from the shape panel to split into two layers."
          aria-label="Mirrored layer"
        >
          <MirrorIcon />
        </span>
      )}
      {needsApply(shape) && (
        <span
          className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#3b82f6]"
          title={applyHint(shape)}
          aria-label="Has unbaked blend mode or opacity"
        />
      )}
      {depth > 0 && (
        <button
          type="button"
          className="text-muted hover:text-accent border-transparent bg-transparent px-1 py-px text-[10px] leading-none"
          title="Remove from group"
          onClick={e => {
            e.stopPropagation()
            onUngroup()
          }}
          aria-label="Remove from group"
        >
          ×
        </button>
      )}
    </li>
  )
}

function defaultLayerName(shape: Shape): string {
  if (shape.kind === 'circle') return 'circle'
  return shape.closed ? 'polygon' : 'line'
}

const hasBlend = (sh: Shape): boolean => !!sh.blendMode && sh.blendMode !== 'normal'
const hasOpacity = (sh: Shape): boolean => sh.opacity !== undefined && sh.opacity < 1
const needsApply = (sh: Shape): boolean => hasBlend(sh) || hasOpacity(sh)

const applyHint = (sh: Shape): string => {
  const parts: string[] = []
  if (hasBlend(sh)) parts.push(`${sh.blendMode} blending`)
  if (hasOpacity(sh)) parts.push(`${sh.opacity!.toFixed(2)} opacity`)
  return `Uses ${parts.join(' + ')} — apply it from the shape panel to bake the color.`
}

function NameInput({
  initial,
  onCommit,
  onCancel,
}: {
  initial: string
  onCommit: (v: string) => void
  onCancel: () => void
}) {
  const ref = useRef<HTMLInputElement>(null)
  const [value, setValue] = useState(initial)
  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])
  return (
    <input
      ref={ref}
      className="bg-bg-1 border-accent text-text min-w-0 flex-1 border px-1 py-px text-[11px] tracking-[0.4px] outline-none"
      value={value}
      onChange={e => setValue(e.target.value)}
      onBlur={() => onCommit(value)}
      onKeyDown={e => {
        if (e.key === 'Enter') {
          e.preventDefault()
          onCommit(value)
        } else if (e.key === 'Escape') {
          e.preventDefault()
          onCancel()
        }
        e.stopPropagation()
      }}
      onClick={e => e.stopPropagation()}
      onDoubleClick={e => e.stopPropagation()}
    />
  )
}

function Swatches({ shape, dim }: { shape: Shape; dim: boolean }) {
  const wrap = `flex gap-0.5 shrink-0${dim ? ' opacity-40' : ''}`
  if (shape.closed) {
    return (
      <span className={wrap} aria-hidden>
        <Swatch color={shape.fill} title={`Fill ${shape.fill}`} />
        <Swatch color={shape.stroke} title={`Stroke ${shape.stroke}`} />
      </span>
    )
  }
  return (
    <span className={wrap} aria-hidden>
      <Swatch color={shape.stroke} title={`Stroke ${shape.stroke}`} />
    </span>
  )
}

function Swatch({ color, title }: { color: string; title: string }) {
  const isNone = !color || color === 'none' || color === 'transparent'
  const cls = `w-2.5 h-2.5 border border-line inline-block${isNone ? ' swatch-none' : ''}`
  return <span className={cls} style={isNone ? undefined : { background: color }} title={title} />
}

function ShapePreview({ shape, bezier, dim }: { shape: Shape; bezier: ShapeBezier; dim: boolean }) {
  const fill = shape.closed ? (shape.fill === 'none' ? 'transparent' : shape.fill) : 'none'
  const stroke = shape.stroke === 'none' ? 'transparent' : shape.stroke
  const pad = 1
  const wrap = `flex items-center justify-center w-5 h-5 text-muted shrink-0${dim ? ' opacity-40' : ''}`
  if (shape.kind === 'circle' && shape.points.length >= 2) {
    const [cx, cy] = shape.points[0]
    const r = dist(shape.points[0], shape.points[1]) || 0.0001
    const vb = `${cx - r - pad} ${cy - r - pad} ${r * 2 + pad * 2} ${r * 2 + pad * 2}`
    return (
      <span className={wrap} aria-hidden>
        <svg viewBox={vb} width="20" height="20" preserveAspectRatio="xMidYMid meet">
          <circle
            cx={cx}
            cy={cy}
            r={r}
            fill={fill}
            stroke={stroke}
            strokeWidth={1.2}
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      </span>
    )
  }
  const box = bbox(shape.points)
  const w = Math.max(box.w, 0.0001)
  const h = Math.max(box.h, 0.0001)
  const vb = `${box.x - pad} ${box.y - pad} ${w + pad * 2} ${h + pad * 2}`
  const d = pointsToPath(shape.points, shape.closed, bezier.spec, bezier.perPoint, bezier.canvasRef)
  return (
    <span className={wrap} aria-hidden>
      <svg viewBox={vb} width="20" height="20" preserveAspectRatio="xMidYMid meet">
        <path
          d={d}
          fill={fill}
          stroke={stroke}
          strokeWidth={1.2}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </span>
  )
}

function DragHandleIcon() {
  return (
    <svg viewBox="0 0 8 16" width="8" height="14">
      <circle cx="2" cy="4" r="1" fill="currentColor" />
      <circle cx="6" cy="4" r="1" fill="currentColor" />
      <circle cx="2" cy="8" r="1" fill="currentColor" />
      <circle cx="6" cy="8" r="1" fill="currentColor" />
      <circle cx="2" cy="12" r="1" fill="currentColor" />
      <circle cx="6" cy="12" r="1" fill="currentColor" />
    </svg>
  )
}

function EyeIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14">
      <path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="8" cy="8" r="2" fill="currentColor" />
    </svg>
  )
}

function EyeOffIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14">
      <path
        d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        opacity="0.4"
      />
      <line x1="2" y1="2" x2="14" y2="14" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}

function LockIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14">
      <rect x="3" y="7" width="10" height="7" fill="currentColor" rx="1" />
      <path d="M5.5 7V5a2.5 2.5 0 015 0v2" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}

function MirrorIcon() {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
      <path d="M3 2v12M13 2v12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <path
        d="M5 4l-1.5 4L5 12M11 4l1.5 4L11 12"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path d="M8 1v14" stroke="currentColor" strokeWidth="0.8" strokeDasharray="1.5 1.5" />
    </svg>
  )
}

function UnlockIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14">
      <rect x="3" y="7" width="10" height="7" fill="none" stroke="currentColor" strokeWidth="1.2" rx="1" />
      <path d="M5.5 7V5a2.5 2.5 0 015 0" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}

function FolderIcon() {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
      <path
        d="M1.5 4.5h4l1 1.5h8v6.5a1 1 0 01-1 1H2.5a1 1 0 01-1-1v-8z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  )
}
