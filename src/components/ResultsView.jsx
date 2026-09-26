import { useCallback, useMemo, useRef, useState } from 'react';
import { getExercise } from '../config/exercises/index.js';
import VideoPlayer from './VideoPlayer.jsx';
import RepChart from './RepChart.jsx';
import RepTable from './RepTable.jsx';
import CompareView, { comparisonPair } from './CompareView.jsx';
import EmptyState from './EmptyState.jsx';
import { STATUS } from './status.js';
import { HighlightContext, useMetricHover } from './highlight.js';
import { highlightFor } from './overlay.js';
import { changePhrase, fmt, fmtDelta, fmtLong, fmtRange, listReps } from '../lib/report/format.js';
import { painNotice } from '../lib/report/template.js';

const LEVEL_WORD = { notable: 'Notable', major: 'Major' };

function RepDetail({ analysis, repIndex, onPlay }) {
  const cfg = getExercise(analysis.exerciseId);
  const hover = useMetricHover();
  const rep = analysis.reps.find((r) => r.index === repIndex);
  if (!rep) {
    return (
      <div className="rep-detail rep-detail-empty">
        <p className="muted">Select a rep on the timeline, the chart or the table to see what changed compared with your baseline.</p>
      </div>
    );
  }
  const s = STATUS[rep.status] || STATUS.unknown;
  const changed = Object.entries(rep.deviations)
    .filter(([, d]) => d.level === 'notable' || d.level === 'major')
    .sort((a, b) => b[1].severity - a[1].severity);
  return (
    <div className={`rep-detail s-${rep.status}`}>
      <div className="rep-detail-head">
        <div>
          <p className="eyebrow">Rep {rep.index}</p>
          <h3>
            {rep.isBaseline ? 'Baseline rep' : s.long}
            {rep.score != null && <span className="rep-score"> · {rep.score}/100</span>}
          </h3>
        </div>
        <button type="button" className="btn btn-ghost btn-small" onClick={() => onPlay(rep.index)}>
          Replay
        </button>
      </div>
      {!rep.scorable && (
        <p className="muted small">
          {rep.truncated ? 'This rep is cut off by the start or end of the video, so it is not scored.' : `Tracking was clear in only ${Math.round(rep.confidence * 100)}% of this rep's frames, so it is not scored.`}
        </p>
      )}
      {rep.partial && <p className="small">Partial rep: it covered less than {Math.round(cfg.reps.partialFrac * 100)}% of a typical rep's range.</p>}
      {rep.scorable && !rep.isBaseline && !rep.partial && changed.length === 0 && <p className="small">Every measure stayed within your baseline range.</p>}
      {rep.isBaseline && <p className="small">One of the reps the rest of the set is compared against.</p>}
      {changed.length > 0 && (
        <ul className="change-list">
          {changed.map(([key, d]) => {
            const def = cfg.metrics[key];
            return (
              <li key={key} className={`lvl-${d.level}`} tabIndex={0} {...hover(key)}>
                <span className="change-level">{LEVEL_WORD[d.level]}</span>
                <span className="change-text">
                  <strong>{def.label}</strong>: {fmtRange(d.base, d.value, def)} ({fmtDelta(d, def)})
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <dl className="mini-facts">
        <div>
          <dt>{cfg.reps.concentricFirst ? 'Up' : 'Down'}</dt>
          <dd>{fmt(cfg.reps.concentricFirst ? rep.metrics.liftTime : rep.metrics.lowerTime, { unit: 's', decimals: 2 })}</dd>
        </div>
        <div>
          <dt>Hold</dt>
          <dd>{fmt(rep.holdTime, { unit: 's', decimals: 2 })}</dd>
        </div>
        <div>
          <dt>{cfg.reps.concentricFirst ? 'Down' : 'Up'}</dt>
          <dd>{fmt(cfg.reps.concentricFirst ? rep.metrics.lowerTime : rep.metrics.liftTime, { unit: 's', decimals: 2 })}</dd>
        </div>
        <div>
          <dt>Tracking</dt>
          <dd>{Math.round(rep.confidence * 100)}%</dd>
        </div>
      </dl>
    </div>
  );
}

function RiskList({ analysis, onRep }) {
  const cfg = getExercise(analysis.exerciseId);
  const hover = useMetricHover();
  if (!analysis.risks.length) {
    return (
      <EmptyState compact title="No risk patterns in this set">
        None of the measured patterns linked to extra strain moved past its threshold compared with your baseline reps.
      </EmptyState>
    );
  }
  return (
    <ul className="risk-list">
      {analysis.risks.map((r) => {
        const def = cfg.metrics[r.metric];
        const others = r.reps.filter((i) => i !== r.firstRep);
        return (
          <li key={r.id} className={`risk lvl-${r.worst.level}`} {...hover(r.metric)}>
            <div className="risk-head">
              <h3>{r.title}</h3>
              <button type="button" className="chip" onClick={() => onRep(r.firstRep)}>
                Rep {r.firstRep}
              </button>
            </div>
            <p className="risk-evidence">
              <span className="evidence-label">{def.label}</span>: {fmtRange(r.first.base, r.first.value, def)} from baseline to rep {r.firstRep} (
              {fmtDelta(r.first, def)})
              {r.worstRep !== r.firstRep && (
                <>
                  ; largest on rep {r.worstRep} at {fmt(r.worst.value, def)}
                </>
              )}
              {others.length > 0 && <>. Also on {listReps(others)}</>}.
            </p>
            <p className="risk-text">{r.text}</p>
          </li>
        );
      })}
    </ul>
  );
}

export default function ResultsView({ analysis, input, report, llmPending, prepared, onNewSet, onHistory }) {
  const cfg = getExercise(analysis.exerciseId);
  const playerRef = useRef(null);
  const [selectedRep, setSelectedRep] = useState(analysis.breakdown?.rep ?? null);
  // Playback settings shared by the main player and the side-by-side.
  const [rate, setRate] = useState(1);
  const [showSkeleton, setShowSkeleton] = useState(true);
  const [loop, setLoop] = useState(false);
  const [highlightMetric, setHighlightMetric] = useState(null);
  const highlight = useMemo(() => highlightFor(analysis, highlightMetric), [analysis, highlightMetric]);
  const pair = useMemo(() => comparisonPair(analysis), [analysis]);
  const playRep = useCallback((index) => {
    setSelectedRep(index);
    playerRef.current?.playRep(index);
    const stage = document.querySelector('.player');
    if (stage && stage.getBoundingClientRect().top < 0) stage.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  const scorable = analysis.reps.filter((r) => r.scorable);
  const weightText = input.weightLabel || (input.bodyweight ? 'Bodyweight' : `${input.weight} ${input.unit}`);
  const date = useMemo(() => new Date().toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }), []);
  const causesLine = analysis.breakdown?.causes
    ?.slice(0, 3)
    .map((c) => changePhrase(c.key, c, cfg.metrics[c.key]))
    .join('; ');

  return (
    <HighlightContext.Provider value={setHighlightMetric}>
    <article className="results">
      <header className="results-head">
        <div className="results-meta">
          <p className="eyebrow">
            {cfg.name} · {weightText} · {date}
            {input.sample && <span className="tag tag-sample">Sample video</span>}
          </p>
          <h1 className={`headline ${llmPending ? '' : 'is-final'}`} key={report.headline}>
            {report.headline}
          </h1>
          <p className="summary" key={report.summary}>
            {report.summary}
          </p>
          <p className="source muted small">
            {report.source === 'llm' ? 'Written by Claude from the measurements below.' : 'Written from the measurements below.'}
            {llmPending && <span className="pending"> Checking for a written summary…</span>}
          </p>
        </div>
        <dl className="stat-row">
          <div className="stat">
            <dt>Reps counted</dt>
            <dd>
              {analysis.reps.length}
              <span className="stat-sub">of {input.plannedReps} planned</span>
            </dd>
          </div>
          <div className="stat">
            <dt>Form held through</dt>
            <dd>
              {analysis.breakdown ? `Rep ${analysis.breakdown.rep - 1}` : 'Every rep'}
              <span className="stat-sub">
                {analysis.breakdown
                  ? `changed at rep ${analysis.breakdown.rep}`
                  : analysis.isolated.length
                    ? `apart from ${analysis.isolated.length === 1 ? 'one brief change' : `${analysis.isolated.length} brief changes`}`
                    : `${scorable.length} scored`}
              </span>
            </dd>
          </div>
          <div className="stat">
            <dt>Set score</dt>
            <dd>
              {analysis.setScore ?? '–'}
              <span className="stat-sub">average of scored reps</span>
            </dd>
          </div>
          <div className="stat">
            <dt>Baseline</dt>
            <dd>
              {listReps(analysis.baselineReps).replace(/^reps? /, '')}
              <span className="stat-sub">{analysis.baselineReps.length === 1 ? 'first clean rep' : 'first clean reps'}</span>
            </dd>
          </div>
        </dl>
      </header>

      {input.painReported && (
        <div className="notice notice-care" role="note">
          {painNotice()}
        </div>
      )}

      <section className="results-grid">
        <div className="results-video">
          <VideoPlayer
            ref={playerRef}
            src={prepared?.url}
            rotation={prepared?.rotation || 0}
            analysis={analysis}
            selectedRep={selectedRep}
            onSelectRep={setSelectedRep}
            rate={rate}
            onRate={setRate}
            showSkeleton={showSkeleton}
            onToggleSkeleton={() => setShowSkeleton((s) => !s)}
            loop={loop}
            onToggleLoop={() => setLoop((l) => !l)}
            highlight={highlight}
          />
        </div>
        <aside className="results-side">
          <RepDetail analysis={analysis} repIndex={selectedRep} onPlay={playRep} />
          {analysis.breakdown && (
            <div className="breakdown-card">
              <p className="eyebrow">Breakdown point</p>
              <p className="breakdown-rep">Rep {analysis.breakdown.rep}</p>
              <p className="small">{causesLine ? `${causesLine[0].toUpperCase()}${causesLine.slice(1)}.` : ''}</p>
            </div>
          )}
        </aside>
      </section>

      <section className="section" aria-labelledby="compare-title">
        <div className="section-head">
          <h2 id="compare-title">
            {pair ? `Baseline rep ${pair.baseline.index} vs. ${pair.kind === 'breakdown' ? 'breakdown' : 'last'} rep ${pair.other.index}` : 'Baseline vs. later reps'}
          </h2>
          <p className="muted">
            {pair?.kind === 'last'
              ? 'No breakdown point was found, so your most typical baseline rep is shown next to your last rep. Both start together from the beginning of each rep.'
              : 'Your most typical baseline rep next to the rep where form changed. Both start together from the beginning of each rep.'}
          </p>
        </div>
        <CompareView
          analysis={analysis}
          src={prepared?.url}
          rotation={prepared?.rotation || 0}
          rate={rate}
          onRate={setRate}
          showSkeleton={showSkeleton}
          onToggleSkeleton={() => setShowSkeleton((s) => !s)}
          highlight={highlight}
        />
      </section>

      <section className="section">
        <RepChart analysis={analysis} selectedRep={selectedRep} onRep={playRep} />
      </section>

      <section className="section" aria-labelledby="breakdown-title">
        <div className="section-head">
          <h2 id="breakdown-title">Rep by rep</h2>
          <p className="muted">
            Each rep's measurements, with the change from your baseline average underneath. Highlighted cells crossed a threshold. Select a row to replay it.
          </p>
        </div>
        <RepTable analysis={analysis} selectedRep={selectedRep} onRep={playRep} />
      </section>

      <div className="two-col">
        <section className="section" aria-labelledby="risk-title">
          <div className="section-head">
            <h2 id="risk-title">Risk factors</h2>
            <p className="muted">Movement patterns linked to extra strain, each tied to the rep and number that triggered it. These are not diagnoses.</p>
          </div>
          <RiskList analysis={analysis} onRep={playRep} />
        </section>

        <section className="section" aria-labelledby="cue-title">
          <div className="section-head">
            <h2 id="cue-title">Coaching cues</h2>
            <p className="muted">About movement only. What to load next time is your call.</p>
          </div>
          {input.painReported ? (
            <p className="muted">Not shown, because you reported pain with this set.</p>
          ) : (
            <ul className="cue-list">
              {report.cues.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="section">
        <details className="method">
          <summary>How this was measured</summary>
          <div className="method-body">
            <dl className="facts">
              <div>
                <dt>Camera view</dt>
                <dd>{cfg.viewLabel}</dd>
              </div>
              {analysis.ctx.view === 'side' && (
                <div>
                  <dt>Side measured</dt>
                  <dd>
                    Your {analysis.ctx.side} side (nearest the camera), facing {analysis.ctx.facing > 0 ? 'right' : 'left'} in the frame
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
            <h3>What each number means</h3>
            <ul className="metric-notes">
              {Object.entries(cfg.metrics).map(([k, def]) => (
                <MetricNote key={k} metricKey={k}>
                  <strong>{def.label}</strong> <span className={`rel rel-${def.reliability}`}>{def.reliability} reliability</span>
                  <br />
                  <span className="muted">{def.description}</span>{' '}
                  <span className="muted">
                    Flagged when a rep goes{' '}
                    {def.mode === 'relative' ? `${Math.round(def.notable * 100)}% of the baseline average` : fmtLong(def.notable, def)} beyond your baseline
                    range (major at {def.mode === 'relative' ? `${Math.round(def.major * 100)}%` : fmtLong(def.major, def)}).
                  </span>
                </MetricNote>
              ))}
            </ul>
            <h3>Limits of a 2-D video</h3>
            <ul className="metric-notes">
              {cfg.limitations.map((l) => (
                <li key={l} className="muted">
                  {l}
                </li>
              ))}
              <li className="muted">Angles are measured in the camera's image plane, so movement toward or away from the camera is underestimated.</li>
            </ul>
          </div>
        </details>
      </section>

      <div className="results-actions">
        <button className="btn btn-primary" onClick={onNewSet}>
          Analyze another set
        </button>
        <button className="btn btn-ghost" onClick={onHistory}>
          View {cfg.shortName.toLowerCase()} history
        </button>
      </div>

      <p className="disclaimer">
        Spotter measures movement from video. It is not medical advice and cannot diagnose injuries.
      </p>
    </article>
    </HighlightContext.Provider>
  );
}

function MetricNote({ metricKey, children }) {
  const hover = useMetricHover();
  return <li {...hover(metricKey)}>{children}</li>;
}
