// The rep strip under the video: the main way around the set. Reps sit on a
// time axis; clicking one jumps to it (Full set) or loads it on the right
// (Compare). Clicking empty space scrubs the video in Full set.

import { useRef } from 'react';
import { severityOf } from './status.js';
import { alertText } from '../lib/report/format.js';

export default function RepStrip({ analysis, mode, time, selectedRep, compareLeft, onRep, onSeek, onAlert }) {
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
            First reps
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
          if (mode !== 'full' || e.target.closest('.strip-rep, .strip-alert')) return;
          dragging.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          seekFromEvent(e);
        }}
        onPointerMove={(e) => dragging.current && seekFromEvent(e)}
        onPointerUp={() => {
          dragging.current = false;
        }}
        role="group"
        aria-label={mode === 'compare' ? 'Reps. Choose one to compare with your first reps.' : 'Reps. Choose one to play it.'}
      >
        {reps.map((r) => {
          // Colour and label follow the combined severity, the same as the gauge.
          const s = severityOf(r);
          const why = r.excluded?.text;
          const label = `Rep ${r.index}${r.isBaseline ? ' (first reps)' : ''}: ${s.long.toLowerCase()}${why ? `. ${why}` : ''}`;
          return (
            <button
              key={r.index}
              type="button"
              className={[
                'strip-rep',
                `s-${r.scorable ? r.severity : 'unknown'}`,
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
        {(analysis.liveAlerts || []).map((a) => (
          <button
            key={`${a.t}-${a.ruleId}`}
            type="button"
            className="strip-alert"
            style={{ left: pct(a.t) }}
            onClick={() => onAlert?.(a.t)}
            title={alertText(a)}
            aria-label={`${alertText(a)}. Play from here.`}
          />
        ))}
        {mode === 'full' && <div className="strip-playhead" style={{ left: pct(time) }} aria-hidden="true" />}
      </div>
    </div>
  );
}
