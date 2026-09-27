// The home screen, one screen with no scrolling: pick the exercise, fill in
// the set in one slim row, then record or upload in the drop zone, which
// becomes the trim preview once there's a video. Recording opens the
// full-screen camera on top of this screen.

import { useRef, useState } from 'react';
import { EXERCISES, EXERCISE_ORDER } from '../config/exercises/index.js';
import { prepareVideo, VideoLoadError } from '../lib/video/load.js';
import TrimControl, { MAX_ANALYSIS_SEC, MIN_TRIM_SEC } from './TrimControl.jsx';
import RecordView from './RecordView.jsx';
import { weightFor, getMuted, setMuted } from '../lib/prefs.js';
import { unlockAudio } from '../lib/live/audio.js';

function validate(input) {
  const errors = {};
  const cfg = EXERCISES[input.exerciseId];
  if (!(cfg.allowBodyweight && input.bodyweight)) {
    const w = Number(input.weight);
    if (!input.weight || !Number.isFinite(w) || w <= 0) errors.weight = 'Enter the weight you used.';
    else if (w > 1000) errors.weight = 'That weight looks too high. Check the number.';
  }
  const r = Number(input.plannedReps);
  if (!input.plannedReps || !Number.isInteger(r) || r < 1) errors.plannedReps = 'Enter how many reps you planned.';
  else if (r > 50) errors.plannedReps = 'Enter 50 reps or fewer.';
  return errors;
}

export default function SetupView({ input, onInputChange, onAnalyze, initialPrepared, onDiscardPrepared, error, onDismissError }) {
  const [touched, setTouched] = useState(false);
  const [prepared, setPrepared] = useState(initialPrepared);
  const [userRotation, setUserRotation] = useState(0);
  const [trim, setTrim] = useState(initialPrepared?.trim ?? null);
  const [loadState, setLoadState] = useState({ status: initialPrepared ? 'ready' : 'idle' });
  const [dragOver, setDragOver] = useState(false);
  const [recording, setRecording] = useState(false);
  const [muted, setMutedState] = useState(getMuted);
  const fileInputRef = useRef(null);
  const exercise = EXERCISES[input.exerciseId];
  const errors = validate(input);

  const set = (patch) => onInputChange({ ...input, ...patch });
  const trimTooLong = Boolean(prepared) && (trim ? trim.end - trim.start : prepared.duration) > MAX_ANALYSIS_SEC;
  const bodyweight = exercise.allowBodyweight && input.bodyweight;

  function releasePrepared() {
    if (!prepared) return;
    onDiscardPrepared?.();
    if (prepared !== initialPrepared) URL.revokeObjectURL(prepared.url);
  }

  /** Loads an uploaded or recorded file into the preview. `extra`: { liveAlerts, trimEnd, recorded }. */
  async function handleFile(file, extra = {}) {
    if (!file) return;
    onDismissError?.();
    releasePrepared();
    setPrepared(null);
    setUserRotation(0);
    setTrim(null);
    setLoadState({ status: 'loading', message: extra.recorded ? 'Opening your recording' : 'Reading video', file: file.name });
    try {
      const p = await prepareVideo(file, {
        onStatus: (message) => setLoadState((s) => ({ ...s, status: 'loading', message })),
        onConvertProgress: (fraction) => setLoadState((s) => ({ ...s, convert: fraction })),
      });
      p.fileName = extra.recorded ? 'Your recording' : file.name;
      p.recorded = Boolean(extra.recorded);
      p.liveAlerts = extra.liveAlerts ?? [];
      setPrepared(p);
      // Long videos start trimmed to the first 3 minutes. A hands-free stop
      // trims off the walk back to the camera.
      let next = null;
      if (Number.isFinite(extra.trimEnd) && extra.trimEnd >= MIN_TRIM_SEC && extra.trimEnd < p.duration - 0.3) next = { start: 0, end: extra.trimEnd };
      if (p.duration > MAX_ANALYSIS_SEC) next = { start: 0, end: Math.min(next?.end ?? Infinity, MAX_ANALYSIS_SEC) };
      setTrim(next);
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

  function openRecorder() {
    // Browsers only allow sound after a tap; this is the tap.
    unlockAudio();
    onDismissError?.();
    setRecording(true);
  }

  function submit(e) {
    e.preventDefault();
    setTouched(true);
    if (Object.keys(errors).length || !prepared || trimTooLong) return;
    const final = {
      ...input,
      weight: bodyweight ? 0 : Number(input.weight),
      plannedReps: Number(input.plannedReps),
    };
    onAnalyze(final, { ...prepared, rotation: (prepared.rotation + userRotation) % 360, trim });
  }

  const canAnalyze = prepared && !Object.keys(errors).length && !trimTooLong;
  const dropHandlers = {
    onDragOver: (e) => {
      if (!e.dataTransfer?.types?.includes('Files')) return;
      e.preventDefault();
      setDragOver(true);
    },
    onDragLeave: (e) => {
      if (!e.currentTarget.contains(e.relatedTarget)) setDragOver(false);
    },
    onDrop: (e) => {
      e.preventDefault();
      setDragOver(false);
      handleFile(e.dataTransfer.files?.[0]);
    },
  };

  return (
    <form className="home" onSubmit={submit} noValidate {...dropHandlers}>
      <div className="home-top">
        <div className="ex-picker" role="radiogroup" aria-label="Exercise">
          {EXERCISE_ORDER.map((id) => {
            const ex = EXERCISES[id];
            const active = input.exerciseId === id;
            return (
              <label key={id} className={`ex-option ${active ? 'is-active' : ''}`}>
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
                <span className="ex-name">{ex.shortName}</span>
                <span className="ex-view">{ex.viewLabel}</span>
              </label>
            );
          })}
        </div>

        <div className="set-row">
          <label className={`set-field ${touched && errors.weight ? 'is-invalid' : ''}`}>
            <span className="set-label">Weight{exercise.id === 'curl' || exercise.id === 'press' ? ' per dumbbell' : ''}</span>
            <input
              id="weight"
              type="number"
              inputMode="decimal"
              min="0"
              step="0.5"
              value={bodyweight ? '' : input.weight}
              placeholder={bodyweight ? 'Bodyweight' : '0'}
              disabled={bodyweight}
              onChange={(e) => set({ weight: e.target.value })}
              aria-invalid={touched && Boolean(errors.weight)}
            />
          </label>
          <div className="segmented segmented-small" role="group" aria-label="Weight unit">
            {['lb', 'kg'].map((u) => (
              <button type="button" key={u} className={input.unit === u ? 'is-active' : ''} aria-pressed={input.unit === u} onClick={() => set({ unit: u })} disabled={bodyweight}>
                {u}
              </button>
            ))}
          </div>
          {exercise.allowBodyweight && (
            <label className="check set-check">
              <input type="checkbox" checked={input.bodyweight} onChange={(e) => set({ bodyweight: e.target.checked })} />
              <span>Bodyweight</span>
            </label>
          )}
          <span className="set-sep" aria-hidden="true" />
          <label className={`set-field set-field-reps ${touched && errors.plannedReps ? 'is-invalid' : ''}`}>
            <span className="set-label">Planned reps</span>
            <input
              id="reps"
              type="number"
              inputMode="numeric"
              min="1"
              max="50"
              step="1"
              value={input.plannedReps}
              placeholder="0"
              onChange={(e) => set({ plannedReps: e.target.value })}
              aria-invalid={touched && Boolean(errors.plannedReps)}
            />
          </label>
          <span className="set-sep" aria-hidden="true" />
          <div className="set-field set-pain">
            <span className="set-label" id="pain-label">
              Pain or injury?
            </span>
            <div className="segmented segmented-small" role="radiogroup" aria-labelledby="pain-label">
              <button type="button" role="radio" aria-checked={!input.painReported} className={!input.painReported ? 'is-active' : ''} onClick={() => set({ painReported: false })}>
                No
              </button>
              <button type="button" role="radio" aria-checked={input.painReported} className={input.painReported ? 'is-active' : ''} onClick={() => set({ painReported: true })}>
                Yes
              </button>
            </div>
          </div>
        </div>
        {input.painReported && (
          <p className="home-care" role="status">
            Pain while lifting is worth having checked by a doctor or physical therapist. Spotter will still show what the video measured, without coaching cues.
          </p>
        )}
      </div>

      {error && (
        <p className="home-error" role="alert">
          <strong>Analysis stopped.</strong> {error}{' '}
          <button type="button" className="link" onClick={onDismissError}>
            Dismiss
          </button>
        </p>
      )}

      <section className={`home-stage ${dragOver ? 'is-over' : ''} ${prepared ? 'has-video' : ''}`} aria-label="Your video">
        {!prepared && loadState.status !== 'loading' && (
          <div className="drop">
            <p className="drop-title">Record your set or bring a video</p>
            <div className="drop-actions">
              <button type="button" className="btn btn-primary btn-big" onClick={openRecorder}>
                <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
                  <circle cx="10" cy="10" r="6" fill="currentColor" />
                </svg>
                Record
              </button>
              <button type="button" className="btn btn-secondary btn-big" onClick={() => fileInputRef.current?.click()}>
                <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
                  <path d="M10 14 V4 M5.5 8.5 L10 4 L14.5 8.5 M4 16 H16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Upload video
              </button>
            </div>
            <p className="drop-sub">
              {dragOver ? 'Drop it to open it.' : 'Or drop a video here. MP4, MOV or WebM, up to 3 minutes. Analyzed on this device; the video is never uploaded.'}
            </p>
            {loadState.status === 'error' && (
              <div className="drop-error" role="alert">
                <strong>{loadState.message}</strong>
                {loadState.detail && <p className="small">{loadState.detail}</p>}
              </div>
            )}
          </div>
        )}

        {loadState.status === 'loading' && (
          <div className="drop" role="status">
            <div className="spinner" aria-hidden="true" />
            <p className="drop-title drop-title-small">{loadState.message}</p>
            {Number.isFinite(loadState.convert) ? (
              <>
                <div className="bar drop-bar" aria-hidden="true">
                  <span style={{ transform: `scaleX(${loadState.convert})` }} />
                </div>
                <p className="drop-sub">Your browser can't play this format directly, so it's being converted here on your device. {Math.round(loadState.convert * 100)}%</p>
              </>
            ) : (
              <p className="drop-sub">{loadState.file}</p>
            )}
          </div>
        )}

        {prepared && (
          <TrimControl prepared={prepared} rotation={(prepared.rotation + userRotation) % 360} trim={trim} onChange={setTrim}>
            <div className="preview-meta">
              <div>
                <p className="preview-name">{prepared.fileName || 'Video'}</p>
                <p className="muted small">
                  {prepared.duration.toFixed(1)} s{prepared.transcoded ? ' · converted on this device' : ''}
                  {prepared.liveAlerts?.length ? ` · ${prepared.liveAlerts.length} stop signal${prepared.liveAlerts.length === 1 ? '' : 's'} during the set` : ''}
                </p>
              </div>
              <div className="preview-actions">
                {!prepared.recorded && (
                  <button type="button" className="btn btn-ghost btn-small" onClick={() => setUserRotation((r) => (r + 90) % 360)}>
                    Rotate
                  </button>
                )}
                <button type="button" className="btn btn-ghost btn-small" onClick={openRecorder}>
                  {prepared.recorded ? 'Record again' : 'Record instead'}
                </button>
                <button type="button" className="btn btn-ghost btn-small" onClick={() => fileInputRef.current?.click()}>
                  {prepared.recorded ? 'Upload instead' : 'Replace'}
                </button>
                <button type="submit" className="btn btn-primary" aria-disabled={!canAnalyze}>
                  Analyze set
                </button>
              </div>
            </div>
            {touched && Object.keys(errors).length > 0 && <p className="field-error">{errors.weight || errors.plannedReps}</p>}
          </TrimControl>
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
      </section>

      <p className="home-guide">{exercise.guide.line}</p>

      {recording && (
        <RecordView
          exerciseId={input.exerciseId}
          muted={muted}
          onToggleMute={() => {
            setMuted(!muted);
            setMutedState(!muted);
            if (muted) unlockAudio();
          }}
          onCancel={() => setRecording(false)}
          onUpload={() => {
            setRecording(false);
            fileInputRef.current?.click();
          }}
          onDone={({ file, liveAlerts, trimEnd }) => {
            setRecording(false);
            handleFile(file, { recorded: true, liveAlerts, trimEnd });
          }}
        />
      )}
    </form>
  );
}
