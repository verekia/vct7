import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../store';
import { dist, isPartialArc } from '../lib/geometry';
import type { ArcRange, Shape } from '../types';

const HEX_RE = /^#[0-9a-f]{3}([0-9a-f]{3})?$/i;

const sanitizeColor = (c: string): string => {
  if (HEX_RE.test(c)) {
    if (c.length === 4) {
      return (
        '#' +
        c
          .slice(1)
          .split('')
          .map((ch) => ch + ch)
          .join('')
      );
    }
    return c;
  }
  return '#000000';
};

type ShapeKind = 'circle' | 'line' | 'polygon';

const kindOf = (sh: Shape): ShapeKind => {
  if (sh.kind === 'circle') return 'circle';
  return sh.closed ? 'polygon' : 'line';
};

const allSame = <T,>(values: T[]): boolean => values.every((v) => v === values[0]);

export function ShapePanel() {
  // Subscribe to the underlying primitives only — deriving the selected-shape
  // list inside the selector would return a fresh array each call and trip
  // Zustand's strict identity check (Maximum update depth exceeded).
  const shapes = useStore((s) => s.shapes);
  const selectedShapeIds = useStore((s) => s.selectedShapeIds);
  const globalBezier = useStore((s) => s.settings.bezier);
  const updateShape = useStore((s) => s.updateShape);
  const deleteShape = useStore((s) => s.deleteShape);
  const deleteShapes = useStore((s) => s.deleteShapes);

  const selectedShapes = useMemo(() => {
    const ids = new Set(selectedShapeIds);
    return shapes.filter((sh) => ids.has(sh.id));
  }, [shapes, selectedShapeIds]);

  if (selectedShapes.length === 0) {
    return (
      <section className="relative px-3.5 py-3 border-b border-line last:border-b-0">
        <p className="text-[11px] text-muted mt-1 leading-[1.55] tracking-[0.3px] border-l-2 border-accent-dim py-1 pl-2.5">
          No layer selected.
          <br />
          Pick one from the layers panel or use the Select tool (V) on the canvas.
        </p>
      </section>
    );
  }

  if (selectedShapes.length === 1) {
    return (
      <ShapePanelInner
        shape={selectedShapes[0]}
        globalBezier={globalBezier}
        updateShape={updateShape}
        deleteShape={deleteShape}
      />
    );
  }

  const kinds = selectedShapes.map(kindOf);
  if (!allSame(kinds)) {
    return (
      <section className="relative px-3.5 py-3 border-b border-line last:border-b-0">
        <p className="text-[11px] text-muted mt-1 leading-[1.55] tracking-[0.3px] border-l-2 border-accent-dim py-1 pl-2.5">
          {selectedShapes.length} layers selected — mixed types.
          <br />
          Pick layers of the same type to edit them together.
        </p>
      </section>
    );
  }

  return (
    <MultiShapePanel
      shapes={selectedShapes}
      kind={kinds[0]}
      globalBezier={globalBezier}
      updateShape={updateShape}
      deleteShapes={deleteShapes}
    />
  );
}

function ShapePanelInner({
  shape,
  globalBezier,
  updateShape,
  deleteShape,
}: {
  shape: Shape;
  globalBezier: number;
  updateShape: (id: string, patch: Partial<Shape>) => void;
  deleteShape: (id: string) => void;
}) {
  const [strokeText, setStrokeText] = useState(shape.stroke);
  const [fillText, setFillText] = useState(shape.fill);
  useEffect(() => setStrokeText(shape.stroke), [shape.stroke]);
  useEffect(() => setFillText(shape.fill), [shape.fill]);

  const bezierValue = shape.bezierOverride ?? globalBezier;
  const isCircle = shape.kind === 'circle';
  const partial = isCircle && isPartialArc(shape.arc);
  const arcOpen = partial && shape.arc!.style === 'open';
  const showFill = isCircle ? !arcOpen : shape.closed;
  const typeLabel = isCircle ? 'circle' : shape.closed ? 'polygon' : 'line';

  return (
    <section className="relative px-3.5 py-3 border-b border-line last:border-b-0">
      <div className="flex gap-1.5 items-center flex-wrap">
        <span className="text-muted w-[60px] text-[11px] tracking-[0.5px] uppercase">Type</span>
        <span className="text-text text-xs">{typeLabel}</span>
      </div>
      <div className="flex gap-1.5 items-center flex-wrap">
        <span className="text-muted w-[60px] text-[11px] tracking-[0.5px] uppercase">
          {isCircle ? 'Radius' : 'Points'}
        </span>
        <span className="text-text text-xs">
          {isCircle && shape.points.length >= 2
            ? dist(shape.points[0], shape.points[1]).toFixed(2)
            : shape.points.length}
        </span>
      </div>

      <label>
        <span>Stroke</span>
        <div className="flex gap-1.5 items-center flex-wrap">
          <input
            type="color"
            value={sanitizeColor(shape.stroke)}
            onChange={(e) => updateShape(shape.id, { stroke: e.target.value })}
          />
          <input
            type="text"
            value={strokeText}
            onChange={(e) => setStrokeText(e.target.value)}
            onBlur={() => {
              if (strokeText === 'none' || HEX_RE.test(strokeText)) {
                updateShape(shape.id, { stroke: strokeText });
              } else {
                setStrokeText(shape.stroke);
              }
            }}
          />
        </div>
      </label>

      <label>
        <span>Stroke width</span>
        <input
          type="number"
          min={0}
          step={0.5}
          value={shape.strokeWidth}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            if (Number.isFinite(v) && v >= 0) updateShape(shape.id, { strokeWidth: v });
          }}
        />
      </label>

      {showFill && (
        <label>
          <span>Fill</span>
          <div className="flex gap-1.5 items-center flex-wrap">
            <input
              type="color"
              value={sanitizeColor(shape.fill)}
              onChange={(e) => updateShape(shape.id, { fill: e.target.value })}
            />
            <input
              type="text"
              value={fillText}
              onChange={(e) => setFillText(e.target.value)}
              onBlur={() => {
                if (fillText === 'none' || HEX_RE.test(fillText)) {
                  updateShape(shape.id, { fill: fillText });
                } else {
                  setFillText(shape.fill);
                }
              }}
            />
            <button
              type="button"
              className="text-[11px] px-[7px] py-[2px]"
              onClick={() => updateShape(shape.id, { fill: 'none' })}
            >
              none
            </button>
          </div>
        </label>
      )}

      {isCircle && <ArcControls shape={shape} updateShape={updateShape} />}

      {!isCircle && (
        <label>
          <span className="flex gap-1.5 items-center flex-wrap">
            <span style={{ flex: 1 }}>Bezier override</span>
            {shape.bezierOverride !== null && (
              <button
                type="button"
                className="text-[11px] px-[7px] py-[2px]"
                onClick={() => updateShape(shape.id, { bezierOverride: null })}
              >
                use global
              </button>
            )}
          </span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={bezierValue}
            onChange={(e) => updateShape(shape.id, { bezierOverride: parseFloat(e.target.value) })}
          />
          <span className="text-text tabular-nums">
            {shape.bezierOverride === null
              ? `— (global ${globalBezier.toFixed(2)})`
              : shape.bezierOverride.toFixed(2)}
          </span>
        </label>
      )}

      <div className="flex gap-1.5 items-center flex-wrap">
        <button
          type="button"
          className="text-accent hover:bg-accent hover:text-white hover:border-accent"
          onClick={() => deleteShape(shape.id)}
        >
          Delete shape
        </button>
      </div>
    </section>
  );
}

function ArcControls({
  shape,
  updateShape,
}: {
  shape: Shape;
  updateShape: (id: string, patch: Partial<Shape>) => void;
}) {
  const arc = shape.arc;
  const partial = isPartialArc(arc);
  const enable = () => {
    const next: ArcRange = arc ?? { start: 0, end: 180, style: 'chord' };
    updateShape(shape.id, { arc: next });
  };
  const disable = () => updateShape(shape.id, { arc: undefined });
  const setField = (patch: Partial<ArcRange>) => {
    if (!arc) return;
    updateShape(shape.id, { arc: { ...arc, ...patch } });
  };

  return (
    <>
      <label>
        <span className="flex gap-1.5 items-center flex-wrap">
          <span style={{ flex: 1 }}>Partial arc</span>
          <input
            type="checkbox"
            checked={partial}
            onChange={(e) => (e.target.checked ? enable() : disable())}
          />
        </span>
      </label>
      {partial && arc && (
        <>
          <label>
            <span>Start angle</span>
            <input
              type="number"
              step={1}
              value={arc.start}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                if (Number.isFinite(v)) setField({ start: v });
              }}
            />
          </label>
          <label>
            <span>End angle</span>
            <input
              type="number"
              step={1}
              value={arc.end}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                if (Number.isFinite(v)) setField({ end: v });
              }}
            />
          </label>
          <label>
            <span>Style</span>
            <select
              value={arc.style}
              onChange={(e) => setField({ style: e.target.value as ArcRange['style'] })}
            >
              <option value="wedge">Wedge (pie slice)</option>
              <option value="chord">Chord (D-shape)</option>
              <option value="open">Open arc</option>
            </select>
          </label>
        </>
      )}
    </>
  );
}

/**
 * Multi-shape inspector. All edits dispatch updateShape per id, so each shape
 * stores its own copy of the new value (independent updates, not group state).
 * Inputs display the value when uniform across the selection, and a "Mixed"
 * placeholder when values differ — until the user types something, at which
 * point that uniform value is written everywhere.
 */
function MultiShapePanel({
  shapes,
  kind,
  globalBezier,
  updateShape,
  deleteShapes,
}: {
  shapes: Shape[];
  kind: ShapeKind;
  globalBezier: number;
  updateShape: (id: string, patch: Partial<Shape>) => void;
  deleteShapes: (ids: string[]) => void;
}) {
  const showFill = kind !== 'line';
  const showBezier = kind !== 'circle';

  const strokes = shapes.map((s) => s.stroke);
  const fills = shapes.map((s) => s.fill);
  const widths = shapes.map((s) => s.strokeWidth);
  const overrides = shapes.map((s) => s.bezierOverride);
  const strokeUniform = allSame(strokes);
  const fillUniform = allSame(fills);
  const widthUniform = allSame(widths);
  const overrideUniform = allSame(overrides);

  const [strokeText, setStrokeText] = useState(strokeUniform ? strokes[0] : '');
  const [fillText, setFillText] = useState(fillUniform ? fills[0] : '');
  // Resync the typed-input value when the underlying selection changes — but
  // only when the *displayed* value would change. Joining is just to derive
  // a primitive identity for the deps array (arrays change every render).
  const strokeKey = strokes.join('|');
  const fillKey = fills.join('|');
  useEffect(() => {
    setStrokeText(strokeUniform ? strokes[0] : '');
    // strokes is captured via the strokeKey identity above
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strokeUniform, strokeKey]);
  useEffect(() => {
    setFillText(fillUniform ? fills[0] : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fillUniform, fillKey]);

  const applyAll = (patch: Partial<Shape>) => {
    for (const s of shapes) updateShape(s.id, patch);
  };

  const bezierForRange = overrideUniform && overrides[0] !== null ? overrides[0] : globalBezier;

  const typeLabel = kind === 'circle' ? `${shapes.length} circles` : `${shapes.length} ${kind}s`;

  return (
    <section className="relative px-3.5 py-3 border-b border-line last:border-b-0">
      <div className="flex gap-1.5 items-center flex-wrap">
        <span className="text-muted w-[60px] text-[11px] tracking-[0.5px] uppercase">Type</span>
        <span className="text-text text-xs">{typeLabel}</span>
      </div>

      <label>
        <span>Stroke</span>
        <div className="flex gap-1.5 items-center flex-wrap">
          <input
            type="color"
            value={sanitizeColor(strokeUniform ? strokes[0] : '#000000')}
            onChange={(e) => applyAll({ stroke: e.target.value })}
          />
          <input
            type="text"
            value={strokeText}
            placeholder={strokeUniform ? '' : 'Mixed'}
            onChange={(e) => setStrokeText(e.target.value)}
            onBlur={() => {
              if (strokeText === 'none' || HEX_RE.test(strokeText)) {
                applyAll({ stroke: strokeText });
              } else {
                setStrokeText(strokeUniform ? strokes[0] : '');
              }
            }}
          />
        </div>
      </label>

      <label>
        <span>Stroke width</span>
        <input
          type="number"
          min={0}
          step={0.5}
          value={widthUniform ? widths[0] : ''}
          placeholder={widthUniform ? '' : 'Mixed'}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            if (Number.isFinite(v) && v >= 0) applyAll({ strokeWidth: v });
          }}
        />
      </label>

      {showFill && (
        <label>
          <span>Fill</span>
          <div className="flex gap-1.5 items-center flex-wrap">
            <input
              type="color"
              value={sanitizeColor(fillUniform ? fills[0] : '#000000')}
              onChange={(e) => applyAll({ fill: e.target.value })}
            />
            <input
              type="text"
              value={fillText}
              placeholder={fillUniform ? '' : 'Mixed'}
              onChange={(e) => setFillText(e.target.value)}
              onBlur={() => {
                if (fillText === 'none' || HEX_RE.test(fillText)) {
                  applyAll({ fill: fillText });
                } else {
                  setFillText(fillUniform ? fills[0] : '');
                }
              }}
            />
            <button
              type="button"
              className="text-[11px] px-[7px] py-[2px]"
              onClick={() => applyAll({ fill: 'none' })}
            >
              none
            </button>
          </div>
        </label>
      )}

      {showBezier && (
        <label>
          <span className="flex gap-1.5 items-center flex-wrap">
            <span style={{ flex: 1 }}>Bezier override</span>
            {overrides.some((o) => o !== null) && (
              <button
                type="button"
                className="text-[11px] px-[7px] py-[2px]"
                onClick={() => applyAll({ bezierOverride: null })}
              >
                use global
              </button>
            )}
          </span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={bezierForRange}
            onChange={(e) => applyAll({ bezierOverride: parseFloat(e.target.value) })}
          />
          <span className="text-text tabular-nums">
            {!overrideUniform
              ? 'Mixed'
              : overrides[0] === null
                ? `— (global ${globalBezier.toFixed(2)})`
                : overrides[0]!.toFixed(2)}
          </span>
        </label>
      )}

      <div className="flex gap-1.5 items-center flex-wrap">
        <button
          type="button"
          className="text-accent hover:bg-accent hover:text-white hover:border-accent"
          onClick={() => deleteShapes(shapes.map((s) => s.id))}
        >
          Delete {shapes.length} shapes
        </button>
      </div>
    </section>
  );
}
