// Two small charts that share one x axis (session order): weight on top,
// form score below. Two charts instead of one dual-axis chart, so neither
// scale can suggest a relationship that isn't there.

import { useState } from 'react';
import { useWidth } from './useWidth.js';

const PAD = { left: 48, right: 16 };

function scale(lo, hi, top, h) {
  return (v) => top + h - ((v - lo) / (hi - lo || 1)) * h;
}

function ticksFor(lo, hi) {
  const span = hi - lo || 1;
  const raw = span / 3;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= 3) || raw;
  const out = [];
  for (let v = Math.floor(lo / step) * step; v <= hi + 1e-9; v += step) out.push(Math.round(v * 100) / 100);
  return out;
}

function Panel({ title, sub, points, values, domain, x, width, height, hover, fmtTick }) {
  const top = 12;
  const h = height - top - 8;
  const [lo, hi] = domain;
  const y = scale(lo, hi, top, h);
  const ticks = ticksFor(lo, hi).filter((t) => t >= lo - 1e-9 && t <= hi + 1e-9);
  const path = values
    .map((v, i) => (Number.isFinite(v) ? `${x(i)},${y(v)}` : null))
    .filter(Boolean)
    .map((p, k) => `${k ? 'L' : 'M'}${p}`)
    .join(' ');
  return (
    <div className="trend-panel">
      <p className="trend-title">
        {title} <span className="muted">{sub}</span>
      </p>
      <svg width={width} height={height} aria-hidden="true">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} className="grid" />
            <text x={PAD.left - 8} y={y(t)} className="tick" textAnchor="end" dominantBaseline="middle">
              {fmtTick(t)}
            </text>
          </g>
        ))}
        {hover != null && <line x1={x(hover)} x2={x(hover)} y1={top} y2={top + h} className="crosshair" />}
        <path d={path} className="trend-line" />
        {values.map((v, i) =>
          Number.isFinite(v) ? <circle key={points[i].id} cx={x(i)} cy={y(v)} r={hover === i ? 6 : 4.5} className="trend-dot" /> : null,
        )}
      </svg>
    </div>
  );
}

export default function TrendChart({ sessions, unit }) {
  const [ref, width] = useWidth(640);
  const [hover, setHover] = useState(null);
  const n = sessions.length;
  const innerW = Math.max(100, width - PAD.left - PAD.right);
  const x = (i) => (n === 1 ? PAD.left + innerW / 2 : PAD.left + (innerW * i) / (n - 1));

  const weights = sessions.map((s) => (s.bodyweight ? NaN : s.weightDisplay));
  const scores = sessions.map((s) => (Number.isFinite(s.score) ? s.score : NaN));
  const wv = weights.filter(Number.isFinite);
  let wLo = wv.length ? Math.min(...wv) : 0;
  let wHi = wv.length ? Math.max(...wv) : 1;
  const wPad = Math.max(1, (wHi - wLo) * 0.2);
  wLo = Math.max(0, wLo - wPad);
  wHi += wPad;

  const onMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    let best = 0;
    for (let i = 1; i < n; i++) if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i;
    setHover(best);
  };

  const hs = hover != null ? sessions[hover] : null;

  return (
    <div className="trend" ref={ref}>
      <div className="trend-plot" onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
        {wv.length > 0 && (
          <Panel title="Weight" sub={unit} points={sessions} values={weights} domain={[wLo, wHi]} x={x} width={width} height={120} hover={hover} fmtTick={(t) => t} />
        )}
        <Panel title="Form score" sub="0–100, set average" points={sessions} values={scores} domain={[0, 100]} x={x} width={width} height={120} hover={hover} fmtTick={(t) => t} />
        <svg width={width} height={24} aria-hidden="true">
          {sessions.map((s, i) =>
            n <= 8 || i === 0 || i === n - 1 || i % Math.ceil(n / 6) === 0 ? (
              <text key={s.id} x={x(i)} y={14} className="tick" textAnchor="middle">
                {new Date(s.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
              </text>
            ) : null,
          )}
        </svg>
        {hs && (
          <div className="chart-tip" style={{ left: Math.min(Math.max(x(hover), 80), width - 80), top: 0 }}>
            <strong>{hs.bodyweight ? 'Bodyweight' : `${Math.round(hs.weightDisplay * 10) / 10} ${unit}`}</strong>
            <span>Score {hs.score ?? '–'}</span>
            <span className="muted">
              {new Date(hs.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })} ·{' '}
              {hs.breakdownRep ? `changed at rep ${hs.breakdownRep}` : 'held throughout'}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
