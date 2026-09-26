import { EXERCISES } from '../config/exercises/index.js';
import CameraGuide from './CameraGuide.jsx';

export default function RejectedView({ analysis, input, onRetry, onRetryAs }) {
  const ex = EXERCISES[input.exerciseId];
  const q = analysis.quality || {};
  const suggestion = analysis.issues.find((i) => i.suggestExercise)?.suggestExercise ?? null;
  return (
    <section className="rejected">
      <div className="rejected-main">
        <p className="eyebrow">{ex.name}</p>
        <h1>This video can't give a reliable report</h1>
        <p className="lede">
          Rather than guess, Spotter needs a clearer recording. Here is what got in the way, what it measured, and what to change before you film again.
        </p>
        <ul className="issue-list">
          {analysis.issues.map((issue) => (
            <li key={issue.code} className="issue">
              <h3>{issue.title}</h3>
              <p>{issue.message}</p>
              {issue.fix && (
                <p className="issue-fix">
                  <span className="issue-fix-label">What to change</span>
                  {issue.fix}
                </p>
              )}
            </li>
          ))}
        </ul>
        <dl className="facts">
          <div>
            <dt>Frames checked</dt>
            <dd>{q.frames ?? '–'}</dd>
          </div>
          <div>
            <dt>Frames with a person</dt>
            <dd>{Number.isFinite(q.poseFraction) ? `${Math.round(q.poseFraction * 100)}%` : '–'}</dd>
          </div>
          <div>
            <dt>Frames with all key joints clear</dt>
            <dd>{Number.isFinite(q.keyFraction) ? `${Math.round(q.keyFraction * 100)}%` : '–'}</dd>
          </div>
          {analysis.reps?.length > 0 && (
            <div>
              <dt>Reps found</dt>
              <dd>{analysis.reps.length}</dd>
            </div>
          )}
        </dl>
        <div className="actions">
          {suggestion && onRetryAs && (
            <button className="btn btn-primary" onClick={() => onRetryAs(suggestion)}>
              Analyze as {EXERCISES[suggestion].shortName.toLowerCase()}
            </button>
          )}
          <button className={`btn ${suggestion ? 'btn-ghost' : 'btn-primary'}`} onClick={onRetry}>
            Upload a different video
          </button>
        </div>
      </div>
      <aside className="rejected-guide">
        <CameraGuide exercise={ex} />
      </aside>
    </section>
  );
}
