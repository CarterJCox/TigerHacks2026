import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { drawVideoFrame } from '../lib/video/frame.js';
import { LM, SKELETON, BODY_POINTS } from '../lib/pose/landmarks.js';
import { getExercise } from '../config/exercises/index.js';
import Timeline from './Timeline.jsx';
import { STATUS, fmtClock, repAt } from './status.js';

function cssVar(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

// Interpolated landmark position at time t (analysis pixel coordinates).
function pointAtTime(sm, j, fi) {
  const i0 = Math.max(0, Math.min(sm.n - 1, Math.floor(fi)));
  const i1 = Math.min(sm.n - 1, i0 + 1);
  const f = fi - i0;
  const ok0 = sm.ok[j][i0] && Number.isFinite(sm.x[j][i0]);
  const ok1 = sm.ok[j][i1] && Number.isFinite(sm.x[j][i1]);
  if (ok0 && ok1) return { x: sm.x[j][i0] * (1 - f) + sm.x[j][i1] * f, y: sm.y[j][i0] * (1 - f) + sm.y[j][i1] * f };
  if (ok0 && f < 0.5) return { x: sm.x[j][i0], y: sm.y[j][i0] };
  if (ok1 && f >= 0.5) return { x: sm.x[j][i1], y: sm.y[j][i1] };
  return null;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawSkeleton(ctx, analysis, t, scale, dpr, colors, statusColor) {
  const { sm, ctx: body, series } = analysis;
  const cfg = getExercise(analysis.exerciseId);
  const fi = t * analysis.fps;
  const pts = {};
  for (const j of [...BODY_POINTS, LM.nose]) {
    const p = pointAtTime(sm, j, fi);
    if (p) pts[j] = { x: p.x * scale, y: p.y * scale };
  }
  const nearSide = body.view === 'side' ? body.side : null;
  const isNear = (j) => {
    if (!nearSide) return true;
    const name = Object.keys(LM).find((k) => LM[k] === j) || '';
    return name.startsWith(nearSide);
  };
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // Far side first, dimmer, so the measured side sits on top.
  for (const pass of ['far', 'near']) {
    for (const [a, b] of SKELETON) {
      const near = isNear(a) && isNear(b);
      if ((pass === 'near') !== near) continue;
      const pa = pts[a];
      const pb = pts[b];
      if (!pa || !pb) continue;
      ctx.strokeStyle = 'rgba(8,9,12,0.55)';
      ctx.lineWidth = (near ? 6 : 4) * dpr;
      ctx.beginPath();
      ctx.moveTo(pa.x, pa.y);
      ctx.lineTo(pb.x, pb.y);
      ctx.stroke();
      ctx.strokeStyle = near ? statusColor : colors.far;
      ctx.lineWidth = (near ? 3 : 2) * dpr;
      ctx.beginPath();
      ctx.moveTo(pa.x, pa.y);
      ctx.lineTo(pb.x, pb.y);
      ctx.stroke();
    }
  }
  for (const [j, p] of Object.entries(pts)) {
    const near = isNear(Number(j));
    ctx.fillStyle = 'rgba(8,9,12,0.8)';
    ctx.beginPath();
    ctx.arc(p.x, p.y, (near ? 5 : 3.5) * dpr, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = near ? statusColor : colors.far;
    ctx.beginPath();
    ctx.arc(p.x, p.y, (near ? 3 : 2) * dpr, 0, Math.PI * 2);
    ctx.fill();
  }

  // Key joint readout, e.g. "Elbow 47°".
  const joints =
    body.view === 'side'
      ? [LM[`${body.side}${cfg.overlay.joint === 'knee' ? 'Knee' : 'Elbow'}`]]
      : [LM.leftElbow, LM.rightElbow];
  const values = series[cfg.overlay.series];
  const idx = Math.max(0, Math.min(sm.n - 1, Math.round(fi)));
  const value = values ? values[idx] : NaN;
  const anchor = joints.map((j) => pts[j]).find(Boolean);
  for (const j of joints) {
    const p = pts[j];
    if (!p) continue;
    ctx.strokeStyle = colors.accent;
    ctx.lineWidth = 2 * dpr;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 10 * dpr, 0, Math.PI * 2);
    ctx.stroke();
  }
  if (anchor && Number.isFinite(value)) {
    const text = `${cfg.overlay.label} ${Math.round(value)}°`;
    ctx.font = `600 ${12.5 * dpr}px "Instrument Sans Variable", system-ui, sans-serif`;
    const w = ctx.measureText(text).width + 16 * dpr;
    const h = 24 * dpr;
    let x = anchor.x + 16 * dpr;
    let y = anchor.y - h - 8 * dpr;
    x = Math.min(Math.max(4 * dpr, x), ctx.canvas.width - w - 4 * dpr);
    y = Math.min(Math.max(4 * dpr, y), ctx.canvas.height - h - 4 * dpr);
    ctx.fillStyle = 'rgba(12,13,16,0.82)';
    roundRect(ctx, x, y, w, h, 7 * dpr);
    ctx.fill();
    ctx.fillStyle = '#f4f5f7';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x + 8 * dpr, y + h / 2 + 0.5 * dpr);
  }
}

const VideoPlayer = forwardRef(function VideoPlayer({ src, rotation, analysis, selectedRep, onSelectRep }, ref) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const stopAtRef = useRef(null);
  const dirtyRef = useRef(true);
  const colorsRef = useRef(null);
  const readyRef = useRef(false);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(1);
  const [showSkeleton, setShowSkeleton] = useState(true);
  const [ready, setReady] = useState(false);
  const reps = analysis.reps;
  const duration = analysis.duration;

  const seek = useCallback((t) => {
    const v = videoRef.current;
    if (!v) return;
    stopAtRef.current = null;
    v.currentTime = Math.max(0, Math.min(duration - 0.01, t));
    dirtyRef.current = true;
  }, [duration]);

  const playRep = useCallback(
    (index) => {
      const rep = reps.find((r) => r.index === index);
      const v = videoRef.current;
      if (!rep || !v) return;
      onSelectRep?.(index);
      v.currentTime = Math.max(0, rep.tStart - 0.2);
      stopAtRef.current = Math.min(duration, rep.tEnd + 0.25);
      v.playbackRate = rate;
      v.play().catch(() => {});
      dirtyRef.current = true;
    },
    [reps, duration, onSelectRep, rate],
  );

  useImperativeHandle(ref, () => ({ playRep, seek }), [playRep, seek]);

  // Size the canvas to its container, keeping the video's aspect ratio.
  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    const ar = analysis.width / analysis.height;
    const resize = () => {
      const maxH = Math.min(window.innerHeight * 0.68, 720);
      let w = wrap.clientWidth;
      let h = w / ar;
      if (h > maxH) {
        h = maxH;
        w = h * ar;
      }
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.style.width = `${Math.round(w)}px`;
      canvas.style.height = `${Math.round(h)}px`;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      dirtyRef.current = true;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    window.addEventListener('resize', resize);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', resize);
    };
  }, [analysis.width, analysis.height]);

  useEffect(() => {
    dirtyRef.current = true;
  }, [showSkeleton, selectedRep]);

  // Render loop: draws only when the frame or overlay settings changed.
  useEffect(() => {
    colorsRef.current = {
      green: cssVar('--good', '#0ca30c'),
      yellow: cssVar('--warn', '#fab219'),
      red: cssVar('--bad', '#d03b3b'),
      unknown: cssVar('--unknown', '#8a909c'),
      neutral: 'rgba(236,238,242,0.92)',
      far: 'rgba(236,238,242,0.38)',
      accent: cssVar('--accent', '#a594ff'),
    };
    let raf;
    let last = -1;
    let lastUiUpdate = 0;
    const loop = (now) => {
      const v = videoRef.current;
      const c = canvasRef.current;
      if (v && c && v.readyState >= 2) {
        if (!readyRef.current) {
          readyRef.current = true;
          setReady(true);
        }
        const t = v.currentTime;
        if (stopAtRef.current != null && t >= stopAtRef.current) {
          v.pause();
          stopAtRef.current = null;
        }
        if (t !== last || dirtyRef.current) {
          const ctx = c.getContext('2d');
          drawVideoFrame(ctx, v, rotation, c.width, c.height);
          if (showSkeleton) {
            const rep = repAt(reps, t);
            const colors = colorsRef.current;
            const statusColor = rep ? colors[rep.status] || colors.unknown : colors.neutral;
            drawSkeleton(ctx, analysis, t, c.width / analysis.width, c.width / parseFloat(c.style.width || c.width), colors, statusColor);
          }
          last = t;
          dirtyRef.current = false;
        }
        if (now - lastUiUpdate > 50) {
          setTime(t);
          lastUiUpdate = now;
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [analysis, reps, rotation, showSkeleton]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = rate;
  }, [rate]);

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      stopAtRef.current = null;
      if (v.currentTime >= duration - 0.05) v.currentTime = 0;
      v.play().catch(() => {});
    } else v.pause();
  };

  const current = repAt(reps, time);
  const status = current ? STATUS[current.status] || STATUS.unknown : null;
  const stepRep = (dir) => {
    const idx = current ? current.index + dir : dir > 0 ? (reps.find((r) => r.tStart > time)?.index ?? reps.length) : ([...reps].reverse().find((r) => r.tEnd < time)?.index ?? 1);
    const clamped = Math.max(1, Math.min(reps.length, idx));
    playRep(clamped);
  };

  return (
    <div className="player">
      <div className="player-stage" ref={wrapRef}>
        <canvas ref={canvasRef} className="player-canvas" onClick={togglePlay} aria-label="Video with pose overlay. Click to play or pause." />
        <video
          ref={videoRef}
          src={src}
          muted
          playsInline
          preload="auto"
          className="player-video"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onLoadedData={() => {
            readyRef.current = true;
            setReady(true);
            dirtyRef.current = true;
          }}
          onCanPlay={() => setReady(true)}
          onSeeked={() => {
            dirtyRef.current = true;
          }}
          onTimeUpdate={(e) => {
            // Backup for single-rep playback when animation frames are throttled.
            const v = e.currentTarget;
            if (stopAtRef.current != null && v.currentTime >= stopAtRef.current) {
              v.pause();
              stopAtRef.current = null;
            }
          }}
        />
        {!ready && <div className="player-loading">Loading video</div>}
        {current && (
          <div className={`player-badge s-${current.status}`}>
            <span className="badge-dot" aria-hidden="true" />
            Rep {current.index}
            <span className="badge-sep">·</span>
            {current.isBaseline ? 'Baseline' : status.label}
          </div>
        )}
      </div>

      <div className="player-controls">
        <button type="button" className="icon-btn" onClick={togglePlay} aria-label={playing ? 'Pause' : 'Play'}>
          {playing ? (
            <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
              <rect x="4.5" y="3.5" width="4" height="13" rx="1.2" fill="currentColor" />
              <rect x="11.5" y="3.5" width="4" height="13" rx="1.2" fill="currentColor" />
            </svg>
          ) : (
            <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
              <path d="M6 3.8 L16 10 L6 16.2 Z" fill="currentColor" strokeLinejoin="round" />
            </svg>
          )}
        </button>
        <span className="clock">
          {fmtClock(time)} <span className="muted">/ {fmtClock(duration)}</span>
        </span>
        <div className="controls-right">
          <button type="button" className="chip" onClick={() => stepRep(-1)}>
            Prev rep
          </button>
          <button type="button" className="chip" onClick={() => stepRep(1)}>
            Next rep
          </button>
          <div className="segmented segmented-small" role="group" aria-label="Playback speed">
            {[0.5, 1].map((r) => (
              <button type="button" key={r} className={rate === r ? 'is-active' : ''} aria-pressed={rate === r} onClick={() => setRate(r)}>
                {r}×
              </button>
            ))}
          </div>
          <button type="button" className={`chip ${showSkeleton ? 'is-on' : ''}`} aria-pressed={showSkeleton} onClick={() => setShowSkeleton((s) => !s)}>
            Skeleton
          </button>
        </div>
      </div>

      <Timeline
        duration={duration}
        reps={reps}
        time={time}
        selectedRep={selectedRep}
        baselineReps={analysis.baselineReps}
        breakdown={analysis.breakdown}
        onSeek={(t) => {
          seek(t);
          const r = repAt(reps, t);
          if (r) onSelectRep?.(r.index);
        }}
        onRep={playRep}
      />
    </div>
  );
});

export default VideoPlayer;
