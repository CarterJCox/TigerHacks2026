import { useRef, useState } from 'react';
import { EXERCISES, EXERCISE_ORDER } from '../config/exercises/index.js';
import CameraGuide from './CameraGuide.jsx';
import { prepareVideo, VideoLoadError } from '../lib/video/load.js';
import TrimControl, { MAX_ANALYSIS_SEC } from './TrimControl.jsx';
import { mentionsPain } from '../lib/report/safety.js';
import { SAMPLE } from '../config/sample.js';
import { weightFor } from '../lib/prefs.js';

function validate(input) {
  const errors = {};
  const cfg = EXERCISES[input.exerciseId];
  if (!(cfg.allowBodyweight && input.bodyweight)) {
    const w = Number(input.weight);
    if (!input.weight || !Number.isFinite(w) || w <= 0) {
      errors.weight = 'Enter the weight you used.';
    }
    else if (w > 1000) {
      errors.weight = 'You are not lifting 1000 pounds bro.';
    }
  }
  const r = Number(input.plannedReps);
  if (!input.plannedReps || !Number.isInteger(r) || r < 1) {
    errors.plannedReps = 'Enter how many reps you planned.';
  }
  else if (r > 50) {
    errors.plannedReps = '50 Reps!? Lower the count.';
  }
  return errors;
}

export default function SetupView({ input, onInputChange, onAnalyze, initialPrepared, onDiscardPrepared, error, onDismissError }) {
  const [touched, setTouched] = useState(false);
  const [prepared, setPrepared] = useState(initialPrepared);
  const [userRotation, setUserRotation] = useState(0);
  const [trim, setTrim] = useState(initialPrepared?.trim ?? null);
  const [loadState, setLoadState] = useState({ status: initialPrepared ? 'ready' : 'idle' });
  const [dragOver, setDragOver] = useState(false);
  const [sampleState, setSampleState] = useState(null); // null | 'loading' | error message
  const fileInputRef = useRef(null);
  const exercise = EXERCISES[input.exerciseId];
  const errors = validate(input);
  const painFromNotes = mentionsPain(input.notes);

  const set = (patch) => onInputChange({ ...input, ...patch });
  const trimTooLong = Boolean(prepared) && (trim ? trim.end - trim.start : prepared.duration) > MAX_ANALYSIS_SEC;

  async function handleFile(file) {
    if (!file) { 
      return;
    }
    onDismissError?.();
    if (prepared) {
      onDiscardPrepared?.();
      if (prepared !== initialPrepared) {
        URL.revokeObjectURL(prepared.url);
      }
    }
    setPrepared(null);
    setUserRotation(0);
    setTrim(null);
    setLoadState({ status: 'loading', message: 'Reading video', file: file.name });
    try {
      const p = await prepareVideo(file, {
        onStatus: (message) => setLoadState((s) => ({ ...s, status: 'loading', message })),
        onConvertProgress: (fraction) => setLoadState((s) => ({ ...s, convert: fraction })),
      });
      p.fileName = file.name;
      setPrepared(p);
      // Long recordings start trimmed to the first 3 minutes; the rest is optional.
      setTrim(p.duration > MAX_ANALYSIS_SEC ? { start: 0, end: MAX_ANALYSIS_SEC } : null);
      setLoadState({ status: 'ready' });
    } catch (err) {
      console.error(err);
      setLoadState({
        status: 'error',
        message: err instanceof VideoLoadError ? err.message : 'This video could not be opened.',
        detail: err instanceof VideoLoadError ? err.detail : err?.message,
      });
    }
  }

  // Loads the bundled demo clip and runs the normal analysis on it.
  async function trySample() {
    if (sampleState === 'loading') return;
    onDismissError?.();
    setSampleState('loading');
    try {
      const res = await fetch(SAMPLE.url);
      if (!res.ok) throw new Error(`The sample video is missing (${res.status}).`);
      const blob = await res.blob();
      const file = new File([blob], SAMPLE.fileName, { type: blob.type || 'video/mp4' });
      const p = await prepareVideo(file);
      p.fileName = SAMPLE.fileName;
      setSampleState(null);
      onAnalyze({ ...SAMPLE.input }, p);
    } catch (err) {
      console.error(err);
      setSampleState(err?.message || 'The sample video could not be loaded.');
    }
  }

  function submit(e) {
    e.preventDefault();
    setTouched(true);
    if (Object.keys(errors).length || !prepared || trimTooLong) return;
    const final = {
      ...input,
      painReported: input.painReported || painFromNotes,
      weight: exercise.allowBodyweight && input.bodyweight ? 0 : Number(input.weight),
      plannedReps: Number(input.plannedReps),
    };
    onAnalyze(final, { ...prepared, rotation: (prepared.rotation + userRotation) % 360, trim });
  }

  const canAnalyze = prepared && !Object.keys(errors).length && !trimTooLong;

  return (
    <form className="setup" onSubmit={submit} noValidate>
      <div className="setup-intro">
        <h1>
          See the rep where your form <em>changed</em>.
        </h1>
        <p>
          Spotter compares every rep in a set against your own first reps and shows where, and by how much, the movement drifted. It
          describes what happened. Decisions about weight stay with you.
        </p>
        <div className="sample-row">
          <button type="button" className="btn btn-secondary" onClick={trySample} disabled={sampleState === 'loading'} aria-busy={sampleState === 'loading'}>
            {sampleState === 'loading' ? 'Loading sample…' : 'Try a sample'}
          </button>
          <p className="sample-note">
            <strong>{SAMPLE.title}.</strong> {SAMPLE.description} Runs the full analysis on this device.
          </p>
        </div>
        {sampleState && sampleState !== 'loading' && (
          <p className="field-error" role="alert">
            {sampleState}
          </p>
        )}
      </div>

      {error && (
        <div className="notice notice-error" role="alert">
          <strong>Analysis stopped.</strong> {error}
          <button type="button" className="link" onClick={onDismissError}>
            Dismiss
          </button>
        </div>
      )}

      <div className="setup-grid">
        <div className="setup-col">
          <fieldset className="panel">
            <legend className="panel-title">Exercise</legend>
            <div className="exercise-list" role="radiogroup">
              {EXERCISE_ORDER.map((id) => {
                const ex = EXERCISES[id];
                const active = input.exerciseId === id;
                return (
                  <label key={id} className={`exercise-option ${active ? 'is-active' : ''}`}>
                    <input
                      type="radio"
                      name="exercise"
                      value={id}
                      checked={active}
                      onChange={() => {
                        // Pre-fill the weight last used for this exercise.
                        const w = weightFor(id);
                        set(
                          w
                            ? { exerciseId: id, weight: w.weight ?? '', unit: w.unit === 'kg' ? 'kg' : 'lb', bodyweight: ex.allowBodyweight ? Boolean(w.bodyweight) : false }
                            : { exerciseId: id, bodyweight: ex.allowBodyweight ? input.bodyweight : false },
                        );
                      }}
                    />
                    <span className="exercise-name">{ex.name}</span>
                    <span className="exercise-view">{ex.viewLabel}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          <fieldset className="panel">
            <legend className="panel-title">The set</legend>
            <div className="field-row">
              <div className="field">
                <label htmlFor="weight">Weight {exercise.id === 'curl' || exercise.id === 'press' ? '(per dumbbell)' : ''}</label>
                <div className="input-group">
                  <input
                    id="weight"
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="0.5"
                    value={exercise.allowBodyweight && input.bodyweight ? '' : input.weight}
                    placeholder={exercise.allowBodyweight && input.bodyweight ? 'Bodyweight' : '0'}
                    disabled={exercise.allowBodyweight && input.bodyweight}
                    onChange={(e) => set({ weight: e.target.value })}
                    aria-invalid={touched && Boolean(errors.weight)}
                    aria-describedby="weight-error"
                  />
                  <div className="segmented" role="group" aria-label="Weight unit">
                    {['lb', 'kg'].map((u) => (
                      <button
                        type="button"
                        key={u}
                        className={input.unit === u ? 'is-active' : ''}
                        aria-pressed={input.unit === u}
                        onClick={() => set({ unit: u })}
                        disabled={exercise.allowBodyweight && input.bodyweight}
                      >
                        {u}
                      </button>
                    ))}
                  </div>
                </div>
                {exercise.allowBodyweight && (
                  <label className="check">
                    <input type="checkbox" checked={input.bodyweight} onChange={(e) => set({ bodyweight: e.target.checked })} />
                    <span>Bodyweight only</span>
                  </label>
                )}
                {touched && errors.weight && (
                  <p className="field-error" id="weight-error">
                    {errors.weight}
                  </p>
                )}
              </div>
              <div className="field field-narrow">
                <label htmlFor="reps">Planned reps</label>
                <input
                  id="reps"
                  type="number"
                  inputMode="numeric"
                  min="1"
                  max="100"
                  step="1"
                  value={input.plannedReps}
                  placeholder="0"
                  onChange={(e) => set({ plannedReps: e.target.value })}
                  aria-invalid={touched && Boolean(errors.plannedReps)}
                />
                {touched && errors.plannedReps && <p className="field-error">{errors.plannedReps}</p>}
              </div>
            </div>

            <div className="field">
              <span className="label" id="pain-label">
                Any pain during or after this set?
              </span>
              <div className="segmented segmented-wide" role="radiogroup" aria-labelledby="pain-label">
                <button type="button" role="radio" aria-checked={!input.painReported} className={!input.painReported ? 'is-active' : ''} onClick={() => set({ painReported: false })}>
                  No
                </button>
                <button type="button" role="radio" aria-checked={input.painReported} className={input.painReported ? 'is-active' : ''} onClick={() => set({ painReported: true })}>
                  Yes
                </button>
              </div>
            </div>
            <div className="field">
              <label htmlFor="notes">Notes (optional)</label>
              <textarea id="notes" rows={2} value={input.notes} placeholder="Anything about how the set felt" onChange={(e) => set({ notes: e.target.value })} />
            </div>
            {(input.painReported || painFromNotes) && (
              <div className="notice notice-care" role="status">
                Pain while lifting is worth getting checked by a doctor or physical therapist before you train this movement again. Spotter
                will still show what the video measured, without coaching cues.
              </div>
            )}
          </fieldset>
        </div>

        <div className="setup-col">
          <CameraGuide exercise={exercise} />

          <section className="panel upload-panel" aria-labelledby="upload-title">
            <h3 id="upload-title" className="panel-title">
              Video
            </h3>
            {!prepared && loadState.status !== 'loading' && (
              <div
                className={`dropzone ${dragOver ? 'is-over' : ''}`}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  handleFile(e.dataTransfer.files?.[0]);
                }}
              >
                <p className="dropzone-title">Drop a video of one set here</p>
                <p className="dropzone-sub">MP4 or MOV, including iPhone HEVC. Up to 3 minutes.</p>
                <button type="button" className="btn btn-secondary" onClick={() => fileInputRef.current?.click()}>
                  Choose video
                </button>
              </div>
            )}
            <input
              ref={fileInputRef}
              className="visually-hidden"
              type="file"
              accept="video/*,.mov,.mp4,.m4v,.webm"
              data-testid="video-input"
              onChange={(e) => {
                handleFile(e.target.files?.[0]);
                e.target.value = '';
              }}
            />

            {loadState.status === 'loading' && (
              <div className="loading-card" role="status">
                <div className="spinner" aria-hidden="true" />
                <div>
                  <p className="loading-title">{loadState.message}</p>
                  {Number.isFinite(loadState.convert) ? (
                    <>
                      <div className="bar" aria-hidden="true">
                        <span style={{ transform: `scaleX(${loadState.convert})` }} />
                      </div>
                      <p className="muted small">
                        Your browser can't play this format directly, so it's being converted here on your device. {Math.round(loadState.convert * 100)}%
                      </p>
                    </>
                  ) : (
                    <p className="muted small">{loadState.file}</p>
                  )}
                </div>
              </div>
            )}

            {loadState.status === 'error' && (
              <div className="notice notice-error" role="alert">
                <strong>{loadState.message}</strong>
                {loadState.detail && <p className="small">{loadState.detail}</p>}
              </div>
            )}

            {prepared && (
              <div className="preview">
                <TrimControl prepared={prepared} rotation={(prepared.rotation + userRotation) % 360} trim={trim} onChange={setTrim}>
                  <div className="preview-meta">
                    <div>
                      <p className="preview-name">{prepared.fileName || 'Video'}</p>
                      <p className="muted small">
                        {prepared.duration.toFixed(1)} s{prepared.transcoded ? ' · converted on this device' : ''}
                      </p>
                    </div>
                    <div className="preview-actions">
                      <button type="button" className="btn btn-ghost" onClick={() => setUserRotation((r) => (r + 90) % 360)}>
                        Rotate
                      </button>
                      <button type="button" className="btn btn-ghost" onClick={() => fileInputRef.current?.click()}>
                        Replace
                      </button>
                    </div>
                  </div>
                  <p className="muted small">If the preview is sideways, use Rotate until you are upright.</p>
                </TrimControl>
              </div>
            )}
          </section>

          <div className="submit-row">
            <button type="submit" className="btn btn-primary btn-large" disabled={touched && !canAnalyze} aria-disabled={!canAnalyze}>
              Analyze set
            </button>
            {touched && !prepared && <p className="field-error">Add a video of your set first.</p>}
            {touched && prepared && Object.keys(errors).length > 0 && <p className="field-error">Fill in the set details above.</p>}
          </div>
        </div>
      </div>
    </form>
  );
}
