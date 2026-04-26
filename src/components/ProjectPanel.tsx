import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { ANGLE_PRESETS } from '../lib/snap';

const HEX_RE = /^#[0-9a-f]{3}([0-9a-f]{3})?$/i;

const parseAngles = (text: string): number[] =>
  text
    .split(/[\s,]+/)
    .map((s) => parseFloat(s))
    .filter((n) => Number.isFinite(n));

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

  const [anglesText, setAnglesText] = useState(settings.snapAngles.join(','));
  useEffect(() => {
    setAnglesText(settings.snapAngles.join(','));
  }, [settings.snapAngles]);

  const [bgText, setBgText] = useState(settings.bg);
  useEffect(() => setBgText(settings.bg), [settings.bg]);

  const [widthText, setWidthText] = useState(String(settings.width));
  const [heightText, setHeightText] = useState(String(settings.height));
  useEffect(() => setWidthText(String(settings.width)), [settings.width]);
  useEffect(() => setHeightText(String(settings.height)), [settings.height]);

  return (
    <section className="panel">
      <h2>Project</h2>
      <label>
        <span>Snap angles (deg)</span>
        <input
          type="text"
          value={anglesText}
          onChange={(e) => setAnglesText(e.target.value)}
          onBlur={() => {
            const parsed = parseAngles(anglesText);
            setSettings({ snapAngles: parsed });
          }}
        />
      </label>
      <div className="row">
        {Object.keys(ANGLE_PRESETS).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setSettings({ snapAngles: ANGLE_PRESETS[key] })}
          >
            {key === 'ortho' ? '0/90' : `${key}°`}
          </button>
        ))}
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
    </section>
  );
}
