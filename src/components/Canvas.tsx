import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { effectiveBezier } from '../store';
import { fmt, pointsToPath } from '../lib/geometry';
import { useCanvasInteractions } from '../hooks/useCanvasInteractions';
import type { Drawing, Point, Shape } from '../types';

interface ContainerSize {
  w: number;
  h: number;
}

export function Canvas() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState<ContainerSize>({ w: 800, h: 600 });

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
    const scale = Math.min(
      (size.w - pad * 2) / settings.width,
      (size.h - pad * 2) / settings.height,
    );
    const s = scale > 0 ? scale : 1;
    setView({
      scale: s,
      x: (size.w - settings.width * s) / 2,
      y: (size.h - settings.height * s) / 2,
    });
  }, [fitNonce, size.w, size.h, settings.width, settings.height, setView]);

  useCanvasInteractions(svgRef);

  const tool = useStore((s) => s.tool);
  const view = useStore((s) => s.view);
  const cursor = useStore((s) => s.cursor);
  const shapes = useStore((s) => s.shapes);
  const drawing = useStore((s) => s.drawing);
  const selectedShapeId = useStore((s) => s.selectedShapeId);
  const selectedVertex = useStore((s) => s.selectedVertex);
  const snapDisabled = useStore((s) => s.snapDisabled);
  const spaceHeld = useStore((s) => s.spaceHeld);
  const panning = useStore((s) => s.panning);

  const selectedShape = shapes.find((s) => s.id === selectedShapeId) ?? null;
  const transform = `translate(${fmt(view.x)} ${fmt(view.y)}) scale(${fmt(view.scale)})`;

  const cls = [
    'canvas-svg',
    tool === 'select' ? 'tool-select' : '',
    panning ? 'panning' : spaceHeld ? 'space' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div ref={wrapRef} className="canvas-wrap">
      <svg
        ref={svgRef}
        className={cls}
        viewBox={`0 0 ${size.w} ${size.h}`}
        xmlns="http://www.w3.org/2000/svg"
      >
        <g transform={transform}>
          <rect x={0} y={0} width={settings.width} height={settings.height} fill={settings.bg} />
          <rect
            x={0}
            y={0}
            width={settings.width}
            height={settings.height}
            fill="none"
            stroke="#3a4150"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />

          {shapes.map((shape) => (
            <ShapeNode key={shape.id} shape={shape} bezier={effectiveBezier(shape, settings)} />
          ))}

          {selectedShape && (
            <SelectionLayer
              shape={selectedShape}
              selectedIndex={selectedVertex?.index ?? null}
              scale={view.scale}
            />
          )}

          {drawing && (
            <PreviewLayer
              drawing={drawing}
              cursor={cursor}
              snapDisabled={snapDisabled}
              snapAngles={settings.snapAngles}
              boardW={settings.width}
              boardH={settings.height}
              bezier={settings.bezier}
              scale={view.scale}
            />
          )}
        </g>
      </svg>
      <div className="canvas-hud">
        <span>
          {Math.round(cursor[0])}, {Math.round(cursor[1])}
        </span>
        <span>{Math.round(view.scale * 100)}%</span>
        <span>{tool}</span>
      </div>
    </div>
  );
}

function ShapeNode({ shape, bezier }: { shape: Shape; bezier: number }) {
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
        pointerEvents={shape.closed ? 'all' : 'stroke'}
        opacity={0}
        vectorEffect="non-scaling-stroke"
      />
    </g>
  );
}

function SelectionLayer({
  shape,
  selectedIndex,
  scale,
}: {
  shape: Shape;
  selectedIndex: number | null;
  scale: number;
}) {
  return (
    <g>
      <path d={pointsToPath(shape.points, shape.closed, 0)} className="selection-outline" />
      {shape.points.map((p, i) => (
        <circle
          key={i}
          cx={fmt(p[0])}
          cy={fmt(p[1])}
          r={5 / scale}
          className={`vertex-handle${selectedIndex === i ? ' selected' : ''}`}
          data-shape-id={shape.id}
          data-vertex-index={i}
        />
      ))}
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
  const previewPts: Point[] = [...drawing.points, [cursor[0], cursor[1]]];
  const rayLen = (boardW + boardH) * 2;

  return (
    <g>
      {!snapDisabled &&
        snapAngles.map((a) => {
          const rad = (a * Math.PI) / 180;
          return (
            <line
              key={a}
              x1={fmt(last[0])}
              y1={fmt(last[1])}
              x2={fmt(last[0] + Math.cos(rad) * rayLen)}
              y2={fmt(last[1] + Math.sin(rad) * rayLen)}
              className="snap-guide"
              vectorEffect="non-scaling-stroke"
            />
          );
        })}

      {drawing.type === 'polygon' && previewPts.length >= 3 && (
        <path
          d={pointsToPath(previewPts, true, bezier)}
          fill="rgba(255,59,48,0.08)"
          stroke="none"
        />
      )}

      <path
        d={pointsToPath(previewPts, false, bezier)}
        className="preview-shape"
        vectorEffect="non-scaling-stroke"
      />

      {drawing.points.map((p, i) => (
        <circle key={i} cx={fmt(p[0])} cy={fmt(p[1])} r={3 / scale} className="preview-vertex" />
      ))}
    </g>
  );
}
