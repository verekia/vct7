import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'

import { sceneTotal, spinStartT } from '../lib/animation'
import { useStore } from '../store'

import type { AnimationSpec, Shape } from '../types'

/**
 * Bottom-of-screen scrubber + playback controls for the per-shape entrance
 * animations. Always rendered (so the row height stays stable) but visually
 * dimmed and non-interactive when `settings.animationEnabled` is false.
 *
 * The expandable tracks panel below the scrubber visualizes each animated
 * shape on its own time-aligned track:
 *  - Red **clip** for the entrance window (`delay` → `delay + duration`).
 *    Clicking selects the shape; dragging the body or either edge mutates
 *    `delay` / `duration` directly so the inspector and the timeline stay in
 *    sync. (We use "clip" — the After Effects / video-editor term — for the
 *    pill that represents an animation's timing window on a track.)
 *  - Vertical dashed line at the entrance end when the shape also has a spin,
 *    marking where the finite animation lands and the looping tail begins.
 *  - Sky-blue clip for the spin's looping segment, drawn from `spinStartT` to
 *    the timeline end (selectable, not draggable — there's no finite duration
 *    to edit on an infinite loop).
 *
 * Authoring still happens in the inspector — the timeline only proxies delay /
 * duration via drag for ergonomics.
 *
 * Authoring uses the JS interpolation path in {@link AnimatedShape} — the
 * scrubber drives `previewT` directly. Play just runs a rAF loop that walks
 * `previewT` from 0 to the scene total, then pauses on the rest pose. The
 * exported SVG ships its own CSS-keyframe animation, so what plays here is
 * effectively a faithful preview rather than the real engine.
 */
export function Timeline() {
  const animationEnabled = useStore(s => s.settings.animationEnabled)
  const setSettings = useStore(s => s.setSettings)
  const shapes = useStore(s => s.shapes)
  const groups = useStore(s => s.groups)
  const previewT = useStore(s => s.previewT)
  const previewPlaying = useStore(s => s.previewPlaying)
  const onionSkin = useStore(s => s.onionSkin)
  const setPreviewT = useStore(s => s.setPreviewT)
  const setPreviewPlaying = useStore(s => s.setPreviewPlaying)
  const setOnionSkin = useStore(s => s.setOnionSkin)
  const selectShape = useStore(s => s.selectShape)
  const updateShape = useStore(s => s.updateShape)
  const selectedShapeIds = useStore(s => s.selectedShapeIds)

  const total = sceneTotal(shapes, groups)
  const hasAnimated = total > 0
  const animatedShapes = shapes.filter(s => s.animation)
  // Slider value: when no scrub is active and we're not playing, sit at total
  // (rest pose) so the user sees where the timeline ends without thinking.
  const sliderT = previewT ?? total

  const [expanded, setExpanded] = useState(false)

  // rAF playback loop. Captures `total` once at start so a mid-play edit to
  // a shape's duration doesn't yank the head somewhere unexpected — restart
  // play to pick up the new duration.
  const rafRef = useRef<number | null>(null)
  useEffect(() => {
    if (!previewPlaying) {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
      return
    }
    if (total <= 0) {
      setPreviewPlaying(false)
      return
    }
    const startWall = performance.now()
    const startT = previewT ?? 0
    const tick = (wall: number) => {
      const t = startT + (wall - startWall)
      if (t >= total) {
        setPreviewT(null)
        setPreviewPlaying(false)
        rafRef.current = null
        return
      }
      setPreviewT(t)
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
    }
    // previewT intentionally excluded — we capture it once at start, otherwise
    // every tick would tear down + rebuild this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewPlaying, total])

  const onPlay = () => {
    if (total <= 0) return
    setPreviewT(0)
    setPreviewPlaying(true)
  }
  const onStop = () => {
    setPreviewPlaying(false)
    setPreviewT(null)
  }

  const interactive = animationEnabled && hasAnimated
  const dimmed = !animationEnabled
  const tracksOpen = expanded && hasAnimated

  return (
    <div className="timeline-surface border-line border-t" style={{ opacity: dimmed ? 0.45 : 1 }}>
      <div className="text-muted flex items-center gap-3 px-3.5 py-1.5 text-[11px]">
        <label className="flex cursor-pointer items-center gap-1.5 tracking-normal normal-case">
          <input
            type="checkbox"
            checked={animationEnabled}
            onChange={e => setSettings({ animationEnabled: e.target.checked })}
          />
          <span className="text-[10px] tracking-[0.5px] uppercase">Animate</span>
        </label>

        <div className="flex items-center gap-1">
          <button
            type="button"
            className="px-2 py-[2px] text-[11px]"
            onClick={previewPlaying ? () => setPreviewPlaying(false) : onPlay}
            disabled={!interactive}
            title={previewPlaying ? 'Pause' : 'Play'}
          >
            {previewPlaying ? 'Pause' : 'Play'}
          </button>
          <button
            type="button"
            className="px-2 py-[2px] text-[11px]"
            onClick={onStop}
            disabled={!interactive}
            title="Reset to rest pose"
          >
            Stop
          </button>
        </div>

        <label className="flex cursor-pointer items-center gap-1.5 tracking-normal normal-case">
          <input
            type="checkbox"
            checked={onionSkin}
            onChange={e => setOnionSkin(e.target.checked)}
            disabled={!interactive}
          />
          <span className="text-[10px] tracking-[0.5px] uppercase">Onion</span>
        </label>

        <button
          type="button"
          className="px-2 py-[2px] text-[11px]"
          onClick={() => setExpanded(v => !v)}
          disabled={!hasAnimated}
          title={tracksOpen ? 'Collapse tracks' : 'Expand tracks'}
        >
          {tracksOpen ? 'Tracks ▾' : 'Tracks ▸'}
        </button>

        <input
          type="range"
          min={0}
          max={total > 0 ? total : 1000}
          step={1}
          value={sliderT}
          disabled={!interactive}
          onChange={e => {
            const v = parseFloat(e.target.value)
            if (!Number.isFinite(v)) return
            if (previewPlaying) setPreviewPlaying(false)
            // Releasing the head at the very end maps to "rest" (null) so the
            // canvas drops the wrapper entirely — matches the static editor.
            setPreviewT(v >= total ? null : v)
          }}
          className="flex-1"
        />

        <span className="min-w-[80px] text-right text-[10px] tracking-[0.5px] uppercase tabular-nums">
          {hasAnimated ? `${Math.round(sliderT)} / ${Math.round(total)} ms` : 'no animated shapes'}
        </span>
      </div>

      {tracksOpen && (
        <TracksPanel
          shapes={animatedShapes}
          total={total}
          interactive={interactive}
          selectedIds={selectedShapeIds}
          onSelect={selectShape}
          onPatch={(id, patch) => updateShape(id, { animation: patch })}
        />
      )}
    </div>
  )
}

const NAME_COL_WIDTH = 120
const TRACK_HEIGHT = 22
const CLIP_HEIGHT = 14

interface TracksPanelProps {
  shapes: Shape[]
  total: number
  interactive: boolean
  selectedIds: string[]
  onSelect: (id: string) => void
  onPatch: (id: string, patch: AnimationSpec) => void
}

function TracksPanel({ shapes, total, interactive, selectedIds, onSelect, onPatch }: TracksPanelProps) {
  return (
    <div className="border-line border-t px-3.5 py-1.5">
      {shapes.map(shape => (
        <TrackRow
          key={shape.id}
          shape={shape}
          total={total}
          interactive={interactive}
          selected={selectedIds.includes(shape.id)}
          onSelect={onSelect}
          onPatch={onPatch}
        />
      ))}
    </div>
  )
}

interface TrackRowProps {
  shape: Shape
  total: number
  interactive: boolean
  selected: boolean
  onSelect: (id: string) => void
  onPatch: (id: string, patch: AnimationSpec) => void
}

function TrackRow({ shape, total, interactive, selected, onSelect, onPatch }: TrackRowProps) {
  const axisRef = useRef<HTMLDivElement>(null)
  const anim = shape.animation
  if (!anim || total <= 0) return null

  const entranceStart = anim.delay
  const entranceEnd = anim.delay + anim.duration
  const hasSpin = !!anim.spin && anim.spin.speed !== 0
  const spinStart = hasSpin ? spinStartT(anim) : 0

  // Drag start — captures the initial geometry, then walks delay/duration as
  // the mouse moves. updateShape's coalesceKey collapses the whole drag into
  // one undo entry. We read the latest animation from the store on each move
  // so a concurrent edit (rare, but possible via the inspector) doesn't get
  // clobbered by a stale closure capture.
  const startDrag = (e: ReactMouseEvent, kind: 'body' | 'left' | 'right') => {
    if (!interactive) return
    e.preventDefault()
    e.stopPropagation()
    onSelect(shape.id)
    const axis = axisRef.current
    if (!axis) return
    const axisWidth = axis.getBoundingClientRect().width
    if (axisWidth <= 0) return
    const startX = e.clientX
    const startDelay = anim.delay
    const startDuration = anim.duration
    const rightEdge = startDelay + startDuration

    const onMove = (ev: MouseEvent) => {
      const dt = ((ev.clientX - startX) / axisWidth) * total
      let nextDelay = startDelay
      let nextDuration = startDuration
      if (kind === 'body') {
        nextDelay = Math.max(0, startDelay + dt)
      } else if (kind === 'left') {
        // Right edge stays put: shrink/grow duration as the left edge moves.
        nextDelay = Math.max(0, Math.min(rightEdge, startDelay + dt))
        nextDuration = Math.max(0, rightEdge - nextDelay)
      } else {
        nextDuration = Math.max(0, startDuration + dt)
      }
      const current = useStore.getState().shapes.find(s => s.id === shape.id)?.animation
      if (!current) return
      onPatch(shape.id, { ...current, delay: nextDelay, duration: nextDuration })
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const pct = (ms: number) => `${(ms / total) * 100}%`
  const widthPct = (a: number, b: number) => `${Math.max(0, ((b - a) / total) * 100)}%`
  const name = displayName(shape)

  return (
    <div className="flex items-center" style={{ height: TRACK_HEIGHT }} data-selected={selected || undefined}>
      <button
        type="button"
        className="text-text shrink-0 truncate text-left text-[11px] tracking-normal normal-case"
        style={{ width: NAME_COL_WIDTH, paddingRight: 8 }}
        onClick={() => interactive && onSelect(shape.id)}
        title={name}
      >
        {name}
      </button>
      <div
        ref={axisRef}
        className="relative flex-1"
        style={{ height: CLIP_HEIGHT, background: 'var(--color-bg-0)', borderRadius: 2 }}
      >
        {hasSpin && (
          <div
            className="absolute"
            style={{
              left: pct(Math.max(0, spinStart)),
              width: widthPct(Math.max(0, spinStart), total),
              top: 0,
              bottom: 0,
              background: '#3aa5ff',
              opacity: selected ? 0.95 : 0.7,
              borderRadius: 2,
              cursor: interactive ? 'pointer' : 'default',
            }}
            onMouseDown={e => {
              if (!interactive) return
              e.stopPropagation()
              onSelect(shape.id)
            }}
            title={`spin from ${Math.round(spinStart)} ms (${anim.spin?.speed ?? 0}°/s)`}
          />
        )}
        {hasSpin && entranceEnd >= 0 && entranceEnd <= total && (
          <div
            className="pointer-events-none absolute"
            style={{
              left: `calc(${pct(entranceEnd)} - 0.5px)`,
              top: -2,
              bottom: -2,
              width: 0,
              borderLeft: '1px dashed var(--color-muted)',
            }}
          />
        )}
        <div
          className="absolute"
          style={{
            left: pct(entranceStart),
            width: widthPct(entranceStart, entranceEnd),
            top: 0,
            bottom: 0,
            background: 'var(--color-accent)',
            opacity: selected ? 1 : 0.85,
            borderRadius: 2,
            cursor: interactive ? 'grab' : 'default',
            outline: selected ? '1px solid var(--color-accent-2)' : 'none',
            outlineOffset: 0,
          }}
          onMouseDown={e => startDrag(e, 'body')}
          title={`${Math.round(entranceStart)} → ${Math.round(entranceEnd)} ms (drag to move)`}
        >
          <span
            className="pointer-events-none absolute inset-0 flex items-center px-1.5 text-[10px] leading-none whitespace-nowrap text-white select-none"
            style={{ overflow: 'hidden' }}
          >
            {name}
          </span>
          <div
            className="absolute"
            style={{ left: 0, top: 0, bottom: 0, width: 5, cursor: interactive ? 'col-resize' : 'default' }}
            onMouseDown={e => startDrag(e, 'left')}
          />
          <div
            className="absolute"
            style={{ right: 0, top: 0, bottom: 0, width: 5, cursor: interactive ? 'col-resize' : 'default' }}
            onMouseDown={e => startDrag(e, 'right')}
          />
        </div>
      </div>
    </div>
  )
}

const displayName = (shape: Shape): string => {
  if (shape.name) return shape.name
  if (shape.kind === 'circle') return 'circle'
  if (shape.kind === 'glyphs') return shape.glyphs?.text || 'text'
  return shape.closed ? 'polygon' : 'line'
}
