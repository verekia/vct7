import type { Tool } from '../types';
import { useStore } from '../store';

const TOOLS: { id: Tool; label: string; key: string; icon: () => JSX.Element }[] = [
  { id: 'select', label: 'Select', key: 'V', icon: SelectIcon },
  { id: 'line', label: 'Line', key: 'L', icon: LineIcon },
  { id: 'polygon', label: 'Polygon', key: 'P', icon: PolygonIcon },
];

export function Toolbar() {
  const tool = useStore((s) => s.tool);
  const setTool = useStore((s) => s.setTool);

  return (
    <div className="tool-grid">
      {TOOLS.map((t) => {
        const Icon = t.icon;
        return (
          <button
            key={t.id}
            type="button"
            className={`tool${tool === t.id ? ' active' : ''}`}
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
      <line x1="3" y1="13" x2="13" y2="3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
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
