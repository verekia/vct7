import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../store';
import { dist, isPartialArc } from '../lib/geometry';
import { hasTransform, shapeRotation, shapeScale } from '../lib/transform';
import type {
  AnimationFromState,
  AnimationSpec,
  ArcRange,
  BlendMode,
  Easing,
  Shape,
  SpinSpec,
  StrokeLinecap,
  StrokeLinejoin,
} from '../types';
import { BLEND_MODES, EASINGS, STROKE_LINECAPS, STROKE_LINEJOINS } from '../types';

const blendValue = (b: BlendMode | undefined): BlendMode => b ?? 'normal';
const blendPatch = (v: string): Partial<Shape> => ({
  blendMode: v === 'normal' ? undefined : (v as BlendMode),
});

/**
 * Round `angle` (in degrees) to the nearest entry of `snapAngles`, accounting
 * for the [0, 360) wrap so a -10° input snaps to 350° rather than 0° when
 * 350° is the nearer angle. Returns the unmodified angle when there are no
 * snap angles defined.
 */
const nearestSnapAngle = (angle: number, snapAngles: number[]): number => {
  if (snapAngles.length === 0) return angle;
  const norm = ((angle % 360) + 360) % 360;
  let best = snapAngles[0];
  let bestDist = Infinity;
  for (const sa of snapAngles) {
    const saNorm = ((sa % 360) + 360) % 360;
    const d = Math.min(Math.abs(norm - saNorm), 360 - Math.abs(norm - saNorm));
    if (d < bestDist) {
      bestDist = d;
      best = saNorm;
    }
  }
  // Map back into roughly the same half-turn the user is in. Without this the
  // rotation slider would jump from -170° straight to +180° instead of the
  // visually-equivalent -180°.
  if (angle < 0 && best > 180) return best - 360;
  return best;
};

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

type ShapeKind = 'circle' | 'line' | 'polygon' | 'text';

const kindOf = (sh: Shape): ShapeKind => {
  if (sh.kind === 'glyphs') return 'text';
  if (sh.kind === 'circle') return 'circle';
  return sh.closed ? 'polygon' : 'line';
};

const allSame = <T,>(values: T[]): boolean => values.every((v) => v === values[0]);

function TrashIcon() {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
      <path
        d="M3 4h10M6.5 4V2.5h3V4M5 4l1 9.5h4L11 4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const PAINT_ROW = 'flex gap-1.5 items-center';
const PAINT_INPUT = 'flex-1 min-w-0';
const CLEAR_BTN = 'px-1.5 py-1 inline-flex items-center justify-center';

export function ShapePanel() {
  // Subscribe to the underlying primitives only — deriving the selected-shape
  // list inside the selector would return a fresh array each call and trip
  // Zustand's strict identity check (Maximum update depth exceeded).
  const shapes = useStore((s) => s.shapes);
  const selectedShapeIds = useStore((s) => s.selectedShapeIds);
  const globalBezier = useStore((s) => s.settings.bezier);
  const snapAngles = useStore((s) => s.settings.snapAngles);
  const animationEnabled = useStore((s) => s.settings.animationEnabled);
  const snapDisabled = useStore((s) => s.snapDisabled);
  const updateShape = useStore((s) => s.updateShape);
  const deleteShape = useStore((s) => s.deleteShape);
  const deleteShapes = useStore((s) => s.deleteShapes);
  const applyBlending = useStore((s) => s.applyBlending);
  const applyOpacity = useStore((s) => s.applyOpacity);
  const applyTransform = useStore((s) => s.applyTransform);

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
        snapAngles={snapAngles}
        animationEnabled={animationEnabled}
        snapDisabled={snapDisabled}
        updateShape={updateShape}
        deleteShape={deleteShape}
        applyBlending={applyBlending}
        applyOpacity={applyOpacity}
        applyTransform={applyTransform}
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
      snapAngles={snapAngles}
      snapDisabled={snapDisabled}
      updateShape={updateShape}
      deleteShapes={deleteShapes}
      applyBlending={applyBlending}
      applyOpacity={applyOpacity}
      applyTransform={applyTransform}
    />
  );
}

const APPLY_BTN =
  'text-[11px] px-[7px] py-[2px] bg-[#2563eb] text-white border-[#3b82f6] hover:bg-[#1d4ed8] hover:border-[#60a5fa] hover:text-white';

/**
 * Linejoin / linecap / dasharray inputs. Visibility is gated by the caller
 * (only meaningful when stroke isn't 'none'); join/cap selects are hidden for
 * full circles since `<circle>` has no joins to style.
 *
 * `mixed` flags are passed in from the multi-shape caller — when true, the
 * select shows a "Mixed" placeholder option until the user picks a value, at
 * which point that uniform value is written across the selection.
 *
 * Dasharray is a free-form text input so users can enter any valid SVG
 * dasharray syntax (e.g. `"4 2"`, `"1,3"`, `"5 2 1 2"`); we forward it
 * verbatim and clear it on empty/blank input.
 */
function StrokeStyleControls({
  linejoin,
  linecap,
  dasharray,
  strokeUnderFill,
  showJoinCap,
  linejoinMixed,
  linecapMixed,
  dasharrayMixed,
  paintOrderMixed,
  onLinejoin,
  onLinecap,
  onDasharray,
  onStrokeUnderFill,
}: {
  linejoin: StrokeLinejoin;
  linecap: StrokeLinecap;
  dasharray: string;
  strokeUnderFill: boolean;
  showJoinCap: boolean;
  linejoinMixed?: boolean;
  linecapMixed?: boolean;
  dasharrayMixed?: boolean;
  paintOrderMixed?: boolean;
  onLinejoin: (v: StrokeLinejoin) => void;
  onLinecap: (v: StrokeLinecap) => void;
  onDasharray: (v: string) => void;
  onStrokeUnderFill: (v: boolean) => void;
}) {
  const [dashText, setDashText] = useState(dasharray);
  const dashKey = dasharrayMixed ? '__mixed__' : dasharray;
  useEffect(() => {
    setDashText(dasharrayMixed ? '' : dasharray);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dashKey]);

  return (
    <>
      {showJoinCap && (
        <>
          <label>
            <span>Line join</span>
            <select
              value={linejoinMixed ? '' : linejoin}
              onChange={(e) => onLinejoin(e.target.value as StrokeLinejoin)}
            >
              {linejoinMixed && (
                <option value="" disabled>
                  Mixed
                </option>
              )}
              {STROKE_LINEJOINS.map((j) => (
                <option key={j} value={j}>
                  {j}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Line cap</span>
            <select
              value={linecapMixed ? '' : linecap}
              onChange={(e) => onLinecap(e.target.value as StrokeLinecap)}
            >
              {linecapMixed && (
                <option value="" disabled>
                  Mixed
                </option>
              )}
              {STROKE_LINECAPS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
        </>
      )}
      <label>
        <span>Dash array</span>
        <input
          type="text"
          value={dashText}
          placeholder={dasharrayMixed ? 'Mixed' : 'solid (e.g. 4 2)'}
          onChange={(e) => setDashText(e.target.value)}
          onBlur={() => onDasharray(dashText.trim())}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
        />
      </label>
      <label>
        <span className="flex gap-1.5 items-center flex-wrap">
          <span style={{ flex: 1 }}>Stroke under fill</span>
          <input
            type="checkbox"
            checked={!paintOrderMixed && strokeUnderFill}
            ref={(el) => {
              if (el) el.indeterminate = !!paintOrderMixed;
            }}
            onChange={(e) => onStrokeUnderFill(e.target.checked)}
            title="Paint stroke under the fill (SVG paint-order=stroke). Useful for outlined text and chunky icon strokes."
          />
        </span>
      </label>
    </>
  );
}

const opacityValue = (s: Shape): number => s.opacity ?? 1;

function ShapePanelInner({
  shape,
  globalBezier,
  snapAngles,
  animationEnabled,
  snapDisabled,
  updateShape,
  deleteShape,
  applyBlending,
  applyOpacity,
  applyTransform,
}: {
  shape: Shape;
  globalBezier: number;
  snapAngles: number[];
  animationEnabled: boolean;
  snapDisabled: boolean;
  updateShape: (id: string, patch: Partial<Shape>) => void;
  deleteShape: (id: string) => void;
  applyBlending: (ids: string[]) => void;
  applyOpacity: (ids: string[]) => void;
  applyTransform: (ids: string[]) => void;
}) {
  const [strokeText, setStrokeText] = useState(shape.stroke);
  const [fillText, setFillText] = useState(shape.fill);
  useEffect(() => setStrokeText(shape.stroke), [shape.stroke]);
  useEffect(() => setFillText(shape.fill), [shape.fill]);

  const bezierValue = shape.bezierOverride ?? globalBezier;
  const isCircle = shape.kind === 'circle';
  const isGlyphs = shape.kind === 'glyphs' && !!shape.glyphs;
  const partial = isCircle && isPartialArc(shape.arc);
  const arcOpen = partial && shape.arc!.style === 'open';
  const showFill = isGlyphs ? true : isCircle ? !arcOpen : shape.closed;
  const showBezierOverride = !isCircle && !isGlyphs;
  const typeLabel = isGlyphs ? 'text' : isCircle ? 'circle' : shape.closed ? 'polygon' : 'line';

  return (
    <section className="relative px-3.5 py-3 border-b border-line last:border-b-0">
      <div className="flex gap-1.5 items-center flex-wrap">
        <span className="text-muted w-[60px] text-[11px] tracking-[0.5px] uppercase">Type</span>
        <span className="text-text text-xs">{typeLabel}</span>
      </div>
      {isGlyphs && shape.glyphs ? (
        <>
          <div className="flex gap-1.5 items-center flex-wrap">
            <span className="text-muted w-[60px] text-[11px] tracking-[0.5px] uppercase">Text</span>
            <span className="text-text text-xs truncate" title={shape.glyphs.text}>
              {shape.glyphs.text || <em className="text-muted">empty</em>}
            </span>
          </div>
          <div className="flex gap-1.5 items-center flex-wrap">
            <span className="text-muted w-[60px] text-[11px] tracking-[0.5px] uppercase">Font</span>
            <span className="text-text text-xs truncate" title={shape.glyphs.fontFamily}>
              {shape.glyphs.fontFamily}
            </span>
          </div>
          <div className="flex gap-1.5 items-center flex-wrap">
            <span className="text-muted w-[60px] text-[11px] tracking-[0.5px] uppercase">Size</span>
            <span className="text-text text-xs tabular-nums">
              {shape.glyphs.fontSize.toFixed(0)} u · {shape.glyphs.width.toFixed(1)}×
              {shape.glyphs.height.toFixed(1)}
            </span>
          </div>
        </>
      ) : (
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
      )}

      <label>
        <span>Stroke</span>
        <div className={PAINT_ROW}>
          <input
            type="color"
            value={sanitizeColor(shape.stroke)}
            onChange={(e) => updateShape(shape.id, { stroke: e.target.value })}
          />
          <input
            type="text"
            className={PAINT_INPUT}
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
          {shape.stroke !== 'none' && (
            <>
              <input
                type="number"
                min={0}
                step={0.5}
                title="Stroke width"
                value={shape.strokeWidth}
                onChange={(e) => {
                  const v = parseFloat(e.target.value);
                  if (Number.isFinite(v) && v >= 0) updateShape(shape.id, { strokeWidth: v });
                }}
              />
              <button
                type="button"
                className={CLEAR_BTN}
                title="Remove stroke"
                onClick={() => updateShape(shape.id, { stroke: 'none' })}
              >
                <TrashIcon />
              </button>
            </>
          )}
        </div>
      </label>

      {shape.stroke !== 'none' && (
        <StrokeStyleControls
          linejoin={shape.strokeLinejoin ?? 'round'}
          linecap={shape.strokeLinecap ?? 'round'}
          dasharray={shape.strokeDasharray ?? ''}
          strokeUnderFill={shape.paintOrder === 'stroke'}
          showJoinCap={!(isCircle && !partial)}
          onLinejoin={(v) =>
            updateShape(shape.id, { strokeLinejoin: v === 'round' ? undefined : v })
          }
          onLinecap={(v) => updateShape(shape.id, { strokeLinecap: v === 'round' ? undefined : v })}
          onDasharray={(v) => updateShape(shape.id, { strokeDasharray: v === '' ? undefined : v })}
          onStrokeUnderFill={(v) => updateShape(shape.id, { paintOrder: v ? 'stroke' : undefined })}
        />
      )}

      {showFill && (
        <label>
          <span>Fill</span>
          <div className={PAINT_ROW}>
            <input
              type="color"
              value={sanitizeColor(shape.fill)}
              onChange={(e) => updateShape(shape.id, { fill: e.target.value })}
            />
            <input
              type="text"
              className={PAINT_INPUT}
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
            {shape.fill !== 'none' && (
              <button
                type="button"
                className={CLEAR_BTN}
                title="Remove fill"
                onClick={() => updateShape(shape.id, { fill: 'none' })}
              >
                <TrashIcon />
              </button>
            )}
          </div>
        </label>
      )}

      <label>
        <span className="flex gap-1.5 items-center flex-wrap">
          <span style={{ flex: 1 }}>Blend mode</span>
          {shape.blendMode && shape.blendMode !== 'normal' && (
            <button
              type="button"
              className={APPLY_BTN}
              onClick={() => applyBlending([shape.id])}
              title="Bake this blend mode into the fill / stroke so the SVG renders correctly without mix-blend-mode support."
            >
              Apply blending
            </button>
          )}
        </span>
        <select
          value={blendValue(shape.blendMode)}
          onChange={(e) => updateShape(shape.id, blendPatch(e.target.value))}
        >
          {BLEND_MODES.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </label>

      <label>
        <span className="flex gap-1.5 items-center flex-wrap">
          <span style={{ flex: 1 }}>Opacity</span>
          {opacityValue(shape) < 1 && (
            <button
              type="button"
              className={APPLY_BTN}
              onClick={() => applyOpacity([shape.id])}
              title="Bake this opacity into the fill / stroke by alpha-compositing against the layer below, then reset opacity to 1."
            >
              Apply opacity
            </button>
          )}
        </span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={opacityValue(shape)}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            updateShape(shape.id, { opacity: v >= 1 ? undefined : v });
          }}
        />
        <span className="text-text tabular-nums">{opacityValue(shape).toFixed(2)}</span>
      </label>

      <TransformControls
        rotation={shapeRotation(shape)}
        scale={shapeScale(shape)}
        rotationMixed={false}
        scaleMixed={false}
        snapAngles={snapAngles}
        snapDisabled={snapDisabled}
        canBake={hasTransform(shape) && shape.kind !== 'glyphs'}
        onRotation={(r) => updateShape(shape.id, { rotation: r === 0 ? undefined : r })}
        onScale={(sc) => updateShape(shape.id, { scale: sc === 1 ? undefined : sc })}
        onReset={() => updateShape(shape.id, { rotation: undefined, scale: undefined })}
        onApply={() => applyTransform([shape.id])}
        isGlyphs={shape.kind === 'glyphs'}
      />

      {isCircle && <ArcControls shape={shape} updateShape={updateShape} />}

      {showBezierOverride && (
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

      <AnimationControls
        shape={shape}
        animationEnabled={animationEnabled}
        updateShape={updateShape}
      />

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

/**
 * Rotation + uniform-scale inputs. Wired so single- and multi-shape panels can
 * share the same UI surface — callers choose how to fan the new value out.
 *
 * `rotationMixed` / `scaleMixed` flag heterogeneous selections; the slider
 * still moves the underlying value (committing to whatever it lands on), but
 * the readout shows "Mixed". Snap-to-snapAngle kicks in when the user drags
 * the slider with snap enabled — Shift disables it (matching canvas snap).
 * The numeric input always takes the typed value verbatim.
 */
function TransformControls({
  rotation,
  scale,
  rotationMixed,
  scaleMixed,
  snapAngles,
  snapDisabled,
  canBake,
  isGlyphs,
  onRotation,
  onScale,
  onReset,
  onApply,
}: {
  rotation: number;
  scale: number;
  rotationMixed: boolean;
  scaleMixed: boolean;
  snapAngles: number[];
  snapDisabled: boolean;
  canBake: boolean;
  isGlyphs: boolean;
  onRotation: (v: number) => void;
  onScale: (v: number) => void;
  onReset: () => void;
  onApply: () => void;
}) {
  const showReset = !rotationMixed && !scaleMixed && (rotation !== 0 || scale !== 1);
  return (
    <>
      <label>
        <span className="flex gap-1.5 items-center flex-wrap">
          <span style={{ flex: 1 }}>Rotation</span>
          {snapAngles.length > 0 && (
            <span className="text-[10px] text-muted-2 normal-case tracking-normal">
              {snapDisabled ? 'free' : 'snap'}
            </span>
          )}
        </span>
        <div className="flex gap-1.5 items-center flex-wrap">
          <input
            type="range"
            min={-180}
            max={180}
            step={1}
            value={rotation}
            onChange={(e) => {
              const raw = parseFloat(e.target.value);
              if (!Number.isFinite(raw)) return;
              const v =
                snapDisabled || snapAngles.length === 0 ? raw : nearestSnapAngle(raw, snapAngles);
              onRotation(v);
            }}
          />
          <input
            type="number"
            step={1}
            value={rotationMixed ? '' : rotation.toFixed(0)}
            placeholder={rotationMixed ? 'Mixed' : ''}
            onChange={(e) => {
              const v = parseFloat(e.target.value);
              if (Number.isFinite(v)) onRotation(v);
            }}
          />
        </div>
      </label>

      <label>
        <span>Scale</span>
        <div className="flex gap-1.5 items-center flex-wrap">
          <input
            type="range"
            min={0.1}
            max={5}
            step={0.01}
            value={scale}
            onChange={(e) => {
              const v = parseFloat(e.target.value);
              if (Number.isFinite(v) && v > 0) onScale(v);
            }}
          />
          <input
            type="number"
            min={0.01}
            step={0.1}
            value={scaleMixed ? '' : scale.toFixed(2)}
            placeholder={scaleMixed ? 'Mixed' : ''}
            onChange={(e) => {
              const v = parseFloat(e.target.value);
              if (Number.isFinite(v) && v > 0) onScale(v);
            }}
          />
        </div>
      </label>

      {(showReset || canBake) && (
        <div className="flex gap-1.5 items-center flex-wrap">
          {showReset && (
            <button type="button" className="text-[11px] px-[7px] py-[2px]" onClick={onReset}>
              Reset transform
            </button>
          )}
          {canBake && (
            <button
              type="button"
              className={APPLY_BTN}
              onClick={onApply}
              title="Bake the rotation / scale into the shape's points and reset back to identity. Required before editing vertices on a transformed shape."
            >
              Apply transform
            </button>
          )}
          {isGlyphs && (rotation !== 0 || scale !== 1) && (
            <span className="text-[10px] text-muted-2 normal-case tracking-normal">
              live transform — text shapes can&apos;t be baked
            </span>
          )}
        </div>
      )}
    </>
  );
}

/**
 * Default spec applied when the user enables animation on a shape — every
 * channel starts at identity, so toggling the checkbox is purely declarative
 * (the shape is "animated" but with no visible offsets). The user opts into
 * each channel — opacity, rotation, scale, translate, color, spin — explicitly.
 */
const DEFAULT_ANIMATION: AnimationSpec = {
  duration: 600,
  delay: 0,
  easing: 'ease-out',
  from: {},
};

const fromField = (spec: AnimationSpec, patch: Partial<AnimationFromState>): AnimationSpec => ({
  ...spec,
  from: { ...spec.from, ...patch },
});

/**
 * Numeric input that treats empty / NaN as "no offset on this channel" and
 * stores undefined rather than 0 — keeps the spec free of redundant fields and
 * lets users blank out an offset without fighting the input. The placeholder
 * shows the implicit identity value (e.g. "0" for translate) so an empty input
 * isn't ambiguous.
 */
function NumField({
  value,
  placeholder,
  step = 1,
  onChange,
}: {
  value: number | undefined;
  placeholder: number;
  step?: number;
  onChange: (v: number | undefined) => void;
}) {
  return (
    <input
      type="number"
      step={step}
      value={value ?? ''}
      placeholder={placeholder.toString()}
      onChange={(e) => {
        const raw = e.target.value;
        if (raw === '') return onChange(undefined);
        const v = parseFloat(raw);
        if (Number.isFinite(v)) onChange(v);
      }}
    />
  );
}

function AnimationControls({
  shape,
  animationEnabled,
  updateShape,
}: {
  shape: Shape;
  animationEnabled: boolean;
  updateShape: (id: string, patch: Partial<Shape>) => void;
}) {
  const anim = shape.animation;
  const set = (next: AnimationSpec | undefined) => updateShape(shape.id, { animation: next });
  const updateFrom = (patch: Partial<AnimationFromState>) => {
    if (!anim) return;
    set(fromField(anim, patch));
  };

  return (
    <section
      className="border-t border-line pt-2.5 mt-2.5"
      style={{ opacity: animationEnabled ? 1 : 0.55 }}
    >
      <div className="flex gap-1.5 items-center flex-wrap mb-1.5">
        <span className="text-muted text-[11px] tracking-[0.5px] uppercase flex-1">Animation</span>
        <input
          type="checkbox"
          checked={!!anim}
          onChange={(e) =>
            set(
              e.target.checked
                ? { ...DEFAULT_ANIMATION, from: { ...DEFAULT_ANIMATION.from } }
                : undefined,
            )
          }
        />
      </div>

      {!animationEnabled && anim && (
        <p className="text-[10px] text-muted-2 tracking-normal normal-case mb-2 leading-snug">
          Project animations are off — toggle in Project panel to preview.
        </p>
      )}

      {anim && (
        <>
          <label>
            <span>Duration (ms)</span>
            <input
              type="number"
              min={0}
              step={50}
              value={anim.duration}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                if (Number.isFinite(v) && v >= 0) set({ ...anim, duration: v });
              }}
            />
          </label>
          <label>
            <span>Delay (ms)</span>
            <input
              type="number"
              min={0}
              step={50}
              value={anim.delay}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                if (Number.isFinite(v) && v >= 0) set({ ...anim, delay: v });
              }}
            />
          </label>
          <label>
            <span>Easing</span>
            <select
              value={anim.easing}
              onChange={(e) => set({ ...anim, easing: e.target.value as Easing })}
            >
              {EASINGS.map((e) => (
                <option key={e} value={e}>
                  {e}
                </option>
              ))}
            </select>
          </label>

          <div className="text-muted text-[10px] tracking-[0.5px] uppercase mt-2 mb-1">
            From state
          </div>
          <label>
            <span>Opacity</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={anim.from.opacity ?? 1}
              onChange={(e) =>
                updateFrom({
                  opacity: parseFloat(e.target.value) >= 1 ? undefined : parseFloat(e.target.value),
                })
              }
            />
            <span className="text-text tabular-nums">{(anim.from.opacity ?? 1).toFixed(2)}</span>
          </label>
          <label>
            <span>Rotation offset (°)</span>
            <NumField
              value={anim.from.rotation}
              placeholder={0}
              onChange={(v) => updateFrom({ rotation: v })}
            />
          </label>
          <label>
            <span>Scale factor</span>
            <NumField
              value={anim.from.scale}
              placeholder={1}
              step={0.05}
              onChange={(v) => updateFrom({ scale: v })}
            />
          </label>
          <label>
            <span>Translate X / Y</span>
            <div className="flex gap-1.5 items-center">
              <NumField
                value={anim.from.translateX}
                placeholder={0}
                onChange={(v) => updateFrom({ translateX: v })}
              />
              <NumField
                value={anim.from.translateY}
                placeholder={0}
                onChange={(v) => updateFrom({ translateY: v })}
              />
            </div>
          </label>
          <ColorFromField
            label="From fill"
            restColor={shape.fill}
            value={anim.from.fill}
            onChange={(v) => updateFrom({ fill: v })}
          />
          <ColorFromField
            label="From stroke"
            restColor={shape.stroke}
            value={anim.from.stroke}
            onChange={(v) => updateFrom({ stroke: v })}
          />

          <SpinControls spin={anim.spin} onChange={(next) => set({ ...anim, spin: next })} />
        </>
      )}
    </section>
  );
}

const DEFAULT_SPIN: SpinSpec = { speed: 90, startOffset: 0 };

/**
 * Constant-speed forever-spin sub-section. Lives under the entrance controls
 * because the spin engages relative to the entrance's end. Negative
 * `startOffset` is encouraged for the cog-wheel pattern (already spinning
 * while flying in), so the input has no min — only a "ms" label and a hint.
 */
function SpinControls({
  spin,
  onChange,
}: {
  spin: SpinSpec | undefined;
  onChange: (next: SpinSpec | undefined) => void;
}) {
  const enabled = !!spin;
  return (
    <>
      <div className="flex gap-1.5 items-center flex-wrap mt-2">
        <span className="text-muted text-[10px] tracking-[0.5px] uppercase flex-1">
          Spin (after entrance)
        </span>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => onChange(e.target.checked ? { ...DEFAULT_SPIN } : undefined)}
        />
      </div>
      {spin && (
        <>
          <label>
            <span>Speed (°/sec, negative = ccw)</span>
            <input
              type="number"
              step={5}
              value={spin.speed}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                if (Number.isFinite(v)) onChange({ ...spin, speed: v });
              }}
            />
          </label>
          <label>
            <span>Start offset (ms, negative = during entrance)</span>
            <input
              type="number"
              step={50}
              value={spin.startOffset}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                if (Number.isFinite(v)) onChange({ ...spin, startOffset: v });
              }}
            />
          </label>
        </>
      )}
    </>
  );
}

/**
 * Color picker for a from-state paint channel. The animation interpolates
 * between this color and the shape's authored rest color, so when the rest is
 * `'none'` we surface a hint instead of pretending a transition is possible.
 * Pressing "clear" drops the channel back to undefined (no color animation).
 */
function ColorFromField({
  label,
  restColor,
  value,
  onChange,
}: {
  label: string;
  restColor: string;
  value: string | undefined;
  onChange: (v: string | undefined) => void;
}) {
  const restMissing = restColor === 'none' || !HEX_RE.test(restColor);
  return (
    <label>
      <span className="flex gap-1.5 items-center flex-wrap">
        <span style={{ flex: 1 }}>{label}</span>
        {value && (
          <button
            type="button"
            className="text-[11px] px-[7px] py-[2px]"
            onClick={() => onChange(undefined)}
          >
            clear
          </button>
        )}
      </span>
      {restMissing ? (
        <span className="text-[10px] text-muted-2 normal-case tracking-normal">
          rest is &quot;none&quot; — no color to animate toward
        </span>
      ) : (
        <div className="flex gap-1.5 items-center">
          <input
            type="color"
            value={value && HEX_RE.test(value) ? value : restColor}
            onChange={(e) => onChange(e.target.value)}
          />
          <span className="text-[10px] text-muted-2 normal-case tracking-normal">
            {value ? `→ ${restColor}` : 'click to enable'}
          </span>
        </div>
      )}
    </label>
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
  snapAngles,
  snapDisabled,
  updateShape,
  deleteShapes,
  applyBlending,
  applyOpacity,
  applyTransform,
}: {
  shapes: Shape[];
  kind: ShapeKind;
  globalBezier: number;
  snapAngles: number[];
  snapDisabled: boolean;
  updateShape: (id: string, patch: Partial<Shape>) => void;
  deleteShapes: (ids: string[]) => void;
  applyBlending: (ids: string[]) => void;
  applyOpacity: (ids: string[]) => void;
  applyTransform: (ids: string[]) => void;
}) {
  const showFill = kind !== 'line';
  const showBezier = kind !== 'circle' && kind !== 'text';

  const strokes = shapes.map((s) => s.stroke);
  const fills = shapes.map((s) => s.fill);
  const widths = shapes.map((s) => s.strokeWidth);
  const overrides = shapes.map((s) => s.bezierOverride);
  const blends = shapes.map((s) => blendValue(s.blendMode));
  const opacities = shapes.map(opacityValue);
  const rotations = shapes.map(shapeRotation);
  const scales = shapes.map(shapeScale);
  const linejoins = shapes.map((s) => s.strokeLinejoin ?? 'round');
  const linecaps = shapes.map((s) => s.strokeLinecap ?? 'round');
  const dasharrays = shapes.map((s) => s.strokeDasharray ?? '');
  const paintOrders = shapes.map((s) => s.paintOrder === 'stroke');
  const strokeUniform = allSame(strokes);
  const fillUniform = allSame(fills);
  const widthUniform = allSame(widths);
  const overrideUniform = allSame(overrides);
  const blendUniform = allSame(blends);
  const opacityUniform = allSame(opacities);
  const rotationUniform = allSame(rotations);
  const scaleUniform = allSame(scales);
  const linejoinUniform = allSame(linejoins);
  const linecapUniform = allSame(linecaps);
  const dasharrayUniform = allSame(dasharrays);
  const paintOrderUniform = allSame(paintOrders);

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

  const typeLabel =
    kind === 'circle'
      ? `${shapes.length} circles`
      : kind === 'text'
        ? `${shapes.length} text blocks`
        : `${shapes.length} ${kind}s`;

  return (
    <section className="relative px-3.5 py-3 border-b border-line last:border-b-0">
      <div className="flex gap-1.5 items-center flex-wrap">
        <span className="text-muted w-[60px] text-[11px] tracking-[0.5px] uppercase">Type</span>
        <span className="text-text text-xs">{typeLabel}</span>
      </div>

      <label>
        <span>Stroke</span>
        <div className={PAINT_ROW}>
          <input
            type="color"
            value={sanitizeColor(strokeUniform ? strokes[0] : '#000000')}
            onChange={(e) => applyAll({ stroke: e.target.value })}
          />
          <input
            type="text"
            className={PAINT_INPUT}
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
          {strokes.some((s) => s !== 'none') && (
            <>
              <input
                type="number"
                min={0}
                step={0.5}
                title="Stroke width"
                value={widthUniform ? widths[0] : ''}
                placeholder={widthUniform ? '' : 'Mixed'}
                onChange={(e) => {
                  const v = parseFloat(e.target.value);
                  if (Number.isFinite(v) && v >= 0) applyAll({ strokeWidth: v });
                }}
              />
              <button
                type="button"
                className={CLEAR_BTN}
                title="Remove stroke"
                onClick={() => applyAll({ stroke: 'none' })}
              >
                <TrashIcon />
              </button>
            </>
          )}
        </div>
      </label>

      {strokes.some((s) => s !== 'none') && (
        <StrokeStyleControls
          linejoin={linejoinUniform ? linejoins[0] : 'round'}
          linecap={linecapUniform ? linecaps[0] : 'round'}
          dasharray={dasharrayUniform ? dasharrays[0] : ''}
          strokeUnderFill={paintOrderUniform ? paintOrders[0] : false}
          showJoinCap={kind !== 'circle'}
          linejoinMixed={!linejoinUniform}
          linecapMixed={!linecapUniform}
          dasharrayMixed={!dasharrayUniform}
          paintOrderMixed={!paintOrderUniform}
          onLinejoin={(v) => applyAll({ strokeLinejoin: v === 'round' ? undefined : v })}
          onLinecap={(v) => applyAll({ strokeLinecap: v === 'round' ? undefined : v })}
          onDasharray={(v) => applyAll({ strokeDasharray: v === '' ? undefined : v })}
          onStrokeUnderFill={(v) => applyAll({ paintOrder: v ? 'stroke' : undefined })}
        />
      )}

      {showFill && (
        <label>
          <span>Fill</span>
          <div className={PAINT_ROW}>
            <input
              type="color"
              value={sanitizeColor(fillUniform ? fills[0] : '#000000')}
              onChange={(e) => applyAll({ fill: e.target.value })}
            />
            <input
              type="text"
              className={PAINT_INPUT}
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
            {fills.some((f) => f !== 'none') && (
              <button
                type="button"
                className={CLEAR_BTN}
                title="Remove fill"
                onClick={() => applyAll({ fill: 'none' })}
              >
                <TrashIcon />
              </button>
            )}
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

      <label>
        <span className="flex gap-1.5 items-center flex-wrap">
          <span style={{ flex: 1 }}>Blend mode</span>
          {shapes.some((sh) => sh.blendMode && sh.blendMode !== 'normal') && (
            <button
              type="button"
              className={APPLY_BTN}
              onClick={() => applyBlending(shapes.map((sh) => sh.id))}
              title="Bake each shape's blend mode into the fill / stroke so the SVG renders correctly without mix-blend-mode support."
            >
              Apply blending
            </button>
          )}
        </span>
        <select
          value={blendUniform ? blends[0] : ''}
          onChange={(e) => applyAll(blendPatch(e.target.value))}
        >
          {!blendUniform && (
            <option value="" disabled>
              Mixed
            </option>
          )}
          {BLEND_MODES.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </label>

      <label>
        <span className="flex gap-1.5 items-center flex-wrap">
          <span style={{ flex: 1 }}>Opacity</span>
          {opacities.some((o) => o < 1) && (
            <button
              type="button"
              className={APPLY_BTN}
              onClick={() => applyOpacity(shapes.map((sh) => sh.id))}
              title="Bake each shape's opacity into its fill / stroke by alpha-compositing against the layer below, then reset opacity to 1."
            >
              Apply opacity
            </button>
          )}
        </span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={opacityUniform ? opacities[0] : 1}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            applyAll({ opacity: v >= 1 ? undefined : v });
          }}
        />
        <span className="text-text tabular-nums">
          {opacityUniform ? opacities[0].toFixed(2) : 'Mixed'}
        </span>
      </label>

      <TransformControls
        rotation={rotationUniform ? rotations[0] : 0}
        scale={scaleUniform ? scales[0] : 1}
        rotationMixed={!rotationUniform}
        scaleMixed={!scaleUniform}
        snapAngles={snapAngles}
        snapDisabled={snapDisabled}
        canBake={shapes.some((sh) => hasTransform(sh) && sh.kind !== 'glyphs')}
        isGlyphs={kind === 'text'}
        onRotation={(r) => applyAll({ rotation: r === 0 ? undefined : r })}
        onScale={(sc) => applyAll({ scale: sc === 1 ? undefined : sc })}
        onReset={() => applyAll({ rotation: undefined, scale: undefined })}
        onApply={() => applyTransform(shapes.map((sh) => sh.id))}
      />

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
