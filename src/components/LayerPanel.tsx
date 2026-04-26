import { useEffect, useRef, useState, type DragEvent } from 'react';
import { useStore, effectiveBezier } from '../store';
import { bbox, dist, pointsToPath } from '../lib/geometry';
import type { Shape } from '../types';

interface DropTarget {
  id: string;
  position: 'above' | 'below';
}

export function LayerPanel() {
  const shapes = useStore((s) => s.shapes);
  const selectedShapeId = useStore((s) => s.selectedShapeId);
  const settings = useStore((s) => s.settings);
  const selectShape = useStore((s) => s.selectShape);
  const toggleShapeVisibility = useStore((s) => s.toggleShapeVisibility);
  const toggleShapeLock = useStore((s) => s.toggleShapeLock);
  const reorderShape = useStore((s) => s.reorderShape);
  const renameShape = useStore((s) => s.renameShape);

  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const clearDrag = () => {
    setDraggingId(null);
    setDropTarget(null);
  };

  const onDragStart = (e: DragEvent<HTMLLIElement>, id: string) => {
    setDraggingId(id);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', id);
  };

  const onDragOverRow = (e: DragEvent<HTMLLIElement>, id: string) => {
    if (!draggingId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (id === draggingId) {
      if (dropTarget) setDropTarget(null);
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const position: 'above' | 'below' = e.clientY < rect.top + rect.height / 2 ? 'above' : 'below';
    if (dropTarget?.id !== id || dropTarget?.position !== position) {
      setDropTarget({ id, position });
    }
  };

  const onDrop = (e: DragEvent<HTMLOListElement>) => {
    e.preventDefault();
    if (!draggingId || !dropTarget) {
      clearDrag();
      return;
    }
    const fromArr = shapes.findIndex((s) => s.id === draggingId);
    if (fromArr === -1) return clearDrag();
    const temp = shapes.slice();
    temp.splice(fromArr, 1);
    const targetTempIdx = temp.findIndex((s) => s.id === dropTarget.id);
    if (targetTempIdx === -1) return clearDrag();
    // Visual list is reversed (top of list = last array element / top of z-stack),
    // so dropping "above" the target means inserting *after* it in the array.
    const insertAt = dropTarget.position === 'above' ? targetTempIdx + 1 : targetTempIdx;
    reorderShape(fromArr, insertAt);
    clearDrag();
  };

  if (shapes.length === 0) {
    return (
      <section className="panel">
        <p className="hint">No layers yet — draw a line, polygon, or circle.</p>
      </section>
    );
  }

  const visual = shapes.toReversed();

  return (
    <section className="panel">
      <ol
        className="layer-list"
        onDrop={onDrop}
        onDragOver={(e) => {
          if (draggingId) e.preventDefault();
        }}
      >
        {visual.map((shape) => {
          const isSelected = shape.id === selectedShapeId;
          const isDragging = shape.id === draggingId;
          const drop = dropTarget?.id === shape.id ? dropTarget.position : null;
          const cls = [
            'layer-row',
            isSelected ? 'selected' : '',
            isDragging ? 'dragging' : '',
            shape.hidden ? 'is-hidden' : '',
            shape.locked ? 'is-locked' : '',
            drop === 'above' ? 'drop-above' : '',
            drop === 'below' ? 'drop-below' : '',
          ]
            .filter(Boolean)
            .join(' ');
          return (
            <li
              key={shape.id}
              className={cls}
              draggable
              onDragStart={(e) => onDragStart(e, shape.id)}
              onDragOver={(e) => onDragOverRow(e, shape.id)}
              onDragEnd={clearDrag}
              onClick={() => selectShape(shape.id)}
            >
              <span className="layer-handle" aria-hidden>
                <DragHandleIcon />
              </span>
              <button
                type="button"
                className="layer-icon-btn"
                title={shape.hidden ? 'Show layer' : 'Hide layer'}
                onClick={(e) => {
                  e.stopPropagation();
                  toggleShapeVisibility(shape.id);
                }}
              >
                {shape.hidden ? <EyeOffIcon /> : <EyeIcon />}
              </button>
              <button
                type="button"
                className="layer-icon-btn"
                title={shape.locked ? 'Unlock layer' : 'Lock layer'}
                onClick={(e) => {
                  e.stopPropagation();
                  toggleShapeLock(shape.id);
                }}
              >
                {shape.locked ? <LockIcon /> : <UnlockIcon />}
              </button>
              <ShapePreview shape={shape} bezier={effectiveBezier(shape, settings)} />
              <Swatches shape={shape} />
              {editingId === shape.id ? (
                <NameInput
                  initial={shape.name ?? defaultLayerName(shape)}
                  onCommit={(v) => {
                    renameShape(shape.id, v);
                    setEditingId(null);
                  }}
                  onCancel={() => setEditingId(null)}
                />
              ) : (
                <span
                  className="layer-name"
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    setEditingId(shape.id);
                  }}
                >
                  {shape.name || defaultLayerName(shape)}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function defaultLayerName(shape: Shape): string {
  if (shape.kind === 'circle') return 'circle';
  return shape.closed ? 'polygon' : 'line';
}

function NameInput({
  initial,
  onCommit,
  onCancel,
}: {
  initial: string;
  onCommit: (v: string) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(initial);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  return (
    <input
      ref={ref}
      className="layer-name-input"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => onCommit(value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          onCommit(value);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          onCancel();
        }
        e.stopPropagation();
      }}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    />
  );
}

function Swatches({ shape }: { shape: Shape }) {
  if (shape.closed) {
    return (
      <span className="layer-swatches" aria-hidden>
        <Swatch color={shape.fill} title={`Fill ${shape.fill}`} />
        <Swatch color={shape.stroke} title={`Stroke ${shape.stroke}`} />
      </span>
    );
  }
  return (
    <span className="layer-swatches" aria-hidden>
      <Swatch color={shape.stroke} title={`Stroke ${shape.stroke}`} />
    </span>
  );
}

function Swatch({ color, title }: { color: string; title: string }) {
  const isNone = !color || color === 'none' || color === 'transparent';
  return (
    <span
      className={`layer-swatch${isNone ? ' is-none' : ''}`}
      style={isNone ? undefined : { background: color }}
      title={title}
    />
  );
}

function ShapePreview({ shape, bezier }: { shape: Shape; bezier: number }) {
  const fill = shape.closed ? (shape.fill === 'none' ? 'transparent' : shape.fill) : 'none';
  const stroke = shape.stroke === 'none' ? 'transparent' : shape.stroke;
  const pad = 1;
  if (shape.kind === 'circle' && shape.points.length >= 2) {
    const [cx, cy] = shape.points[0];
    const r = dist(shape.points[0], shape.points[1]) || 0.0001;
    const vb = `${cx - r - pad} ${cy - r - pad} ${r * 2 + pad * 2} ${r * 2 + pad * 2}`;
    return (
      <span className="layer-preview" aria-hidden>
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
    );
  }
  const box = bbox(shape.points);
  const w = Math.max(box.w, 0.0001);
  const h = Math.max(box.h, 0.0001);
  const vb = `${box.x - pad} ${box.y - pad} ${w + pad * 2} ${h + pad * 2}`;
  const d = pointsToPath(shape.points, shape.closed, bezier);
  return (
    <span className="layer-preview" aria-hidden>
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
  );
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
  );
}

function EyeIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14">
      <path
        d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      <circle cx="8" cy="8" r="2" fill="currentColor" />
    </svg>
  );
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
  );
}

function LockIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14">
      <rect x="3" y="7" width="10" height="7" fill="currentColor" rx="1" />
      <path d="M5.5 7V5a2.5 2.5 0 015 0v2" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function UnlockIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14">
      <rect
        x="3"
        y="7"
        width="10"
        height="7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        rx="1"
      />
      <path d="M5.5 7V5a2.5 2.5 0 015 0" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}
