import { useEffect, useMemo, useRef, useState } from 'react'

import { dist, isPartialArc } from '../lib/geometry'
import { applyTransformToPoint, hasTransform, isPointOnAxis, shapeRotation, shapeScale } from '../lib/transform'
import { useStore } from '../store'
import { BLEND_MODES, EASINGS, STROKE_LINECAPS, STROKE_LINEJOINS } from '../types'
import { BezierControl, BezierRefSelect, PaletteRefSelect } from './ProjectPanel'

import type { BezierMode, BezierPreset } from '../types'
import type {
  AnimationFromState,
  AnimationSpec,
  ArcRange,
  BlendMode,
  Easing,
  Group,
  MirrorAxis,
  PaletteColor,
  Point,
  RadialSpec,
  Shape,
  SpinSpec,
  StrokeLinecap,
  StrokeLinejoin,
} from '../types'

const blendValue = (b: BlendMode | undefined): BlendMode => b ?? 'normal'
const blendPatch = (v: string): Partial<Shape> => ({
  blendMode: v === 'normal' ? undefined : (v as BlendMode),
})

/**
 * Round `angle` (in degrees) to the nearest entry of `snapAngles`, accounting
 * for the [0, 360) wrap so a -10° input snaps to 350° rather than 0° when
 * 350° is the nearer angle. Returns the unmodified angle when there are no
 * snap angles defined.
 */
const nearestSnapAngle = (angle: number, snapAngles: number[]): number => {
  if (snapAngles.length === 0) return angle
  const norm = ((angle % 360) + 360) % 360
  let best = snapAngles[0]
  let bestDist = Infinity
  for (const sa of snapAngles) {
    const saNorm = ((sa % 360) + 360) % 360
    const d = Math.min(Math.abs(norm - saNorm), 360 - Math.abs(norm - saNorm))
    if (d < bestDist) {
      bestDist = d
      best = saNorm
    }
  }
  // Map back into roughly the same half-turn the user is in. Without this the
  // rotation slider would jump from -170° straight to +180° instead of the
  // visually-equivalent -180°.
  if (angle < 0 && best > 180) return best - 360
  return best
}

const HEX_RE = /^#[0-9a-f]{3}([0-9a-f]{3})?$/i

const sanitizeColor = (c: string): string => {
  if (HEX_RE.test(c)) {
    if (c.length === 4) {
      return (
        '#' +
        c
          .slice(1)
          .split('')
          .map(ch => ch + ch)
          .join('')
      )
    }
    return c
  }
  return '#000000'
}

type ShapeKind = 'circle' | 'line' | 'polygon' | 'text'

const kindOf = (sh: Shape): ShapeKind => {
  if (sh.kind === 'glyphs') return 'text'
  if (sh.kind === 'circle') return 'circle'
  return sh.closed ? 'polygon' : 'line'
}

const allSame = <T,>(values: T[]): boolean => values.every(v => v === values[0])

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
  )
}

const PAINT_ROW = 'flex gap-1.5 items-center'
const PAINT_INPUT = 'flex-1 min-w-0'
const CLEAR_BTN = 'px-1.5 py-1 inline-flex items-center justify-center'

export function ShapePanel() {
  // Subscribe to the underlying primitives only — deriving the selected-shape
  // list inside the selector would return a fresh array each call and trip
  // Zustand's strict identity check (Maximum update depth exceeded).
  const shapes = useStore(s => s.shapes)
  const selectedShapeIds = useStore(s => s.selectedShapeIds)
  const selectedVertices = useStore(s => s.selectedVertices)
  const globalBezier = useStore(s => s.settings.bezier)
  const globalBezierMode = useStore(s => s.settings.bezierMode ?? 'proportional')
  const bezierPresets = useStore(s => s.settings.bezierPresets)
  const canvasRef = useStore(s => Math.min(s.settings.viewBoxWidth, s.settings.viewBoxHeight))
  const setShapeBezierRef = useStore(s => s.setShapeBezierRef)
  const setVertexBezierRef = useStore(s => s.setVertexBezierRef)
  const snapAngles = useStore(s => s.settings.snapAngles)
  const animationEnabled = useStore(s => s.settings.animationEnabled)
  const palette = useStore(s => s.settings.palette)
  const snapDisabled = useStore(s => s.snapDisabled)
  const updateShape = useStore(s => s.updateShape)
  const deleteShape = useStore(s => s.deleteShape)
  const deleteShapes = useStore(s => s.deleteShapes)
  const setShapePaletteRef = useStore(s => s.setShapePaletteRef)
  const applyBlending = useStore(s => s.applyBlending)
  const applyOpacity = useStore(s => s.applyOpacity)
  const applyTransform = useStore(s => s.applyTransform)
  const flipShapes = useStore(s => s.flipShapes)
  const enableMirror = useStore(s => s.enableMirror)
  const disableMirror = useStore(s => s.disableMirror)
  const updateMirrorAxis = useStore(s => s.updateMirrorAxis)
  const toggleMirrorAxisVisibility = useStore(s => s.toggleMirrorAxisVisibility)
  const convertMirrorToGroup = useStore(s => s.convertMirrorToGroup)
  const mergeMirror = useStore(s => s.mergeMirror)
  const enableRadial = useStore(s => s.enableRadial)
  const disableRadial = useStore(s => s.disableRadial)
  const updateRadial = useStore(s => s.updateRadial)
  const toggleRadialCenterVisibility = useStore(s => s.toggleRadialCenterVisibility)
  const convertRadialToGroup = useStore(s => s.convertRadialToGroup)
  const mergeShapes = useStore(s => s.mergeShapes)
  const insertPointBetween = useStore(s => s.insertPointBetween)
  const groups = useStore(s => s.groups)
  const setGroupTransform = useStore(s => s.setGroupTransform)
  const applyGroupTransform = useStore(s => s.applyGroupTransform)
  const setGroupAnimation = useStore(s => s.setGroupAnimation)
  const renameGroup = useStore(s => s.renameGroup)
  const removeGroup = useStore(s => s.removeGroup)
  const enableGroupMirror = useStore(s => s.enableGroupMirror)
  const disableGroupMirror = useStore(s => s.disableGroupMirror)
  const updateGroupMirrorAxis = useStore(s => s.updateGroupMirrorAxis)
  const toggleGroupMirrorAxisVisibility = useStore(s => s.toggleGroupMirrorAxisVisibility)
  const convertGroupMirror = useStore(s => s.convertGroupMirror)
  const enableGroupRadial = useStore(s => s.enableGroupRadial)
  const disableGroupRadial = useStore(s => s.disableGroupRadial)
  const updateGroupRadial = useStore(s => s.updateGroupRadial)
  const toggleGroupRadialCenterVisibility = useStore(s => s.toggleGroupRadialCenterVisibility)
  const convertGroupRadial = useStore(s => s.convertGroupRadial)

  const selectedShapes = useMemo(() => {
    const ids = new Set(selectedShapeIds)
    return shapes.filter(sh => ids.has(sh.id))
  }, [shapes, selectedShapeIds])

  // "Group selected" = the selection is exactly the full membership of one
  // group. This is the cycle-up state of the click-cycling behavior — every
  // group click lands here, and the inspector swaps to group-level controls
  // (rotation/scale on the wrapping `<g>`, group entrance animation).
  const fullySelectedGroup = useMemo(() => {
    if (selectedShapes.length < 1) return null
    const gid = selectedShapes[0].groupId
    if (!gid) return null
    if (!selectedShapes.every(sh => sh.groupId === gid)) return null
    const members = shapes.filter(sh => sh.groupId === gid)
    if (members.length !== selectedShapes.length) return null
    return groups.find(g => g.id === gid) ?? null
  }, [shapes, groups, selectedShapes])

  if (selectedShapes.length === 0) {
    return (
      <section className="border-line relative border-b px-3.5 py-3 last:border-b-0">
        <p className="text-muted border-accent-dim mt-1 border-l-2 py-1 pl-2.5 text-[11px] leading-[1.55] tracking-[0.3px]">
          No layer selected.
          <br />
          Pick one from the layers panel or use the Select tool (V) on the canvas.
        </p>
      </section>
    )
  }

  if (fullySelectedGroup) {
    const hasGlyphMember = selectedShapes.some(sh => sh.kind === 'glyphs')
    return (
      <GroupPanel
        group={fullySelectedGroup}
        memberCount={selectedShapes.length}
        hasGlyphMember={hasGlyphMember}
        animationEnabled={animationEnabled}
        snapAngles={snapAngles}
        snapDisabled={snapDisabled}
        setGroupTransform={setGroupTransform}
        applyGroupTransform={applyGroupTransform}
        setGroupAnimation={setGroupAnimation}
        renameGroup={renameGroup}
        removeGroup={removeGroup}
        enableGroupMirror={enableGroupMirror}
        disableGroupMirror={disableGroupMirror}
        updateGroupMirrorAxis={updateGroupMirrorAxis}
        toggleGroupMirrorAxisVisibility={toggleGroupMirrorAxisVisibility}
        convertGroupMirror={convertGroupMirror}
        enableGroupRadial={enableGroupRadial}
        disableGroupRadial={disableGroupRadial}
        updateGroupRadial={updateGroupRadial}
        toggleGroupRadialCenterVisibility={toggleGroupRadialCenterVisibility}
        convertGroupRadial={convertGroupRadial}
      />
    )
  }

  if (selectedShapes.length === 1) {
    const shape = selectedShapes[0]
    const vertexIndices = selectedVertices.filter(v => v.shapeId === shape.id).map(v => v.index)
    return (
      <ShapePanelInner
        shape={shape}
        selectedVertexIndices={vertexIndices}
        globalBezier={globalBezier}
        globalBezierMode={globalBezierMode}
        bezierPresets={bezierPresets}
        canvasRef={canvasRef}
        setShapeBezierRef={setShapeBezierRef}
        setVertexBezierRef={setVertexBezierRef}
        snapAngles={snapAngles}
        animationEnabled={animationEnabled}
        palette={palette}
        snapDisabled={snapDisabled}
        updateShape={updateShape}
        deleteShape={deleteShape}
        setPaletteRef={setShapePaletteRef}
        applyBlending={applyBlending}
        applyOpacity={applyOpacity}
        applyTransform={applyTransform}
        flipShapes={flipShapes}
        enableMirror={enableMirror}
        disableMirror={disableMirror}
        updateMirrorAxis={updateMirrorAxis}
        toggleMirrorAxisVisibility={toggleMirrorAxisVisibility}
        convertMirrorToGroup={convertMirrorToGroup}
        mergeMirror={mergeMirror}
        enableRadial={enableRadial}
        disableRadial={disableRadial}
        updateRadial={updateRadial}
        toggleRadialCenterVisibility={toggleRadialCenterVisibility}
        convertRadialToGroup={convertRadialToGroup}
        insertPointBetween={insertPointBetween}
      />
    )
  }

  const kinds = selectedShapes.map(kindOf)
  if (!allSame(kinds)) {
    return (
      <section className="border-line relative border-b px-3.5 py-3 last:border-b-0">
        <p className="text-muted border-accent-dim mt-1 border-l-2 py-1 pl-2.5 text-[11px] leading-[1.55] tracking-[0.3px]">
          {selectedShapes.length} layers selected — mixed types.
          <br />
          Pick layers of the same type to edit them together.
        </p>
      </section>
    )
  }

  return (
    <MultiShapePanel
      shapes={selectedShapes}
      kind={kinds[0]}
      globalBezier={globalBezier}
      globalBezierMode={globalBezierMode}
      bezierPresets={bezierPresets}
      canvasRef={canvasRef}
      setShapeBezierRef={setShapeBezierRef}
      snapAngles={snapAngles}
      palette={palette}
      snapDisabled={snapDisabled}
      updateShape={updateShape}
      deleteShapes={deleteShapes}
      setPaletteRef={setShapePaletteRef}
      applyBlending={applyBlending}
      applyOpacity={applyOpacity}
      applyTransform={applyTransform}
      flipShapes={flipShapes}
      mergeShapes={mergeShapes}
    />
  )
}

const APPLY_BTN =
  'text-[11px] px-[7px] py-[2px] bg-[#2563eb] text-white border-[#3b82f6] hover:bg-[#1d4ed8] hover:border-[#60a5fa] hover:text-white'

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
  linejoin: StrokeLinejoin
  linecap: StrokeLinecap
  dasharray: string
  strokeUnderFill: boolean
  showJoinCap: boolean
  linejoinMixed?: boolean
  linecapMixed?: boolean
  dasharrayMixed?: boolean
  paintOrderMixed?: boolean
  onLinejoin: (v: StrokeLinejoin) => void
  onLinecap: (v: StrokeLinecap) => void
  onDasharray: (v: string) => void
  onStrokeUnderFill: (v: boolean) => void
}) {
  const [dashText, setDashText] = useState(dasharray)
  const dashKey = dasharrayMixed ? '__mixed__' : dasharray
  useEffect(() => {
    setDashText(dasharrayMixed ? '' : dasharray)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dashKey])

  return (
    <>
      {showJoinCap && (
        <>
          <label>
            <span>Line join</span>
            <select value={linejoinMixed ? '' : linejoin} onChange={e => onLinejoin(e.target.value as StrokeLinejoin)}>
              {linejoinMixed && (
                <option value="" disabled>
                  Mixed
                </option>
              )}
              {STROKE_LINEJOINS.map(j => (
                <option key={j} value={j}>
                  {j}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Line cap</span>
            <select value={linecapMixed ? '' : linecap} onChange={e => onLinecap(e.target.value as StrokeLinecap)}>
              {linecapMixed && (
                <option value="" disabled>
                  Mixed
                </option>
              )}
              {STROKE_LINECAPS.map(c => (
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
          onChange={e => setDashText(e.target.value)}
          onBlur={() => onDasharray(dashText.trim())}
          onKeyDown={e => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          }}
        />
      </label>
      <label>
        <span className="flex flex-wrap items-center gap-1.5">
          <span style={{ flex: 1 }}>Stroke under fill</span>
          <input
            type="checkbox"
            checked={!paintOrderMixed && strokeUnderFill}
            ref={el => {
              if (el) el.indeterminate = !!paintOrderMixed
            }}
            onChange={e => onStrokeUnderFill(e.target.checked)}
            title="Paint stroke under the fill (SVG paint-order=stroke). Useful for outlined text and chunky icon strokes."
          />
        </span>
      </label>
    </>
  )
}

const opacityValue = (s: Shape): number => s.opacity ?? 1

function ShapePanelInner({
  shape,
  selectedVertexIndices,
  globalBezier,
  globalBezierMode,
  bezierPresets,
  canvasRef,
  setShapeBezierRef,
  setVertexBezierRef,
  snapAngles,
  animationEnabled,
  palette,
  snapDisabled,
  updateShape,
  deleteShape,
  setPaletteRef,
  applyBlending,
  applyOpacity,
  applyTransform,
  flipShapes,
  enableMirror,
  disableMirror,
  updateMirrorAxis,
  toggleMirrorAxisVisibility,
  convertMirrorToGroup,
  mergeMirror,
  enableRadial,
  disableRadial,
  updateRadial,
  toggleRadialCenterVisibility,
  convertRadialToGroup,
  insertPointBetween,
}: {
  shape: Shape
  selectedVertexIndices: number[]
  globalBezier: number
  globalBezierMode: BezierMode
  bezierPresets: BezierPreset[]
  canvasRef: number
  setShapeBezierRef: (id: string, name: string | undefined) => void
  setVertexBezierRef: (id: string, indices: number[], name: string | undefined) => void
  snapAngles: number[]
  animationEnabled: boolean
  palette: PaletteColor[]
  snapDisabled: boolean
  updateShape: (id: string, patch: Partial<Shape>) => void
  deleteShape: (id: string) => void
  setPaletteRef: (id: string, channel: 'fill' | 'stroke', name: string | undefined) => void
  applyBlending: (ids: string[]) => void
  applyOpacity: (ids: string[]) => void
  applyTransform: (ids: string[]) => void
  flipShapes: (ids: string[], axis: 'horizontal' | 'vertical') => void
  enableMirror: (id: string, axis: 'horizontal' | 'vertical') => void
  disableMirror: (id: string) => void
  updateMirrorAxis: (id: string, patch: Partial<MirrorAxis>) => void
  toggleMirrorAxisVisibility: (id: string) => void
  convertMirrorToGroup: (id: string) => string | null
  mergeMirror: (id: string) => boolean
  enableRadial: (id: string, angle: number) => void
  disableRadial: (id: string) => void
  updateRadial: (id: string, patch: Partial<RadialSpec>) => void
  toggleRadialCenterVisibility: (id: string) => void
  convertRadialToGroup: (id: string) => string | null
  insertPointBetween: (shapeId: string, i: number, j: number) => void
}) {
  const [strokeText, setStrokeText] = useState(shape.stroke)
  const [fillText, setFillText] = useState(shape.fill)
  useEffect(() => setStrokeText(shape.stroke), [shape.stroke])
  useEffect(() => setFillText(shape.fill), [shape.fill])

  // Active preset wins over inline value/mode at the layer scope. When set,
  // the BezierControl below is rendered read-only (the slider would just
  // bounce back to the preset's value on every change).
  const layerPreset = shape.bezierRef ? bezierPresets.find(p => p.name === shape.bezierRef) : undefined
  const bezierValue = layerPreset?.value ?? shape.bezierOverride ?? globalBezier
  const bezierMode: BezierMode = layerPreset
    ? (layerPreset.mode ?? 'proportional')
    : shape.bezierOverride !== null
      ? (shape.bezierModeOverride ?? 'proportional')
      : globalBezierMode
  const isCircle = shape.kind === 'circle'
  const isGlyphs = shape.kind === 'glyphs' && !!shape.glyphs
  const partial = isCircle && isPartialArc(shape.arc)
  const arcOpen = partial && shape.arc!.style === 'open'
  const showFill = isGlyphs ? true : isCircle ? !arcOpen : shape.closed
  const showBezierOverride = !isCircle && !isGlyphs
  const typeLabel = isGlyphs ? 'text' : isCircle ? 'circle' : shape.closed ? 'polygon' : 'line'

  return (
    <section className="border-line relative border-b px-3.5 py-3 last:border-b-0">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-muted w-[60px] text-[11px] tracking-[0.5px] uppercase">Type</span>
        <span className="text-text text-xs">{typeLabel}</span>
      </div>
      {isGlyphs && shape.glyphs ? (
        <>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-muted w-[60px] text-[11px] tracking-[0.5px] uppercase">Text</span>
            <span className="text-text truncate text-xs" title={shape.glyphs.text}>
              {shape.glyphs.text || <em className="text-muted">empty</em>}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-muted w-[60px] text-[11px] tracking-[0.5px] uppercase">Font</span>
            <span className="text-text truncate text-xs" title={shape.glyphs.fontFamily}>
              {shape.glyphs.fontFamily}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-muted w-[60px] text-[11px] tracking-[0.5px] uppercase">Size</span>
            <span className="text-text text-xs tabular-nums">
              {shape.glyphs.fontSize.toFixed(0)} u · {shape.glyphs.width.toFixed(1)}×{shape.glyphs.height.toFixed(1)}
            </span>
          </div>
        </>
      ) : (
        <div className="flex flex-wrap items-center gap-1.5">
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
            onChange={e => updateShape(shape.id, { stroke: e.target.value })}
          />
          <input
            type="text"
            className={PAINT_INPUT}
            value={strokeText}
            onChange={e => setStrokeText(e.target.value)}
            onBlur={() => {
              if (strokeText === 'none' || HEX_RE.test(strokeText)) {
                updateShape(shape.id, { stroke: strokeText })
              } else {
                setStrokeText(shape.stroke)
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
                onChange={e => {
                  const v = parseFloat(e.target.value)
                  if (Number.isFinite(v) && v >= 0) updateShape(shape.id, { strokeWidth: v })
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
        {palette.length > 0 && shape.stroke !== 'none' && (
          <PaletteRefSelect
            palette={palette}
            value={shape.strokeRef}
            onChange={name => setPaletteRef(shape.id, 'stroke', name)}
          />
        )}
      </label>

      {shape.stroke !== 'none' && (
        <StrokeStyleControls
          linejoin={shape.strokeLinejoin ?? 'round'}
          linecap={shape.strokeLinecap ?? 'round'}
          dasharray={shape.strokeDasharray ?? ''}
          strokeUnderFill={shape.paintOrder === 'stroke'}
          showJoinCap={!(isCircle && !partial)}
          onLinejoin={v => updateShape(shape.id, { strokeLinejoin: v === 'round' ? undefined : v })}
          onLinecap={v => updateShape(shape.id, { strokeLinecap: v === 'round' ? undefined : v })}
          onDasharray={v => updateShape(shape.id, { strokeDasharray: v === '' ? undefined : v })}
          onStrokeUnderFill={v => updateShape(shape.id, { paintOrder: v ? 'stroke' : undefined })}
        />
      )}

      {showFill && (
        <label>
          <span>Fill</span>
          <div className={PAINT_ROW}>
            <input
              type="color"
              value={sanitizeColor(shape.fill)}
              onChange={e => updateShape(shape.id, { fill: e.target.value })}
            />
            <input
              type="text"
              className={PAINT_INPUT}
              value={fillText}
              onChange={e => setFillText(e.target.value)}
              onBlur={() => {
                if (fillText === 'none' || HEX_RE.test(fillText)) {
                  updateShape(shape.id, { fill: fillText })
                } else {
                  setFillText(shape.fill)
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
          {palette.length > 0 && shape.fill !== 'none' && (
            <PaletteRefSelect
              palette={palette}
              value={shape.fillRef}
              onChange={name => setPaletteRef(shape.id, 'fill', name)}
            />
          )}
        </label>
      )}

      <label>
        <span className="flex flex-wrap items-center gap-1.5">
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
        <select value={blendValue(shape.blendMode)} onChange={e => updateShape(shape.id, blendPatch(e.target.value))}>
          {BLEND_MODES.map(m => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </label>

      <label>
        <span className="flex flex-wrap items-center gap-1.5">
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
          onChange={e => {
            const v = parseFloat(e.target.value)
            updateShape(shape.id, { opacity: v >= 1 ? undefined : v })
          }}
        />
        <span className="text-text tabular-nums">{opacityValue(shape).toFixed(2)}</span>
      </label>

      {!isGlyphs && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-muted w-[60px] text-[11px] tracking-[0.5px] uppercase">Flip</span>
          <button
            type="button"
            className="px-[7px] py-[2px] text-[11px]"
            onClick={() => flipShapes([shape.id], 'horizontal')}
            title="Mirror the shape across its vertical center axis."
          >
            Horizontal
          </button>
          <button
            type="button"
            className="px-[7px] py-[2px] text-[11px]"
            onClick={() => flipShapes([shape.id], 'vertical')}
            title="Mirror the shape across its horizontal center axis."
          >
            Vertical
          </button>
        </div>
      )}

      {!isGlyphs && !shape.radial && (
        <MirrorControls
          shape={shape}
          enableMirror={enableMirror}
          disableMirror={disableMirror}
          updateMirrorAxis={updateMirrorAxis}
          toggleMirrorAxisVisibility={toggleMirrorAxisVisibility}
          convertMirrorToGroup={convertMirrorToGroup}
          mergeMirror={mergeMirror}
        />
      )}

      {!isGlyphs && !shape.mirror && (
        <RadialControls
          shape={shape}
          enableRadial={enableRadial}
          disableRadial={disableRadial}
          updateRadial={updateRadial}
          toggleRadialCenterVisibility={toggleRadialCenterVisibility}
          convertRadialToGroup={convertRadialToGroup}
        />
      )}

      <TransformControls
        rotation={shapeRotation(shape)}
        scale={shapeScale(shape)}
        rotationMixed={false}
        scaleMixed={false}
        snapAngles={snapAngles}
        snapDisabled={snapDisabled}
        canBake={hasTransform(shape) && shape.kind !== 'glyphs'}
        onRotation={r => updateShape(shape.id, { rotation: r === 0 ? undefined : r })}
        onScale={sc => updateShape(shape.id, { scale: sc === 1 ? undefined : sc })}
        onReset={() => updateShape(shape.id, { rotation: undefined, scale: undefined })}
        onApply={() => applyTransform([shape.id])}
        isGlyphs={shape.kind === 'glyphs'}
      />

      {isCircle && <ArcControls shape={shape} updateShape={updateShape} />}

      {showBezierOverride && (
        <>
          <BezierRefSelect
            value={shape.bezierRef ?? undefined}
            presets={bezierPresets}
            label="Layer bezier preset"
            onChange={name => setShapeBezierRef(shape.id, name)}
          />
          <BezierControl
            mode={bezierMode}
            value={bezierValue}
            canvasRef={canvasRef}
            label="Layer bezier override"
            disabled={!!layerPreset}
            extra={
              (shape.bezierOverride !== null || shape.bezierRef) && (
                <button
                  type="button"
                  className="px-[7px] py-[2px] text-[11px]"
                  onClick={() =>
                    updateShape(shape.id, {
                      bezierOverride: null,
                      bezierModeOverride: undefined,
                      bezierRef: undefined,
                    })
                  }
                >
                  use global
                </button>
              )
            }
            valueDisplay={
              layerPreset
                ? `preset ${layerPreset.name} (${layerPreset.value.toFixed(bezierMode === 'absolute' ? 1 : 2)})`
                : shape.bezierOverride === null
                  ? `— (global ${globalBezier.toFixed(bezierMode === 'absolute' ? 1 : 2)})`
                  : undefined
            }
            onModeChange={m =>
              updateShape(shape.id, {
                bezierOverride: shape.bezierOverride ?? globalBezier,
                bezierModeOverride: m === 'proportional' ? undefined : m,
              })
            }
            onValueChange={v =>
              updateShape(shape.id, {
                bezierOverride: v,
                bezierModeOverride:
                  shape.bezierOverride === null && bezierMode !== 'proportional'
                    ? bezierMode
                    : shape.bezierModeOverride,
              })
            }
          />
        </>
      )}

      {showBezierOverride &&
        selectedVertexIndices.length === 2 &&
        areAdjacentVertices(shape, selectedVertexIndices[0], selectedVertexIndices[1]) && (
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              className="px-[7px] py-[2px] text-[11px]"
              onClick={() => insertPointBetween(shape.id, selectedVertexIndices[0], selectedVertexIndices[1])}
              title="Insert a new vertex at the midpoint of the edge between the two selected points."
            >
              Insert point
            </button>
          </div>
        )}

      {showBezierOverride && selectedVertexIndices.length > 0 && (
        <PointBezierControl
          shape={shape}
          indices={selectedVertexIndices}
          layerBezier={bezierValue}
          layerBezierMode={bezierMode}
          canvasRef={canvasRef}
          presets={bezierPresets}
          updateShape={updateShape}
          setVertexBezierRef={setVertexBezierRef}
        />
      )}

      <AnimationControls shape={shape} animationEnabled={animationEnabled} updateShape={updateShape} />

      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          className="text-accent hover:bg-accent hover:border-accent hover:text-white"
          onClick={() => deleteShape(shape.id)}
        >
          Delete shape
        </button>
      </div>
    </section>
  )
}

/**
 * Per-vertex bezier override slider. Visible only when at least one vertex is
 * selected on a path-kind shape. The displayed value is uniform across the
 * selected indices when they match; otherwise the readout shows "Mixed" and
 * dragging the slider writes the new value to every selected vertex. "use
 * layer" drops the entries (the corners fall back to the layer bezier).
 */
function PointBezierControl({
  shape,
  indices,
  layerBezier,
  layerBezierMode,
  canvasRef,
  presets,
  updateShape,
  setVertexBezierRef,
}: {
  shape: Shape
  indices: number[]
  layerBezier: number
  layerBezierMode: BezierMode
  canvasRef: number
  presets: BezierPreset[]
  updateShape: (id: string, patch: Partial<Shape>) => void
  setVertexBezierRef: (id: string, indices: number[], name: string | undefined) => void
}) {
  const overrides = shape.pointBezierOverrides
  const modeOverrides = shape.pointBezierModeOverrides
  const refs = shape.pointBezierRefs
  const refsAt = indices.map(i => refs?.[i])
  const uniformRef = allSame(refsAt)
  const activeRef = uniformRef ? refsAt[0] : null
  const activePreset =
    activeRef !== undefined && activeRef !== null ? presets.find(p => p.name === activeRef) : undefined
  const values = indices.map(i => overrides?.[i])
  const modes = indices.map(i => modeOverrides?.[i])
  const uniform = allSame(values)
  const uniformMode = allSame(modes)
  const firstDefined = values.find(v => v !== undefined)
  // When a preset is active and uniform, show its value; otherwise fall through
  // to the inline value or the layer value.
  const sliderValue = activePreset
    ? activePreset.value
    : uniform
      ? (values[0] ?? layerBezier)
      : (firstDefined ?? layerBezier)
  const anyOverride = values.some(v => v !== undefined)
  const anyRef = refsAt.some(r => r !== undefined)
  const displayedMode: BezierMode = activePreset
    ? (activePreset.mode ?? 'proportional')
    : uniformMode && modes[0] !== undefined
      ? modes[0]!
      : anyOverride
        ? 'proportional'
        : layerBezierMode
  const label =
    indices.length === 1 ? `Point bezier override (#${indices[0]})` : `Point bezier override (×${indices.length})`

  const setAll = (v: number | undefined) => {
    const next: Record<number, number> = { ...overrides }
    const nextMode: Record<number, BezierMode> = { ...modeOverrides }
    for (const i of indices) {
      if (v === undefined) {
        delete next[i]
        delete nextMode[i]
      } else {
        next[i] = v
      }
    }
    const trimmed = Object.keys(next).length > 0 ? next : undefined
    const trimmedMode = Object.keys(nextMode).length > 0 ? nextMode : undefined
    updateShape(shape.id, { pointBezierOverrides: trimmed, pointBezierModeOverrides: trimmedMode })
  }

  const setAllMode = (m: BezierMode) => {
    // Picking a mode promotes the point(s) to an override if there wasn't one,
    // using the layer's resolved value as the seed.
    const next: Record<number, number> = { ...overrides }
    const nextMode: Record<number, BezierMode> = { ...modeOverrides }
    for (const i of indices) {
      if (next[i] === undefined) next[i] = layerBezier
      if (m === 'proportional') delete nextMode[i]
      else nextMode[i] = m
    }
    const trimmedMode = Object.keys(nextMode).length > 0 ? nextMode : undefined
    updateShape(shape.id, { pointBezierOverrides: next, pointBezierModeOverrides: trimmedMode })
  }

  return (
    <>
      <BezierRefSelect
        value={activeRef === undefined ? undefined : activeRef}
        presets={presets}
        label="Point bezier preset"
        onChange={name => setVertexBezierRef(shape.id, indices, name)}
      />
      <BezierControl
        mode={displayedMode}
        value={sliderValue}
        canvasRef={canvasRef}
        label={label}
        disabled={!!activePreset}
        extra={
          (anyOverride || anyRef) && (
            <button
              type="button"
              className="px-[7px] py-[2px] text-[11px]"
              onClick={() => {
                // Clear refs first (touches all selected), then drop inline
                // values+modes at those indices. Two-step keeps the action
                // semantics clear; both share the same store mutator path.
                setVertexBezierRef(shape.id, indices, undefined)
                setAll(undefined)
              }}
            >
              use layer
            </button>
          )
        }
        valueDisplay={
          activePreset
            ? `preset ${activePreset.name} (${activePreset.value.toFixed(displayedMode === 'absolute' ? 1 : 2)})`
            : !uniform
              ? 'Mixed'
              : values[0] === undefined
                ? `— (layer ${layerBezier.toFixed(layerBezierMode === 'absolute' ? 1 : 2)})`
                : values[0].toFixed(displayedMode === 'absolute' ? 1 : 2)
        }
        onModeChange={setAllMode}
        onValueChange={v => setAll(v)}
      />
    </>
  )
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
  rotation: number
  scale: number
  rotationMixed: boolean
  scaleMixed: boolean
  snapAngles: number[]
  snapDisabled: boolean
  canBake: boolean
  isGlyphs: boolean
  onRotation: (v: number) => void
  onScale: (v: number) => void
  onReset: () => void
  onApply: () => void
}) {
  const showReset = !rotationMixed && !scaleMixed && (rotation !== 0 || scale !== 1)
  return (
    <>
      <label>
        <span className="flex flex-wrap items-center gap-1.5">
          <span style={{ flex: 1 }}>Rotation</span>
          {snapAngles.length > 0 && (
            <span className="text-muted-2 text-[10px] tracking-normal normal-case">
              {snapDisabled ? 'free' : 'snap'}
            </span>
          )}
        </span>
        <div className="flex flex-wrap items-center gap-1.5">
          <input
            type="range"
            min={-180}
            max={180}
            step={1}
            value={rotation}
            onChange={e => {
              const raw = parseFloat(e.target.value)
              if (!Number.isFinite(raw)) return
              const v = snapDisabled || snapAngles.length === 0 ? raw : nearestSnapAngle(raw, snapAngles)
              onRotation(v)
            }}
          />
          <input
            type="number"
            step={1}
            value={rotationMixed ? '' : rotation.toFixed(0)}
            placeholder={rotationMixed ? 'Mixed' : ''}
            onChange={e => {
              const v = parseFloat(e.target.value)
              if (Number.isFinite(v)) onRotation(v)
            }}
          />
        </div>
      </label>

      <label>
        <span>Scale</span>
        <div className="flex flex-wrap items-center gap-1.5">
          <input
            type="range"
            min={0.1}
            max={5}
            step={0.01}
            value={scale}
            onChange={e => {
              const v = parseFloat(e.target.value)
              if (Number.isFinite(v) && v > 0) onScale(v)
            }}
          />
          <input
            type="number"
            min={0.01}
            step={0.1}
            value={scaleMixed ? '' : scale.toFixed(2)}
            placeholder={scaleMixed ? 'Mixed' : ''}
            onChange={e => {
              const v = parseFloat(e.target.value)
              if (Number.isFinite(v) && v > 0) onScale(v)
            }}
          />
        </div>
      </label>

      {(showReset || canBake) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {showReset && (
            <button type="button" className="px-[7px] py-[2px] text-[11px]" onClick={onReset}>
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
            <span className="text-muted-2 text-[10px] tracking-normal normal-case">
              live transform — text shapes can&apos;t be baked
            </span>
          )}
        </div>
      )}
    </>
  )
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
}

const fromField = (spec: AnimationSpec, patch: Partial<AnimationFromState>): AnimationSpec => ({
  ...spec,
  from: { ...spec.from, ...patch },
})

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
  value: number | undefined
  placeholder: number
  step?: number
  onChange: (v: number | undefined) => void
}) {
  return (
    <input
      type="number"
      step={step}
      value={value ?? ''}
      placeholder={placeholder.toString()}
      onChange={e => {
        const raw = e.target.value
        if (raw === '') return onChange(undefined)
        const v = parseFloat(raw)
        if (Number.isFinite(v)) onChange(v)
      }}
    />
  )
}

function AnimationControls({
  shape,
  animationEnabled,
  updateShape,
}: {
  shape: Shape
  animationEnabled: boolean
  updateShape: (id: string, patch: Partial<Shape>) => void
}) {
  const anim = shape.animation
  const set = (next: AnimationSpec | undefined) => updateShape(shape.id, { animation: next })
  const updateFrom = (patch: Partial<AnimationFromState>) => {
    if (!anim) return
    set(fromField(anim, patch))
  }

  return (
    <section className="border-line mt-2.5 border-t pt-2.5" style={{ opacity: animationEnabled ? 1 : 0.55 }}>
      <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
        <span className="text-muted flex-1 text-[11px] tracking-[0.5px] uppercase">Animation</span>
        <input
          type="checkbox"
          checked={!!anim}
          onChange={e =>
            set(e.target.checked ? { ...DEFAULT_ANIMATION, from: { ...DEFAULT_ANIMATION.from } } : undefined)
          }
        />
      </div>

      {!animationEnabled && anim && (
        <p className="text-muted-2 mb-2 text-[10px] leading-snug tracking-normal normal-case">
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
              onChange={e => {
                const v = parseFloat(e.target.value)
                if (Number.isFinite(v) && v >= 0) set({ ...anim, duration: v })
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
              onChange={e => {
                const v = parseFloat(e.target.value)
                if (Number.isFinite(v) && v >= 0) set({ ...anim, delay: v })
              }}
            />
          </label>
          <label>
            <span>Easing</span>
            <select value={anim.easing} onChange={e => set({ ...anim, easing: e.target.value as Easing })}>
              {EASINGS.map(e => (
                <option key={e} value={e}>
                  {e}
                </option>
              ))}
            </select>
          </label>

          <div className="text-muted mt-2 mb-1 text-[10px] tracking-[0.5px] uppercase">From state</div>
          <label>
            <span>Opacity</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={anim.from.opacity ?? 1}
              onChange={e =>
                updateFrom({
                  opacity: parseFloat(e.target.value) >= 1 ? undefined : parseFloat(e.target.value),
                })
              }
            />
            <span className="text-text tabular-nums">{(anim.from.opacity ?? 1).toFixed(2)}</span>
          </label>
          <label>
            <span>Rotation offset (°)</span>
            <NumField value={anim.from.rotation} placeholder={0} onChange={v => updateFrom({ rotation: v })} />
          </label>
          <label>
            <span>Scale factor</span>
            <NumField value={anim.from.scale} placeholder={1} step={0.05} onChange={v => updateFrom({ scale: v })} />
          </label>
          <label>
            <span>Translate X / Y</span>
            <div className="flex items-center gap-1.5">
              <NumField value={anim.from.translateX} placeholder={0} onChange={v => updateFrom({ translateX: v })} />
              <NumField value={anim.from.translateY} placeholder={0} onChange={v => updateFrom({ translateY: v })} />
            </div>
          </label>
          <ColorFromField
            label="From fill"
            restColor={shape.fill}
            value={anim.from.fill}
            onChange={v => updateFrom({ fill: v })}
          />
          <ColorFromField
            label="From stroke"
            restColor={shape.stroke}
            value={anim.from.stroke}
            onChange={v => updateFrom({ stroke: v })}
          />

          <SpinControls spin={anim.spin} onChange={next => set({ ...anim, spin: next })} />
        </>
      )}
    </section>
  )
}

const DEFAULT_SPIN: SpinSpec = { speed: 90, startOffset: 0 }

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
  spin: SpinSpec | undefined
  onChange: (next: SpinSpec | undefined) => void
}) {
  const enabled = !!spin
  return (
    <>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className="text-muted flex-1 text-[10px] tracking-[0.5px] uppercase">Spin (after entrance)</span>
        <input
          type="checkbox"
          checked={enabled}
          onChange={e => onChange(e.target.checked ? { ...DEFAULT_SPIN } : undefined)}
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
              onChange={e => {
                const v = parseFloat(e.target.value)
                if (Number.isFinite(v)) onChange({ ...spin, speed: v })
              }}
            />
          </label>
          <label>
            <span>Start offset (ms, negative = during entrance)</span>
            <input
              type="number"
              step={50}
              value={spin.startOffset}
              onChange={e => {
                const v = parseFloat(e.target.value)
                if (Number.isFinite(v)) onChange({ ...spin, startOffset: v })
              }}
            />
          </label>
        </>
      )}
    </>
  )
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
  label: string
  restColor: string
  value: string | undefined
  onChange: (v: string | undefined) => void
}) {
  const restMissing = restColor === 'none' || !HEX_RE.test(restColor)
  return (
    <label>
      <span className="flex flex-wrap items-center gap-1.5">
        <span style={{ flex: 1 }}>{label}</span>
        {value && (
          <button type="button" className="px-[7px] py-[2px] text-[11px]" onClick={() => onChange(undefined)}>
            clear
          </button>
        )}
      </span>
      {restMissing ? (
        <span className="text-muted-2 text-[10px] tracking-normal normal-case">
          rest is &quot;none&quot; — no color to animate toward
        </span>
      ) : (
        <div className="flex items-center gap-1.5">
          <input
            type="color"
            value={value && HEX_RE.test(value) ? value : restColor}
            onChange={e => onChange(e.target.value)}
          />
          <span className="text-muted-2 text-[10px] tracking-normal normal-case">
            {value ? `→ ${restColor}` : 'click to enable'}
          </span>
        </div>
      )}
    </label>
  )
}

function ArcControls({
  shape,
  updateShape,
}: {
  shape: Shape
  updateShape: (id: string, patch: Partial<Shape>) => void
}) {
  const arc = shape.arc
  const partial = isPartialArc(arc)
  const enable = () => {
    const next: ArcRange = arc ?? { start: 0, end: 180, style: 'chord' }
    updateShape(shape.id, { arc: next })
  }
  const disable = () => updateShape(shape.id, { arc: undefined })
  const setField = (patch: Partial<ArcRange>) => {
    if (!arc) return
    updateShape(shape.id, { arc: { ...arc, ...patch } })
  }

  return (
    <>
      <label>
        <span className="flex flex-wrap items-center gap-1.5">
          <span style={{ flex: 1 }}>Partial arc</span>
          <input type="checkbox" checked={partial} onChange={e => (e.target.checked ? enable() : disable())} />
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
              onChange={e => {
                const v = parseFloat(e.target.value)
                if (Number.isFinite(v)) setField({ start: v })
              }}
            />
          </label>
          <label>
            <span>End angle</span>
            <input
              type="number"
              step={1}
              value={arc.end}
              onChange={e => {
                const v = parseFloat(e.target.value)
                if (Number.isFinite(v)) setField({ end: v })
              }}
            />
          </label>
          <label>
            <span>Style</span>
            <select value={arc.style} onChange={e => setField({ style: e.target.value as ArcRange['style'] })}>
              <option value="wedge">Wedge (pie slice)</option>
              <option value="chord">Chord (D-shape)</option>
              <option value="open">Open arc</option>
            </select>
          </label>
        </>
      )}
    </>
  )
}

/**
 * Live mirror modifier section. Empty when mirror is off — a single "Add
 * mirror" button enables it with a sensible default axis (vertical line
 * through bbox center). With it on, exposes axis x/y/angle inputs, the
 * "show axis" canvas toggle, and an "Eject" button that bakes the
 * reflection into a sibling shape and clears the link.
 */
function MirrorControls({
  shape,
  enableMirror,
  disableMirror,
  updateMirrorAxis,
  toggleMirrorAxisVisibility,
  convertMirrorToGroup,
  mergeMirror,
}: {
  shape: Shape
  enableMirror: (id: string, axis: 'horizontal' | 'vertical') => void
  disableMirror: (id: string) => void
  updateMirrorAxis: (id: string, patch: Partial<MirrorAxis>) => void
  toggleMirrorAxisVisibility: (id: string) => void
  convertMirrorToGroup: (id: string) => string | null
  mergeMirror: (id: string) => boolean
}) {
  const mirror = shape.mirror
  if (!mirror) {
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-muted w-[60px] text-[11px] tracking-[0.5px] uppercase">Mirror</span>
        <button
          type="button"
          className="px-[7px] py-[2px] text-[11px]"
          onClick={() => enableMirror(shape.id, 'horizontal')}
          title="Add a live mirror modifier with a vertical axis through the canvas center (left ↔ right reflection)."
        >
          Horizontal
        </button>
        <button
          type="button"
          className="px-[7px] py-[2px] text-[11px]"
          onClick={() => enableMirror(shape.id, 'vertical')}
          title="Add a live mirror modifier with a horizontal axis through the canvas center (top ↔ bottom reflection)."
        >
          Vertical
        </button>
      </div>
    )
  }
  const ax = mirror.axis
  return (
    <section className="border-line mt-2.5 border-t pt-2.5">
      <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
        <span className="text-muted flex-1 text-[11px] tracking-[0.5px] uppercase">Mirror</span>
        <button type="button" className="px-[7px] py-[2px] text-[11px]" onClick={() => disableMirror(shape.id)}>
          Remove
        </button>
      </div>
      <label>
        <span className="flex flex-wrap items-center gap-1.5">
          <span style={{ flex: 1 }}>Show axis on canvas</span>
          <input type="checkbox" checked={!!mirror.showAxis} onChange={() => toggleMirrorAxisVisibility(shape.id)} />
        </span>
      </label>
      <label>
        <span>Axis X / Y</span>
        <div className="flex items-center gap-1.5">
          <input
            type="number"
            step={1}
            value={ax.x}
            onChange={e => {
              const v = parseFloat(e.target.value)
              if (Number.isFinite(v)) updateMirrorAxis(shape.id, { x: v })
            }}
          />
          <input
            type="number"
            step={1}
            value={ax.y}
            onChange={e => {
              const v = parseFloat(e.target.value)
              if (Number.isFinite(v)) updateMirrorAxis(shape.id, { y: v })
            }}
          />
        </div>
      </label>
      <label>
        <span>Axis angle (°)</span>
        <div className="flex items-center gap-1.5">
          <input
            type="range"
            min={-180}
            max={180}
            step={1}
            value={ax.angle}
            onChange={e => {
              const v = parseFloat(e.target.value)
              if (Number.isFinite(v)) updateMirrorAxis(shape.id, { angle: v })
            }}
          />
          <input
            type="number"
            step={1}
            value={ax.angle}
            onChange={e => {
              const v = parseFloat(e.target.value)
              if (Number.isFinite(v)) updateMirrorAxis(shape.id, { angle: v })
            }}
          />
        </div>
      </label>
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          className={APPLY_BTN}
          onClick={() => convertMirrorToGroup(shape.id)}
          title="Bake the reflection into an independent shape and place both halves in a fresh group."
        >
          Convert to group
        </button>
        {canMergeMirror(shape) && (
          <button
            type="button"
            className={APPLY_BTN}
            onClick={() => mergeMirror(shape.id)}
            title={mergeMirrorHint(shape)}
          >
            Merge
          </button>
        )}
      </div>
    </section>
  )
}

const RADIAL_PRESETS: readonly number[] = [15, 30, 45, 90, 120, 180]

/**
 * Live radial-repeat modifier section. When off, exposes the three preset
 * angle buttons (45 / 90 / 180). When on, lets the user customize the angle
 * (preset chips + free numeric input) and the rotation center, plus toggle
 * the on-canvas center indicator.
 */
function RadialControls({
  shape,
  enableRadial,
  disableRadial,
  updateRadial,
  toggleRadialCenterVisibility,
  convertRadialToGroup,
}: {
  shape: Shape
  enableRadial: (id: string, angle: number) => void
  disableRadial: (id: string) => void
  updateRadial: (id: string, patch: Partial<RadialSpec>) => void
  toggleRadialCenterVisibility: (id: string) => void
  convertRadialToGroup: (id: string) => string | null
}) {
  const radial = shape.radial
  if (!radial) {
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-muted w-[60px] text-[11px] tracking-[0.5px] uppercase">Radial</span>
        {RADIAL_PRESETS.map(a => (
          <button
            key={a}
            type="button"
            className="px-[7px] py-[2px] text-[11px]"
            onClick={() => enableRadial(shape.id, a)}
            title={`Add a radial repeat with a ${a}° increment (${Math.floor(360 / a)} copies total) around the canvas center.`}
          >
            {a}°
          </button>
        ))}
      </div>
    )
  }
  const copies = Math.max(1, Math.floor((360 - 1e-3) / radial.angle) + 1)
  return (
    <section className="border-line mt-2.5 border-t pt-2.5">
      <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
        <span className="text-muted flex-1 text-[11px] tracking-[0.5px] uppercase">Radial</span>
        <button type="button" className="px-[7px] py-[2px] text-[11px]" onClick={() => disableRadial(shape.id)}>
          Remove
        </button>
      </div>
      <label>
        <span className="flex flex-wrap items-center gap-1.5">
          <span style={{ flex: 1 }}>Show center on canvas</span>
          <input
            type="checkbox"
            checked={!!radial.showCenter}
            onChange={() => toggleRadialCenterVisibility(shape.id)}
          />
        </span>
      </label>
      <label>
        <span>Center X / Y</span>
        <div className="flex items-center gap-1.5">
          <input
            type="number"
            step={1}
            value={radial.cx}
            onChange={e => {
              const v = parseFloat(e.target.value)
              if (Number.isFinite(v)) updateRadial(shape.id, { cx: v })
            }}
          />
          <input
            type="number"
            step={1}
            value={radial.cy}
            onChange={e => {
              const v = parseFloat(e.target.value)
              if (Number.isFinite(v)) updateRadial(shape.id, { cy: v })
            }}
          />
        </div>
      </label>
      <label>
        <span className="flex flex-wrap items-center gap-1.5">
          <span style={{ flex: 1 }}>Angle (°)</span>
          <span className="text-muted text-[11px]">{copies} copies</span>
        </span>
        <div className="flex items-center gap-1.5">
          <input
            type="number"
            step={1}
            min={1}
            max={360}
            value={radial.angle}
            onChange={e => {
              const v = parseFloat(e.target.value)
              if (Number.isFinite(v) && v > 0) updateRadial(shape.id, { angle: v })
            }}
          />
        </div>
      </label>
      <div className="flex flex-wrap items-center gap-1.5">
        {RADIAL_PRESETS.map(a => (
          <button
            key={a}
            type="button"
            className="px-[7px] py-[2px] text-[11px]"
            onClick={() => updateRadial(shape.id, { angle: a })}
            title={`Set the increment to ${a}°.`}
          >
            {a}°
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          className={APPLY_BTN}
          onClick={() => convertRadialToGroup(shape.id)}
          title="Bake every radial clone into an independent shape and place all copies in a fresh group."
        >
          Convert to group
        </button>
      </div>
    </section>
  )
}

/**
 * Mirror-merge eligibility. Lines need at least one endpoint on the axis;
 * polygons need exactly two axis-touching vertices. Circles and glyphs are
 * out of scope (no clean topology for "axis touches the boundary"). The
 * caller already excludes glyphs at the panel level — the circle guard here
 * keeps the helper safe to reuse from other contexts.
 */
const canMergeMirror = (shape: Shape): boolean => {
  if (!shape.mirror) return false
  if (shape.kind === 'circle' || shape.kind === 'glyphs') return false
  const axis = shape.mirror.axis
  if (shape.closed) {
    let count = 0
    for (const p of shape.points) if (isPointOnAxis(p, axis)) count++
    return count === 2
  }
  const n = shape.points.length
  if (n < 2) return false
  return isPointOnAxis(shape.points[0], axis) || isPointOnAxis(shape.points[n - 1], axis)
}

/**
 * Two vertex indices count as adjacent when they sit next to each other in the
 * point list, plus the wrap-around case (first ↔ last) on closed shapes. Used
 * to gate the "Insert point" button — inserting only makes geometric sense
 * along an actual edge of the path.
 */
const areAdjacentVertices = (shape: Shape, i: number, j: number): boolean => {
  if (shape.kind === 'circle' || shape.kind === 'glyphs') return false
  const n = shape.points.length
  if (n < 2 || i === j) return false
  if (i < 0 || i >= n || j < 0 || j >= n) return false
  if (Math.abs(i - j) === 1) return true
  return shape.closed && Math.min(i, j) === 0 && Math.max(i, j) === n - 1
}

const mergeMirrorHint = (shape: Shape): string =>
  shape.closed
    ? 'Combine source and reflection into one polygon along the two axis-touching vertices.'
    : 'Stitch source and reflection into one continuous line at the axis-touching endpoint.'

const SHARED_VERTEX_TOL = 1e-3
const samePoint = (a: Point, b: Point): boolean => {
  const dx = a[0] - b[0]
  const dy = a[1] - b[1]
  return dx * dx + dy * dy < SHARED_VERTEX_TOL * SHARED_VERTEX_TOL
}

/**
 * Visual coordinates of every vertex — applies the live rotation/scale so
 * coincidence is checked at the rendered position. Mirrors the bake step
 * mergeShapes performs in the store.
 */
const visualPoints = (shape: Shape): Point[] =>
  hasTransform(shape) ? shape.points.map(p => applyTransformToPoint(shape, p)) : shape.points

/**
 * Eligibility check for the multi-shape "Merge" button. Two closed polygons
 * qualify when they share exactly two coincident vertices (the seam); two
 * open lines qualify when at least one endpoint of each coincides. Mirrors
 * the store's `mergeShapes` so the button stays out unless the operation
 * would actually succeed.
 */
const canMergeShapes = (a: Shape, b: Shape): boolean => {
  if (a.id === b.id) return false
  if (a.kind === 'circle' || a.kind === 'glyphs') return false
  if (b.kind === 'circle' || b.kind === 'glyphs') return false
  if (a.closed !== b.closed) return false
  const ap = visualPoints(a)
  const bp = visualPoints(b)
  if (ap.length < 2 || bp.length < 2) return false
  if (a.closed) {
    let shared = 0
    for (let i = 0; i < ap.length; i++) {
      for (let j = 0; j < bp.length; j++) {
        if (samePoint(ap[i], bp[j])) {
          shared++
          break
        }
      }
      // Three or more coincident vertices is ambiguous for the seam pick;
      // bail rather than guess which two form the join.
      if (shared > 2) return false
    }
    return shared === 2
  }
  const aStart = ap[0]
  const aEnd = ap[ap.length - 1]
  const bStart = bp[0]
  const bEnd = bp[bp.length - 1]
  return samePoint(aEnd, bStart) || samePoint(aStart, bEnd) || samePoint(aStart, bStart) || samePoint(aEnd, bEnd)
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
  globalBezierMode,
  bezierPresets,
  canvasRef,
  setShapeBezierRef,
  snapAngles,
  palette,
  snapDisabled,
  updateShape,
  deleteShapes,
  setPaletteRef,
  applyBlending,
  applyOpacity,
  applyTransform,
  flipShapes,
  mergeShapes,
}: {
  shapes: Shape[]
  kind: ShapeKind
  globalBezier: number
  globalBezierMode: BezierMode
  bezierPresets: BezierPreset[]
  canvasRef: number
  setShapeBezierRef: (id: string, name: string | undefined) => void
  snapAngles: number[]
  palette: PaletteColor[]
  snapDisabled: boolean
  updateShape: (id: string, patch: Partial<Shape>) => void
  deleteShapes: (ids: string[]) => void
  setPaletteRef: (id: string, channel: 'fill' | 'stroke', name: string | undefined) => void
  applyBlending: (ids: string[]) => void
  applyOpacity: (ids: string[]) => void
  applyTransform: (ids: string[]) => void
  flipShapes: (ids: string[], axis: 'horizontal' | 'vertical') => void
  mergeShapes: (idA: string, idB: string) => boolean
}) {
  const showFill = kind !== 'line'
  const showBezier = kind !== 'circle' && kind !== 'text'

  const strokes = shapes.map(s => s.stroke)
  const fills = shapes.map(s => s.fill)
  const widths = shapes.map(s => s.strokeWidth)
  const overrides = shapes.map(s => s.bezierOverride)
  const blends = shapes.map(s => blendValue(s.blendMode))
  const opacities = shapes.map(opacityValue)
  const rotations = shapes.map(shapeRotation)
  const scales = shapes.map(shapeScale)
  const linejoins = shapes.map(s => s.strokeLinejoin ?? 'round')
  const linecaps = shapes.map(s => s.strokeLinecap ?? 'round')
  const dasharrays = shapes.map(s => s.strokeDasharray ?? '')
  const paintOrders = shapes.map(s => s.paintOrder === 'stroke')
  const fillRefs = shapes.map(s => s.fillRef)
  const strokeRefs = shapes.map(s => s.strokeRef)
  const strokeUniform = allSame(strokes)
  const fillUniform = allSame(fills)
  const widthUniform = allSame(widths)
  const overrideUniform = allSame(overrides)
  const blendUniform = allSame(blends)
  const opacityUniform = allSame(opacities)
  const rotationUniform = allSame(rotations)
  const scaleUniform = allSame(scales)
  const linejoinUniform = allSame(linejoins)
  const linecapUniform = allSame(linecaps)
  const dasharrayUniform = allSame(dasharrays)
  const paintOrderUniform = allSame(paintOrders)
  const fillRefUniform = allSame(fillRefs)
  const strokeRefUniform = allSame(strokeRefs)

  const [strokeText, setStrokeText] = useState(strokeUniform ? strokes[0] : '')
  const [fillText, setFillText] = useState(fillUniform ? fills[0] : '')
  // Resync the typed-input value when the underlying selection changes — but
  // only when the *displayed* value would change. Joining is just to derive
  // a primitive identity for the deps array (arrays change every render).
  const strokeKey = strokes.join('|')
  const fillKey = fills.join('|')
  useEffect(() => {
    setStrokeText(strokeUniform ? strokes[0] : '')
    // strokes is captured via the strokeKey identity above
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strokeUniform, strokeKey])
  useEffect(() => {
    setFillText(fillUniform ? fills[0] : '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fillUniform, fillKey])

  const applyAll = (patch: Partial<Shape>) => {
    for (const s of shapes) updateShape(s.id, patch)
  }

  const refs = shapes.map(s => s.bezierRef)
  const refsUniform = allSame(refs)
  const activeRef = refsUniform ? refs[0] : null
  const activePreset =
    activeRef !== undefined && activeRef !== null ? bezierPresets.find(p => p.name === activeRef) : undefined
  const anyRef = refs.some(r => r)
  const bezierForRange = activePreset?.value ?? (overrideUniform && overrides[0] !== null ? overrides[0] : globalBezier)
  const modeOverrides = shapes.map(s => s.bezierModeOverride)
  const modeOverrideUniform = allSame(modeOverrides)
  const allOverridden = overrides.every(o => o !== null)
  const bezierModeForRange: BezierMode = activePreset
    ? (activePreset.mode ?? 'proportional')
    : modeOverrideUniform && allOverridden
      ? (modeOverrides[0] ?? 'proportional')
      : overrides.every(o => o === null)
        ? globalBezierMode
        : 'proportional'

  const typeLabel =
    kind === 'circle'
      ? `${shapes.length} circles`
      : kind === 'text'
        ? `${shapes.length} text blocks`
        : `${shapes.length} ${kind}s`

  return (
    <section className="border-line relative border-b px-3.5 py-3 last:border-b-0">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-muted w-[60px] text-[11px] tracking-[0.5px] uppercase">Type</span>
        <span className="text-text text-xs">{typeLabel}</span>
      </div>

      <label>
        <span>Stroke</span>
        <div className={PAINT_ROW}>
          <input
            type="color"
            value={sanitizeColor(strokeUniform ? strokes[0] : '#000000')}
            onChange={e => applyAll({ stroke: e.target.value })}
          />
          <input
            type="text"
            className={PAINT_INPUT}
            value={strokeText}
            placeholder={strokeUniform ? '' : 'Mixed'}
            onChange={e => setStrokeText(e.target.value)}
            onBlur={() => {
              if (strokeText === 'none' || HEX_RE.test(strokeText)) {
                applyAll({ stroke: strokeText })
              } else {
                setStrokeText(strokeUniform ? strokes[0] : '')
              }
            }}
          />
          {strokes.some(s => s !== 'none') && (
            <>
              <input
                type="number"
                min={0}
                step={0.5}
                title="Stroke width"
                value={widthUniform ? widths[0] : ''}
                placeholder={widthUniform ? '' : 'Mixed'}
                onChange={e => {
                  const v = parseFloat(e.target.value)
                  if (Number.isFinite(v) && v >= 0) applyAll({ strokeWidth: v })
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
        {palette.length > 0 && strokes.some(s => s !== 'none') && (
          <MultiPaletteRefSelect
            palette={palette}
            value={strokeRefUniform ? strokeRefs[0] : 'mixed'}
            onChange={name => {
              for (const sh of shapes) setPaletteRef(sh.id, 'stroke', name)
            }}
          />
        )}
      </label>

      {strokes.some(s => s !== 'none') && (
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
          onLinejoin={v => applyAll({ strokeLinejoin: v === 'round' ? undefined : v })}
          onLinecap={v => applyAll({ strokeLinecap: v === 'round' ? undefined : v })}
          onDasharray={v => applyAll({ strokeDasharray: v === '' ? undefined : v })}
          onStrokeUnderFill={v => applyAll({ paintOrder: v ? 'stroke' : undefined })}
        />
      )}

      {showFill && (
        <label>
          <span>Fill</span>
          <div className={PAINT_ROW}>
            <input
              type="color"
              value={sanitizeColor(fillUniform ? fills[0] : '#000000')}
              onChange={e => applyAll({ fill: e.target.value })}
            />
            <input
              type="text"
              className={PAINT_INPUT}
              value={fillText}
              placeholder={fillUniform ? '' : 'Mixed'}
              onChange={e => setFillText(e.target.value)}
              onBlur={() => {
                if (fillText === 'none' || HEX_RE.test(fillText)) {
                  applyAll({ fill: fillText })
                } else {
                  setFillText(fillUniform ? fills[0] : '')
                }
              }}
            />
            {fills.some(f => f !== 'none') && (
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
          {palette.length > 0 && fills.some(f => f !== 'none') && (
            <MultiPaletteRefSelect
              palette={palette}
              value={fillRefUniform ? fillRefs[0] : 'mixed'}
              onChange={name => {
                for (const sh of shapes) setPaletteRef(sh.id, 'fill', name)
              }}
            />
          )}
        </label>
      )}

      {showBezier && (
        <>
          <BezierRefSelect
            value={refsUniform ? (activeRef ?? undefined) : null}
            presets={bezierPresets}
            label="Layer bezier preset"
            onChange={name => shapes.forEach(s => setShapeBezierRef(s.id, name))}
          />
          <BezierControl
            mode={bezierModeForRange}
            value={bezierForRange}
            canvasRef={canvasRef}
            label="Layer bezier override"
            disabled={!!activePreset}
            extra={
              (overrides.some(o => o !== null) || anyRef) && (
                <button
                  type="button"
                  className="px-[7px] py-[2px] text-[11px]"
                  onClick={() =>
                    applyAll({ bezierOverride: null, bezierModeOverride: undefined, bezierRef: undefined })
                  }
                >
                  use global
                </button>
              )
            }
            valueDisplay={
              activePreset
                ? `preset ${activePreset.name} (${activePreset.value.toFixed(bezierModeForRange === 'absolute' ? 1 : 2)})`
                : !overrideUniform
                  ? 'Mixed'
                  : overrides[0] === null
                    ? `— (global ${globalBezier.toFixed(globalBezierMode === 'absolute' ? 1 : 2)})`
                    : overrides[0]!.toFixed(bezierModeForRange === 'absolute' ? 1 : 2)
            }
            onModeChange={m =>
              shapes.forEach(s =>
                updateShape(s.id, {
                  bezierOverride: s.bezierOverride ?? globalBezier,
                  bezierModeOverride: m === 'proportional' ? undefined : m,
                }),
              )
            }
            onValueChange={v =>
              applyAll({
                bezierOverride: v,
                ...(bezierModeForRange !== 'proportional' ? { bezierModeOverride: bezierModeForRange } : {}),
              })
            }
          />
        </>
      )}

      <label>
        <span className="flex flex-wrap items-center gap-1.5">
          <span style={{ flex: 1 }}>Blend mode</span>
          {shapes.some(sh => sh.blendMode && sh.blendMode !== 'normal') && (
            <button
              type="button"
              className={APPLY_BTN}
              onClick={() => applyBlending(shapes.map(sh => sh.id))}
              title="Bake each shape's blend mode into the fill / stroke so the SVG renders correctly without mix-blend-mode support."
            >
              Apply blending
            </button>
          )}
        </span>
        <select value={blendUniform ? blends[0] : ''} onChange={e => applyAll(blendPatch(e.target.value))}>
          {!blendUniform && (
            <option value="" disabled>
              Mixed
            </option>
          )}
          {BLEND_MODES.map(m => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </label>

      <label>
        <span className="flex flex-wrap items-center gap-1.5">
          <span style={{ flex: 1 }}>Opacity</span>
          {opacities.some(o => o < 1) && (
            <button
              type="button"
              className={APPLY_BTN}
              onClick={() => applyOpacity(shapes.map(sh => sh.id))}
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
          onChange={e => {
            const v = parseFloat(e.target.value)
            applyAll({ opacity: v >= 1 ? undefined : v })
          }}
        />
        <span className="text-text tabular-nums">{opacityUniform ? opacities[0].toFixed(2) : 'Mixed'}</span>
      </label>

      {kind !== 'text' && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-muted w-[60px] text-[11px] tracking-[0.5px] uppercase">Flip</span>
          <button
            type="button"
            className="px-[7px] py-[2px] text-[11px]"
            onClick={() =>
              flipShapes(
                shapes.map(sh => sh.id),
                'horizontal',
              )
            }
            title="Mirror each selected shape across its vertical center axis."
          >
            Horizontal
          </button>
          <button
            type="button"
            className="px-[7px] py-[2px] text-[11px]"
            onClick={() =>
              flipShapes(
                shapes.map(sh => sh.id),
                'vertical',
              )
            }
            title="Mirror each selected shape across its horizontal center axis."
          >
            Vertical
          </button>
        </div>
      )}

      <TransformControls
        rotation={rotationUniform ? rotations[0] : 0}
        scale={scaleUniform ? scales[0] : 1}
        rotationMixed={!rotationUniform}
        scaleMixed={!scaleUniform}
        snapAngles={snapAngles}
        snapDisabled={snapDisabled}
        canBake={shapes.some(sh => hasTransform(sh) && sh.kind !== 'glyphs')}
        isGlyphs={kind === 'text'}
        onRotation={r => applyAll({ rotation: r === 0 ? undefined : r })}
        onScale={sc => applyAll({ scale: sc === 1 ? undefined : sc })}
        onReset={() => applyAll({ rotation: undefined, scale: undefined })}
        onApply={() => applyTransform(shapes.map(sh => sh.id))}
      />

      {shapes.length === 2 && canMergeShapes(shapes[0], shapes[1]) && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-muted w-[60px] text-[11px] tracking-[0.5px] uppercase">Merge</span>
          <button
            type="button"
            className={APPLY_BTN}
            onClick={() => mergeShapes(shapes[0].id, shapes[1].id)}
            title={
              shapes[0].closed
                ? 'Combine the two polygons into one along their shared seam (the two coincident vertices).'
                : 'Stitch the two lines into a single polyline at their coincident endpoint.'
            }
          >
            Merge layers
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          className="text-accent hover:bg-accent hover:border-accent hover:text-white"
          onClick={() => deleteShapes(shapes.map(s => s.id))}
        >
          Delete {shapes.length} shapes
        </button>
      </div>
    </section>
  )
}

/**
 * Palette picker variant for multi-shape selections. Pass the special string
 * `'mixed'` for `value` when the selected shapes hold different refs — the
 * select shows a "Mixed" placeholder until the user makes a choice.
 */
function MultiPaletteRefSelect({
  palette,
  value,
  onChange,
}: {
  palette: PaletteColor[]
  value: string | undefined | 'mixed'
  onChange: (name: string | undefined) => void
}) {
  const isMixed = value === 'mixed'
  return (
    <select
      className="text-[11px]"
      title="Link to palette color"
      value={isMixed ? '__mixed__' : (value ?? '')}
      onChange={e => {
        const v = e.target.value
        if (v === '__mixed__') return
        onChange(v === '' ? undefined : v)
      }}
    >
      {isMixed && (
        <option value="__mixed__" disabled>
          Mixed
        </option>
      )}
      <option value="">— off-palette —</option>
      {palette.map(p => (
        <option key={p.name} value={p.name}>
          {p.name}
        </option>
      ))}
    </select>
  )
}

/**
 * Inspector for a fully-selected group — rotation / scale on the group's
 * `<g transform>` (live, no baking required), the group-level entrance
 * animation (drives the same wrapper via `vh-anim-group-{id}`), plus rename
 * and ungroup buttons. Per-member fill / stroke / vertex editing falls
 * through to the click-cycling path: clicking a child a second time selects
 * the individual layer and surfaces the regular shape inspector.
 */
function GroupPanel({
  group,
  memberCount,
  hasGlyphMember,
  animationEnabled,
  snapAngles,
  snapDisabled,
  setGroupTransform,
  applyGroupTransform,
  setGroupAnimation,
  renameGroup,
  removeGroup,
  enableGroupMirror,
  disableGroupMirror,
  updateGroupMirrorAxis,
  toggleGroupMirrorAxisVisibility,
  convertGroupMirror,
  enableGroupRadial,
  disableGroupRadial,
  updateGroupRadial,
  toggleGroupRadialCenterVisibility,
  convertGroupRadial,
}: {
  group: Group
  memberCount: number
  hasGlyphMember: boolean
  animationEnabled: boolean
  snapAngles: number[]
  snapDisabled: boolean
  setGroupTransform: (groupId: string, patch: { rotation?: number; scale?: number }) => void
  applyGroupTransform: (groupId: string) => void
  setGroupAnimation: (groupId: string, animation: AnimationSpec | undefined) => void
  renameGroup: (id: string, name: string) => void
  removeGroup: (id: string) => void
  enableGroupMirror: (groupId: string, axis: 'horizontal' | 'vertical') => void
  disableGroupMirror: (groupId: string) => void
  updateGroupMirrorAxis: (groupId: string, patch: Partial<MirrorAxis>) => void
  toggleGroupMirrorAxisVisibility: (groupId: string) => void
  convertGroupMirror: (groupId: string) => boolean
  enableGroupRadial: (groupId: string, angle: number) => void
  disableGroupRadial: (groupId: string) => void
  updateGroupRadial: (groupId: string, patch: Partial<RadialSpec>) => void
  toggleGroupRadialCenterVisibility: (groupId: string) => void
  convertGroupRadial: (groupId: string) => boolean
}) {
  const [editingName, setEditingName] = useState(false)
  const rotation = group.rotation ?? 0
  const scale = group.scale ?? 1
  const canBake = rotation !== 0 || scale !== 1

  return (
    <section className="border-line relative border-b px-3.5 py-3 last:border-b-0">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-muted w-[60px] text-[11px] tracking-[0.5px] uppercase">Group</span>
        {editingName ? (
          <NameInput
            initial={group.name}
            onCommit={v => {
              renameGroup(group.id, v)
              setEditingName(false)
            }}
            onCancel={() => setEditingName(false)}
          />
        ) : (
          <span className="text-text text-xs" onDoubleClick={() => setEditingName(true)} title="Double-click to rename">
            {group.name}
          </span>
        )}
        <span className="text-muted-2 ml-auto text-[10px] tracking-normal normal-case">
          {memberCount} member{memberCount === 1 ? '' : 's'}
        </span>
      </div>

      <TransformControls
        rotation={rotation}
        scale={scale}
        rotationMixed={false}
        scaleMixed={false}
        snapAngles={snapAngles}
        snapDisabled={snapDisabled}
        canBake={canBake}
        isGlyphs={false}
        onRotation={r => setGroupTransform(group.id, { rotation: r })}
        onScale={sc => setGroupTransform(group.id, { scale: sc })}
        onReset={() => setGroupTransform(group.id, { rotation: 0, scale: 1 })}
        onApply={() => applyGroupTransform(group.id)}
      />

      <GroupAnimationControls
        animation={group.animation}
        animationEnabled={animationEnabled}
        onChange={anim => setGroupAnimation(group.id, anim)}
      />

      {!group.radial && (
        <GroupMirrorControls
          group={group}
          hasGlyphMember={hasGlyphMember}
          enableGroupMirror={enableGroupMirror}
          disableGroupMirror={disableGroupMirror}
          updateGroupMirrorAxis={updateGroupMirrorAxis}
          toggleGroupMirrorAxisVisibility={toggleGroupMirrorAxisVisibility}
          convertGroupMirror={convertGroupMirror}
        />
      )}

      {!group.mirror && (
        <GroupRadialControls
          group={group}
          hasGlyphMember={hasGlyphMember}
          enableGroupRadial={enableGroupRadial}
          disableGroupRadial={disableGroupRadial}
          updateGroupRadial={updateGroupRadial}
          toggleGroupRadialCenterVisibility={toggleGroupRadialCenterVisibility}
          convertGroupRadial={convertGroupRadial}
        />
      )}

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          className="text-accent hover:bg-accent hover:border-accent hover:text-white"
          onClick={() => removeGroup(group.id)}
          title="Delete group (members keep their layers)."
        >
          Ungroup all
        </button>
      </div>
    </section>
  )
}

/**
 * Group-level mirror modifier controls. Off state surfaces "Horizontal" /
 * "Vertical" buttons mirroring the per-shape MirrorControls. On state exposes
 * axis x/y/angle inputs, the on-canvas axis toggle, and a "Convert to layers"
 * button that bakes the reflection into individual member shapes within this
 * same group.
 */
function GroupMirrorControls({
  group,
  hasGlyphMember,
  enableGroupMirror,
  disableGroupMirror,
  updateGroupMirrorAxis,
  toggleGroupMirrorAxisVisibility,
  convertGroupMirror,
}: {
  group: Group
  hasGlyphMember: boolean
  enableGroupMirror: (groupId: string, axis: 'horizontal' | 'vertical') => void
  disableGroupMirror: (groupId: string) => void
  updateGroupMirrorAxis: (groupId: string, patch: Partial<MirrorAxis>) => void
  toggleGroupMirrorAxisVisibility: (groupId: string) => void
  convertGroupMirror: (groupId: string) => boolean
}) {
  const mirror = group.mirror
  if (!mirror) {
    if (hasGlyphMember) {
      return (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-muted w-[60px] text-[11px] tracking-[0.5px] uppercase">Mirror</span>
          <span className="text-muted-2 text-[10px] tracking-normal normal-case">
            unavailable — group contains text
          </span>
        </div>
      )
    }
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-muted w-[60px] text-[11px] tracking-[0.5px] uppercase">Mirror</span>
        <button
          type="button"
          className="px-[7px] py-[2px] text-[11px]"
          onClick={() => enableGroupMirror(group.id, 'horizontal')}
          title="Mirror the whole group across a vertical axis through the canvas center (left ↔ right)."
        >
          Horizontal
        </button>
        <button
          type="button"
          className="px-[7px] py-[2px] text-[11px]"
          onClick={() => enableGroupMirror(group.id, 'vertical')}
          title="Mirror the whole group across a horizontal axis through the canvas center (top ↔ bottom)."
        >
          Vertical
        </button>
      </div>
    )
  }
  const ax = mirror.axis
  return (
    <section className="border-line mt-2.5 border-t pt-2.5">
      <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
        <span className="text-muted flex-1 text-[11px] tracking-[0.5px] uppercase">Mirror</span>
        <button type="button" className="px-[7px] py-[2px] text-[11px]" onClick={() => disableGroupMirror(group.id)}>
          Remove
        </button>
      </div>
      <label>
        <span className="flex flex-wrap items-center gap-1.5">
          <span style={{ flex: 1 }}>Show axis on canvas</span>
          <input
            type="checkbox"
            checked={!!mirror.showAxis}
            onChange={() => toggleGroupMirrorAxisVisibility(group.id)}
          />
        </span>
      </label>
      <label>
        <span>Axis X / Y</span>
        <div className="flex items-center gap-1.5">
          <input
            type="number"
            step={1}
            value={ax.x}
            onChange={e => {
              const v = parseFloat(e.target.value)
              if (Number.isFinite(v)) updateGroupMirrorAxis(group.id, { x: v })
            }}
          />
          <input
            type="number"
            step={1}
            value={ax.y}
            onChange={e => {
              const v = parseFloat(e.target.value)
              if (Number.isFinite(v)) updateGroupMirrorAxis(group.id, { y: v })
            }}
          />
        </div>
      </label>
      <label>
        <span>Axis angle (°)</span>
        <div className="flex items-center gap-1.5">
          <input
            type="range"
            min={-180}
            max={180}
            step={1}
            value={ax.angle}
            onChange={e => {
              const v = parseFloat(e.target.value)
              if (Number.isFinite(v)) updateGroupMirrorAxis(group.id, { angle: v })
            }}
          />
          <input
            type="number"
            step={1}
            value={ax.angle}
            onChange={e => {
              const v = parseFloat(e.target.value)
              if (Number.isFinite(v)) updateGroupMirrorAxis(group.id, { angle: v })
            }}
          />
        </div>
      </label>
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          className={APPLY_BTN}
          onClick={() => convertGroupMirror(group.id)}
          title="Bake the mirror reflection into independent shape layers within this same group."
        >
          Convert to layers
        </button>
      </div>
    </section>
  )
}

/**
 * Group-level radial repeat controls. Mirrors `RadialControls` but operates
 * on the group as a whole — every member is rotated together for each clone.
 */
function GroupRadialControls({
  group,
  hasGlyphMember,
  enableGroupRadial,
  disableGroupRadial,
  updateGroupRadial,
  toggleGroupRadialCenterVisibility,
  convertGroupRadial,
}: {
  group: Group
  hasGlyphMember: boolean
  enableGroupRadial: (groupId: string, angle: number) => void
  disableGroupRadial: (groupId: string) => void
  updateGroupRadial: (groupId: string, patch: Partial<RadialSpec>) => void
  toggleGroupRadialCenterVisibility: (groupId: string) => void
  convertGroupRadial: (groupId: string) => boolean
}) {
  const radial = group.radial
  if (!radial) {
    if (hasGlyphMember) {
      return (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-muted w-[60px] text-[11px] tracking-[0.5px] uppercase">Radial</span>
          <span className="text-muted-2 text-[10px] tracking-normal normal-case">
            unavailable — group contains text
          </span>
        </div>
      )
    }
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-muted w-[60px] text-[11px] tracking-[0.5px] uppercase">Radial</span>
        {RADIAL_PRESETS.map(a => (
          <button
            key={a}
            type="button"
            className="px-[7px] py-[2px] text-[11px]"
            onClick={() => enableGroupRadial(group.id, a)}
            title={`Add a radial repeat of the whole group at ${a}° increments (${Math.floor(360 / a)} copies total) around the canvas center.`}
          >
            {a}°
          </button>
        ))}
      </div>
    )
  }
  const copies = Math.max(1, Math.floor((360 - 1e-3) / radial.angle) + 1)
  return (
    <section className="border-line mt-2.5 border-t pt-2.5">
      <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
        <span className="text-muted flex-1 text-[11px] tracking-[0.5px] uppercase">Radial</span>
        <button type="button" className="px-[7px] py-[2px] text-[11px]" onClick={() => disableGroupRadial(group.id)}>
          Remove
        </button>
      </div>
      <label>
        <span className="flex flex-wrap items-center gap-1.5">
          <span style={{ flex: 1 }}>Show center on canvas</span>
          <input
            type="checkbox"
            checked={!!radial.showCenter}
            onChange={() => toggleGroupRadialCenterVisibility(group.id)}
          />
        </span>
      </label>
      <label>
        <span>Center X / Y</span>
        <div className="flex items-center gap-1.5">
          <input
            type="number"
            step={1}
            value={radial.cx}
            onChange={e => {
              const v = parseFloat(e.target.value)
              if (Number.isFinite(v)) updateGroupRadial(group.id, { cx: v })
            }}
          />
          <input
            type="number"
            step={1}
            value={radial.cy}
            onChange={e => {
              const v = parseFloat(e.target.value)
              if (Number.isFinite(v)) updateGroupRadial(group.id, { cy: v })
            }}
          />
        </div>
      </label>
      <label>
        <span className="flex flex-wrap items-center gap-1.5">
          <span style={{ flex: 1 }}>Angle (°)</span>
          <span className="text-muted text-[11px]">{copies} copies</span>
        </span>
        <div className="flex items-center gap-1.5">
          <input
            type="number"
            step={1}
            min={1}
            max={360}
            value={radial.angle}
            onChange={e => {
              const v = parseFloat(e.target.value)
              if (Number.isFinite(v) && v > 0) updateGroupRadial(group.id, { angle: v })
            }}
          />
        </div>
      </label>
      <div className="flex flex-wrap items-center gap-1.5">
        {RADIAL_PRESETS.map(a => (
          <button
            key={a}
            type="button"
            className="px-[7px] py-[2px] text-[11px]"
            onClick={() => updateGroupRadial(group.id, { angle: a })}
            title={`Set the increment to ${a}°.`}
          >
            {a}°
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          className={APPLY_BTN}
          onClick={() => convertGroupRadial(group.id)}
          title="Bake every radial clone into independent shape layers within this same group."
        >
          Convert to layers
        </button>
      </div>
    </section>
  )
}

/**
 * Group animation panel. Same shape as the per-shape AnimationControls but
 * without the color-channel and spin sub-rows that don't apply at the
 * group level — fill / stroke live on individual children and would be
 * ambiguous to animate at the wrapper. Spin is also omitted for the same
 * reason: per-child spin is already a thing and a group spin would
 * compose unpredictably with it.
 */
function GroupAnimationControls({
  animation,
  animationEnabled,
  onChange,
}: {
  animation: AnimationSpec | undefined
  animationEnabled: boolean
  onChange: (next: AnimationSpec | undefined) => void
}) {
  const updateFrom = (patch: Partial<AnimationFromState>) => {
    if (!animation) return
    onChange({ ...animation, from: { ...animation.from, ...patch } })
  }
  const setSpec = (next: AnimationSpec | undefined) => onChange(next)

  return (
    <section className="border-line mt-2.5 border-t pt-2.5" style={{ opacity: animationEnabled ? 1 : 0.55 }}>
      <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
        <span className="text-muted flex-1 text-[11px] tracking-[0.5px] uppercase">Group animation</span>
        <input
          type="checkbox"
          checked={!!animation}
          onChange={e =>
            setSpec(
              e.target.checked
                ? { duration: DEFAULT_ANIMATION.duration, delay: 0, easing: 'ease-out', from: {} }
                : undefined,
            )
          }
        />
      </div>
      {!animationEnabled && animation && (
        <p className="text-muted-2 mb-2 text-[10px] leading-snug tracking-normal normal-case">
          Project animations are off — toggle in Project panel to preview.
        </p>
      )}
      {animation && (
        <>
          <label>
            <span>Duration (ms)</span>
            <input
              type="number"
              min={0}
              step={50}
              value={animation.duration}
              onChange={e => {
                const v = parseFloat(e.target.value)
                if (Number.isFinite(v) && v >= 0) setSpec({ ...animation, duration: v })
              }}
            />
          </label>
          <label>
            <span>Delay (ms)</span>
            <input
              type="number"
              min={0}
              step={50}
              value={animation.delay}
              onChange={e => {
                const v = parseFloat(e.target.value)
                if (Number.isFinite(v) && v >= 0) setSpec({ ...animation, delay: v })
              }}
            />
          </label>
          <label>
            <span>Easing</span>
            <select
              value={animation.easing}
              onChange={e => setSpec({ ...animation, easing: e.target.value as Easing })}
            >
              {EASINGS.map(e => (
                <option key={e} value={e}>
                  {e}
                </option>
              ))}
            </select>
          </label>

          <div className="text-muted mt-2 mb-1 text-[10px] tracking-[0.5px] uppercase">From state</div>
          <label>
            <span>Opacity</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={animation.from.opacity ?? 1}
              onChange={e => {
                const v = parseFloat(e.target.value)
                updateFrom({ opacity: v >= 1 ? undefined : v })
              }}
            />
            <span className="text-text tabular-nums">{(animation.from.opacity ?? 1).toFixed(2)}</span>
          </label>
          <label>
            <span>Rotation offset (°)</span>
            <NumField value={animation.from.rotation} placeholder={0} onChange={v => updateFrom({ rotation: v })} />
          </label>
          <label>
            <span>Scale factor</span>
            <NumField
              value={animation.from.scale}
              placeholder={1}
              step={0.05}
              onChange={v => updateFrom({ scale: v })}
            />
          </label>
          <label>
            <span>Translate X / Y</span>
            <div className="flex items-center gap-1.5">
              <NumField
                value={animation.from.translateX}
                placeholder={0}
                onChange={v => updateFrom({ translateX: v })}
              />
              <NumField
                value={animation.from.translateY}
                placeholder={0}
                onChange={v => updateFrom({ translateY: v })}
              />
            </div>
          </label>
        </>
      )}
    </section>
  )
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
