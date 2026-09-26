import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { drawVideoFrame } from '../lib/video/frame.js';
import Timeline from './Timeline.jsx';
import PlaybackControls from './PlaybackControls.jsx';
import { STATUS, fmtClock, repAt } from './status.js';
import { drawSkeleton, fitCanvas, overlayColors } from './overlay.js';

const LEAD_IN = 0.2; // seconds shown before a rep starts
const LEAD_OUT = 0.25; // and after it ends

export function isTypingTarget(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

function isInteractive(el) {
  return Boolean(el?.closest?.('button, a, summary, [role="button"], [role="tab"], [role="slider"], [role="radio"]'));
}

const VideoPlayer = forwardRef(function VideoPlayer(
  { src, rotation, analysis, selectedRep, onSelectRep, rate, onRate, showSkeleton, onToggleSkeleton, loop, onToggleLoop, highlight, keyboard = true },
  ref,
) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const windowRef = useRef(null); // { start, end } of the rep being played, if any
  const loopRef = useRef(loop);
  const resumeRef = useRef(false); // resume playback after a loop jumps back
  const dirtyRef = useRef(true);
  const readyRef = useRef(false);
  const [time, setTime] = useState(analysis.t0 || 0);
  const [playing, setPlaying] = useState(false);
  const [ready, setReady] = useState(false);
  const reps = analysis.reps;
  const t0 = analysis.t0 || 0;
  const tEnd = t0 + analysis.duration;

  loopRef.current = loop;

  const seek = useCallback(
    (t) => {
      const v = videoRef.current;
      if (!v) return;
      windowRef.current = null;
      v.currentTime = Math.max(t0, Math.min(tEnd - 0.01, t));
      dirtyRef.current = true;
    },
    [t0, tEnd],
  );

  const playRep = useCallback(
    (index) => {
      const rep = reps.find((r) => r.index === index);
      const v = videoRef.current;
      if (!rep || !v) return;
      onSelectRep?.(index);
      windowRef.current = { start: Math.max(t0, rep.tStart - LEAD_IN), end: Math.min(tEnd, rep.tEnd + LEAD_OUT) };
      v.currentTime = windowRef.current.start;
      v.playbackRate = rate;
      v.play().catch(() => {});
      dirtyRef.current = true;
    },
    [reps, t0, tEnd, onSelectRep, rate],
  );

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (!v.paused) {
      v.pause();
      return;
    }
    if (loopRef.current && selectedRep) {
      playRep(selectedRep);
      return;
    }
    windowRef.current = null;
    if (v.currentTime >= tEnd - 0.05 || v.currentTime < t0) v.currentTime = t0;
    v.playbackRate = rate;
    v.play().catch(() => {});
  }, [playRep, selectedRep, t0, tEnd, rate]);

  const stepRep = useCallback(
    (dir) => {
      if (!reps.length) return;
      const now = videoRef.current?.currentTime ?? time;
      const current = selectedRep ? reps.find((r) => r.index === selectedRep) : repAt(reps, now);
      let idx;
      if (current) idx = current.index + dir;
      else if (dir > 0) idx = reps.find((r) => r.tStart > now)?.index ?? reps.length;
      else idx = [...reps].reverse().find((r) => r.tEnd < now)?.index ?? 1;
      playRep(Math.max(1, Math.min(reps.length, idx)));
    },
    [reps, selectedRep, playRep, time],
  );

  useImperativeHandle(ref, () => ({ playRep, seek, togglePlay }), [playRep, seek, togglePlay]);

  // Keyboard: space plays/pauses, arrows move between reps.
  useEffect(() => {
    if (!keyboard) return undefined;
    const onKey = (e) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || isTypingTarget(e.target)) return;
      if (e.key === ' ' || e.code === 'Space') {
        if (isInteractive(e.target)) return; // a focused button handles its own space press
        e.preventDefault();
        togglePlay();
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        if (e.target?.closest?.('[role="slider"], [role="tablist"]')) return;
        e.preventDefault();
        stepRep(e.key === 'ArrowRight' ? 1 : -1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [keyboard, togglePlay, stepRep]);

  // Turning the loop on starts repeating the selected rep right away.
  const loopArmed = useRef(false);
  useEffect(() => {
    if (!loopArmed.current) {
      loopArmed.current = true;
      return;
    }
    if (loop && selectedRep) playRep(selectedRep);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loop]);

  // Size the canvas to its container, keeping the video's aspect ratio.
  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    const resize = () => {
      fitCanvas(canvas, wrap.clientWidth, analysis.width / analysis.height, Math.min(window.innerHeight * 0.68, 720));
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
  }, [showSkeleton, selectedRep, highlight]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = rate;
  }, [rate]);

  // Start at the beginning of the analyzed range (it may be trimmed).
  useEffect(() => {
    const v = videoRef.current;
    if (v && t0 > 0) v.currentTime = t0;
  }, [src, t0]);

  // End-of-window handling, shared by the render loop and timeupdate.
  const checkWindow = useCallback(
    (v) => {
      const w = windowRef.current;
      if (w && v.currentTime >= w.end) {
        if (loopRef.current) {
          resumeRef.current = true;
          v.currentTime = w.start;
          v.play().catch(() => {});
        } else {
          v.pause();
          windowRef.current = null;
        }
      } else if (!w && !v.paused && v.currentTime >= tEnd) {
        v.pause();
      }
    },
    [tEnd],
  );

  // Render loop: draws only when the frame or overlay settings changed.
  useEffect(() => {
    const colors = overlayColors();
    let raf;
    let last = -1;
    let lastUiUpdate = 0;
    const loopFn = (now) => {
      const v = videoRef.current;
      const c = canvasRef.current;
      if (v && c && v.readyState >= 2) {
        if (!readyRef.current) {
          readyRef.current = true;
          setReady(true);
        }
        checkWindow(v);
        const t = v.currentTime;
        if (t !== last || dirtyRef.current) {
          const ctx = c.getContext('2d');
          drawVideoFrame(ctx, v, rotation, c.width, c.height);
          if (showSkeleton) {
            const rep = repAt(reps, t);
            drawSkeleton(ctx, analysis, t, {
              scale: c.width / analysis.width,
              dpr: c.width / parseFloat(c.style.width || c.width),
              colors,
              statusColor: rep ? colors[rep.status] || colors.unknown : colors.neutral,
              highlight,
            });
          }
          last = t;
          dirtyRef.current = false;
        }
        if (now - lastUiUpdate > 50) {
          setTime(t);
          lastUiUpdate = now;
        }
      }
      raf = requestAnimationFrame(loopFn);
    };
    raf = requestAnimationFrame(loopFn);
    return () => cancelAnimationFrame(raf);
  }, [analysis, reps, rotation, showSkeleton, highlight, checkWindow]);

  const current = repAt(reps, time);
  const status = current ? STATUS[current.status] || STATUS.unknown : null;

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
          onSeeked={(e) => {
            dirtyRef.current = true;
            // Some browsers pause a muted video after a seek; keep a looping rep going.
            if (resumeRef.current) {
              resumeRef.current = false;
              if (e.currentTarget.paused && loopRef.current) e.currentTarget.play().catch(() => {});
            }
          }}
          onTimeUpdate={(e) => checkWindow(e.currentTarget)}
        />
        {!ready && <div className="player-loading">Loading video</div>}
        {current && (
          <div className={`player-badge s-${current.status}`}>
            <span className="badge-dot" aria-hidden="true" />
            Rep {current.index}
            <span className="badge-sep">·</span>
            {current.isBaseline ? 'Baseline' : status.label}
            {loop && selectedRep === current.index && <span className="badge-loop">Looping</span>}
          </div>
        )}
      </div>

      <div className="player-controls">
        <button type="button" className="icon-btn" onClick={togglePlay} aria-label={playing ? 'Pause' : 'Play'} title="Play or pause (Space)">
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
          {fmtClock(time)} <span className="muted">/ {fmtClock(tEnd)}</span>
        </span>
        <div className="controls-right">
          <button type="button" className="chip" onClick={() => stepRep(-1)} title="Previous rep (Left arrow)">
            Prev rep
          </button>
          <button type="button" className="chip" onClick={() => stepRep(1)} title="Next rep (Right arrow)">
            Next rep
          </button>
          <PlaybackControls
            rate={rate}
            onRate={onRate}
            showSkeleton={showSkeleton}
            onToggleSkeleton={onToggleSkeleton}
            loop={loop}
            onToggleLoop={() => {
              if (!loop && !selectedRep && reps.length) onSelectRep?.((current || reps[0]).index);
              onToggleLoop();
            }}
          />
        </div>
      </div>

      <Timeline
        t0={t0}
        duration={analysis.duration}
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
      {keyboard && (
        <p className="shortcut-hint">
          <span>
            <kbd>Space</kbd> play or pause
          </span>
          <span>
            <kbd>←</kbd>
            <kbd>→</kbd> previous or next rep
          </span>
        </p>
      )}
    </div>
  );
});

export default VideoPlayer;
