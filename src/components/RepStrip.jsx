// The rep strip under the video: the main way around the set. Reps sit on a
// time axis; clicking one jumps to it (Full set) or loads it on the right
// (Compare). Clicking empty space scrubs the video in Full set.

import { useRef } from 'react';
import { STATUS } from './status.js';

export default function RepStrip({ analysis, mode, time, selectedRep, compareLeft, onRep, onSeek }) {
  const trackRef = useRef(null);
  const dragging = useRef(false);
  const t0 = analysis.t0 || 0;
  const duration = analysis.duration;
  const reps = analysis.reps;
  const pct = (t) => `${Math.max(0, Math.min(100, ((t - t0) / duration) * 100))}%`;

  const seekFromEvent = (e) => {
    const rect = trackRef.current.getBoundingClientRect();
    onSeek(t0 + Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * duration);
  };

  const baseline = reps.filter((r) => r.isBaseline);
  const bRep = analysis.breakdown ? reps.find((r) => r.index === analysis.breakdown.rep) : null;

  return (
    <div className="strip">
      <div className="strip-marks" aria-hidden="true">
        {baseline.length > 0 && (
          <span className="strip-baseline" style={{ left: pct(baseline[0].tStart), width: `calc(${pct(baseline[baseline.length - 1].tEnd)} - ${pct(baseline[0].tStart)})` }}>
            Baseline
          </span>
        )}
        {reps
          .filter((r) => r.excluded)
          .map((r) => (
            <span key={r.index} className="strip-excluded" style={{ left: pct(r.tStart), width: `calc(${pct(r.tEnd)} - ${pct(r.tStart)})` }} title={r.excluded.text}>
              {r.excluded.code === 'cut_start' || r.excluded.code === 'cut_end' ? 'Cut off' : 'Unclear'}
            </span>
          ))}
        {bRep && (
          <span className={`strip-break strip-break-${analysis.breakdown.kind}`} style={{ left: pct(bRep.tStart) }}>
            {analysis.breakdown.kind === 'breakdown' ? 'Broke down' : 'Changed'}
          </span>
        )}
      </div>
      <div
        ref={trackRef}
        className={`strip-track ${mode === 'compare' ? 'is-compare' : ''}`}
        onPointerDown={(e) => {
          if (mode !== 'full' || e.target.closest('.strip-rep')) return;
          dragging.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          seekFromEvent(e);
        }}
        onPointerMove={(e) => dragging.current && seekFromEvent(e)}
        onPointerUp={() => {
          dragging.current = false;
        }}
        role="group"
        aria-label={mode === 'compare' ? 'Reps. Choose one to compare with your baseline.' : 'Reps. Choose one to play it.'}
      >
        {reps.map((r) => {
          const s = STATUS[r.status] || STATUS.unknown;
          const why = r.excluded?.text;
          const label = `Rep ${r.index}: ${r.isBaseline ? 'baseline' : r.scorable ? s.label.toLowerCase() : 'not scored'}${r.score != null ? `, score ${r.score}` : ''}${why ? `. ${why}` : ''}`;
          return (
            <button
              key={r.index}
              type="button"
              className={[
                'strip-rep',
                `s-${r.scorable ? r.status : 'unknown'}`,
                selectedRep === r.index ? 'is-selected' : '',
                mode === 'compare' && compareLeft === r.index ? 'is-left' : '',
                r.partial ? 'is-partial' : '',
              ].join(' ')}
              style={{ left: pct(r.tStart), width: `calc(${pct(r.tEnd)} - ${pct(r.tStart)})` }}
              onClick={() => onRep(r.index)}
              aria-label={label}
              aria-pressed={selectedRep === r.index}
              title={label}
            >
              <span>{r.index}</span>
            </button>
          );
        })}
        {mode === 'full' && <div className="strip-playhead" style={{ left: pct(time) }} aria-hidden="true" />}
      </div>
    </div>
  );
}
