// Everything for people who want to dig in, kept off the main screen:
// the written summary, the rep-by-rep table, the per-metric chart and how
// the numbers were measured.

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { getExercise } from '../config/exercises/index.js';
import { fmt, fmtLong, fmtRange, listReps } from '../lib/report/format.js';
import RepTable from './RepTable.jsx';
import RepChart from './RepChart.jsx';
import { useMetricHover } from './highlight.js';

const TABS = [
  ['summary', 'Summary'],
  ['reps', 'Rep table'],
  ['chart', 'Chart'],
  ['method', 'How it was measured'],
];

function Summary({ analysis, input, report, llmPending }) {
  const cfg = getExercise(analysis.exerciseId);
  const hover = useMetricHover();
  const excluded = analysis.reps.filter((r) => !r.scorable);
  return (
    <div className="drawer-section">
      <p className="drawer-lead">{report.headline}</p>
      <p className="drawer-text">{report.summary}</p>
      <p className="muted small">
        {report.source === 'llm' ? 'Written by Claude from these measurements.' : 'Written from these measurements.'}
        {llmPending && ' Checking for a written summary…'}
      </p>

      {excluded.length > 0 && (
        <>
          <h3>Reps not scored</h3>
          <ul className="drawer-list">
            {excluded.map((r) => (
              <li key={r.index}>
                <strong>Rep {r.index}</strong>: {r.excluded?.text}. It still counts toward the rep total.
              </li>
            ))}
          </ul>
        </>
      )}

      {analysis.risks.length > 0 && (
        <>
          <h3>Risk factors</h3>
          <p className="muted small">Movement patterns linked to extra strain. Not diagnoses.</p>
          <ul className="drawer-list">
            {analysis.risks.map((r) => {
              const def = cfg.metrics[r.metric];
              return (
                <li key={r.id} {...hover(r.metric)}>
                  <strong>{r.title}</strong>, from rep {r.firstRep}{r.reps.length > 1 ? ` (${listReps(r.reps)})` : ''}: {def.label.toLowerCase()} {fmtRange(r.first.base, r.first.value, def)}. {r.text}
                </li>
              );
            })}
          </ul>
        </>
      )}

      {!input.painReported && report.cues.length > 0 && (
        <>
          <h3>Coaching cues</h3>
          <ul className="drawer-list">
            {report.cues.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function Method({ analysis }) {
  const cfg = getExercise(analysis.exerciseId);
  const hover = useMetricHover();
  return (
    <div className="drawer-section">
      <dl className="drawer-facts">
        <div>
          <dt>Camera view</dt>
          <dd>{cfg.viewLabel}</dd>
        </div>
        {analysis.ctx.view === 'side' && (
          <div>
            <dt>Side measured</dt>
            <dd>
              Your {analysis.ctx.side} side, facing {analysis.ctx.facing > 0 ? 'right' : 'left'} in the frame
            </dd>
          </div>
        )}
        <div>
          <dt>Frames analyzed</dt>
          <dd>
            {analysis.quality.frames} at {analysis.fps} fps, {analysis.width}×{analysis.height}
          </dd>
        </div>
        <div>
          <dt>Frames with all key joints clear</dt>
          <dd>{Math.round(analysis.quality.keyFraction * 100)}%</dd>
        </div>
        <div>
          <dt>Pose model</dt>
          <dd>MediaPipe Pose Landmarker (full), {analysis.delegate === 'GPU' ? 'GPU' : 'CPU'}, in this browser</dd>
        </div>
      </dl>
      <h3>How reps are scored</h3>
      <p className="drawer-text small">
        Each rep is compared with the average of your baseline reps ({listReps(analysis.baselineReps)}). The 0–100 score drops in proportion to how far
        each measure moved in the worse direction, relative to that measure's "major" threshold plus the range your baseline reps covered,
        so small differences cost a few points. The colour is stricter: a rep turns yellow or red only when a measure moves past the range your
        baseline reps already covered by more than the thresholds below.
      </p>
      <h3>What each number means</h3>
      <ul className="drawer-list">
        {Object.entries(cfg.metrics).map(([k, def]) => (
          <li key={k} {...hover(k)}>
            <strong>{def.label}</strong> <span className={`rel rel-${def.reliability}`}>{def.reliability} reliability</span>
            <br />
            <span className="muted">
              {def.description} Flagged when a rep goes {def.mode === 'relative' ? `${Math.round(def.notable * 100)}% of the baseline average` : fmtLong(def.notable, def)} beyond
              your baseline range (major at {def.mode === 'relative' ? `${Math.round(def.major * 100)}%` : fmtLong(def.major, def)}). Baseline average{' '}
              {fmt(analysis.stats[k]?.mean, def)}.
            </span>
          </li>
        ))}
      </ul>
      <h3>Limits of a 2-D video</h3>
      <ul className="drawer-list muted">
        {cfg.limitations.map((l) => (
          <li key={l}>{l}</li>
        ))}
        <li>Angles are measured in the camera's image plane, so movement toward or away from the camera is underestimated.</li>
      </ul>
    </div>
  );
}

export default function DetailsDrawer({ open, onClose, analysis, input, report, llmPending, selectedRep, onRep, onHistory }) {
  const [tab, setTab] = useState('summary');
  const panelRef = useRef(null);
  const cfg = getExercise(analysis.exerciseId);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    panelRef.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Rendered on <body> so no transformed ancestor can offset the fixed drawer.
  return createPortal(
    <div className={`drawer ${open ? 'is-open' : ''}`} aria-hidden={!open}>
      <div className="drawer-scrim" onClick={onClose} />
      <section className="drawer-panel" role="dialog" aria-modal="true" aria-label="Set details" ref={panelRef} tabIndex={-1}>
        <header className="drawer-head">
          <div className="drawer-tabs" role="tablist">
            {TABS.map(([id, label]) => (
              <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'is-active' : ''} onClick={() => setTab(id)}>
                {label}
              </button>
            ))}
          </div>
          <div className="drawer-actions">
            <button type="button" className="text-btn" onClick={onHistory}>
              {cfg.shortName} history
            </button>
            <button type="button" className="icon-close" onClick={onClose} aria-label="Close details">
              <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
                <path d="M5 5 L15 15 M15 5 L5 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </header>
        <div className="drawer-body">
          {open && tab === 'summary' && <Summary analysis={analysis} input={input} report={report} llmPending={llmPending} />}
          {open && tab === 'reps' && (
            <div className="drawer-section">
              <p className="muted small">Each rep's measurements, with the change from your baseline average underneath. Select a row to play that rep.</p>
              <RepTable analysis={analysis} selectedRep={selectedRep} onRep={onRep} />
            </div>
          )}
          {open && tab === 'chart' && (
            <div className="drawer-section">
              <RepChart analysis={analysis} selectedRep={selectedRep} onRep={onRep} />
            </div>
          )}
          {open && tab === 'method' && <Method analysis={analysis} />}
        </div>
      </section>
    </div>,
    document.body,
  );
}
