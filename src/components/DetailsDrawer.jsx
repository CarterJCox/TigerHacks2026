// Everything for people who want to dig in, kept off the main screen:
// the written summary, the form standards, the rep-by-rep table, the
// per-metric chart and how the numbers were measured.

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { getExercise } from '../config/exercises/index.js';
import { alertText, fmt, fmtLong, fmtRange, listReps } from '../lib/report/format.js';
import RepTable from './RepTable.jsx';
import RepChart from './RepChart.jsx';
import FormStandardsTable from './FormStandardsTable.jsx';
import { useMetricHover } from './highlight.js';

const TABS = [
  ['summary', 'Summary'],
  ['form', 'Form standards'],
  ['reps', 'Rep table'],
  ['chart', 'Chart'],
  ['method', 'How it was measured'],
];

function Summary({ analysis, input, report, llmPending, onSeek }) {
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

      {analysis.liveAlerts?.length > 0 && (
        <>
          <h3>Stop signals during the set</h3>
          <p className="muted small">Raised live while you recorded, when a form limit linked to extra strain was crossed. Select one to watch that moment.</p>
          <ul className="drawer-list">
            {analysis.liveAlerts.map((a) => (
              <li key={`${a.t}-${a.ruleId}`}>
                <button type="button" className="link alert-link" onClick={() => onSeek?.(a.t)}>
                  {alertText(a)}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

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
        Every rep, your first ones included, is checked against the fixed limits in the Form standards tab. Crossing a red limit means injury
        risk; crossing a yellow one means the rep is less effective for building muscle. Separately, each rep is compared with the average of
        your first reps ({listReps(analysis.baselineReps)}), which are not assumed to be good form. A rep that moves past the range your first reps
        covered by more than the thresholds below also counts as yellow. The rep colour is the more serious of the two. The 0–100 consistency
        score drops in proportion to how far each measure moved in the worse direction, relative to that measure's "major" threshold plus the
        range your first reps covered, so small differences cost a few points.
      </p>
      <h3>What each number means</h3>
      <ul className="drawer-list">
        {Object.entries(cfg.metrics).map(([k, def]) => (
          <li key={k} {...hover(k)}>
            <strong>{def.label}</strong> <span className={`rel rel-${def.reliability}`}>{def.reliability} reliability</span>
            <br />
            <span className="muted">
              {def.description} Flagged when a rep goes {def.mode === 'relative' ? `${Math.round(def.notable * 100)}% of your first reps' average` : fmtLong(def.notable, def)} beyond
              the range of your first reps (major at {def.mode === 'relative' ? `${Math.round(def.major * 100)}%` : fmtLong(def.major, def)}). Average of your first reps{' '}
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

export default function DetailsDrawer({ open, onClose, analysis, input, report, llmPending, selectedRep, onRep, onSeek, onHistory }) {
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
          {open && tab === 'summary' && <Summary analysis={analysis} input={input} report={report} llmPending={llmPending} onSeek={onSeek} />}
          {open && tab === 'form' && (
            <div className="drawer-section">
              <FormStandardsTable analysis={analysis} selectedRep={selectedRep} onRep={onRep} />
            </div>
          )}
          {open && tab === 'reps' && (
            <div className="drawer-section">
              <p className="muted small">Each rep's measurements, with the change from your first reps' average underneath. Select a row to play that rep.</p>
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
