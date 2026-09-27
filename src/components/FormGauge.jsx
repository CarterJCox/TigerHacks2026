// The form gauge at the top of the side panel: a half dial in three zones
// (good form, less effective, injury risk) with a needle that eases to the
// current reading. The reading itself (0-100) is computed in
// lib/analysis/standards.js (gaugeValue).

import { useEffect, useState } from 'react';
import { SEVERITY } from './status.js';

const W = 260;
const CX = 130;
const CY = 126;
const R = 100; // arc radius
const LR = 116; // label radius
const GAP = 0.012; // gap between zones, as a fraction of the dial

const ZONES = [
  { id: 'green', from: 0, to: 1 / 3, label: 'Good form', color: 'var(--good)' },
  { id: 'yellow', from: 1 / 3, to: 2 / 3, label: 'Less effective', color: 'var(--warn)' },
  { id: 'red', from: 2 / 3, to: 1, label: 'Injury risk', color: 'var(--bad)' },
];

// Point on the dial at fraction t (0 = far left, 1 = far right, over the top).
function at(t, r) {
  const a = Math.PI * (1 - t);
  return [CX + r * Math.cos(a), CY - r * Math.sin(a)];
}

function arc(t0, t1, r) {
  const [x0, y0] = at(t0, r);
  const [x1, y1] = at(t1, r);
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

export default function FormGauge({ severity, value, caption, reason, action }) {
  const known = ZONES.some((z) => z.id === severity);
  // Start from the left on first render so the needle sweeps in.
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(known && Number.isFinite(value) ? value : 0));
    return () => cancelAnimationFrame(id);
  }, [value, known]);
  const label = SEVERITY[severity]?.long ?? SEVERITY.unknown.long;

  return (
    <figure className={`gauge g-${known ? severity : 'unknown'}`}>
      <div className="gauge-dial">
        <svg viewBox={`0 0 ${W} ${CY + 30}`} role="img" aria-label={`Form gauge, ${caption}: ${label}.`}>
          <defs>
            {ZONES.map((z) => (
              <path key={z.id} id={`gauge-label-${z.id}`} d={arc(z.from, z.to, LR)} />
            ))}
          </defs>
          {ZONES.map((z) => {
            const on = z.id === severity;
            return (
              <g key={z.id} className={`gauge-zone ${on ? 'is-on' : ''}`}>
                <path
                  d={arc(z.from + (z.from > 0 ? GAP : 0), z.to - (z.to < 1 ? GAP : 0), R)}
                  stroke={z.color}
                  strokeWidth="11"
                  fill="none"
                  strokeLinecap="butt"
                />
                <text className="gauge-label" style={on ? { fill: z.color } : undefined}>
                  <textPath href={`#gauge-label-${z.id}`} startOffset="50%" textAnchor="middle">
                    {z.label}
                  </textPath>
                </text>
              </g>
            );
          })}
          <g className="gauge-needle" style={{ transform: `rotate(${(shown / 100) * 180}deg)`, transformOrigin: `${CX}px ${CY}px`, opacity: known ? 1 : 0 }}>
            <path d={`M ${CX - (R - 14)} ${CY} L ${CX} ${CY - 3.4} L ${CX + 9} ${CY} L ${CX} ${CY + 3.4} Z`} />
          </g>
          <circle cx={CX} cy={CY} r="6.5" className="gauge-hub" />
          <circle cx={CX} cy={CY} r="2.4" className="gauge-hub-dot" />
          <text x={CX} y={CY + 25} textAnchor="middle" className="gauge-caption">
            {caption}
          </text>
        </svg>
        {action}
      </div>
      <figcaption className="gauge-reason">{reason}</figcaption>
    </figure>
  );
}
