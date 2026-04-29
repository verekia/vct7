import { useEffect, useRef } from 'react'

import { sceneTotal } from '../lib/animation'
import { useStore } from '../store'

/**
 * Bottom-of-screen scrubber + playback controls for the per-shape entrance
 * animations. Always rendered (so the row height stays stable) but visually
 * dimmed and non-interactive when `settings.animationEnabled` is false.
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
  const previewT = useStore(s => s.previewT)
  const previewPlaying = useStore(s => s.previewPlaying)
  const onionSkin = useStore(s => s.onionSkin)
  const setPreviewT = useStore(s => s.setPreviewT)
  const setPreviewPlaying = useStore(s => s.setPreviewPlaying)
  const setOnionSkin = useStore(s => s.setOnionSkin)

  const total = sceneTotal(shapes)
  const hasAnimated = total > 0
  // Slider value: when no scrub is active and we're not playing, sit at total
  // (rest pose) so the user sees where the timeline ends without thinking.
  const sliderT = previewT ?? total

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

  return (
    <div
      className="timeline-surface border-line text-muted flex items-center gap-3 border-t px-3.5 py-1.5 text-[11px]"
      style={{ opacity: dimmed ? 0.45 : 1 }}
    >
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
  )
}
