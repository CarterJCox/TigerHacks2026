// One of the first reps on the left, the selected rep on the right, same size as the
// full-set view, started together from the beginning of each rep.

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import { drawVideoFrame, seekVideo } from '../lib/video/frame.js';
import { bodyRegion, drawSkeleton, fitCanvas, overlayColors } from './overlay.js';
import { severityOf } from './status.js';

const LEAD = 0.15;
const GAP = 14;

function repLabel(rep, isLeft) {
  const label = severityOf(rep).label;
  return isLeft || rep.isBaseline ? `First reps · ${label}` : label;
}

const ComparePlayer = forwardRef(function ComparePlayer(
  { src, rotation, analysis, leftRep, rightRep, rate, showSkeleton, loop, highlight, onState },
  ref,
) {
  const boxRef = useRef(null);
  const canvasA = useRef(null);
  const canvasB = useRef(null);
  const videoA = useRef(null);
  const videoB = useRef(null);
  const loopRef = useRef(loop);
  const playingRef = useRef(false);
  const startingRef = useRef(false);
  const genRef = useRef(0);
  const dirtyRef = useRef(true);
  loopRef.current = loop;
  // Both panes show the same crop around the lifter, so they are as large as possible and directly comparable.
  const region = useMemo(() => bodyRegion(analysis), [analysis]);

  const windows = useMemo(() => {
    const t0 = analysis.t0 || 0;
    const tEnd = t0 + analysis.duration;
    const w = (r) => (r ? { start: Math.max(t0, r.tStart - LEAD), end: Math.min(tEnd, r.tEnd + LEAD) } : null);
    return { a: w(leftRep), b: w(rightRep) };
  }, [analysis, leftRep, rightRep]);

  const setPlaying = useCallback(
    (on) => {
      playingRef.current = on;
      onState?.({ playing: on });
    },
    [onState],
  );

  // Show the first frame of each rep.
  const cue = useCallback(async () => {
    const a = videoA.current;
    const b = videoB.current;
    if (!a || !b || !windows.a || !windows.b) return;
    await Promise.all([seekVideo(a, windows.a.start), seekVideo(b, windows.b.start)]).catch(() => {});
    dirtyRef.current = true;
  }, [windows]);

  const play = useCallback(async () => {
    const a = videoA.current;
    const b = videoB.current;
    if (!a || !b || startingRef.current) return;
    startingRef.current = true;
    const gen = genRef.current;
    a.pause();
    b.pause();
    await cue();
    if (gen !== genRef.current) {
      startingRef.current = false;
      return;
    }
    a.playbackRate = rate;
    b.playbackRate = rate;
    setPlaying(true);
    await Promise.all([a.play(), b.play()]).catch(() => {});
    startingRef.current = false;
  }, [cue, rate, setPlaying]);

  const stop = useCallback(() => {
    genRef.current += 1;
    videoA.current?.pause();
    videoB.current?.pause();
    setPlaying(false);
  }, [setPlaying]);

  const togglePlay = useCallback(() => (playingRef.current ? stop() : play()), [play, stop]);

  useImperativeHandle(ref, () => ({ togglePlay, play, pause: stop }), [togglePlay, play, stop]);

  // Each pane pauses at the end of its rep; when both are done, repeat together or stop.
  const checkEnds = useCallback(() => {
    const a = videoA.current;
    const b = videoB.current;
    if (!a || !b || !windows.a || !windows.b || !playingRef.current || startingRef.current) return;
    if (a.currentTime >= windows.a.end && !a.paused) a.pause();
    if (b.currentTime >= windows.b.end && !b.paused) b.pause();
    if (a.paused && b.paused) {
      if (loopRef.current) play();
      else stop();
    }
  }, [windows, play, stop]);

  useEffect(() => {
    const vids = [videoA.current, videoB.current].filter(Boolean);
    vids.forEach((v) => {
      v.addEventListener('timeupdate', checkEnds);
      v.addEventListener('ended', checkEnds);
    });
    return () =>
      vids.forEach((v) => {
        v.removeEventListener('timeupdate', checkEnds);
        v.removeEventListener('ended', checkEnds);
      });
  }, [checkEnds]);

  // New rep on either side: stop and show its first frame.
  useEffect(() => {
    stop();
    const a = videoA.current;
    const b = videoB.current;
    if (!a || !b) return undefined;
    if (a.readyState >= 2 && b.readyState >= 2) {
      cue();
      return undefined;
    }
    let done = 0;
    const onReady = () => {
      done += 1;
      if (done === 2) cue();
    };
    a.addEventListener('loadeddata', onReady, { once: true });
    b.addEventListener('loadeddata', onReady, { once: true });
    return () => {
      a.removeEventListener('loadeddata', onReady);
      b.removeEventListener('loadeddata', onReady);
    };
  }, [cue, stop]);

  useEffect(() => {
    if (videoA.current) videoA.current.playbackRate = rate;
    if (videoB.current) videoB.current.playbackRate = rate;
  }, [rate]);

  useEffect(() => {
    dirtyRef.current = true;
  }, [showSkeleton, highlight]);

  useEffect(() => () => stop(), [stop]);

  // Two panes side by side, each as large as the stage allows.
  useEffect(() => {
    const box = boxRef.current;
    const resize = () => {
      if (!box.clientWidth || !box.clientHeight) return;
      const each = (box.clientWidth - GAP) / 2;
      const ar = region.w / region.h;
      for (const c of [canvasA.current, canvasB.current]) if (c) fitCanvas(c, each, ar, box.clientHeight - 30);
      dirtyRef.current = true;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(box);
    return () => ro.disconnect();
  }, [region]);

  // One render loop for both panes keeps them in step.
  useEffect(() => {
    const colors = overlayColors();
    let raf;
    const last = { a: -1, b: -1 };
    const draw = (key, video, canvas, rep) => {
      if (!video || !canvas || !rep || video.readyState < 2) return;
      const t = video.currentTime;
      if (t === last[key] && !dirtyRef.current) return;
      last[key] = t;
      const ctx = canvas.getContext('2d');
      const k = canvas.width / region.w;
      ctx.save();
      ctx.translate(-region.x * k, -region.y * k);
      drawVideoFrame(ctx, video, rotation, analysis.width * k, analysis.height * k);
      ctx.restore();
      if (showSkeleton) {
        drawSkeleton(ctx, analysis, t, {
          scale: k,
          origin: { x: region.x, y: region.y },
          dpr: canvas.width / parseFloat(canvas.style.width || canvas.width),
          colors,
          statusColor: colors.neutral,
          highlight,
        });
      }
    };
    const tick = () => {
      checkEnds();
      draw('a', videoA.current, canvasA.current, leftRep);
      draw('b', videoB.current, canvasB.current, rightRep);
      dirtyRef.current = false;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [analysis, region, rotation, showSkeleton, highlight, checkEnds, leftRep, rightRep]);

  const pane = (rep, canvasRef, videoRef, isLeft) => (
    <figure className="compare-pane">
      <figcaption className="compare-cap">
        <span className={`status-pill s-${rep?.scorable ? rep.severity : 'unknown'}`}>
          <i aria-hidden="true" />
          Rep {rep?.index ?? '–'}
        </span>
        <span className="compare-cap-label">{rep ? repLabel(rep, isLeft) : ''}</span>
      </figcaption>
      <canvas ref={canvasRef} className="stage-canvas" onClick={togglePlay} />
      <video ref={videoRef} src={src} muted playsInline preload="auto" className="player-video" />
    </figure>
  );

  return (
    <div className="stage-box stage-compare" ref={boxRef}>
      {pane(leftRep, canvasA, videoA, true)}
      {pane(rightRep, canvasB, videoB, false)}
    </div>
  );
});

export default ComparePlayer;
