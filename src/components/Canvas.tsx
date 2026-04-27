import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { useStore } from '../store';
import { effectiveBezier } from '../store';
import { arcToPath, dist, fmt, isPartialArc, pointsToPath } from '../lib/geometry';
import { useCanvasInteractions } from '../hooks/useCanvasInteractions';
import type { BoxSelect } from '../store';
import type { Drawing, Point, ProjectSettings, Shape } from '../types';

interface ContainerSize {
  w: number;
  h: number;
}

export function Canvas() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  // Start at 0×0 so the fit effect's `size.w <= 1` gate skips the very first
  // pass — otherwise it'd lock the initial fit to a hardcoded fallback (and
  // the nonce gate prevents re-running once the real measurement arrives).
  const [size, setSize] = useState<ContainerSize>({ w: 0, h: 0 });

  // Track container size to drive the SVG viewBox.
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth || 1, h: el.clientHeight || 1 });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Refit when explicitly requested (initial mount, file load, F shortcut, …).
  // Resizing the window alone must NOT reset the user's view.
  const settings = useStore((s) => s.settings);
  const setView = useStore((s) => s.setView);
  const fitNonce = useStore((s) => s.fitNonce);
  const lastFitNonce = useRef(-1);
  useEffect(() => {
    if (size.w <= 1 || size.h <= 1) return;
    if (lastFitNonce.current === fitNonce) return;
    lastFitNonce.current = fitNonce;
    const pad = 40;
    // Fit centers the artboard (= viewBox) in the viewport. The viewBox origin
    // may be non-zero, so subtract `vbX*scale` from the centering offset to
    // place the artboard's top-left where it belongs in world space.
    const vbW = settings.viewBoxWidth;
    const vbH = settings.viewBoxHeight;
    const scale = Math.min((size.w - pad * 2) / vbW, (size.h - pad * 2) / vbH);
    const s = scale > 0 ? scale : 1;
    setView({
      scale: s,
      x: (size.w - vbW * s) / 2 - settings.viewBoxX * s,
      y: (size.h - vbH * s) / 2 - settings.viewBoxY * s,
    });
  }, [
    fitNonce,
    size.w,
    size.h,
    settings.viewBoxX,
    settings.viewBoxY,
    settings.viewBoxWidth,
    settings.viewBoxHeight,
    setView,
  ]);

  useCanvasInteractions(svgRef);

  const tool = useStore((s) => s.tool);
  const view = useStore((s) => s.view);
  const cursor = useStore((s) => s.cursor);
  const shapes = useStore((s) => s.shapes);
  const drawing = useStore((s) => s.drawing);
  const selectedShapeIds = useStore((s) => s.selectedShapeIds);
  const selectedVertices = useStore((s) => s.selectedVertices);
  const snapDisabled = useStore((s) => s.snapDisabled);
  const spaceHeld = useStore((s) => s.spaceHeld);
  const panning = useStore((s) => s.panning);
  const vertexDragging = useStore((s) => s.vertexDragging);
  const snapTarget = useStore((s) => s.snapTarget);
  const boxSelect = useStore((s) => s.boxSelect);

  const selectedSet = useMemo(() => new Set(selectedShapeIds), [selectedShapeIds]);
  const selectedShapes = shapes.filter((s) => selectedSet.has(s.id));
  const singleSelected = selectedShapes.length === 1 ? selectedShapes[0] : null;
  const transform = `translate(${fmt(view.x)} ${fmt(view.y)}) scale(${fmt(view.scale)})`;

  const cls = [
    'canvas-svg block w-full h-full select-none relative z-[1]',
    tool === 'select' ? 'tool-select' : '',
    panning ? 'panning' : spaceHeld ? 'space' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div ref={wrapRef} className="canvas-surface relative bg-bg-0 overflow-hidden">
      <svg
        ref={svgRef}
        className={cls}
        viewBox={`0 0 ${size.w} ${size.h}`}
        xmlns="http://www.w3.org/2000/svg"
      >
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
            {shapes.map((shape) =>
              shape.hidden ? null : (
                <ShapeNode key={shape.id} shape={shape} bezier={effectiveBezier(shape, settings)} />
              ),
            )}
          </g>

          {selectedShapes.map((shape) => (
            <SelectionLayer
              key={shape.id}
              shape={shape}
              // Vertex handles are only meaningful when a single shape is
              // selected — multi-select shows outlines only.
              selectedIndices={
                singleSelected
                  ? selectedVertices.filter((v) => v.shapeId === shape.id).map((v) => v.index)
                  : []
              }
              showVertices={!!singleSelected}
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
              <VertexDragGuides
                shape={singleSelected}
                index={selectedVertices[0].index}
                settings={settings}
              />
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
      <div className="hud-dots absolute bottom-3 right-3 flex gap-3.5 bg-[rgba(18,20,26,0.92)] border border-line px-3 py-[5px] text-[10px] text-muted pointer-events-none tracking-[1.5px] uppercase tabular-nums z-[2] backdrop-blur-[6px]">
        <span>
          {Math.round(cursor[0])}, {Math.round(cursor[1])}
        </span>
        <span>{Math.round(view.scale * 100)}%</span>
        <span>{tool}</span>
      </div>
    </div>
  );
}

// Checker tile thresholds in **screen pixels**, so tiles stay roughly constant
// across zoom levels. The actual tile size is converted to canvas units (the
// pattern coordinate space) on the fly via `/ scale`.
const CHECKER_TARGET_PX = 40;
const CHECKER_MIN_PX = 24;
const CHECKER_MAX_PX = 64;

// Returns the tile size in canvas units. As long as the project has a grid
// spacing (regardless of whether the grid is rendered), snaps the tile to
// `gridSize · 2^k` so every grid line coincides with a tile boundary (or —
// when zoomed in past the grid — every tile boundary lies on a 1/2^|k|
// subdivision of the grid). The exponent is the one whose on-screen tile
// size lands closest to the screen target while still inside [MIN, MAX].
// This gives the checker a "subdivides as you zoom in" feel that stays
// grid-aligned at any zoom level.
const computeCheckerSize = (gridSize: number, scale: number): number => {
  const safeScale = scale > 0 ? scale : 1;
  const targetCanvas = CHECKER_TARGET_PX / safeScale;
  if (!(gridSize > 0)) return targetCanvas;
  const minCanvas = CHECKER_MIN_PX / safeScale;
  const maxCanvas = CHECKER_MAX_PX / safeScale;
  // Pick the exponent k closest to the screen target.
  let exp = Math.round(Math.log2(targetCanvas / gridSize));
  let tile = gridSize * 2 ** exp;
  // The MAX/MIN ratio (≥ 2) guarantees at least one power-of-2 step fits in
  // the band, so these loops settle quickly without oscillating.
  while (tile > maxCanvas) {
    exp -= 1;
    tile = gridSize * 2 ** exp;
  }
  while (tile < minCanvas) {
    exp += 1;
    tile = gridSize * 2 ** exp;
  }
  // Adjusting up could overshoot MAX in pathological setups (very narrow
  // band) — give up on grid snapping rather than emit something too large.
  if (tile > maxCanvas) return targetCanvas;
  return tile;
};

function CheckerPattern({ id, gridSize, scale }: { id: string; gridSize: number; scale: number }) {
  const s = computeCheckerSize(gridSize, scale);
  const t = s * 2;
  return (
    <pattern id={id} x={0} y={0} width={t} height={t} patternUnits="userSpaceOnUse">
      <rect x={0} y={0} width={t} height={t} fill="#bcbcbc" />
      <rect x={0} y={0} width={s} height={s} fill="#aeaeae" />
      <rect x={s} y={s} width={s} height={s} fill="#aeaeae" />
    </pattern>
  );
}

function GridLayer({
  size,
  boardX,
  boardY,
  boardW,
  boardH,
  scale,
}: {
  size: number;
  boardX: number;
  boardY: number;
  boardW: number;
  boardH: number;
  scale: number;
}) {
  // Skip rendering if the grid would be visually noisy (sub-pixel) or huge.
  const screenSpacing = size * scale;
  const lines = useMemo(() => {
    const xs: number[] = [];
    const ys: number[] = [];
    // Lines start one cell in from the artboard origin and run up to (but not
    // including) the right/bottom edge — borders are already drawn.
    for (let x = boardX + size; x < boardX + boardW; x += size) xs.push(x);
    for (let y = boardY + size; y < boardY + boardH; y += size) ys.push(y);
    return { xs, ys };
  }, [size, boardX, boardY, boardW, boardH]);
  if (screenSpacing < 4) return null;
  return (
    <g className="grid-layer" pointerEvents="none">
      {lines.xs.map((x) => (
        <line
          key={`x${x}`}
          x1={fmt(x)}
          y1={fmt(boardY)}
          x2={fmt(x)}
          y2={fmt(boardY + boardH)}
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {lines.ys.map((y) => (
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
  );
}

function ShapeNode({ shape, bezier }: { shape: Shape; bezier: number }) {
  const blendStyle: CSSProperties | undefined =
    shape.blendMode && shape.blendMode !== 'normal' ? { mixBlendMode: shape.blendMode } : undefined;
  const opacity = shape.opacity !== undefined && shape.opacity < 1 ? shape.opacity : undefined;
  if (shape.kind === 'circle' && shape.points.length >= 2) {
    const [cx, cy] = shape.points[0];
    const r = dist(shape.points[0], shape.points[1]);
    if (isPartialArc(shape.arc)) {
      const d = arcToPath(cx, cy, r, shape.arc);
      const filled = shape.arc.style !== 'open';
      return (
        <g data-shape-id={shape.id}>
          <path
            d={d}
            fill={filled ? shape.fill : 'none'}
            stroke={shape.stroke}
            strokeWidth={shape.strokeWidth}
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
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
            vectorEffect="non-scaling-stroke"
          />
        </g>
      );
    }
    return (
      <g data-shape-id={shape.id}>
        <circle
          cx={fmt(cx)}
          cy={fmt(cy)}
          r={fmt(r)}
          fill={shape.fill}
          stroke={shape.stroke}
          strokeWidth={shape.strokeWidth}
          vectorEffect="non-scaling-stroke"
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
          vectorEffect="non-scaling-stroke"
        />
      </g>
    );
  }
  const d = pointsToPath(shape.points, shape.closed, bezier);
  return (
    <g data-shape-id={shape.id}>
      <path
        d={d}
        fill={shape.closed ? shape.fill : 'none'}
        stroke={shape.stroke}
        strokeWidth={shape.strokeWidth}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
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
        vectorEffect="non-scaling-stroke"
      />
    </g>
  );
}

function SelectionLayer({
  shape,
  selectedIndices,
  showVertices,
  scale,
}: {
  shape: Shape;
  selectedIndices: number[];
  showVertices: boolean;
  scale: number;
}) {
  const selectedSet = useMemo(() => new Set(selectedIndices), [selectedIndices]);
  let outline;
  if (shape.kind === 'circle' && shape.points.length >= 2) {
    const [cx, cy] = shape.points[0];
    const r = dist(shape.points[0], shape.points[1]);
    if (isPartialArc(shape.arc)) {
      outline = (
        <path d={arcToPath(cx, cy, r, shape.arc)} className="selection-outline" fill="none" />
      );
    } else {
      outline = (
        <circle cx={fmt(cx)} cy={fmt(cy)} r={fmt(r)} className="selection-outline" fill="none" />
      );
    }
  } else {
    outline = (
      <path d={pointsToPath(shape.points, shape.closed, 0)} className="selection-outline" />
    );
  }
  return (
    <g>
      {outline}
      {showVertices &&
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
  );
}

function MarqueeRect({ box }: { box: BoxSelect }) {
  const x = Math.min(box.start[0], box.end[0]);
  const y = Math.min(box.start[1], box.end[1]);
  const w = Math.abs(box.end[0] - box.start[0]);
  const h = Math.abs(box.end[1] - box.start[1]);
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
  );
}

function VertexDragGuides({
  shape,
  index,
  settings,
}: {
  shape: Shape;
  index: number;
  settings: ProjectSettings;
}) {
  if (settings.snapAngles.length === 0) return null;
  const n = shape.points.length;
  const anchors: Point[] = [];
  if (index > 0) anchors.push(shape.points[index - 1]);
  else if (shape.closed && n > 1) anchors.push(shape.points[n - 1]);
  if (index < n - 1) anchors.push(shape.points[index + 1]);
  else if (shape.closed && n > 1) anchors.push(shape.points[0]);
  const rayLen = (settings.viewBoxWidth + settings.viewBoxHeight) * 2;
  return (
    <g>
      {anchors.map((a, ai) =>
        settings.snapAngles.map((deg) => {
          const rad = (deg * Math.PI) / 180;
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
          );
        }),
      )}
    </g>
  );
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
  drawing: Drawing;
  cursor: Point;
  snapDisabled: boolean;
  snapAngles: number[];
  boardW: number;
  boardH: number;
  bezier: number;
  scale: number;
}) {
  if (drawing.points.length === 0) return null;
  const last = drawing.points[drawing.points.length - 1];
  const first = drawing.points[0];
  // For polygons with ≥ 2 points, also project rays from the first vertex so
  // the user can align the closing edge with the start of the polygon before
  // clicking it to close. Circles only ever have one placed point (center) so
  // the ray fan from `last` is exactly the fan from the center — useful for
  // axis-aligning the radius before the second click.
  const guideAnchors: Point[] = [last];
  if (drawing.type === 'polygon' && drawing.points.length >= 2) {
    guideAnchors.push(first);
  }
  const previewPts: Point[] = [...drawing.points, [cursor[0], cursor[1]]];
  const rayLen = (boardW + boardH) * 2;
  const isCircle = drawing.type === 'circle';
  const circleR = isCircle ? Math.hypot(cursor[0] - first[0], cursor[1] - first[1]) : 0;

  return (
    <g>
      {!snapDisabled &&
        guideAnchors.flatMap((anchor, ai) =>
          snapAngles.map((a) => {
            const rad = (a * Math.PI) / 180;
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
            );
          }),
        )}

      {drawing.type === 'polygon' && previewPts.length >= 3 && (
        <path
          d={pointsToPath(previewPts, true, bezier)}
          fill="rgba(255,59,48,0.08)"
          stroke="none"
        />
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
        <path
          d={pointsToPath(previewPts, false, bezier)}
          className="preview-shape"
          vectorEffect="non-scaling-stroke"
        />
      )}

      {drawing.points.map((p, i) => (
        <circle key={i} cx={fmt(p[0])} cy={fmt(p[1])} r={3 / scale} className="preview-vertex" />
      ))}
    </g>
  );
}
