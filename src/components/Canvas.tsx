import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'

import { useCanvasInteractions } from '../hooks/useCanvasInteractions'
import {
  IDENTITY_OFFSETS,
  groupOffsetsToTransform,
  lerpOffsets,
  offsetsToTransform,
  sampleAnimation,
  sampleAnimationSpec,
} from '../lib/animation'
import { arcToPath, dist, fmt, isPartialArc, pointsToPath } from '../lib/geometry'
import {
  composeTransformString,
  groupBBoxCenter,
  hasTransform,
  pairBBoxCenter,
  radialCloneAngles,
  reflectShape,
  shapeRotation,
  shapeScale,
  transformAroundString,
} from '../lib/transform'
import { useStore } from '../store'
import { effectiveBezier } from '../store'

import type { BoxSelect } from '../store'
import type { Drawing, Group, Point, ProjectSettings, Shape } from '../types'

interface ContainerSize {
  w: number
  h: number
}

export function Canvas() {
  const wrapRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  // Start at 0×0 so the fit effect's `size.w <= 1` gate skips the very first
  // pass — otherwise it'd lock the initial fit to a hardcoded fallback (and
  // the nonce gate prevents re-running once the real measurement arrives).
  const [size, setSize] = useState<ContainerSize>({ w: 0, h: 0 })

  // Track container size to drive the SVG viewBox.
  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const measure = () => setSize({ w: el.clientWidth || 1, h: el.clientHeight || 1 })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Refit when explicitly requested (initial mount, file load, F shortcut, …).
  // Resizing the window alone must NOT reset the user's view.
  const settings = useStore(s => s.settings)
  const setView = useStore(s => s.setView)
  const fitNonce = useStore(s => s.fitNonce)
  const lastFitNonce = useRef(-1)
  useEffect(() => {
    if (size.w <= 1 || size.h <= 1) return
    if (lastFitNonce.current === fitNonce) return
    lastFitNonce.current = fitNonce
    const pad = 40
    // Fit centers the artboard (= viewBox) in the viewport. The viewBox origin
    // may be non-zero, so subtract `vbX*scale` from the centering offset to
    // place the artboard's top-left where it belongs in world space.
    const vbW = settings.viewBoxWidth
    const vbH = settings.viewBoxHeight
    const scale = Math.min((size.w - pad * 2) / vbW, (size.h - pad * 2) / vbH)
    const s = scale > 0 ? scale : 1
    setView({
      scale: s,
      x: (size.w - vbW * s) / 2 - settings.viewBoxX * s,
      y: (size.h - vbH * s) / 2 - settings.viewBoxY * s,
    })
  }, [
    fitNonce,
    size.w,
    size.h,
    settings.viewBoxX,
    settings.viewBoxY,
    settings.viewBoxWidth,
    settings.viewBoxHeight,
    setView,
  ])

  useCanvasInteractions(svgRef)

  const tool = useStore(s => s.tool)
  const view = useStore(s => s.view)
  const cursor = useStore(s => s.cursor)
  const shapes = useStore(s => s.shapes)
  const groups = useStore(s => s.groups)
  const drawing = useStore(s => s.drawing)
  const selectedShapeIds = useStore(s => s.selectedShapeIds)
  const selectedVertices = useStore(s => s.selectedVertices)
  const snapDisabled = useStore(s => s.snapDisabled)
  const spaceHeld = useStore(s => s.spaceHeld)
  const panning = useStore(s => s.panning)
  const vertexDragging = useStore(s => s.vertexDragging)
  const snapTarget = useStore(s => s.snapTarget)
  const boxSelect = useStore(s => s.boxSelect)
  const previewT = useStore(s => s.previewT)
  const onionSkin = useStore(s => s.onionSkin)
  // Animation only renders when both the project switch and an active scrub /
  // play exist. Toggling animationEnabled off therefore behaves identically to
  // the pre-animation editor — shapes always show their rest pose.
  const animationActive = settings.animationEnabled
  const sceneT = animationActive ? previewT : null
  const onionActive = animationActive && onionSkin

  const selectedSet = useMemo(() => new Set(selectedShapeIds), [selectedShapeIds])
  const selectedShapes = shapes.filter(s => selectedSet.has(s.id))
  const singleSelected = selectedShapes.length === 1 ? selectedShapes[0] : null
  const groupById = useMemo(() => {
    const map = new Map<string, Group>()
    for (const g of groups) map.set(g.id, g)
    return map
  }, [groups])
  const transform = `translate(${fmt(view.x)} ${fmt(view.y)}) scale(${fmt(view.scale)})`

  const cls = [
    'canvas-svg block w-full h-full select-none relative z-[1]',
    tool === 'select' ? 'tool-select' : '',
    panning ? 'panning' : spaceHeld ? 'space' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div ref={wrapRef} className="canvas-surface bg-bg-0 relative overflow-hidden">
      <svg ref={svgRef} className={cls} viewBox={`0 0 ${size.w} ${size.h}`} xmlns="http://www.w3.org/2000/svg">
        <g transform={transform}>
          {settings.bg === null && (
            <defs>
              <CheckerPattern id="vh-checker" gridSize={settings.gridSize} scale={view.scale} />
            </defs>
          )}
          <rect
            x={settings.viewBoxX}
            y={settings.viewBoxY}
            width={settings.viewBoxWidth}
            height={settings.viewBoxHeight}
            fill={settings.bg === null ? 'url(#vh-checker)' : settings.bg}
          />
          {settings.gridVisible && settings.gridSize > 0 && (
            <GridLayer
              size={settings.gridSize}
              boardX={settings.viewBoxX}
              boardY={settings.viewBoxY}
              boardW={settings.viewBoxWidth}
              boardH={settings.viewBoxHeight}
              scale={view.scale}
            />
          )}
          <rect
            x={settings.viewBoxX}
            y={settings.viewBoxY}
            width={settings.viewBoxWidth}
            height={settings.viewBoxHeight}
            fill="none"
            stroke="#3a4150"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />

          {settings.clip && (
            <defs>
              <clipPath id="vh-artboard-clip">
                <rect
                  x={settings.viewBoxX}
                  y={settings.viewBoxY}
                  width={settings.viewBoxWidth}
                  height={settings.viewBoxHeight}
                />
              </clipPath>
            </defs>
          )}
          <g clipPath={settings.clip ? 'url(#vh-artboard-clip)' : undefined}>
            <ShapeStack shapes={shapes} groups={groups} settings={settings} sceneT={sceneT} onionActive={onionActive} />
          </g>

          {selectedShapes.map(shape => (
            <SelectionForShape
              key={shape.id}
              shape={shape}
              shapes={shapes}
              groupById={groupById}
              selectedVertices={selectedVertices}
              singleSelected={!!singleSelected}
              scale={view.scale}
            />
          ))}

          {/* Drag guides anchor on neighbors of one vertex — only meaningful
              when a single vertex is being moved. Multi-vertex drag is a pure
              translate so per-vertex angle rays would be noise. */}
          {vertexDragging &&
            singleSelected &&
            selectedVertices.length === 1 &&
            selectedVertices[0].shapeId === singleSelected.id &&
            !snapDisabled && (
              <VertexDragGuides shape={singleSelected} index={selectedVertices[0].index} settings={settings} />
            )}

          {boxSelect && <MarqueeRect box={boxSelect} />}

          {drawing && (
            <PreviewLayer
              drawing={drawing}
              cursor={cursor}
              snapDisabled={snapDisabled}
              snapAngles={settings.snapAngles}
              boardW={settings.viewBoxWidth}
              boardH={settings.viewBoxHeight}
              bezier={settings.bezier}
              scale={view.scale}
            />
          )}

          {snapTarget && (
            <circle
              className="snap-target"
              cx={fmt(snapTarget[0])}
              cy={fmt(snapTarget[1])}
              r={7 / view.scale}
              pointerEvents="none"
            />
          )}
        </g>
      </svg>
      <div className="hud-dots border-line text-muted pointer-events-none absolute right-3 bottom-3 z-[2] flex gap-3.5 border bg-[rgba(18,20,26,0.92)] px-3 py-[5px] text-[10px] tracking-[1.5px] uppercase tabular-nums backdrop-blur-[6px]">
        <span>
          {Math.round(cursor[0])}, {Math.round(cursor[1])}
        </span>
        <span>{Math.round(view.scale * 100)}%</span>
        <span>{tool}</span>
      </div>
    </div>
  )
}

// Checker tile thresholds in **screen pixels**, so tiles stay roughly constant
// across zoom levels. The actual tile size is converted to canvas units (the
// pattern coordinate space) on the fly via `/ scale`.
const CHECKER_TARGET_PX = 40
const CHECKER_MIN_PX = 24
const CHECKER_MAX_PX = 64

// Returns the tile size in canvas units. As long as the project has a grid
// spacing (regardless of whether the grid is rendered), snaps the tile to
// `gridSize · 2^k` so every grid line coincides with a tile boundary (or —
// when zoomed in past the grid — every tile boundary lies on a 1/2^|k|
// subdivision of the grid). The exponent is the one whose on-screen tile
// size lands closest to the screen target while still inside [MIN, MAX].
// This gives the checker a "subdivides as you zoom in" feel that stays
// grid-aligned at any zoom level.
const computeCheckerSize = (gridSize: number, scale: number): number => {
  const safeScale = scale > 0 ? scale : 1
  const targetCanvas = CHECKER_TARGET_PX / safeScale
  if (!(gridSize > 0)) return targetCanvas
  const minCanvas = CHECKER_MIN_PX / safeScale
  const maxCanvas = CHECKER_MAX_PX / safeScale
  // Pick the exponent k closest to the screen target.
  let exp = Math.round(Math.log2(targetCanvas / gridSize))
  let tile = gridSize * 2 ** exp
  // The MAX/MIN ratio (≥ 2) guarantees at least one power-of-2 step fits in
  // the band, so these loops settle quickly without oscillating.
  while (tile > maxCanvas) {
    exp -= 1
    tile = gridSize * 2 ** exp
  }
  while (tile < minCanvas) {
    exp += 1
    tile = gridSize * 2 ** exp
  }
  // Adjusting up could overshoot MAX in pathological setups (very narrow
  // band) — give up on grid snapping rather than emit something too large.
  if (tile > maxCanvas) return targetCanvas
  return tile
}

function CheckerPattern({ id, gridSize, scale }: { id: string; gridSize: number; scale: number }) {
  const s = computeCheckerSize(gridSize, scale)
  const t = s * 2
  return (
    <pattern id={id} x={0} y={0} width={t} height={t} patternUnits="userSpaceOnUse">
      <rect x={0} y={0} width={t} height={t} fill="#bcbcbc" />
      <rect x={0} y={0} width={s} height={s} fill="#aeaeae" />
      <rect x={s} y={s} width={s} height={s} fill="#aeaeae" />
    </pattern>
  )
}

function GridLayer({
  size,
  boardX,
  boardY,
  boardW,
  boardH,
  scale,
}: {
  size: number
  boardX: number
  boardY: number
  boardW: number
  boardH: number
  scale: number
}) {
  // Skip rendering if the grid would be visually noisy (sub-pixel) or huge.
  const screenSpacing = size * scale
  const lines = useMemo(() => {
    const xs: number[] = []
    const ys: number[] = []
    // Lines start one cell in from the artboard origin and run up to (but not
    // including) the right/bottom edge — borders are already drawn.
    for (let x = boardX + size; x < boardX + boardW; x += size) xs.push(x)
    for (let y = boardY + size; y < boardY + boardH; y += size) ys.push(y)
    return { xs, ys }
  }, [size, boardX, boardY, boardW, boardH])
  if (screenSpacing < 4) return null
  return (
    <g className="grid-layer" pointerEvents="none">
      {lines.xs.map(x => (
        <line
          key={`x${x}`}
          x1={fmt(x)}
          y1={fmt(boardY)}
          x2={fmt(x)}
          y2={fmt(boardY + boardH)}
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {lines.ys.map(y => (
        <line
          key={`y${y}`}
          x1={fmt(boardX)}
          y1={fmt(y)}
          x2={fmt(boardX + boardW)}
          y2={fmt(y)}
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </g>
  )
}

/**
 * Wraps {@link ShapeNode} with a JS-driven animation transform / opacity layer
 * keyed off `sceneT` (the timeline scrubber position in ms). When `sceneT` is
 * null the wrapper is skipped entirely — i.e. when no scrub is active the DOM
 * matches what the static editor produced before the animation system existed.
 *
 * Onion-skin renders an extra ghosted copy at the shape's from-state, sitting
 * underneath the live shape, so the user can author the from-state without
 * scrubbing. Pointer events are killed on the ghost so it doesn't intercept
 * selection clicks.
 */
function AnimatedShape({
  shape,
  bezier,
  sceneT,
  onionSkin,
}: {
  shape: Shape
  bezier: number
  sceneT: number | null
  onionSkin: boolean
}) {
  const offsets = sceneT === null ? IDENTITY_OFFSETS : sampleAnimation(shape, sceneT)
  const transform = offsetsToTransform(shape, offsets)
  const opacity = offsets.opacityMul < 1 ? offsets.opacityMul : undefined
  const ghostOffsets =
    onionSkin && shape.animation ? lerpOffsets(shape.animation.from, 0, shape.fill, shape.stroke) : null
  const ghostTransform = ghostOffsets ? offsetsToTransform(shape, ghostOffsets) : ''
  const renderMirror = (fillOverride?: string | null, strokeOverride?: string | null) =>
    shape.mirror ? (
      <MirrorNode shape={shape} bezier={bezier} fillOverride={fillOverride} strokeOverride={strokeOverride} />
    ) : null
  const renderRadial = (fillOverride?: string | null, strokeOverride?: string | null) =>
    shape.radial ? (
      <RadialClones shape={shape} bezier={bezier} fillOverride={fillOverride} strokeOverride={strokeOverride} />
    ) : null

  // Identity offsets + no ghost → render the bare ShapeNode so untouched
  // shapes have the exact same DOM shape as the pre-animation editor. This
  // matters for selection hit testing tests that inspect `<g data-shape-id>`.
  if (transform === '' && opacity === undefined && !ghostOffsets && offsets.fill === null && offsets.stroke === null) {
    if (!shape.mirror && !shape.radial) return <ShapeNode shape={shape} bezier={bezier} />
    return (
      <>
        <ShapeNode shape={shape} bezier={bezier} />
        {renderMirror()}
        {renderRadial()}
      </>
    )
  }

  return (
    <>
      {ghostOffsets && (
        <g transform={ghostTransform || undefined} opacity={(ghostOffsets.opacityMul ?? 1) * 0.25} pointerEvents="none">
          <ShapeNode
            shape={shape}
            bezier={bezier}
            fillOverride={ghostOffsets.fill}
            strokeOverride={ghostOffsets.stroke}
          />
          {renderMirror(ghostOffsets.fill, ghostOffsets.stroke)}
          {renderRadial(ghostOffsets.fill, ghostOffsets.stroke)}
        </g>
      )}
      <g transform={transform || undefined} opacity={opacity}>
        <ShapeNode shape={shape} bezier={bezier} fillOverride={offsets.fill} strokeOverride={offsets.stroke} />
        {renderMirror(offsets.fill, offsets.stroke)}
        {renderRadial(offsets.fill, offsets.stroke)}
      </g>
    </>
  )
}

/**
 * Render the shape stack with contiguous group runs wrapped in a single
 * `<g class="vh-group-${id}">`. The wrapper carries the group's rotation /
 * scale (around the combined bbox center) and, when an entrance animation
 * is set, the matching `vh-anim-group-${id}` class so a single keyframe
 * rule drives every member at once.
 *
 * Iteration is one pass through `shapes` (z-order). Each time the running
 * `groupId` changes we close the open group's children list and start a
 * new one. Hidden shapes are filtered inside the run because filtering
 * upstream would split groups apart.
 */
function ShapeStack({
  shapes,
  groups,
  settings,
  sceneT,
  onionActive,
}: {
  shapes: Shape[]
  groups: Group[]
  settings: ProjectSettings
  sceneT: number | null
  onionActive: boolean
}) {
  const groupById = useMemo(() => {
    const map = new Map<string, Group>()
    for (const g of groups) map.set(g.id, g)
    return map
  }, [groups])
  const runs = useMemo(() => buildShapeRuns(shapes, groupById), [shapes, groupById])
  return (
    <>
      {runs.map(run => {
        // Each run is keyed by its first shape's id — stable across edits and
        // unique even if the same group reappears later in the array (which
        // shouldn't happen given contiguity, but the key stays well-formed
        // for non-grouped runs that share no group identity).
        const runKey = run.shapes[0]?.id ?? 'empty'
        const renderedChildren = run.shapes
          .filter(sh => !sh.hidden)
          .map(sh => (
            <AnimatedShape
              key={sh.id}
              shape={sh}
              bezier={effectiveBezier(sh, settings)}
              sceneT={sceneT}
              onionSkin={onionActive}
            />
          ))
        if (run.group === null) {
          return <Fragment key={`run-${runKey}`}>{renderedChildren}</Fragment>
        }
        return (
          <GroupNode
            key={`group-${run.group.id}-${runKey}`}
            group={run.group}
            members={run.shapes}
            animationActive={settings.animationEnabled}
            sceneT={sceneT}
            onionActive={onionActive}
          >
            {renderedChildren}
          </GroupNode>
        )
      })}
    </>
  )
}

interface ShapeRun {
  group: Group | null
  shapes: Shape[]
}

const buildShapeRuns = (shapes: Shape[], groupById: Map<string, Group>): ShapeRun[] => {
  const out: ShapeRun[] = []
  let current: ShapeRun | null = null
  for (const sh of shapes) {
    const groupId = sh.groupId
    const group = groupId ? (groupById.get(groupId) ?? null) : null
    if (current && current.group?.id === group?.id) {
      current.shapes.push(sh)
      continue
    }
    current = { group, shapes: [sh] }
    out.push(current)
  }
  return out
}

/**
 * Wrapping `<g>` for a contiguous run of group members. Carries the group's
 * static transform (around the live combined bbox center, so the pivot
 * tracks members as they edit) and — when the project's animation switch
 * is on and the group has an animation — the timeline preview transform /
 * opacity sampled from the same scene scrubber that drives shape-level
 * animations. Hidden members are excluded from the bbox so a hidden child
 * doesn't drag the pivot off-screen.
 */
function GroupNode({
  group,
  members,
  animationActive,
  sceneT,
  onionActive,
  children,
}: {
  group: Group
  members: Shape[]
  animationActive: boolean
  sceneT: number | null
  onionActive: boolean
  children: ReactNode
}) {
  const visibleMembers = members.filter(sh => !sh.hidden)
  const pivotMembers = visibleMembers.length > 0 ? visibleMembers : members
  const [cx, cy] = groupBBoxCenter(pivotMembers)
  const rot = group.rotation ?? 0
  const scl = group.scale ?? 1
  const staticTransform = transformAroundString(rot, scl, cx, cy)
  const animActive = animationActive && !!group.animation
  const animOffsets =
    animActive && sceneT !== null && group.animation ? sampleAnimationSpec(group.animation, sceneT) : null
  const animTransform = animOffsets ? groupOffsetsToTransform(animOffsets, cx, cy) : ''
  const opacity = animOffsets && animOffsets.opacityMul < 1 ? animOffsets.opacityMul : undefined
  const ghostOffsets = onionActive && animActive && group.animation ? lerpOffsets(group.animation.from, 0) : null
  const ghostTransform = ghostOffsets ? groupOffsetsToTransform(ghostOffsets, cx, cy) : ''
  const className = `vh-group-${group.id}${animActive ? ` vh-anim-group-${group.id}` : ''}`
  // The static transform always wraps; the animation transform layers on top
  // (so a slider-driven group rotation composes with a timeline-driven
  // entrance offset). When neither is set, the wrapper still emits its
  // group class so external SVG viewers receive the same DOM shape.
  return (
    <>
      {ghostOffsets && (
        <g
          className={`vh-group-${group.id}`}
          transform={staticTransform || undefined}
          pointerEvents="none"
          opacity={(ghostOffsets.opacityMul ?? 1) * 0.25}
        >
          <g transform={ghostTransform || undefined}>{children}</g>
        </g>
      )}
      <g className={className} transform={staticTransform || undefined} opacity={opacity}>
        {animTransform ? <g transform={animTransform}>{children}</g> : children}
      </g>
    </>
  )
}

/**
 * Live mirror copy. The reflected geometry comes from `reflectShape`, which
 * inherits the source's `rotation` / `scale`; we strip both before rendering
 * and apply them ourselves around the combined pair pivot via an outer `<g>`,
 * so the source and reflection rotate as one rigid group rather than each
 * pivoting at their own bbox center. The inner `ShapeNode` re-uses the
 * source's id for hit testing — clicking the mirror selects the source.
 */
function MirrorNode({
  shape,
  bezier,
  fillOverride,
  strokeOverride,
}: {
  shape: Shape
  bezier: number
  fillOverride?: string | null
  strokeOverride?: string | null
}) {
  if (!shape.mirror) return null
  const reflected: Shape = { ...reflectShape(shape, shape.mirror.axis), rotation: undefined, scale: undefined }
  const r = shapeRotation(shape)
  const sc = shapeScale(shape)
  const [cx, cy] = pairBBoxCenter(shape)
  const wrapperTransform =
    r === 0 && sc === 1
      ? undefined
      : `translate(${fmt(cx)} ${fmt(cy)}) rotate(${fmt(r)}) scale(${fmt(sc)}) translate(${fmt(-cx)} ${fmt(-cy)})`
  return (
    <g transform={wrapperTransform}>
      <ShapeNode shape={reflected} bezier={bezier} fillOverride={fillOverride} strokeOverride={strokeOverride} />
    </g>
  )
}

/**
 * Live radial repeat copies. Each clone is the source `ShapeNode` wrapped in a
 * `<g transform="rotate(angle, cx, cy)">` so the clone (including its own
 * rotation/scale around the source's bbox center) ends up rotated as a rigid
 * body around the radial center. Hit testing falls through to the source via
 * the inner `data-shape-id`, matching the mirror's "click clone selects source"
 * convention.
 */
function RadialClones({
  shape,
  bezier,
  fillOverride,
  strokeOverride,
}: {
  shape: Shape
  bezier: number
  fillOverride?: string | null
  strokeOverride?: string | null
}) {
  if (!shape.radial) return null
  const angles = radialCloneAngles(shape.radial)
  if (angles.length === 0) return null
  const { cx, cy } = shape.radial
  return (
    <>
      {angles.map(a => (
        <g key={a} transform={`rotate(${fmt(a)} ${fmt(cx)} ${fmt(cy)})`}>
          <ShapeNode shape={shape} bezier={bezier} fillOverride={fillOverride} strokeOverride={strokeOverride} />
        </g>
      ))}
    </>
  )
}

function ShapeNode({
  shape,
  bezier,
  fillOverride,
  strokeOverride,
}: {
  shape: Shape
  bezier: number
  fillOverride?: string | null
  strokeOverride?: string | null
}) {
  // Live-animation overrides take precedence over the authored fill/stroke. We
  // only swap the *visible* paint — the hit-area paths keep their black fill so
  // pointer detection survives a colorless from-state (e.g. fill = same as bg).
  const visibleFill = fillOverride ?? shape.fill
  const visibleStroke = strokeOverride ?? shape.stroke
  const linejoin = shape.strokeLinejoin ?? 'round'
  const linecap = shape.strokeLinecap ?? 'round'
  const dasharray = shape.strokeDasharray && shape.strokeDasharray.trim() !== '' ? shape.strokeDasharray : undefined
  const paintOrder = shape.paintOrder === 'stroke' ? 'stroke' : undefined
  const blendStyle: CSSProperties | undefined =
    shape.blendMode && shape.blendMode !== 'normal' ? { mixBlendMode: shape.blendMode } : undefined
  const opacity = shape.opacity !== undefined && shape.opacity < 1 ? shape.opacity : undefined
  // The wrapping `<g>` carries the composed transform so rotation/scale (and,
  // for glyphs, the local-to-canvas translate) all live in one DOM node.
  const transformAttr = composeTransformString(shape) || undefined
  if (shape.kind === 'glyphs' && shape.glyphs && shape.points.length >= 2) {
    const { d, width, height } = shape.glyphs
    return (
      <g data-shape-id={shape.id} transform={transformAttr}>
        <path
          d={d}
          fill={visibleFill}
          stroke={visibleStroke === 'none' ? undefined : visibleStroke}
          strokeWidth={visibleStroke === 'none' ? undefined : shape.strokeWidth}
          strokeLinejoin={visibleStroke === 'none' ? undefined : linejoin}
          strokeLinecap={visibleStroke === 'none' ? undefined : linecap}
          strokeDasharray={visibleStroke === 'none' ? undefined : dasharray}
          paintOrder={visibleStroke === 'none' ? undefined : paintOrder}
          pointerEvents="none"
          style={blendStyle}
          opacity={opacity}
        />
        {/* Hit area = the whole bbox, since glyph paths have holes / gaps the
            user wouldn't expect to fall through. */}
        <rect
          x={0}
          y={0}
          width={fmt(width)}
          height={fmt(height)}
          className="shape-hit"
          data-shape-id={shape.id}
          fill="#000"
          pointerEvents={shape.locked ? 'none' : 'all'}
          opacity={0}
        />
      </g>
    )
  }
  if (shape.kind === 'circle' && shape.points.length >= 2) {
    const [cx, cy] = shape.points[0]
    const r = dist(shape.points[0], shape.points[1])
    if (isPartialArc(shape.arc)) {
      const d = arcToPath(cx, cy, r, shape.arc)
      const filled = shape.arc.style !== 'open'
      return (
        <g data-shape-id={shape.id} transform={transformAttr}>
          <path
            d={d}
            fill={filled ? visibleFill : 'none'}
            stroke={visibleStroke}
            strokeWidth={shape.strokeWidth}
            strokeLinejoin={linejoin}
            strokeLinecap={linecap}
            strokeDasharray={dasharray}
            paintOrder={paintOrder}
            pointerEvents="none"
            style={blendStyle}
            opacity={opacity}
          />
          <path
            d={d}
            className="shape-hit"
            data-shape-id={shape.id}
            fill={filled ? '#000' : 'none'}
            stroke="#000"
            strokeWidth={Math.max(10, shape.strokeWidth + 8)}
            strokeLinejoin="round"
            strokeLinecap="round"
            pointerEvents={shape.locked ? 'none' : filled ? 'all' : 'stroke'}
            opacity={0}
          />
        </g>
      )
    }
    return (
      <g data-shape-id={shape.id} transform={transformAttr}>
        <circle
          cx={fmt(cx)}
          cy={fmt(cy)}
          r={fmt(r)}
          fill={visibleFill}
          stroke={visibleStroke}
          strokeWidth={shape.strokeWidth}
          strokeDasharray={dasharray}
          paintOrder={paintOrder}
          pointerEvents="none"
          style={blendStyle}
          opacity={opacity}
        />
        <circle
          cx={fmt(cx)}
          cy={fmt(cy)}
          r={fmt(r)}
          className="shape-hit"
          data-shape-id={shape.id}
          fill="#000"
          stroke="#000"
          strokeWidth={Math.max(10, shape.strokeWidth + 8)}
          pointerEvents={shape.locked ? 'none' : 'all'}
          opacity={0}
        />
      </g>
    )
  }
  const d = pointsToPath(shape.points, shape.closed, bezier, shape.pointBezierOverrides)
  return (
    <g data-shape-id={shape.id} transform={transformAttr}>
      <path
        d={d}
        fill={shape.closed ? visibleFill : 'none'}
        stroke={visibleStroke}
        strokeWidth={shape.strokeWidth}
        strokeLinejoin={linejoin}
        strokeLinecap={linecap}
        strokeDasharray={dasharray}
        paintOrder={paintOrder}
        pointerEvents="none"
        style={blendStyle}
        opacity={opacity}
      />
      {/*
        Hit target: invisible (opacity:0) but `pointer-events="all"` so it
        catches both fill (closed shapes) and stroke (open lines) regardless of
        their actual paint values, with a generous stroke width for easy clicking.
      */}
      <path
        d={d}
        className="shape-hit"
        data-shape-id={shape.id}
        fill={shape.closed ? '#000' : 'none'}
        stroke="#000"
        strokeWidth={Math.max(10, shape.strokeWidth + 8)}
        strokeLinejoin="round"
        strokeLinecap="round"
        pointerEvents={shape.locked ? 'none' : shape.closed ? 'all' : 'stroke'}
        opacity={0}
      />
    </g>
  )
}

function SelectionLayer({
  shape,
  selectedIndices,
  showVertices,
  scale,
}: {
  shape: Shape
  selectedIndices: number[]
  showVertices: boolean
  scale: number
}) {
  const selectedSet = useMemo(() => new Set(selectedIndices), [selectedIndices])
  // Same composed transform as ShapeNode so the dashed outline + vertex handles
  // sit on top of the rendered shape regardless of rotation/scale.
  const transformAttr = composeTransformString(shape) || undefined
  const mirrorOutline = shape.mirror ? mirrorSelectionOutline(shape) : null
  const axisLayer = shape.mirror?.showAxis ? (
    <MirrorAxisLayer shape={shape} scale={scale} disabled={hasTransform(shape)} />
  ) : null
  const radialOutlines = shape.radial ? radialSelectionOutlines(shape, transformAttr) : null
  const radialCenter = shape.radial?.showCenter ? <RadialCenterMarker spec={shape.radial} scale={scale} /> : null
  // Vertex handles are pre-transform anchors. Once a transform is applied they
  // would render at the *transformed* positions but a drag would set the
  // underlying point in canvas coords without inverting — making the visual
  // jump. Cleanest UX: hide them, force the user to bake the transform first.
  const transformed = hasTransform(shape)
  // Glyphs render the dashed bbox as their outline — and never expose vertex
  // handles, since the block always moves as a single unit.
  if (shape.kind === 'glyphs' && shape.glyphs && shape.points.length >= 2) {
    const { width, height } = shape.glyphs
    return (
      <>
        <g transform={transformAttr}>
          <rect x={0} y={0} width={fmt(width)} height={fmt(height)} className="selection-outline" fill="none" />
          {mirrorOutline}
          {axisLayer}
        </g>
        {radialOutlines}
        {radialCenter}
      </>
    )
  }
  let outline
  if (shape.kind === 'circle' && shape.points.length >= 2) {
    const [cx, cy] = shape.points[0]
    const r = dist(shape.points[0], shape.points[1])
    if (isPartialArc(shape.arc)) {
      outline = <path d={arcToPath(cx, cy, r, shape.arc)} className="selection-outline" fill="none" />
    } else {
      outline = <circle cx={fmt(cx)} cy={fmt(cy)} r={fmt(r)} className="selection-outline" fill="none" />
    }
  } else {
    outline = <path d={pointsToPath(shape.points, shape.closed, 0)} className="selection-outline" />
  }
  return (
    <>
      <g transform={transformAttr}>
        {outline}
        {mirrorOutline}
        {axisLayer}
        {showVertices &&
          !transformed &&
          shape.points.map((p, i) => (
            <circle
              key={i}
              cx={fmt(p[0])}
              cy={fmt(p[1])}
              r={5 / scale}
              className={`vertex-handle${selectedSet.has(i) ? ' selected' : ''}`}
              data-shape-id={shape.id}
              data-vertex-index={i}
              pointerEvents={shape.locked ? 'none' : undefined}
            />
          ))}
      </g>
      {radialOutlines}
      {radialCenter}
    </>
  )
}

/**
 * Dashed outline of the live mirror copy. Geometry mirrors `SelectionLayer`'s
 * source-outline branches (path / circle / partial-arc) but using the
 * reflected shape's points so the user sees both halves selected.
 */
/**
 * SelectionLayer wrapper that re-applies the shape's group transform when its
 * group has a non-identity rotation/scale. Without this the dashed outline
 * would render at the un-rotated point positions while the actual shape sits
 * at the rotated position, drifting visibly apart. The pivot matches
 * `GroupNode` so the outline stays glued to the rendered shape regardless of
 * which group transform is active.
 */
function SelectionForShape({
  shape,
  shapes,
  groupById,
  selectedVertices,
  singleSelected,
  scale,
}: {
  shape: Shape
  shapes: Shape[]
  groupById: Map<string, Group>
  selectedVertices: { shapeId: string; index: number }[]
  singleSelected: boolean
  scale: number
}) {
  const group = shape.groupId ? groupById.get(shape.groupId) : undefined
  const groupHasTransform = !!group && ((group.rotation ?? 0) !== 0 || (group.scale ?? 1) !== 1)
  let groupTransform = ''
  if (groupHasTransform && group) {
    const visible = shapes.filter(sh => sh.groupId === shape.groupId && !sh.hidden)
    const fallback = shapes.filter(sh => sh.groupId === shape.groupId)
    const pivotMembers = visible.length > 0 ? visible : fallback
    const [cx, cy] = groupBBoxCenter(pivotMembers)
    groupTransform = transformAroundString(group.rotation ?? 0, group.scale ?? 1, cx, cy)
  }
  const inner = (
    <SelectionLayer
      shape={shape}
      selectedIndices={singleSelected ? selectedVertices.filter(v => v.shapeId === shape.id).map(v => v.index) : []}
      showVertices={singleSelected}
      scale={scale}
    />
  )
  if (!groupTransform) return inner
  return <g transform={groupTransform}>{inner}</g>
}

const mirrorSelectionOutline = (shape: Shape) => {
  if (!shape.mirror) return null
  const r = reflectShape(shape, shape.mirror.axis)
  if (r.kind === 'circle' && r.points.length >= 2) {
    const [cx, cy] = r.points[0]
    const radius = dist(r.points[0], r.points[1])
    if (isPartialArc(r.arc)) {
      return <path d={arcToPath(cx, cy, radius, r.arc)} className="selection-outline" fill="none" />
    }
    return <circle cx={fmt(cx)} cy={fmt(cy)} r={fmt(radius)} className="selection-outline" fill="none" />
  }
  return <path d={pointsToPath(r.points, r.closed, 0)} className="selection-outline" />
}

/**
 * Dashed outline at every radial clone position. Each clone wraps the source's
 * own composed transform (so the source's rotation/scale around its own bbox
 * is preserved) inside a `rotate(angle, cx, cy)` so the whole pose pivots
 * around the radial center. Returns null when the spec has no clones.
 */
const radialSelectionOutlines = (shape: Shape, sourceTransform: string | undefined) => {
  if (!shape.radial) return null
  const angles = radialCloneAngles(shape.radial)
  if (angles.length === 0) return null
  const { cx, cy } = shape.radial
  let outline: ReactNode
  if (shape.kind === 'glyphs' && shape.glyphs && shape.points.length >= 2) {
    const { width, height } = shape.glyphs
    outline = <rect x={0} y={0} width={fmt(width)} height={fmt(height)} className="selection-outline" fill="none" />
  } else if (shape.kind === 'circle' && shape.points.length >= 2) {
    const [scx, scy] = shape.points[0]
    const r = dist(shape.points[0], shape.points[1])
    outline = isPartialArc(shape.arc) ? (
      <path d={arcToPath(scx, scy, r, shape.arc)} className="selection-outline" fill="none" />
    ) : (
      <circle cx={fmt(scx)} cy={fmt(scy)} r={fmt(r)} className="selection-outline" fill="none" />
    )
  } else {
    outline = <path d={pointsToPath(shape.points, shape.closed, 0)} className="selection-outline" />
  }
  return (
    <>
      {angles.map(a => (
        <g key={a} transform={`rotate(${fmt(a)} ${fmt(cx)} ${fmt(cy)})`}>
          <g transform={sourceTransform}>{outline}</g>
        </g>
      ))}
    </>
  )
}

/**
 * Orange dot marking the radial center on canvas. Drawn at the spec's `(cx, cy)`
 * with a non-scaling stroke so it stays the same screen size at any zoom. Not
 * interactive — the user edits the center via the side panel inputs.
 */
function RadialCenterMarker({ spec, scale }: { spec: { cx: number; cy: number }; scale: number }) {
  const r = 5 / scale
  return (
    <circle
      cx={fmt(spec.cx)}
      cy={fmt(spec.cy)}
      r={r}
      fill="#ff8a00"
      stroke="#3a1f00"
      strokeWidth={1}
      vectorEffect="non-scaling-stroke"
      pointerEvents="none"
    />
  )
}

const MIRROR_AXIS_HANDLE_PX = 60

/**
 * Bright-green axis line + drag handles for the live mirror. Drawn inside the
 * source's transform wrapper, so when the source has a baked rotation/scale
 * the axis tilts with the group; while the source has *unbaked* transforms
 * (rotation / scale fields), the handles are disabled (matches the vertex
 * handle convention — bake first to edit).
 */
function MirrorAxisLayer({ shape, scale, disabled }: { shape: Shape; scale: number; disabled: boolean }) {
  if (!shape.mirror) return null
  const { x, y, angle } = shape.mirror.axis
  const rad = (angle * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const handleDist = MIRROR_AXIS_HANDLE_PX / scale
  // Stretch the axis line well past the shape so it visibly reaches both sides
  // of the artboard. 4× the handle distance is enough at any reasonable zoom.
  const lineHalf = handleDist * 4
  const x1 = x - cos * lineHalf
  const y1 = y - sin * lineHalf
  const x2 = x + cos * lineHalf
  const y2 = y + sin * lineHalf
  const hx = x + cos * handleDist
  const hy = y + sin * handleDist
  const handleR = 5 / scale
  return (
    <g pointerEvents={disabled ? 'none' : undefined}>
      <line
        x1={fmt(x1)}
        y1={fmt(y1)}
        x2={fmt(x2)}
        y2={fmt(y2)}
        stroke="#00ff00"
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
        pointerEvents="none"
      />
      <circle
        cx={fmt(x)}
        cy={fmt(y)}
        r={handleR}
        fill="#00ff00"
        stroke="#003300"
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
        data-mirror-handle="pos"
        data-shape-id={shape.id}
        style={{ cursor: disabled ? 'default' : 'move' }}
      />
      <circle
        cx={fmt(hx)}
        cy={fmt(hy)}
        r={handleR}
        fill="#00ff00"
        stroke="#003300"
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
        data-mirror-handle="rot"
        data-shape-id={shape.id}
        style={{ cursor: disabled ? 'default' : 'crosshair' }}
      />
    </g>
  )
}

function MarqueeRect({ box }: { box: BoxSelect }) {
  const x = Math.min(box.start[0], box.end[0])
  const y = Math.min(box.start[1], box.end[1])
  const w = Math.abs(box.end[0] - box.start[0])
  const h = Math.abs(box.end[1] - box.start[1])
  return (
    <rect
      className="marquee"
      x={fmt(x)}
      y={fmt(y)}
      width={fmt(w)}
      height={fmt(h)}
      pointerEvents="none"
      vectorEffect="non-scaling-stroke"
    />
  )
}

function VertexDragGuides({ shape, index, settings }: { shape: Shape; index: number; settings: ProjectSettings }) {
  if (settings.snapAngles.length === 0) return null
  const n = shape.points.length
  const anchors: Point[] = []
  if (index > 0) anchors.push(shape.points[index - 1])
  else if (shape.closed && n > 1) anchors.push(shape.points[n - 1])
  if (index < n - 1) anchors.push(shape.points[index + 1])
  else if (shape.closed && n > 1) anchors.push(shape.points[0])
  const rayLen = (settings.viewBoxWidth + settings.viewBoxHeight) * 2
  return (
    <g>
      {anchors.map((a, ai) =>
        settings.snapAngles.map(deg => {
          const rad = (deg * Math.PI) / 180
          return (
            <line
              key={`${ai}-${deg}`}
              x1={fmt(a[0])}
              y1={fmt(a[1])}
              x2={fmt(a[0] + Math.cos(rad) * rayLen)}
              y2={fmt(a[1] + Math.sin(rad) * rayLen)}
              className="snap-guide"
              vectorEffect="non-scaling-stroke"
            />
          )
        }),
      )}
    </g>
  )
}

function PreviewLayer({
  drawing,
  cursor,
  snapDisabled,
  snapAngles,
  boardW,
  boardH,
  bezier,
  scale,
}: {
  drawing: Drawing
  cursor: Point
  snapDisabled: boolean
  snapAngles: number[]
  boardW: number
  boardH: number
  bezier: number
  scale: number
}) {
  if (drawing.points.length === 0) return null
  const last = drawing.points[drawing.points.length - 1]
  const first = drawing.points[0]
  // For polygons with ≥ 2 points, also project rays from the first vertex so
  // the user can align the closing edge with the start of the polygon before
  // clicking it to close. Circles only ever have one placed point (center) so
  // the ray fan from `last` is exactly the fan from the center — useful for
  // axis-aligning the radius before the second click.
  const guideAnchors: Point[] = [last]
  if (drawing.type === 'polygon' && drawing.points.length >= 2) {
    guideAnchors.push(first)
  }
  const previewPts: Point[] = [...drawing.points, [cursor[0], cursor[1]]]
  const rayLen = (boardW + boardH) * 2
  const isCircle = drawing.type === 'circle'
  const circleR = isCircle ? Math.hypot(cursor[0] - first[0], cursor[1] - first[1]) : 0

  return (
    <g>
      {!snapDisabled &&
        guideAnchors.flatMap((anchor, ai) =>
          snapAngles.map(a => {
            const rad = (a * Math.PI) / 180
            return (
              <line
                key={`${ai}-${a}`}
                x1={fmt(anchor[0])}
                y1={fmt(anchor[1])}
                x2={fmt(anchor[0] + Math.cos(rad) * rayLen)}
                y2={fmt(anchor[1] + Math.sin(rad) * rayLen)}
                className="snap-guide"
                vectorEffect="non-scaling-stroke"
              />
            )
          }),
        )}

      {drawing.type === 'polygon' && previewPts.length >= 3 && (
        <path d={pointsToPath(previewPts, true, bezier)} fill="rgba(255,59,48,0.08)" stroke="none" />
      )}

      {isCircle ? (
        <>
          <circle
            cx={fmt(first[0])}
            cy={fmt(first[1])}
            r={fmt(circleR)}
            className="preview-shape"
            fill="rgba(255,59,48,0.08)"
            vectorEffect="non-scaling-stroke"
          />
          <line
            x1={fmt(first[0])}
            y1={fmt(first[1])}
            x2={fmt(cursor[0])}
            y2={fmt(cursor[1])}
            className="preview-shape"
            vectorEffect="non-scaling-stroke"
          />
        </>
      ) : (
        <path d={pointsToPath(previewPts, false, bezier)} className="preview-shape" vectorEffect="non-scaling-stroke" />
      )}

      {drawing.points.map((p, i) => (
        <circle key={i} cx={fmt(p[0])} cy={fmt(p[1])} r={3 / scale} className="preview-vertex" />
      ))}
    </g>
  )
}
