import { useRef } from 'react';
import { STATUS, fmtClock } from './status.js';
import { listReps } from '../lib/report/format.js';

export default function Timeline({ duration, reps, time, selectedRep, baselineReps, breakdown, onSeek, onRep }) {
  const trackRef = useRef(null);
  const dragging = useRef(false);
  const pct = (t) => `${Math.max(0, Math.min(100, (t / duration) * 100))}%`;

  const seekFromEvent = (e) => {
    const rect = trackRef.current.getBoundingClientRect();
    const f = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    onSeek(f * duration);
  };

  const baseline = reps.filter((r) => baselineReps.includes(r.index));
  const bStart = baseline.length ? baseline[0].tStart : null;
  const bEnd = baseline.length ? baseline[baseline.length - 1].tEnd : null;
  const bRep = breakdown ? reps.find((r) => r.index === breakdown.rep) : null;

  return (
    <div className="timeline">
      <div className="tl-annotations" aria-hidden="true">
        {bStart !== null && (
          <div className="tl-baseline" style={{ left: pct(bStart), width: `calc(${pct(bEnd)} - ${pct(bStart)})` }}>
            <span>Baseline</span>
          </div>
        )}
        {bRep && (
          <div className={`tl-break tl-break-${breakdown.kind}`} style={{ left: pct(bRep.tStart) }}>
            <span>{breakdown.kind === 'breakdown' ? 'Broke down' : 'Changed'}</span>
          </div>
        )}
      </div>
      <div
        ref={trackRef}
        className="tl-track"
        onPointerDown={(e) => {
          if (e.target.closest('.tl-rep')) return;
          dragging.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          seekFromEvent(e);
        }}
        onPointerMove={(e) => dragging.current && seekFromEvent(e)}
        onPointerUp={() => {
          dragging.current = false;
        }}
        role="group"
        aria-label={`Set timeline with ${reps.length} reps. Baseline ${listReps(baselineReps)}.`}
      >
        {reps.map((r) => {
          const s = STATUS[r.status] || STATUS.unknown;
          return (
            <button
              key={r.index}
              type="button"
              className={`tl-rep s-${r.status} ${selectedRep === r.index ? 'is-selected' : ''} ${r.partial ? 'is-partial' : ''}`}
              style={{ left: pct(r.tStart), width: `calc(${pct(r.tEnd)} - ${pct(r.tStart)})` }}
              onClick={() => onRep(r.index)}
              aria-label={`Rep ${r.index}: ${s.label}${r.score != null ? `, score ${r.score}` : ''}. Play this rep.`}
              title={`Rep ${r.index} · ${s.label}${r.score != null ? ` · ${r.score}` : ''}`}
            >
              <span>{r.index}</span>
            </button>
          );
        })}
        <div className="tl-playhead" style={{ left: pct(time) }} aria-hidden="true" />
      </div>
      <div className="tl-times" aria-hidden="true">
        <span>{fmtClock(0)}</span>
        <span>{fmtClock(duration)}</span>
      </div>
    </div>
  );
}
