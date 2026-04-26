import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { ANGLE_PRESETS } from '../lib/snap';

const HEX_RE = /^#[0-9a-f]{3}([0-9a-f]{3})?$/i;

const PRESET_LABELS: Record<string, string> = {
  ortho: '90°',
  '45': '45°',
  '30': '30°',
  '60': '60°',
  '15': '15°',
};

const sameAngles = (a: number[], b: number[]): boolean =>
  a.length === b.length && a.every((v, i) => v === b[i]);

// `<input type="color">` requires `#rrggbb`; expand a 3-digit hex if needed.
const toLongHex = (c: string): string => {
  if (/^#[0-9a-f]{6}$/i.test(c)) return c;
  if (/^#[0-9a-f]{3}$/i.test(c)) {
    return (
      '#' +
      c
        .slice(1)
        .split('')
        .map((ch) => ch + ch)
        .join('')
    );
  }
  return '#ffffff';
};

export function ProjectPanel() {
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);

  const [bgText, setBgText] = useState(settings.bg);
  useEffect(() => setBgText(settings.bg), [settings.bg]);

  const [widthText, setWidthText] = useState(String(settings.width));
  const [heightText, setHeightText] = useState(String(settings.height));
  useEffect(() => setWidthText(String(settings.width)), [settings.width]);
  useEffect(() => setHeightText(String(settings.height)), [settings.height]);

  const [gridSizeText, setGridSizeText] = useState(String(settings.gridSize));
  useEffect(() => setGridSizeText(String(settings.gridSize)), [settings.gridSize]);

  return (
    <section className="panel">
      <div className="field">
        <span className="field-label">Snap angles</span>
        <div className="preset-grid">
          {Object.keys(ANGLE_PRESETS).map((key) => {
            const isActive = sameAngles(settings.snapAngles, ANGLE_PRESETS[key]);
            return (
              <button
                key={key}
                type="button"
                className={`small${isActive ? ' active' : ''}`}
                onClick={() => setSettings({ snapAngles: ANGLE_PRESETS[key] })}
              >
                {PRESET_LABELS[key] ?? `${key}°`}
              </button>
            );
          })}
        </div>
      </div>

      <label>
        <span>
          Global bezier <span className="num">{settings.bezier.toFixed(2)}</span>
        </span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={settings.bezier}
          onChange={(e) => setSettings({ bezier: parseFloat(e.target.value) })}
        />
      </label>

      <label>
        <span>Background</span>
        <div className="row">
          <input
            type="color"
            value={toLongHex(settings.bg)}
            onChange={(e) => setSettings({ bg: e.target.value })}
          />
          <input
            type="text"
            value={bgText}
            onChange={(e) => setBgText(e.target.value)}
            onBlur={() => {
              if (HEX_RE.test(bgText)) setSettings({ bg: bgText });
              else setBgText(settings.bg);
            }}
          />
        </div>
      </label>

      <label>
        <span>Canvas size</span>
        <div className="row">
          <input
            type="number"
            min={1}
            value={widthText}
            onChange={(e) => setWidthText(e.target.value)}
            onBlur={() => {
              const v = parseFloat(widthText);
              if (Number.isFinite(v) && v > 0) setSettings({ width: v });
              else setWidthText(String(settings.width));
            }}
          />
          <span>×</span>
          <input
            type="number"
            min={1}
            value={heightText}
            onChange={(e) => setHeightText(e.target.value)}
            onBlur={() => {
              const v = parseFloat(heightText);
              if (Number.isFinite(v) && v > 0) setSettings({ height: v });
              else setHeightText(String(settings.height));
            }}
          />
        </div>
      </label>

      <div className="field">
        <span className="field-label">Grid</span>
        <div className="row">
          <input
            type="number"
            min={1}
            style={{ width: 60 }}
            value={gridSizeText}
            onChange={(e) => {
              const next = e.target.value;
              setGridSizeText(next);
              const v = parseFloat(next);
              if (Number.isFinite(v) && v > 0) setSettings({ gridSize: v });
            }}
            onBlur={() => {
              const v = parseFloat(gridSizeText);
              if (!Number.isFinite(v) || v <= 0) setGridSizeText(String(settings.gridSize));
            }}
          />
          <label className="checkbox" title="Show grid (G)">
            <input
              type="checkbox"
              checked={settings.gridVisible}
              onChange={(e) => setSettings({ gridVisible: e.target.checked })}
            />
            <span>Show</span>
          </label>
          <label className="checkbox" title="Snap to grid">
            <input
              type="checkbox"
              checked={settings.gridSnap}
              onChange={(e) => setSettings({ gridSnap: e.target.checked })}
            />
            <span>Snap</span>
          </label>
        </div>
      </div>
    </section>
  );
}
