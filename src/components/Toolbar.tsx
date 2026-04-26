import type { Tool } from '../types';
import { useStore } from '../store';

const TOOLS: { id: Tool; label: string; key: string; hint: string }[] = [
  {
    id: 'select',
    label: 'Select',
    key: 'V',
    hint: 'Click a shape to select. Drag vertex handles.',
  },
  {
    id: 'line',
    label: 'Line',
    key: 'L',
    hint: 'Click to place points. Enter / dbl-click to finish.',
  },
  {
    id: 'polygon',
    label: 'Polygon',
    key: 'P',
    hint: 'Click points. Click first point or Enter to close.',
  },
];

export function Toolbar() {
  const tool = useStore((s) => s.tool);
  const setTool = useStore((s) => s.setTool);
  const active = TOOLS.find((t) => t.id === tool);

  return (
    <section className="panel">
      <h2>Tools</h2>
      <div className="tool-grid">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`tool${tool === t.id ? ' active' : ''}`}
            title={`${t.label} (${t.key})`}
            onClick={() => setTool(t.id)}
          >
            <span className="tk">{t.key}</span>
            <span>{t.label}</span>
          </button>
        ))}
      </div>
      <p className="hint">{active?.hint ?? ''}</p>
    </section>
  );
}
