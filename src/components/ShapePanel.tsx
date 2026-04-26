import { useEffect, useState } from 'react';
import { useStore } from '../store';
import type { Shape } from '../types';

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

export function ShapePanel() {
  const shape = useStore((s) =>
    s.selectedShapeId ? (s.shapes.find((sh) => sh.id === s.selectedShapeId) ?? null) : null,
  );
  const globalBezier = useStore((s) => s.settings.bezier);
  const updateShape = useStore((s) => s.updateShape);
  const deleteShape = useStore((s) => s.deleteShape);

  if (!shape) {
    return (
      <section className="panel inspector-empty">
        <h2>Inspector</h2>
        <p className="hint">
          No layer selected.
          <br />
          Pick one from the layers panel or use the Select tool (V) on the canvas.
        </p>
      </section>
    );
  }

  return (
    <ShapePanelInner
      shape={shape}
      globalBezier={globalBezier}
      updateShape={updateShape}
      deleteShape={deleteShape}
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

  return (
    <section className="panel">
      <h2>Inspector</h2>
      <div className="row">
        <span className="kv-key">Type</span>
        <span className="kv-value">{shape.closed ? 'polygon' : 'line'}</span>
      </div>
      <div className="row">
        <span className="kv-key">Points</span>
        <span className="kv-value">{shape.points.length}</span>
      </div>

      <label>
        <span>Stroke</span>
        <div className="row">
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

      {shape.closed && (
        <label>
          <span>Fill</span>
          <div className="row">
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
              className="small"
              onClick={() => updateShape(shape.id, { fill: 'none' })}
            >
              none
            </button>
          </div>
        </label>
      )}

      <label>
        <span className="row">
          <span style={{ flex: 1 }}>Bezier override</span>
          {shape.bezierOverride !== null && (
            <button
              type="button"
              className="small"
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
        <span className="num">
          {shape.bezierOverride === null
            ? `— (global ${globalBezier.toFixed(2)})`
            : shape.bezierOverride.toFixed(2)}
        </span>
      </label>

      <div className="row">
        <button type="button" className="danger" onClick={() => deleteShape(shape.id)}>
          Delete shape
        </button>
      </div>
    </section>
  );
}
