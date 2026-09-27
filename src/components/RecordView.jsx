// Full-screen camera for recording a set in the browser.
//   setup:     live pose on the camera feed, a silhouette of where to stand,
//              and three readiness checks (body in frame, camera view, light
//              and tracking). Ready for 2 s starts a 3-second countdown.
//   recording: MediaRecorder, elapsed time, a live rep counter, and the live
//              stop signal for red form limits. Stops on Space, the Stop
//              button, or on its own (walking toward the camera, leaving the
//              frame, or no rep movement for a few seconds).
// Everything runs in this tab; nothing is uploaded.

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { getExercise } from '../config/exercises/index.js';
import { LIVE } from '../config/live.js';
import { createLandmarker } from '../lib/pose/extract.js';
import { LiveMonitor } from '../lib/live/monitor.js';
import { createAlertSignal } from '../lib/live/signal.js';
import { beep, chime, speak } from '../lib/live/audio.js';
import { cameraErrorMessage, pickRecordingType, recordingFileName, recordingSupport } from '../lib/live/recorder.js';
import { NUM_LANDMARKS } from '../lib/pose/landmarks.js';
import { drawLivePose, overlayColors } from './overlay.js';
import Silhouette from './Silhouette.jsx';

const STOP_TEXT = {
  approach: 'Stopped when you walked toward the camera',
  left: 'Stopped when you left the frame',
  idle: 'Stopped after a few seconds without a rep',
};

function clock(sec) {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function capitalize(s) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

// Mean brightness (0-255) of a tiny copy of the frame, for the light check.
function frameBrightness(video, canvas) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  let sum = 0;
  for (let i = 0; i < data.length; i += 4) sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  return sum / (data.length / 4);
}

export default function RecordView({ exerciseId, muted, onToggleMute, onCancel, onUpload, onDone }) {
  const cfg = getExercise(exerciseId);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const frameRef = useRef(null);
  const streamRef = useRef(null);
  const landmarkerRef = useRef(null);
  const monitorRef = useRef(null);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const typeRef = useRef(null);
  const recStartRef = useRef(null);
  const alertsRef = useRef([]);
  const phaseRef = useRef('starting');
  const timersRef = useRef([]);
  const mutedRef = useRef(muted);
  const perfRef = useRef({ frames: 0, since: 0, detectMs: 0 });
  const stopInfoRef = useRef(null);
  const brightRef = useRef({ canvas: null, value: undefined, at: 0 });
  const liveOffRef = useRef(false);
  mutedRef.current = muted;

  const [phase, setPhaseState] = useState('starting'); // starting | error | setup | countdown | recording | saving
  const [error, setError] = useState(null);
  const [status, setStatus] = useState('Starting the camera');
  const [readiness, setReadiness] = useState(null);
  const [count, setCount] = useState(LIVE.ready.countdownSec);
  const [elapsed, setElapsed] = useState(0);
  const [reps, setReps] = useState(0);
  const [alert, setAlert] = useState(null); // { title, until }
  const [liveOff, setLiveOff] = useState(false);
  const [aspect, setAspect] = useState(16 / 9);
  const [attempt, setAttempt] = useState(0);

  const setPhase = useCallback((p) => {
    phaseRef.current = p;
    setPhaseState(p);
  }, []);

  const clearTimers = () => {
    timersRef.current.forEach((id) => clearTimeout(id));
    timersRef.current = [];
  };

  const signal = useRef(
    createAlertSignal({
      playTone: chime,
      speak,
      isMuted: () => mutedRef.current,
    }),
  ).current;

  // ---- recording ----

  const finish = useCallback(() => {
    const type = typeRef.current;
    const blob = new Blob(chunksRef.current, { type: type?.mimeType || 'video/webm' });
    chunksRef.current = [];
    const file = new File([blob], recordingFileName(type?.extension || 'webm'), { type: blob.type });
    const info = stopInfoRef.current || {};
    // After a hands-free stop, trim off the walk to the camera: keep up to
    // one second after the last completed rep.
    let trimEnd = null;
    if (info.reason && info.lastRepEndT != null && recStartRef.current != null) {
      trimEnd = info.lastRepEndT - recStartRef.current / 1000 + 1;
    }
    onDone({ file, liveAlerts: alertsRef.current.slice(), trimEnd, stopReason: info.reason ?? null, liveOff });
  }, [onDone, liveOff]);

  const stopRecording = useCallback(
    (reason = null, lastRepEndT = null) => {
      const rec = recorderRef.current;
      if (phaseRef.current !== 'recording' || !rec) return;
      stopInfoRef.current = { reason, lastRepEndT };
      monitorRef.current?.stopRecording();
      setPhase('saving');
      setStatus(reason ? STOP_TEXT[reason] : 'Saving the recording');
      rec.onstop = finish;
      if (rec.state !== 'inactive') rec.stop();
      else finish();
    },
    [finish, setPhase],
  );

  const startRecording = useCallback(() => {
    const stream = streamRef.current;
    if (!stream || phaseRef.current === 'recording') return;
    clearTimers();
    const type = pickRecordingType();
    typeRef.current = type;
    let rec;
    try {
      rec = new MediaRecorder(stream, type.mimeType ? { mimeType: type.mimeType, videoBitsPerSecond: 6_000_000 } : undefined);
    } catch (err) {
      console.error(err);
      setError({ title: "Recording couldn't start", message: 'This browser refused to record the camera. Try again, or upload a video instead.' });
      setPhase('error');
      return;
    }
    chunksRef.current = [];
    alertsRef.current = [];
    rec.ondataavailable = (e) => {
      if (e.data?.size) chunksRef.current.push(e.data);
    };
    const begin = () => {
      recStartRef.current = performance.now();
      monitorRef.current?.startRecording(recStartRef.current / 1000);
      perfRef.current = { frames: 0, since: performance.now(), detectMs: perfRef.current.detectMs };
    };
    rec.onstart = begin;
    recorderRef.current = rec;
    rec.start(1000);
    begin();
    setReps(0);
    setElapsed(0);
    setPhase('recording');
    if (!mutedRef.current) beep(true);
  }, [setPhase]);

  const startCountdown = useCallback(() => {
    if (phaseRef.current !== 'setup') return;
    clearTimers();
    setPhase('countdown');
    const n = LIVE.ready.countdownSec;
    setCount(n);
    if (!mutedRef.current) beep();
    for (let k = 1; k <= n; k++) {
      timersRef.current.push(
        setTimeout(() => {
          if (phaseRef.current !== 'countdown') return;
          if (k === n) startRecording();
          else {
            setCount(n - k);
            if (!mutedRef.current) beep();
          }
        }, k * 1000),
      );
    }
  }, [setPhase, startRecording]);

  const cancelCountdown = useCallback(() => {
    if (phaseRef.current !== 'countdown') return;
    clearTimers();
    setPhase('setup');
  }, [setPhase]);

  // ---- camera, pose model and the analysis loop ----

  useEffect(() => {
    let cancelled = false;
    let frameHandle = null;
    const video = videoRef.current;

    const support = recordingSupport();
    if (!support.ok) {
      setError(cameraErrorMessage(support.reason));
      setPhase('error');
      return undefined;
    }

    const draw = (result) => {
      const canvas = canvasRef.current;
      const box = frameRef.current;
      if (!canvas || !box || !video.videoWidth) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = Math.round(box.clientWidth * dpr);
      const h = Math.round(box.clientHeight * dpr);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, w, h);
      if (!result?.hasPose) return;
      const flags = liveOffRef.current ? [] : result.flags;
      drawLivePose(ctx, result.points, {
        scale: w / video.videoWidth,
        dpr,
        colors: overlayColors(),
        flags: phaseRef.current === 'recording' ? flags : [],
        nearSide: result.ctx?.view === 'side' ? result.ctx.side : null,
      });
    };

    const raw = new Float32Array(NUM_LANDMARKS * 4);
    let lastDetect = 0;
    let lastUi = 0;

    const onFrame = () => {
      if (cancelled) return;
      schedule();
      const landmarker = landmarkerRef.current;
      const monitor = monitorRef.current;
      if (!landmarker || !monitor || video.readyState < 2 || !video.videoWidth) return;
      const now = performance.now();
      if (now - lastDetect < 1000 / LIVE.targetFps - 4) return; // skip frames beyond the target rate
      lastDetect = now;

      const t0 = performance.now();
      let pose = null;
      try {
        pose = landmarker.detectForVideo(video, now)?.landmarks?.[0] ?? null;
      } catch (err) {
        console.warn('[spotter] live pose failed on a frame', err);
      }
      const detectMs = performance.now() - t0;
      if (pose && pose.length >= NUM_LANDMARKS) {
        for (let j = 0; j < NUM_LANDMARKS; j++) {
          raw[j * 4] = pose[j].x;
          raw[j * 4 + 1] = pose[j].y;
          raw[j * 4 + 2] = pose[j].z;
          raw[j * 4 + 3] = pose[j].visibility ?? 0;
        }
      }
      const b = brightRef.current;
      if (now - b.at > 500) {
        b.canvas = b.canvas || Object.assign(document.createElement('canvas'), { width: 32, height: 18 });
        b.value = frameBrightness(video, b.canvas);
        b.at = now;
      }

      const result = monitor.push({ t: now / 1000, raw: pose ? raw : null, width: video.videoWidth, height: video.videoHeight, brightness: b.value });
      draw(result);

      const phaseNow = phaseRef.current;
      const perf = perfRef.current;
      perf.detectMs = perf.detectMs ? perf.detectMs * 0.9 + detectMs * 0.1 : detectMs;

      if (phaseNow === 'setup' && result.readiness.readyFor >= LIVE.ready.holdSec) startCountdown();
      if (phaseNow === 'countdown' && !result.readiness.ok) cancelCountdown();

      if (phaseNow === 'recording') {
        perf.frames += 1;
        const secs = (now - perf.since) / 1000;
        // Can this device keep up? If not, alerts go off and recording continues.
        if (!liveOffRef.current && secs >= LIVE.warmUpSec && perf.frames / secs < LIVE.minFps) {
          liveOffRef.current = true;
          monitor.disableAlerts();
          setLiveOff(true);
          console.warn(`[spotter] live alerts off: ${(perf.frames / secs).toFixed(1)} frames/s, ${perf.detectMs.toFixed(0)} ms per frame`);
        }
        if (result.alert && !liveOffRef.current) {
          signal(result);
          const a = result.alert;
          alertsRef.current.push({ t: a.recordingT, ruleId: a.ruleId, label: a.label, short: a.short });
          setAlert({ title: capitalize(a.short), until: now + LIVE.alerts.showSec * 1000 });
          console.info(
            `[spotter] stop signal: ${a.ruleId} ${a.value.toFixed(1)} (limit ${a.limit}), ` +
              `${Math.round((a.t - a.patternStart) * 1000)} ms after the pattern started, ${Math.round(detectMs)} ms to analyze the frame`,
          );
        }
        if (result.stop) stopRecording(result.stop.reason, result.lastRepEndT);
      }

      if (now - lastUi > 120 || result.alert) {
        lastUi = now;
        setReadiness(result.readiness);
        setReps(result.reps);
        if (phaseRef.current === 'recording' && recStartRef.current != null) setElapsed((now - recStartRef.current) / 1000);
        setAlert((cur) => (cur && now > cur.until ? null : cur));
      }
    };

    const schedule = () => {
      if (cancelled) return;
      if (video.requestVideoFrameCallback) frameHandle = { v: video.requestVideoFrameCallback(onFrame) };
      else frameHandle = { r: requestAnimationFrame(onFrame) };
    };

    (async () => {
      setPhase('starting');
      setStatus('Starting the camera');
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 }, facingMode: 'user' },
          audio: false,
        });
      } catch (err) {
        if (cancelled) return;
        console.warn('[spotter] camera failed', err);
        setError(cameraErrorMessage(err));
        setPhase('error');
        return;
      }
      if (cancelled) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = stream;
      video.srcObject = stream;
      // play() can be aborted by a quick re-render or a slow first frame;
      // wait for the stream to actually start before calling it a failure.
      const started = await video.play().then(
        () => true,
        (err) =>
          new Promise((resolve) => {
            console.warn('[spotter] camera preview play() failed, waiting for the stream', err);
            if (!video.paused) return resolve(true);
            const timer = setTimeout(() => resolve(false), 5000);
            video.addEventListener('playing', () => {
              clearTimeout(timer);
              resolve(true);
            }, { once: true });
            video.play().catch(() => {});
          }),
      );
      if (cancelled) return;
      if (!started) {
        setError(cameraErrorMessage({ name: 'NotReadableError' }));
        setPhase('error');
        return;
      }
      if (video.videoWidth && video.videoHeight) setAspect(video.videoWidth / video.videoHeight);
      setStatus('Loading pose tracking');
      try {
        const { landmarker } = await createLandmarker();
        if (cancelled) {
          landmarker.close();
          return;
        }
        landmarkerRef.current = landmarker;
      } catch (err) {
        console.error(err);
        if (cancelled) return;
        setError({ title: "Pose tracking couldn't load", message: 'Reload the page and try again, or upload a video instead.' });
        setPhase('error');
        return;
      }
      monitorRef.current = new LiveMonitor(exerciseId);
      setPhase('setup');
      schedule();
    })();

    return () => {
      cancelled = true;
      clearTimers();
      if (frameHandle?.v != null) video.cancelVideoFrameCallback?.(frameHandle.v);
      if (frameHandle?.r != null) cancelAnimationFrame(frameHandle.r);
      const rec = recorderRef.current;
      if (rec && rec.state !== 'inactive') {
        rec.onstop = null;
        rec.stop();
      }
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      landmarkerRef.current?.close();
      landmarkerRef.current = null;
      try {
        window.speechSynthesis?.cancel();
      } catch {
        // nothing to cancel
      }
    };
    // Restart everything on "Try again".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exerciseId, attempt]);

  // Space stops the recording; Escape backs out before it starts.
  useEffect(() => {
    const onKey = (e) => {
      if (e.code === 'Space' || e.key === ' ') {
        if (phaseRef.current === 'recording') {
          e.preventDefault();
          stopRecording();
        } else if (phaseRef.current === 'setup' && !e.target.closest?.('button')) {
          e.preventDefault();
          startCountdown();
        }
      } else if (e.key === 'Escape') {
        if (phaseRef.current === 'countdown') cancelCountdown();
        else if (phaseRef.current !== 'recording' && phaseRef.current !== 'saving') onCancel();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [stopRecording, startCountdown, cancelCountdown, onCancel]);

  const retry = () => {
    setError(null);
    liveOffRef.current = false;
    setLiveOff(false);
    setAttempt((a) => a + 1);
  };

  const checks = readiness
    ? [
        ['body', 'Whole body in frame', readiness.body],
        ['view', cfg.view === 'side' ? 'Side view' : 'Front view', readiness.view],
        ['light', 'Light and tracking', readiness.light],
      ]
    : [];
  const showGuide = phase === 'setup' || phase === 'countdown';

  // Rendered on <body> so no transformed ancestor can trap the fixed overlay.
  return createPortal(
    <div className={`rec phase-${phase} ${alert ? 'is-alert' : ''}`} role="dialog" aria-modal="true" aria-label={`Record a ${cfg.shortName.toLowerCase()} set`}>
      <div className="rec-stage">
        <div className="rec-frame" ref={frameRef} style={{ aspectRatio: aspect, '--ar': aspect }}>
          <div className="rec-mirror">
            <video ref={videoRef} className="rec-video" muted playsInline autoPlay />
            {showGuide && <Silhouette view={cfg.view} pose={cfg.guide.silhouette} />}
            <canvas ref={canvasRef} className="rec-canvas" />
          </div>
        </div>
      </div>

      <header className="rec-top">
        <button type="button" className="rec-btn" onClick={() => (phase === 'recording' ? stopRecording() : onCancel())} disabled={phase === 'saving'}>
          {phase === 'recording' ? 'Stop' : 'Back'}
        </button>
        <p className="rec-title">
          {cfg.name} <span>· {cfg.viewLabel}</span>
        </p>
        <button type="button" className="rec-btn" aria-pressed={!muted} onClick={onToggleMute}>
          {muted ? 'Sound off' : 'Sound on'}
        </button>
      </header>

      {phase === 'recording' && (
        <>
          <p className="rec-time" aria-live="off">
            <i aria-hidden="true" />
            {clock(elapsed)}
          </p>
          <p className="rec-reps" aria-live="polite">
            <strong>{reps}</strong>
            <span>{reps === 1 ? 'rep' : 'reps'}</span>
          </p>
        </>
      )}

      {alert && (
        <div className="rec-alert" role="alert">
          <p className="rec-alert-title">{alert.title}</p>
          <p className="rec-alert-cue">{LIVE.alerts.speech}</p>
        </div>
      )}

      {phase === 'countdown' && (
        <p className="rec-count" key={count} aria-live="assertive">
          {count}
        </p>
      )}

      <div className="rec-bottom">
        {showGuide && readiness && (
          <div className="rec-guide">
            <p className="rec-message">{phase === 'countdown' ? 'Recording starts in a moment' : readiness.message}</p>
            <ul className="rec-checks">
              {checks.map(([key, label, ok]) => (
                <li key={key} className={ok ? 'is-ok' : ''}>
                  <i aria-hidden="true" />
                  {label}
                </li>
              ))}
            </ul>
            <div className="rec-actions">
              {phase === 'setup' ? (
                <button type="button" className="btn btn-primary" onClick={startCountdown}>
                  Start now
                </button>
              ) : (
                <button type="button" className="btn btn-ghost" onClick={cancelCountdown}>
                  Wait
                </button>
              )}
              <p className="rec-hint">Hold still in position for {LIVE.ready.holdSec} seconds and recording starts on its own.</p>
            </div>
          </div>
        )}
        {phase === 'recording' && (
          <div className="rec-stopbar">
            <button type="button" className="rec-stop" onClick={() => stopRecording()}>
              Stop
            </button>
            <p className="rec-hint">
              Space also stops. Walk toward the camera to stop hands-free.
              {liveOff ? '' : ' Spotter will signal if your form becomes an injury risk.'}
            </p>
          </div>
        )}
        {liveOff && phase === 'recording' && (
          <p className="rec-note">Live alerts are off: this device can't analyze the camera fast enough. Recording continues, and the full analysis runs afterwards.</p>
        )}
      </div>

      {(phase === 'starting' || phase === 'saving') && (
        <div className="rec-center" role="status">
          <div className="spinner" aria-hidden="true" />
          <p>{status}</p>
        </div>
      )}

      {phase === 'error' && error && (
        <div className="rec-center rec-error" role="alert">
          <h2>{error.title}</h2>
          <p>{error.message}</p>
          <div className="rec-error-actions">
            <button type="button" className="btn btn-primary" onClick={retry}>
              Try again
            </button>
            <button type="button" className="btn btn-secondary" onClick={onUpload}>
              Upload a video instead
            </button>
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}
