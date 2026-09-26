import { EXERCISES } from '../config/exercises/index.js';

const STAGES = [
  { id: 'model', label: 'Loading the pose model' },
  { id: 'pose', label: 'Tracking your joints frame by frame' },
  { id: 'measure', label: 'Finding reps and comparing them' },
];

function fmtEta(sec) {
  if (!Number.isFinite(sec)) return null;
  if (sec < 5) return 'a few seconds left';
  if (sec < 60) return `about ${Math.round(sec / 5) * 5} s left`;
  return `about ${Math.round(sec / 60)} min left`;
}

export default function AnalyzingView({ progress, input, onCancel }) {
  const ex = EXERCISES[input.exerciseId];
  const stageIdx = Math.max(0, STAGES.findIndex((s) => s.id === progress?.stage));
  // Overall progress: model load is a small slice, pose tracking is most of it.
  const overall = progress?.stage === 'model' ? 0.03 : progress?.stage === 'pose' ? 0.05 + 0.9 * (progress.fraction || 0) : 0.97;
  const eta = progress?.stage === 'pose' ? fmtEta(progress.eta) : null;
  return (
    <section className="analyzing" aria-live="polite">
      <p className="eyebrow">{ex.name}</p>
      <h1>{input.sample ? 'Analyzing the sample set' : 'Analyzing your set'}</h1>
      <div className="progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(overall * 100)}>
        <span style={{ transform: `scaleX(${overall})` }} />
      </div>
      <div className="progress-meta">
        <span>{Math.round(overall * 100)}%</span>
        <span>{eta || ''}</span>
      </div>
      <ol className="stage-list">
        {STAGES.map((s, i) => (
          <li key={s.id} className={i < stageIdx ? 'is-done' : i === stageIdx ? 'is-current' : ''}>
            <span className="stage-dot" aria-hidden="true" />
            <span>
              {s.label}
              {s.id === 'pose' && progress?.stage === 'pose' && progress.total ? (
                <span className="muted">
                  {' '}
                  · frame {progress.done} of {progress.total}
                </span>
              ) : null}
            </span>
          </li>
        ))}
      </ol>
      <p className="muted small">Everything runs in this browser tab. Keep it open until the analysis finishes.</p>
      <button className="btn btn-ghost" onClick={onCancel}>
        Cancel
      </button>
    </section>
  );
}
