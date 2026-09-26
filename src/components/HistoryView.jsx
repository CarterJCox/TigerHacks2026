import { useMemo, useState } from 'react';
import { EXERCISES, EXERCISE_ORDER } from '../config/exercises/index.js';
import { clearHistory, deleteSession, getAllCounts, getHistory, toUnit } from '../lib/history.js';
import TrendChart from './TrendChart.jsx';
import EmptyState from './EmptyState.jsx';

export default function HistoryView({ initialExercise, onStart }) {
  const [exerciseId, setExerciseId] = useState(initialExercise || 'curl');
  const [version, setVersion] = useState(0);
  const [confirmClear, setConfirmClear] = useState(false);
  const counts = useMemo(() => getAllCounts(), [version]);
  const sessions = useMemo(() => getHistory(exerciseId), [exerciseId, version]);
  const ex = EXERCISES[exerciseId];

  // Chart everything in the unit of the most recent weighted session.
  const unit = [...sessions].reverse().find((s) => !s.bodyweight)?.unit || 'lb';
  const display = sessions.map((s) => ({ ...s, weightDisplay: toUnit(s.weight, s.unit, unit) }));
  const mixedUnits = new Set(sessions.filter((s) => !s.bodyweight).map((s) => s.unit)).size > 1;
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const others = EXERCISE_ORDER.filter((id) => id !== exerciseId && counts[id] > 0);

  return (
    <section className="history">
      <div className="section-head">
        <p className="eyebrow">History</p>
        <h1>Weight and form over time</h1>
        <p className="muted">Saved in this browser only. Each point is one analyzed set.</p>
      </div>

      <div className="history-tabs" role="tablist" aria-label="Exercise">
        {EXERCISE_ORDER.map((id) => (
          <button
            key={id}
            role="tab"
            aria-selected={exerciseId === id}
            className={exerciseId === id ? 'is-active' : ''}
            onClick={() => {
              setExerciseId(id);
              setConfirmClear(false);
            }}
          >
            {EXERCISES[id].shortName}
            <span className="count">{counts[id] || 0}</span>
          </button>
        ))}
      </div>

      {sessions.length === 0 ? (
        total === 0 ? (
          <EmptyState
            title="No sets saved yet"
            action={
              <button type="button" className="btn btn-primary btn-small" onClick={() => onStart(exerciseId)}>
                Analyze a set
              </button>
            }
          >
            Each set you analyze is saved here with its date, weight, reps, breakdown rep and form score, so you can see how weight and form
            move together over time. Nothing leaves this browser.
          </EmptyState>
        ) : (
          <EmptyState
            title={`No ${ex.shortName.toLowerCase()} sets yet`}
            action={
              <>
                {others.map((id) => (
                  <button key={id} type="button" className="btn btn-ghost btn-small" onClick={() => setExerciseId(id)}>
                    See {EXERCISES[id].shortName.toLowerCase()} ({counts[id]})
                  </button>
                ))}
                <button type="button" className="btn btn-ghost btn-small" onClick={() => onStart(exerciseId)}>
                  Analyze a {ex.shortName.toLowerCase()} set
                </button>
              </>
            }
          >
            Sets you analyze as {ex.name.toLowerCase()} will show up here.
          </EmptyState>
        )
      ) : (
        <>
          <div className="chart-card">
            <TrendChart sessions={display} unit={unit} />
            {mixedUnits && <p className="muted small">Weights logged in both lb and kg are shown in {unit}.</p>}
          </div>

          <div className="table-wrap" role="region" aria-label={`${ex.shortName} sessions`} tabIndex={0}>
            <table className="rep-table history-table">
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col" className="num">
                    Weight
                  </th>
                  <th scope="col" className="num">
                    Reps
                  </th>
                  <th scope="col">Form changed</th>
                  <th scope="col" className="num">
                    Score
                  </th>
                  <th scope="col">
                    <span className="visually-hidden">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {[...sessions].reverse().map((s) => (
                  <tr key={s.id}>
                    <td>{new Date(s.date).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</td>
                    <td className="num">{s.bodyweight ? 'BW' : `${s.weight} ${s.unit}`}</td>
                    <td className="num">
                      {s.reps}
                      {s.plannedReps ? <span className="muted">/{s.plannedReps}</span> : null}
                    </td>
                    <td>{s.breakdownRep ? `Rep ${s.breakdownRep}` : <span className="muted">Held</span>}</td>
                    <td className="num">{s.score ?? '–'}</td>
                    <td className="num">
                      <button
                        type="button"
                        className="link"
                        onClick={() => {
                          deleteSession(exerciseId, s.id);
                          setVersion((v) => v + 1);
                        }}
                        aria-label={`Remove the set from ${new Date(s.date).toLocaleString()}`}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="history-actions">
            {confirmClear ? (
              <>
                <span className="small">Remove all {sessions.length} saved {ex.shortName.toLowerCase()} sets?</span>
                <button
                  type="button"
                  className="btn btn-danger btn-small"
                  onClick={() => {
                    clearHistory(exerciseId);
                    setConfirmClear(false);
                    setVersion((v) => v + 1);
                  }}
                >
                  Remove all
                </button>
                <button type="button" className="btn btn-ghost btn-small" onClick={() => setConfirmClear(false)}>
                  Keep
                </button>
              </>
            ) : (
              <button type="button" className="link" onClick={() => setConfirmClear(true)}>
                Clear {ex.shortName.toLowerCase()} history
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
}
