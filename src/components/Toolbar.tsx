import type { ReactElement } from 'react';
import type { Tool } from '../types';
import { useStore } from '../store';

const TOOLS: { id: Tool; label: string; key: string; icon: () => ReactElement }[] = [
  { id: 'select', label: 'Select', key: 'V', icon: SelectIcon },
  { id: 'line', label: 'Line', key: 'L', icon: LineIcon },
  { id: 'polygon', label: 'Polygon', key: 'P', icon: PolygonIcon },
  { id: 'circle', label: 'Circle', key: 'C', icon: CircleIcon },
];

export function Toolbar() {
  const tool = useStore((s) => s.tool);
  const setTool = useStore((s) => s.setTool);

  return (
    <div className="flex gap-1">
      {TOOLS.map((t) => {
        const Icon = t.icon;
        const isActive = tool === t.id;
        const cls = isActive
          ? 'flex items-center justify-center w-7 h-7 p-0 bg-accent text-white border-accent shadow-[0_0_0_1px_rgba(255,59,48,0.25)]'
          : 'flex items-center justify-center w-7 h-7 p-0 text-muted';
        return (
          <button
            key={t.id}
            type="button"
            className={cls}
            title={`${t.label} (${t.key})`}
            onClick={() => setTool(t.id)}
            aria-label={t.label}
          >
            <Icon />
          </button>
        );
      })}
    </div>
  );
}

function SelectIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14">
      <path
        d="M3 2l8 7-3.5.6L9.5 14l-1.7.7-1.9-4-2.9 2z"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth="0.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function LineIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14">
      <line
        x1="3"
        y1="13"
        x2="13"
        y2="3"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <circle cx="3" cy="13" r="1.6" fill="currentColor" />
      <circle cx="13" cy="3" r="1.6" fill="currentColor" />
    </svg>
  );
}

function PolygonIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14">
      <polygon
        points="8,2 14,6.5 11.5,13.5 4.5,13.5 2,6.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CircleIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14">
      <circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}
