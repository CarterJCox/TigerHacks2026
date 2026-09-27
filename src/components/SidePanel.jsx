// The slim panel beside the video: the rep in focus, the metrics that moved
// most against baseline, and a cue or risk factor only when one applies.

import { getExercise } from '../config/exercises/index.js';
import { fmt, fmtDelta, fmtRange, listReps } from '../lib/report/format.js';
import { painNotice } from '../lib/report/template.js';
import { STATUS } from './status.js';
import { useMetricHover } from './highlight.js';
import { repChanges } from './repFocus.js';

const LEVEL_TEXT = { ok: 'within baseline range', notable: 'notable change', major: 'major change' };
const PERCENT_UNIT = { '% torso': '% of torso length', '% foot': '% of foot length' };

function MetricRow({ item }) {
  const hover = useMetricHover();
  const { key, d, def } = item;
  return (
    <li className={`mrow lvl-${d.level}`} tabIndex={0} {...hover(key)}>
      <span className="mrow-label">
        {def.label}
        {PERCENT_UNIT[def.unit] ? <span className="muted"> ({PERCENT_UNIT[def.unit]})</span> : null}
      </span>
      <span className="mrow-value">
        {fmt(d.base, def)} → {fmt(d.value, def)}
      </span>
      <span className="mrow-delta">
        {fmtDelta(d, def)}
        <span className="mrow-level"> · {LEVEL_TEXT[d.level] || ''}</span>
      </span>
    </li>
  );
}

export default function SidePanel({ analysis, input, rep, reason }) {
  const cfg = getExercise(analysis.exerciseId);
  const hover = useMetricHover();
  if (!rep) return <aside className="side" />;
  const s = STATUS[rep.status] || STATUS.unknown;
  const changes = rep.scorable ? repChanges(analysis, rep) : [];
  const flagged = changes.filter((c) => c.flagged);
  const cue = !input.painReported && flagged.length ? cfg.cues[flagged[0].key] : null;
  const risks = analysis.risks.filter((r) => r.reps.includes(rep.index));
  const title = rep.isBaseline ? 'Baseline rep' : !rep.scorable ? 'Not scored' : s.long;

  return (
    <aside className="side" aria-live="polite">
      {input.painReported && <p className="care-note">{painNotice()}</p>}

      <div className="side-head">
        <p className="side-eyebrow">
          Rep {rep.index}
          {reason && <span className="muted"> · {reason}</span>}
        </p>
        <div className="side-title">
          <span className={`status-pill s-${rep.scorable ? rep.status : 'unknown'}`}>
            <i aria-hidden="true" />
            {title}
          </span>
          {rep.score != null && (
            <span className="side-score">
              {rep.score}
              <span className="side-score-of">/100</span>
            </span>
          )}
        </div>
        {rep.partial && rep.scorable && <p className="side-note">Partial rep: less than {Math.round(cfg.reps.partialFrac * 100)}% of a typical rep's range.</p>}
      </div>

      {!rep.scorable ? (
        <p className="side-note">{rep.excluded?.text || 'This rep could not be measured reliably.'} It is counted but not scored.</p>
      ) : (
        <>
          <p className="side-caption">{rep.isBaseline ? `Compared with the baseline average (${listReps(analysis.baselineReps)})` : 'Biggest changes against your baseline'}</p>
          {changes.length ? (
            <ul className="mlist">
              {changes.map((c) => (
                <MetricRow key={c.key} item={c} />
              ))}
            </ul>
          ) : (
            <p className="side-note">Every measure stayed within a few units of your baseline average.</p>
          )}
        </>
      )}

      {cue && (
        <div className="side-block">
          <p className="side-label">Cue</p>
          <p className="side-cue">{cue}</p>
        </div>
      )}

      {risks.map((r) => {
        const d = rep.deviations[r.metric];
        const def = cfg.metrics[r.metric];
        return (
          <div key={r.id} className={`side-block risk-note lvl-${d?.level || r.worst.level}`} {...hover(r.metric)}>
            <p className="side-label">Risk factor</p>
            <p className="risk-title">{r.title}</p>
            <p className="risk-line">
              {def.label}: {fmtRange(d.base, d.value, def)} on rep {rep.index}
              {r.firstRep !== rep.index ? `, first seen on rep ${r.firstRep}` : ''}
            </p>
            <p className="risk-body">{r.text}</p>
          </div>
        );
      })}

      <div className="side-foot">
        <p>
          Set score <strong>{analysis.setScore ?? '–'}</strong> · baseline {listReps(analysis.baselineReps)} ·{' '}
          {analysis.reps.length} of {input.plannedReps || analysis.reps.length} planned reps
        </p>
        <p>Measured from video. Not medical advice and can't diagnose injuries.</p>
      </div>
    </aside>
  );
}
