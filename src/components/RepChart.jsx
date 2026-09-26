import { useState } from 'react';
import { getExercise } from '../config/exercises/index.js';
import { useWidth } from './useWidth.js';
import { STATUS } from './status.js';
import { useMetricHover } from './highlight.js';
import { fmt, fmtDelta, unitLabel } from '../lib/report/format.js';

const H = 240;
const PAD = { top: 30, right: 14, bottom: 46, left: 44 };
const LEVEL_COLOR = { ok: 'var(--good)', notable: 'var(--warn)', major: 'var(--bad)', na: 'var(--unknown)' };
const LEVEL_LABEL = { ok: 'Within baseline', notable: 'Notable change', major: 'Major change', na: 'Not measured' };

function niceTicks(lo, hi, count = 4) {
  const span = hi - lo || 1;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= count) || raw;
  const start = Math.floor(lo / step) * step;
  const ticks = [];
  for (let v = start; v <= hi + step * 0.01; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return ticks;
}

export default function RepChart({ analysis, selectedRep, onRep }) {
  const metricHover = useMetricHover();
  const cfg = getExercise(analysis.exerciseId);
  const [mode, setMode] = useState('score');
  const [hover, setHover] = useState(null);
  const [ref, width] = useWidth(640);
  const reps = analysis.reps;
  const n = reps.length;
  const innerW = Math.max(120, width - PAD.left - PAD.right);
  const innerH = H - PAD.top - PAD.bottom;
  const band = innerW / n;
  const cx = (i) => PAD.left + band * (i + 0.5);
  const barW = Math.min(24, band * 0.62);

  const metricKeys = Object.keys(cfg.metrics);
  const def = mode === 'score' ? null : cfg.metrics[mode];
  const stat = mode === 'score' ? null : analysis.stats[mode];

  // Y domain.
  let lo = 0;
  let hi = 100;
  let bandLo = null;
  let bandHi = null;
  if (def) {
    const vals = reps.map((r) => r.metrics[mode]).filter(Number.isFinite);
    // Shaded zone: the baseline reps' range, extended by the "notable"
    // threshold in the direction that counts as worse.
    const allowance = def.mode === 'relative' ? def.notable * Math.abs(stat.mean) : def.notable;
    if (Number.isFinite(stat.mean)) {
      bandLo = def.direction === 'increase' ? stat.min : stat.min - allowance;
      bandHi = def.direction === 'decrease' ? stat.max : stat.max + allowance;
      vals.push(bandLo, bandHi);
    }
    lo = Math.min(...vals);
    hi = Math.max(...vals);
    const pad = (hi - lo || Math.abs(hi) || 1) * 0.12;
    lo -= pad;
    hi += pad;
    if (lo > 0 && lo < (hi - lo) * 0.6) lo = 0;
  }
  const ticks = niceTicks(lo, hi);
  lo = Math.min(lo, ticks[0]);
  hi = Math.max(hi, ticks[ticks.length - 1]);
  const y = (v) => PAD.top + innerH - ((v - lo) / (hi - lo || 1)) * innerH;

  const baseline = reps.filter((r) => r.isBaseline);
  const bFirst = baseline.length ? reps.indexOf(baseline[0]) : -1;
  const bLast = baseline.length ? reps.indexOf(baseline[baseline.length - 1]) : -1;
  const bIdx = analysis.breakdown ? reps.findIndex((r) => r.index === analysis.breakdown.rep) : -1;

  const hoverRep = hover != null ? reps[hover] : null;
  const tip = hoverRep
    ? mode === 'score'
      ? {
          title: `Rep ${hoverRep.index}`,
          value: hoverRep.score != null ? `${hoverRep.score}` : 'Not scored',
          sub: hoverRep.isBaseline ? 'Baseline rep' : (STATUS[hoverRep.status] || STATUS.unknown).label,
        }
      : {
          title: `Rep ${hoverRep.index}`,
          value: fmt(hoverRep.metrics[mode], def),
          sub: `Baseline ${fmt(stat.mean, def)} · ${fmtDelta(hoverRep.deviations[mode], def)} · ${LEVEL_LABEL[hoverRep.deviations[mode]?.level] || ''}`,
        }
    : null;

  const linePath = def
    ? reps
        .map((r, i) => (Number.isFinite(r.metrics[mode]) ? `${cx(i)},${y(r.metrics[mode])}` : null))
        .filter(Boolean)
        .map((p, k) => `${k ? 'L' : 'M'}${p}`)
        .join(' ')
    : '';

  return (
    <div className="chart-card">
      <div className="chart-head">
        <div>
          <h3>{mode === 'score' ? 'Form quality by rep' : cfg.metrics[mode].label}</h3>
          <p className="muted small">
            {mode === 'score'
              ? 'Score out of 100: how closely each rep matched your baseline reps.'
              : `${cfg.metrics[mode].description} In ${unitLabel(cfg.metrics[mode])}.`}
          </p>
        </div>
      </div>
      <div className="chart-tabs" role="tablist" aria-label="Chart measure">
        <button role="tab" aria-selected={mode === 'score'} className={mode === 'score' ? 'is-active' : ''} onClick={() => setMode('score')}>
          Score
        </button>
        {metricKeys.map((k) => (
          <button key={k} role="tab" aria-selected={mode === k} className={mode === k ? 'is-active' : ''} onClick={() => setMode(k)} {...metricHover(k)}>
            {cfg.metrics[k].short}
          </button>
        ))}
      </div>
      <div
        className="chart-body"
        ref={ref}
        onPointerEnter={() => mode !== 'score' && metricHover(mode).onMouseEnter()}
        onPointerLeave={() => {
          setHover(null);
          if (mode !== 'score') metricHover(mode).onMouseLeave();
        }}
      >
        <svg width={width} height={H} role="img" aria-label={mode === 'score' ? 'Bar chart of form score for each rep' : `Line chart of ${cfg.metrics[mode].label} for each rep against the baseline`}>
          {/* Grid + y ticks */}
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={PAD.left + innerW} y1={y(t)} y2={y(t)} className="grid" />
              <text x={PAD.left - 8} y={y(t)} className="tick" textAnchor="end" dominantBaseline="middle">
                {def ? fmt(t, { ...def, decimals: def.decimals && hi - lo < 3 ? def.decimals : 0 }).replace(/ ?(s|% torso|% foot)$/, '') : t}
              </text>
            </g>
          ))}

          {/* Baseline band (metric mode) */}
          {def && bandLo != null && (
            <g>
              <rect x={PAD.left} width={innerW} y={y(bandHi)} height={Math.max(1, y(bandLo) - y(bandHi))} className="baseline-band" />
              <line x1={PAD.left} x2={PAD.left + innerW} y1={y(stat.mean)} y2={y(stat.mean)} className="baseline-line" />
            </g>
          )}

          {/* Breakdown marker */}
          {bIdx >= 0 && (
            <g>
              <line x1={cx(bIdx) - band / 2} x2={cx(bIdx) - band / 2} y1={PAD.top - 12} y2={PAD.top + innerH} className="break-line" />
              <text x={cx(bIdx) - band / 2 + 6} y={PAD.top - 14} className="break-label">
                {analysis.breakdown.kind === 'breakdown' ? 'Broke down' : 'Changed'}
              </text>
            </g>
          )}

          {/* Marks */}
          {mode === 'score' &&
            reps.map((r, i) => {
              const x = cx(i) - barW / 2;
              if (r.score == null) {
                return <rect key={r.index} x={x} y={y(0) - 3} width={barW} height={3} rx={1.5} className="bar-unscored" />;
              }
              const top = y(Math.max(r.score, 1));
              const h = y(0) - top;
              const rr = Math.min(4, h / 2, barW / 2);
              const d = `M${x},${y(0)} V${top + rr} Q${x},${top} ${x + rr},${top} H${x + barW - rr} Q${x + barW},${top} ${x + barW},${top + rr} V${y(0)} Z`;
              return (
                <path
                  key={r.index}
                  d={d}
                  fill={(STATUS[r.status] || STATUS.unknown).color}
                  className={`bar ${hover === i ? 'is-hover' : ''} ${selectedRep === r.index ? 'is-selected' : ''}`}
                />
              );
            })}

          {def && (
            <g>
              <path d={linePath} className="metric-line" />
              {reps.map((r, i) =>
                Number.isFinite(r.metrics[mode]) ? (
                  <circle
                    key={r.index}
                    cx={cx(i)}
                    cy={y(r.metrics[mode])}
                    r={hover === i || selectedRep === r.index ? 6 : 4.5}
                    fill={LEVEL_COLOR[r.deviations[mode]?.level] || LEVEL_COLOR.na}
                    className="dot"
                  />
                ) : null,
              )}
            </g>
          )}

          {/* X axis */}
          <line x1={PAD.left} x2={PAD.left + innerW} y1={PAD.top + innerH} y2={PAD.top + innerH} className="axis" />
          {reps.map((r, i) => (
            <text key={r.index} x={cx(i)} y={PAD.top + innerH + 16} className={`tick ${selectedRep === r.index ? 'tick-strong' : ''}`} textAnchor="middle">
              {r.index}
            </text>
          ))}
          {bFirst >= 0 && (
            <g className="baseline-bracket">
              <path d={`M${cx(bFirst) - band * 0.4},${PAD.top + innerH + 24} v5 H${cx(bLast) + band * 0.4} v-5`} />
              <text x={(cx(bFirst) + cx(bLast)) / 2} y={PAD.top + innerH + 42} textAnchor="middle">
                Baseline
              </text>
            </g>
          )}

          {/* Hit targets: whole column per rep */}
          {reps.map((r, i) => (
            <rect
              key={r.index}
              x={cx(i) - band / 2}
              y={PAD.top - 10}
              width={band}
              height={innerH + 30}
              fill="transparent"
              tabIndex={0}
              role="button"
              aria-label={`Rep ${r.index}${r.score != null ? `, score ${r.score}` : ''}. Play this rep.`}
              onPointerEnter={() => setHover(i)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
              onClick={() => onRep(r.index)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onRep(r.index);
                }
              }}
              className="hit"
            />
          ))}
        </svg>
        {tip && (
          // Sit beside the hovered column, never on top of the marks it describes.
          <div
            className="chart-tip chart-tip-side"
            style={cx(hover) > width / 2 ? { right: width - (cx(hover) - band / 2) + 6, top: PAD.top } : { left: cx(hover) + band / 2 + 6, top: PAD.top }}
          >
            <strong>{tip.value}</strong>
            <span>{tip.title}</span>
            <span className="muted">{tip.sub}</span>
          </div>
        )}
      </div>
      <div className="chart-legend" aria-hidden={mode !== 'score'}>
        {mode === 'score'
          ? ['green', 'yellow', 'red', 'unknown']
              .filter((s) => reps.some((r) => r.status === s))
              .map((s) => (
                <span key={s}>
                  <i style={{ background: STATUS[s].color }} />
                  {STATUS[s].label}
                </span>
              ))
          : [
              ...['ok', 'notable', 'major']
                .filter((l) => reps.some((r) => r.deviations[mode]?.level === l))
                .map((l) => (
                  <span key={l}>
                    <i className="round" style={{ background: LEVEL_COLOR[l] }} />
                    {LEVEL_LABEL[l]}
                  </span>
                )),
              <span key="avg">
                <i className="line" />
                Baseline average {fmt(stat.mean, def)}
              </span>,
              <span key="band">
                <i className="band" />
                Baseline range plus allowed drift
              </span>,
            ]}
      </div>
    </div>
  );
}
