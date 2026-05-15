import { useEffect, useRef, useState } from 'react'

import { ANGLE_PRESETS } from '../lib/snap'
import { useStore } from '../store'
import { BEZIER_MODES } from '../types'

import type { BezierMode, PaletteColor } from '../types'

const BEZIER_MODE_LABELS: Record<BezierMode, string> = {
  proportional: 'Proportional',
  absolute: 'Radius absolute',
  relative: 'Radius relative',
}

/** Slider config — `max` and `step` adapt to the chosen bezier mode. */
export interface BezierSliderRange {
  max: number
  step: number
  isAbsolute: boolean
}

export const bezierSliderRange = (mode: BezierMode, canvasRef: number): BezierSliderRange => {
  if (mode === 'absolute') {
    const max = Math.max(1, canvasRef / 2)
    return { max, step: Math.max(0.1, max / 100), isAbsolute: true }
  }
  return { max: 1, step: 0.01, isAbsolute: false }
}

const HEX_RE = /^#[0-9a-f]{3}([0-9a-f]{3})?$/i
// Mirrors PALETTE_NAME_RE in svg-io.ts — keep these aligned so a name accepted
// by the editor also round-trips through the saved file.
const PALETTE_NAME_RE = /^[A-Za-z0-9_-][A-Za-z0-9_ -]*$/

const PRESET_LABELS: Record<string, string> = {
  ortho: '90°',
  '45': '45°',
  '30': '30°',
  '60': '60°',
  '15': '15°',
}

const sameAngles = (a: number[], b: number[]): boolean => a.length === b.length && a.every((v, i) => v === b[i])

// `<input type="color">` requires `#rrggbb`; expand a 3-digit hex if needed.
const toLongHex = (c: string): string => {
  if (/^#[0-9a-f]{6}$/i.test(c)) return c
  if (/^#[0-9a-f]{3}$/i.test(c)) {
    return (
      '#' +
      c
        .slice(1)
        .split('')
        .map(ch => ch + ch)
        .join('')
    )
  }
  return '#ffffff'
}

export function ProjectPanel() {
  const settings = useStore(s => s.settings)
  const setSettings = useStore(s => s.setSettings)
  const addPaletteColor = useStore(s => s.addPaletteColor)
  const updatePaletteColor = useStore(s => s.updatePaletteColor)
  const removePaletteColor = useStore(s => s.removePaletteColor)
  const setBgPaletteRef = useStore(s => s.setBgPaletteRef)

  const bgEnabled = settings.bg !== null
  const [bgText, setBgText] = useState(settings.bg ?? '')
  useEffect(() => setBgText(settings.bg ?? ''), [settings.bg])
  // Remember the last-used color so toggling the checkbox off and back on
  // restores it instead of resetting to white.
  const lastBgRef = useRef<string>(settings.bg ?? '#ffffff')
  useEffect(() => {
    if (settings.bg) lastBgRef.current = settings.bg
  }, [settings.bg])

  const [widthText, setWidthText] = useState(String(settings.width))
  const [heightText, setHeightText] = useState(String(settings.height))
  useEffect(() => setWidthText(String(settings.width)), [settings.width])
  useEffect(() => setHeightText(String(settings.height)), [settings.height])

  const [vbXText, setVbXText] = useState(String(settings.viewBoxX))
  const [vbYText, setVbYText] = useState(String(settings.viewBoxY))
  const [vbWText, setVbWText] = useState(String(settings.viewBoxWidth))
  const [vbHText, setVbHText] = useState(String(settings.viewBoxHeight))
  useEffect(() => setVbXText(String(settings.viewBoxX)), [settings.viewBoxX])
  useEffect(() => setVbYText(String(settings.viewBoxY)), [settings.viewBoxY])
  useEffect(() => setVbWText(String(settings.viewBoxWidth)), [settings.viewBoxWidth])
  useEffect(() => setVbHText(String(settings.viewBoxHeight)), [settings.viewBoxHeight])

  const viewBoxMatchesCanvas =
    settings.viewBoxX === 0 &&
    settings.viewBoxY === 0 &&
    settings.viewBoxWidth === settings.width &&
    settings.viewBoxHeight === settings.height

  const [gridSizeText, setGridSizeText] = useState(String(settings.gridSize))
  useEffect(() => setGridSizeText(String(settings.gridSize)), [settings.gridSize])

  return (
    <section className="border-line relative border-b px-3.5 py-3 last:border-b-0">
      <div className="text-muted mb-2.5 flex flex-col gap-1 text-[11px] tracking-[0.4px]">
        <span className="flex items-center justify-between gap-1.5">Snap angles</span>
        <div className="grid grid-cols-5 gap-[3px]">
          {Object.keys(ANGLE_PRESETS).map(key => {
            const isActive = sameAngles(settings.snapAngles, ANGLE_PRESETS[key])
            const cls = isActive
              ? 'text-[11px] px-[7px] py-[2px] bg-accent text-white border-accent shadow-[0_0_0_1px_rgba(255,59,48,0.25)]'
              : 'text-[11px] px-[7px] py-[2px]'
            return (
              <button
                key={key}
                type="button"
                className={cls}
                onClick={() => setSettings({ snapAngles: ANGLE_PRESETS[key] })}
              >
                {PRESET_LABELS[key] ?? `${key}°`}
              </button>
            )
          })}
        </div>
      </div>

      <BezierControl
        mode={settings.bezierMode ?? 'proportional'}
        value={settings.bezier}
        canvasRef={Math.min(settings.viewBoxWidth, settings.viewBoxHeight)}
        label="Global bezier"
        onModeChange={m => setSettings({ bezierMode: m === 'proportional' ? undefined : m })}
        onValueChange={v => setSettings({ bezier: v })}
      />

      <label>
        <span>Background</span>
        <div className="flex flex-wrap items-center gap-1.5">
          <input
            type="checkbox"
            checked={bgEnabled}
            title="Toggle background"
            onChange={e => setSettings({ bg: e.target.checked ? lastBgRef.current : null })}
          />
          <input
            type="color"
            value={toLongHex(settings.bg ?? lastBgRef.current)}
            disabled={!bgEnabled}
            onChange={e => setSettings({ bg: e.target.value })}
          />
          <input
            type="text"
            className="w-[72px]"
            value={bgText}
            disabled={!bgEnabled}
            onChange={e => setBgText(e.target.value)}
            onBlur={() => {
              if (HEX_RE.test(bgText)) setSettings({ bg: bgText })
              else setBgText(settings.bg ?? '')
            }}
          />
          {settings.palette.length > 0 && bgEnabled && (
            <PaletteRefSelect palette={settings.palette} value={settings.bgRef} onChange={setBgPaletteRef} />
          )}
        </div>
      </label>

      <PaletteSection
        palette={settings.palette}
        addColor={addPaletteColor}
        updateColor={updatePaletteColor}
        removeColor={removePaletteColor}
      />

      <label>
        <span title="SVG width / height attributes — output rendered size">Output size</span>
        <div className="flex flex-wrap items-center gap-1.5">
          <input
            type="number"
            min={1}
            value={widthText}
            onChange={e => setWidthText(e.target.value)}
            onBlur={() => {
              const v = parseFloat(widthText)
              if (Number.isFinite(v) && v > 0) setSettings({ width: v })
              else setWidthText(String(settings.width))
            }}
          />
          <span>×</span>
          <input
            type="number"
            min={1}
            value={heightText}
            onChange={e => setHeightText(e.target.value)}
            onBlur={() => {
              const v = parseFloat(heightText)
              if (Number.isFinite(v) && v > 0) setSettings({ height: v })
              else setHeightText(String(settings.height))
            }}
          />
          <label className="checkbox" title="Hide parts of shapes that fall outside the artboard">
            <input type="checkbox" checked={settings.clip} onChange={e => setSettings({ clip: e.target.checked })} />
            <span>Clip</span>
          </label>
        </div>
      </label>

      <label>
        <span title="SVG viewBox — drawing coordinate space and the editor artboard">ViewBox</span>
        <div className="flex flex-wrap items-center gap-1.5">
          <input
            type="number"
            value={vbXText}
            title="x"
            onChange={e => setVbXText(e.target.value)}
            onBlur={() => {
              const v = parseFloat(vbXText)
              if (Number.isFinite(v)) setSettings({ viewBoxX: v })
              else setVbXText(String(settings.viewBoxX))
            }}
          />
          <input
            type="number"
            value={vbYText}
            title="y"
            onChange={e => setVbYText(e.target.value)}
            onBlur={() => {
              const v = parseFloat(vbYText)
              if (Number.isFinite(v)) setSettings({ viewBoxY: v })
              else setVbYText(String(settings.viewBoxY))
            }}
          />
          <input
            type="number"
            min={1}
            value={vbWText}
            title="width"
            onChange={e => setVbWText(e.target.value)}
            onBlur={() => {
              const v = parseFloat(vbWText)
              if (Number.isFinite(v) && v > 0) setSettings({ viewBoxWidth: v })
              else setVbWText(String(settings.viewBoxWidth))
            }}
          />
          <span>×</span>
          <input
            type="number"
            min={1}
            value={vbHText}
            title="height"
            onChange={e => setVbHText(e.target.value)}
            onBlur={() => {
              const v = parseFloat(vbHText)
              if (Number.isFinite(v) && v > 0) setSettings({ viewBoxHeight: v })
              else setVbHText(String(settings.viewBoxHeight))
            }}
          />
          <button
            type="button"
            className="px-[7px] py-[2px] text-[11px]"
            disabled={viewBoxMatchesCanvas}
            title="Reset viewBox to 0 0 (output width) (output height)"
            onClick={() =>
              setSettings({
                viewBoxX: 0,
                viewBoxY: 0,
                viewBoxWidth: settings.width,
                viewBoxHeight: settings.height,
              })
            }
          >
            Match
          </button>
        </div>
      </label>

      <div className="text-muted mb-2.5 flex flex-col gap-1 text-[11px] tracking-[0.4px]">
        <span className="flex items-center justify-between gap-1.5">Grid</span>
        <div className="flex flex-wrap items-center gap-1.5">
          <input
            type="number"
            min={1}
            style={{ width: 60 }}
            value={gridSizeText}
            onChange={e => {
              const next = e.target.value
              setGridSizeText(next)
              const v = parseFloat(next)
              if (Number.isFinite(v) && v > 0) setSettings({ gridSize: v })
            }}
            onBlur={() => {
              const v = parseFloat(gridSizeText)
              if (!Number.isFinite(v) || v <= 0) setGridSizeText(String(settings.gridSize))
            }}
          />
          <label className="checkbox" title="Show grid (G)">
            <input
              type="checkbox"
              checked={settings.gridVisible}
              onChange={e => setSettings({ gridVisible: e.target.checked })}
            />
            <span>Show</span>
          </label>
          <label className="checkbox" title="Snap to grid">
            <input
              type="checkbox"
              checked={settings.gridSnap}
              onChange={e => setSettings({ gridSnap: e.target.checked })}
            />
            <span>Snap</span>
          </label>
        </div>
      </div>
    </section>
  )
}

/**
 * Mode dropdown + numeric/slider input for a single bezier value. Reused at
 * every scope (global, per-shape, per-point) so the controls look identical
 * everywhere. `extra` is rendered to the right of the mode dropdown — for
 * scopes that have an "inherit" / "use global" button.
 *
 * `valueDisplay` is rendered after the slider; multi-shape selections pass
 * "Mixed" or a fallback readout here. When omitted the resolved value is
 * shown in plain `toFixed` form.
 */
export function BezierControl({
  mode,
  value,
  canvasRef,
  label,
  extra,
  valueDisplay,
  onModeChange,
  onValueChange,
}: {
  mode: BezierMode
  value: number
  canvasRef: number
  label: string
  extra?: React.ReactNode
  valueDisplay?: React.ReactNode
  onModeChange: (m: BezierMode) => void
  onValueChange: (v: number) => void
}) {
  const range = bezierSliderRange(mode, canvasRef)
  const sliderValue = Math.min(Math.max(0, value), range.max)
  return (
    <label>
      <span className="flex flex-wrap items-center gap-1.5">
        <span style={{ flex: 1 }}>{label}</span>
        <select
          className="text-[11px]"
          value={mode}
          onChange={e => onModeChange(e.target.value as BezierMode)}
          title="How this value becomes a corner radius"
        >
          {BEZIER_MODES.map(m => (
            <option key={m} value={m}>
              {BEZIER_MODE_LABELS[m]}
            </option>
          ))}
        </select>
        {extra}
      </span>
      <input
        type="range"
        min={0}
        max={range.max}
        step={range.step}
        value={sliderValue}
        onChange={e => onValueChange(parseFloat(e.target.value))}
      />
      <span className="text-text tabular-nums">
        {valueDisplay ?? (range.isAbsolute ? value.toFixed(1) : value.toFixed(2))}
      </span>
    </label>
  )
}

const DEFAULT_NEW_PALETTE_COLOR = '#888888'

/**
 * Suggest the next default palette name when the user hits "Add" — `color1`,
 * `color2`, ... — skipping any names already taken so the new entry doesn't
 * collide with an existing one.
 */
const nextPaletteName = (palette: PaletteColor[]): string => {
  const taken = new Set(palette.map(p => p.name))
  for (let i = 1; i < 1000; i++) {
    const candidate = `color${i}`
    if (!taken.has(candidate)) return candidate
  }
  return `color${palette.length + 1}`
}

function PaletteSection({
  palette,
  addColor,
  updateColor,
  removeColor,
}: {
  palette: PaletteColor[]
  addColor: (name: string, color: string) => void
  updateColor: (oldName: string, next: PaletteColor) => void
  removeColor: (name: string) => void
}) {
  return (
    <div className="text-muted mb-2.5 flex flex-col gap-1 text-[11px] tracking-[0.4px]">
      <span className="flex items-center justify-between gap-1.5">
        <span>Palette</span>
        <button
          type="button"
          className="px-[7px] py-[2px] text-[11px]"
          onClick={() => addColor(nextPaletteName(palette), DEFAULT_NEW_PALETTE_COLOR)}
        >
          + Add
        </button>
      </span>
      {palette.length === 0 ? (
        <span className="text-muted-2 text-[10px] leading-snug tracking-normal normal-case">
          No palette colors yet. Add one to reference it from shape fills and strokes.
        </span>
      ) : (
        <div className="flex flex-col gap-1">
          {palette.map(entry => (
            <PaletteRow
              key={entry.name}
              entry={entry}
              onChange={next => updateColor(entry.name, next)}
              onRemove={() => removeColor(entry.name)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function PaletteRow({
  entry,
  onChange,
  onRemove,
}: {
  entry: PaletteColor
  onChange: (next: PaletteColor) => void
  onRemove: () => void
}) {
  const [nameDraft, setNameDraft] = useState(entry.name)
  const [colorDraft, setColorDraft] = useState(entry.color)
  // Resync local drafts when the underlying entry changes (rename via another
  // input, color change committed, etc.). The drafts are short-lived edit
  // buffers — the canonical value is what the store holds.
  useEffect(() => setNameDraft(entry.name), [entry.name])
  useEffect(() => setColorDraft(entry.color), [entry.color])
  return (
    <div className="flex items-center gap-1.5">
      <input
        type="color"
        value={toLongHex(entry.color)}
        onChange={e => {
          setColorDraft(e.target.value)
          onChange({ name: entry.name, color: e.target.value })
        }}
      />
      <input
        type="text"
        className="min-w-0 flex-1"
        value={nameDraft}
        onChange={e => setNameDraft(e.target.value)}
        onBlur={() => {
          const trimmed = nameDraft.trim()
          if (trimmed && trimmed !== entry.name && PALETTE_NAME_RE.test(trimmed)) {
            onChange({ name: trimmed, color: entry.color })
          } else if (trimmed !== entry.name) {
            // Reject invalid renames silently — easier than a toast for now.
            setNameDraft(entry.name)
          }
        }}
      />
      <input
        type="text"
        className="w-[72px]"
        value={colorDraft}
        onChange={e => setColorDraft(e.target.value)}
        onBlur={() => {
          if (HEX_RE.test(colorDraft) && colorDraft !== entry.color) {
            onChange({ name: entry.name, color: colorDraft })
          } else if (colorDraft !== entry.color) {
            setColorDraft(entry.color)
          }
        }}
      />
      <button
        type="button"
        className="px-[7px] py-[2px] text-[11px]"
        title="Remove color (shapes referencing it keep the resolved hex)"
        onClick={onRemove}
      >
        ×
      </button>
    </div>
  )
}

/**
 * Compact dropdown for picking a palette entry. The empty value clears the
 * link (color stays at whatever the field had); selecting an entry sets the
 * ref and snaps the field to the entry's color.
 */
export function PaletteRefSelect({
  palette,
  value,
  onChange,
}: {
  palette: PaletteColor[]
  value: string | undefined
  onChange: (name: string | undefined) => void
}) {
  return (
    <select
      className="text-[11px]"
      title="Link to palette color"
      value={value ?? ''}
      onChange={e => onChange(e.target.value === '' ? undefined : e.target.value)}
    >
      <option value="">— off-palette —</option>
      {palette.map(p => (
        <option key={p.name} value={p.name}>
          {p.name}
        </option>
      ))}
    </select>
  )
}
