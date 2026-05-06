import { useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent } from 'react'

import { bbox, dist, pointsToPath } from '../lib/geometry'
import { useStore, effectiveBezier } from '../store'

import type { Shape } from '../types'

interface DropTarget {
  id: string
  position: 'above' | 'below'
}

export function LayerPanel() {
  const shapes = useStore(s => s.shapes)
  const selectedShapeIds = useStore(s => s.selectedShapeIds)
  const settings = useStore(s => s.settings)
  const selectShape = useStore(s => s.selectShape)
  const toggleShapeSelection = useStore(s => s.toggleShapeSelection)
  const selectShapeRange = useStore(s => s.selectShapeRange)
  const toggleShapeVisibility = useStore(s => s.toggleShapeVisibility)
  const toggleShapeLock = useStore(s => s.toggleShapeLock)
  const reorderShape = useStore(s => s.reorderShape)
  const renameShape = useStore(s => s.renameShape)
  const selectedSet = useMemo(() => new Set(selectedShapeIds), [selectedShapeIds])

  const onRowClick = (e: MouseEvent<HTMLLIElement>, id: string) => {
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
  const [editingId, setEditingId] = useState<string | null>(null)

  const clearDrag = () => {
    setDraggingId(null)
    setDropTarget(null)
  }

  const onDragStart = (e: DragEvent<HTMLLIElement>, id: string) => {
    setDraggingId(id)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', id)
  }

  const onDragOverRow = (e: DragEvent<HTMLLIElement>, id: string) => {
    if (!draggingId) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
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

  const onDrop = (e: DragEvent<HTMLOListElement>) => {
    e.preventDefault()
    if (!draggingId || !dropTarget) {
      clearDrag()
      return
    }
    const fromArr = shapes.findIndex(s => s.id === draggingId)
    if (fromArr === -1) return clearDrag()
    const temp = shapes.slice()
    temp.splice(fromArr, 1)
    const targetTempIdx = temp.findIndex(s => s.id === dropTarget.id)
    if (targetTempIdx === -1) return clearDrag()
    // Visual list is reversed (top of list = last array element / top of z-stack),
    // so dropping "above" the target means inserting *after* it in the array.
    const insertAt = dropTarget.position === 'above' ? targetTempIdx + 1 : targetTempIdx
    reorderShape(fromArr, insertAt)
    clearDrag()
  }

  if (shapes.length === 0) {
    return (
      <section className="border-line relative border-b px-3.5 py-3 last:border-b-0">
        <p className="text-muted mt-1 text-[11px] leading-[1.55] tracking-[0.3px]">
          No layers yet — draw a line, polygon, or circle.
        </p>
      </section>
    )
  }

  const visual = shapes.toReversed()

  return (
    <section className="border-line relative border-b px-3.5 py-3 last:border-b-0">
      <ol
        className="m-0 flex list-none flex-col gap-px p-0"
        onDrop={onDrop}
        onDragOver={e => {
          if (draggingId) e.preventDefault()
        }}
      >
        {visual.map(shape => {
          const isSelected = selectedSet.has(shape.id)
          const isDragging = shape.id === draggingId
          const drop = dropTarget?.id === shape.id ? dropTarget.position : null
          const base =
            'group/row relative flex items-center gap-1.5 pl-1 pr-1.5 py-1 border border-l-2 border-transparent cursor-pointer text-[11px] text-text select-none tracking-[0.4px] transition-[background,border-color] duration-75'
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
          const handleCursor = isDragging ? 'cursor-grabbing' : 'cursor-grab'
          const showHighlighted = shape.hidden ? 'text-accent' : ''
          const lockHighlighted = shape.locked ? 'text-accent' : ''
          return (
            <li
              key={shape.id}
              className={cls}
              draggable
              onDragStart={e => onDragStart(e, shape.id)}
              onDragOver={e => onDragOverRow(e, shape.id)}
              onDragEnd={clearDrag}
              onClick={e => onRowClick(e, shape.id)}
            >
              <span
                className={`text-muted-2 group-hover/row:text-muted flex items-center px-px ${handleCursor}`}
                aria-hidden
              >
                <DragHandleIcon />
              </span>
              <button
                type="button"
                className={`hover:text-text flex items-center justify-center border-transparent bg-transparent px-[3px] py-[2px] tracking-normal hover:bg-black/30 ${showHighlighted || 'text-muted'}`}
                title={shape.hidden ? 'Show layer' : 'Hide layer'}
                onClick={e => {
                  e.stopPropagation()
                  toggleShapeVisibility(shape.id)
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
                  toggleShapeLock(shape.id)
                }}
              >
                {shape.locked ? <LockIcon /> : <UnlockIcon />}
              </button>
              <ShapePreview shape={shape} bezier={effectiveBezier(shape, settings)} dim={shape.hidden} />
              <Swatches shape={shape} dim={shape.hidden} />
              {editingId === shape.id ? (
                <NameInput
                  initial={shape.name ?? defaultLayerName(shape)}
                  onCommit={v => {
                    renameShape(shape.id, v)
                    setEditingId(null)
                  }}
                  onCancel={() => setEditingId(null)}
                />
              ) : (
                <span
                  className={`min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap ${
                    shape.hidden ? 'text-muted-2 italic' : ''
                  }`}
                  onDoubleClick={e => {
                    e.stopPropagation()
                    setEditingId(shape.id)
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
            </li>
          )
        })}
      </ol>
    </section>
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

function ShapePreview({ shape, bezier, dim }: { shape: Shape; bezier: number; dim: boolean }) {
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
  const d = pointsToPath(shape.points, shape.closed, bezier)
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
