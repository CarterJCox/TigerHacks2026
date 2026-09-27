// The full-set video with the skeleton overlay. Controls and the rep strip
// live outside; they drive this through the imperative handle.

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { drawVideoFrame } from '../lib/video/frame.js';
import { severityOf, repAt } from './status.js';
import { drawSkeleton, fitCanvas, overlayColors } from './overlay.js';

const LEAD_IN = 0.2; // seconds shown before a rep starts
const LEAD_OUT = 0.25; // and after it ends

const FullPlayer = forwardRef(function FullPlayer(
  { src, rotation, analysis, selectedRep, onSelectRep, rate, showSkeleton, loop, highlight, onState },
  ref,
) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const boxRef = useRef(null);
  const windowRef = useRef(null); // { start, end } of the rep being played
  const loopRef = useRef(loop);
  const resumeRef = useRef(false);
  const dirtyRef = useRef(true);
  const [ready, setReady] = useState(false);
  const [time, setTime] = useState(analysis.t0 || 0);
  const reps = analysis.reps;
  const t0 = analysis.t0 || 0;
  const tEnd = t0 + analysis.duration;
  loopRef.current = loop;

  const report = useCallback((patch) => onState?.(patch), [onState]);

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
    (index, { autoplay = true } = {}) => {
      const rep = reps.find((r) => r.index === index);
      const v = videoRef.current;
      if (!rep || !v) return;
      onSelectRep?.(index);
      windowRef.current = { start: Math.max(t0, rep.tStart - LEAD_IN), end: Math.min(tEnd, rep.tEnd + LEAD_OUT) };
      v.currentTime = windowRef.current.start;
      v.playbackRate = rate;
      if (autoplay) v.play().catch(() => {});
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

  const pause = useCallback(() => videoRef.current?.pause(), []);

  useImperativeHandle(ref, () => ({ playRep, seek, togglePlay, pause }), [playRep, seek, togglePlay, pause]);

  // Turning the loop on starts repeating the selected rep right away.
  const armed = useRef(false);
  useEffect(() => {
    if (!armed.current) {
      armed.current = true;
      return;
    }
    if (loop && selectedRep) playRep(selectedRep);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loop]);

  // Fill the stage: as large as fits both its width and its height.
  useEffect(() => {
    const box = boxRef.current;
    const canvas = canvasRef.current;
    const resize = () => {
      if (!box.clientWidth || !box.clientHeight) return;
      fitCanvas(canvas, box.clientWidth, analysis.width / analysis.height, box.clientHeight);
      dirtyRef.current = true;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(box);
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

  useEffect(() => {
    const v = videoRef.current;
    if (v && t0 > 0) v.currentTime = t0;
  }, [src, t0]);

  // Stop (or loop) at the end of the rep being played, or of the analyzed range.
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
    let lastUi = 0;
    const tick = (now) => {
      const v = videoRef.current;
      const c = canvasRef.current;
      if (v && c && v.readyState >= 2) {
        checkWindow(v);
        const t = v.currentTime;
        if (t !== last || dirtyRef.current) {
          const ctx = c.getContext('2d');
          drawVideoFrame(ctx, v, rotation, c.width, c.height);
          if (showSkeleton) {
            drawSkeleton(ctx, analysis, t, {
              scale: c.width / analysis.width,
              dpr: c.width / parseFloat(c.style.width || c.width),
              colors,
              // Neutral skeleton; form issues tint their own segments while they happen.
              statusColor: colors.neutral,
              highlight,
            });
          }
          last = t;
          dirtyRef.current = false;
        }
        if (now - lastUi > 50) {
          setTime(t);
          report({ time: t });
          lastUi = now;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [analysis, reps, rotation, showSkeleton, highlight, checkWindow, report]);

  const current = repAt(reps, time);
  const status = current ? severityOf(current) : null;

  return (
    <div className="stage-box" ref={boxRef}>
      <div className="stage-frame">
        <canvas ref={canvasRef} className="stage-canvas" onClick={togglePlay} aria-label="Video with pose overlay. Click to play or pause." />
        {!ready && <div className="stage-loading">Loading video</div>}
        {current && (
          <div className={`stage-badge s-${current.scorable ? current.severity : 'unknown'}`}>
            <span className="badge-dot" aria-hidden="true" />
            Rep {current.index}
            <span className="badge-sep">·</span>
            {status.label}
            {loop && selectedRep === current.index && <span className="badge-loop">Looping</span>}
          </div>
        )}
      </div>
      <video
        ref={videoRef}
        src={src}
        muted
        playsInline
        preload="auto"
        className="player-video"
        onPlay={() => report({ playing: true })}
        onPause={() => report({ playing: false })}
        onLoadedData={() => {
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
    </div>
  );
});

export default FullPlayer;
