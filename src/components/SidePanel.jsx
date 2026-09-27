// The slim panel beside the video: the form gauge (whole set, or the rep
// picked on the strip), then the measures that moved most against the first
// reps, and a cue when one applies.

import { getExercise } from '../config/exercises/index.js';
import { fmt, fmtDelta, listReps } from '../lib/report/format.js';
import { painNotice } from '../lib/report/template.js';
import { useMetricHover } from './highlight.js';
import { repChanges } from './repFocus.js';
import FormGauge from './FormGauge.jsx';

const LEVEL_TEXT = { ok: "within your first reps' range", notable: 'notable change', major: 'major change' };
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

/** The cue for this rep: its worst form flag first, then its biggest change. */
function repCue(cfg, rep, flagged) {
  const rules = cfg.standards?.rules ?? [];
  for (const f of rep.form?.flags ?? []) {
    const key = f.kind === 'rule' ? rules.find((r) => r.id === f.ruleId)?.cue : f.metric;
    if (key && cfg.cues[key]) return cfg.cues[key];
  }
  return flagged.length ? cfg.cues[flagged[0].key] ?? null : null;
}

export default function SidePanel({ analysis, input, rep, reason, selectedRep, onWholeSet }) {
  const cfg = getExercise(analysis.exerciseId);
  const picked = selectedRep ? analysis.reps.find((r) => r.index === selectedRep) : null;
  // The gauge shows the whole set until a rep is picked on the strip.
  const reading = picked
    ? picked.form
      ? { severity: picked.severity, value: picked.form.value, caption: `Rep ${picked.index}`, reason: picked.form.reason.text }
      : { severity: 'unknown', value: null, caption: `Rep ${picked.index}`, reason: `${picked.excluded?.text || 'This rep could not be measured reliably'}, so it wasn't checked.` }
    : { severity: analysis.form.severity, value: analysis.form.value, caption: 'Whole set', reason: analysis.form.reason.text };

  const changes = rep?.scorable ? repChanges(analysis, rep) : [];
  const flagged = changes.filter((c) => c.flagged);
  const cue = !input.painReported && rep ? repCue(cfg, rep, flagged) : null;

  return (
    <aside className="side" aria-live="polite">
      {input.painReported && <p className="care-note">{painNotice()}</p>}

      <FormGauge
        severity={reading.severity}
        value={reading.value}
        caption={reading.caption}
        reason={reading.reason}
        action={
          picked ? (
            <button type="button" className="gauge-reset" onClick={onWholeSet}>
              Whole set
            </button>
          ) : null
        }
      />

      {rep && (
        <div className="side-head">
          <p className="side-eyebrow">
            Rep {rep.index}
            {rep.partial && rep.scorable && <span className="muted"> · partial</span>}
            {reason && <span className="muted"> · {reason}</span>}
          </p>
          {rep.partial && rep.scorable && <p className="side-note">Partial rep: less than {Math.round(cfg.reps.partialFrac * 100)}% of a typical rep's range.</p>}
        </div>
      )}

      {rep &&
        (!rep.scorable ? (
          <p className="side-note">{rep.excluded?.text || 'This rep could not be measured reliably.'} It is counted but not scored.</p>
        ) : (
          <>
            <p className="side-caption">
              {rep.isBaseline ? `One of your first reps, against their average (${listReps(analysis.baselineReps)})` : 'Biggest changes from your first reps'}
            </p>
            {changes.length ? (
              <ul className="mlist">
                {changes.map((c) => (
                  <MetricRow key={c.key} item={c} />
                ))}
              </ul>
            ) : (
              <p className="side-note">Every measure stayed within a few units of your first reps' average.</p>
            )}
          </>
        ))}

      {cue && (
        <div className="side-block">
          <p className="side-label">Cue</p>
          <p className="side-cue">{cue}</p>
        </div>
      )}

      <div className="side-foot">
        <p>
          Consistency <strong>{analysis.setScore ?? '–'}</strong>/100 · first {listReps(analysis.baselineReps)} ·{' '}
          {analysis.reps.length} of {input.plannedReps || analysis.reps.length} planned reps
        </p>
        <p>Measured from video. Not medical advice and can't diagnose injuries.</p>
      </div>
    </aside>
  );
}
