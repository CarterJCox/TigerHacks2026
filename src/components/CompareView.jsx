// Baseline rep and breakdown rep (or the last rep) side by side, each with
// the skeleton overlay, started together from the beginning of each rep.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getExercise } from '../config/exercises/index.js';
import { drawVideoFrame, seekVideo } from '../lib/video/frame.js';
import { fmt, fmtLong } from '../lib/report/format.js';
import { drawSkeleton, fitCanvas, overlayColors } from './overlay.js';
import PlaybackControls from './PlaybackControls.jsx';
import { STATUS } from './status.js';
import { useMetricHover } from './highlight.js';
import EmptyState from './EmptyState.jsx';

const LEAD = 0.15;

/** The baseline rep closest to the baseline average: the most typical one. */
export function typicalBaselineRep(analysis) {
  const cfg = getExercise(analysis.exerciseId);
  const base = analysis.reps.filter((r) => r.isBaseline);
  let best = null;
  for (const r of base) {
    let dist = 0;
    for (const [key, def] of Object.entries(cfg.metrics)) {
      const s = analysis.stats[key];
      const v = r.metrics[key];
      if (!Number.isFinite(v) || !Number.isFinite(s?.mean)) continue;
      const scale = def.mode === 'relative' ? Math.abs(s.mean) * def.major || 1 : def.major;
      dist += Math.abs(v - s.mean) / scale;
    }
    if (!best || dist < best.dist) best = { rep: r, dist };
  }
  return best?.rep ?? null;
}

export function comparisonPair(analysis) {
  const baseline = typicalBaselineRep(analysis);
  if (!baseline) return null;
  if (analysis.breakdown) {
    const rep = analysis.reps.find((r) => r.index === analysis.breakdown.rep);
    return { baseline, other: rep, kind: 'breakdown' };
  }
  const after = analysis.reps.filter((r) => r.scorable && !r.isBaseline);
  if (!after.length) return null;
  return { baseline, other: after[after.length - 1], kind: 'last' };
}

/** Metrics that differ most between the two reps, largest first. */
export function differingMetrics(analysis, a, b, limit = 3) {
  const cfg = getExercise(analysis.exerciseId);
  return Object.entries(cfg.metrics)
    .map(([key, def]) => {
      const va = a.metrics[key];
      const vb = b.metrics[key];
      if (!Number.isFinite(va) || !Number.isFinite(vb)) return null;
      const scale = def.mode === 'relative' ? Math.max(Math.abs(va), def.minAbsChange) * def.major : def.major;
      if (Math.abs(vb - va) < def.minAbsChange) return null;
      return { key, def, va, vb, weight: (Math.abs(vb - va) / scale) * def.weight };
    })
    .filter(Boolean)
    .sort((x, y) => y.weight - x.weight)
    .slice(0, limit);
}

function Pane({ label, sub, rep, status, canvasRef, videoRef, src, metrics, side, hover }) {
  return (
    <figure className="compare-pane">
      <figcaption className="compare-head">
        <span className={`status-pill s-${status}`}>
          <i aria-hidden="true" />
          Rep {rep.index}
        </span>
        <span className="compare-label">{label}</span>
        <span className="muted small">{sub}</span>
      </figcaption>
      <div className="compare-stage">
        <canvas ref={canvasRef} className="compare-canvas" />
        <video ref={videoRef} src={src} muted playsInline preload="auto" className="player-video" />
      </div>
      <ul className="compare-metrics">
        {metrics.map((m) => (
          <li key={m.key} tabIndex={0} {...hover(m.key)}>
            <span className="compare-metric-label">{m.def.label}</span>
            <span className="compare-metric-value">{fmtLong(side === 'a' ? m.va : m.vb, m.def)}</span>
          </li>
        ))}
      </ul>
    </figure>
  );
}

export default function CompareView({ analysis, src, rotation, rate, onRate, showSkeleton, onToggleSkeleton, highlight }) {
  const pair = useMemo(() => comparisonPair(analysis), [analysis]);
  const metrics = useMemo(() => (pair ? differingMetrics(analysis, pair.baseline, pair.other) : []), [analysis, pair]);
  const hover = useMetricHover();
  const gridRef = useRef(null);
  const canvasA = useRef(null);
  const canvasB = useRef(null);
  const videoA = useRef(null);
  const videoB = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState(true);
  const loopRef = useRef(loop);
  const playingRef = useRef(false);
  const startingRef = useRef(false);
  const genRef = useRef(0); // bumps on every stop, so a pending start can tell it was cancelled
  const dirtyRef = useRef(true);
  loopRef.current = loop;

  const windows = useMemo(() => {
    if (!pair) return null;
    const t0 = analysis.t0 || 0;
    const tEnd = t0 + analysis.duration;
    const w = (r) => ({ start: Math.max(t0, r.tStart - LEAD), end: Math.min(tEnd, r.tEnd + LEAD) });
    return { a: w(pair.baseline), b: w(pair.other) };
  }, [pair, analysis]);

  // Show the first frame of each rep before anything is played.
  const cue = useCallback(async () => {
    if (!windows || !videoA.current || !videoB.current) return;
    await Promise.all([seekVideo(videoA.current, windows.a.start), seekVideo(videoB.current, windows.b.start)]).catch(() => {});
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
    playingRef.current = true;
    setPlaying(true);
    await Promise.all([a.play(), b.play()]).catch(() => {});
    startingRef.current = false;
  }, [cue, rate]);

  const stop = useCallback(() => {
    genRef.current += 1;
    videoA.current?.pause();
    videoB.current?.pause();
    playingRef.current = false;
    setPlaying(false);
  }, []);

  // Pause each pane at the end of its rep; when both are done, repeat together
  // or stop. Runs from the render loop and from timeupdate, so it still works
  // when animation frames are throttled.
  const checkEnds = useCallback(() => {
    const a = videoA.current;
    const b = videoB.current;
    if (!a || !b || !windows || !playingRef.current || startingRef.current) return;
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

  useEffect(() => {
    const a = videoA.current;
    const b = videoB.current;
    if (!a || !b) return undefined;
    let done = 0;
    const onReady = () => {
      done += 1;
      if (done === 2) cue();
    };
    a.addEventListener('loadeddata', onReady, { once: true });
    b.addEventListener('loadeddata', onReady, { once: true });
    if (a.readyState >= 2 && b.readyState >= 2) cue();
    return () => {
      a.removeEventListener('loadeddata', onReady);
      b.removeEventListener('loadeddata', onReady);
    };
  }, [cue]);

  useEffect(() => {
    if (videoA.current) videoA.current.playbackRate = rate;
    if (videoB.current) videoB.current.playbackRate = rate;
  }, [rate]);

  useEffect(() => {
    dirtyRef.current = true;
  }, [showSkeleton, highlight]);

  // Size both canvases to half the row each (stacked on narrow screens).
  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return undefined;
    const resize = () => {
      const stacked = grid.clientWidth < 640;
      const each = stacked ? grid.clientWidth : (grid.clientWidth - 16) / 2;
      const ar = analysis.width / analysis.height;
      for (const c of [canvasA.current, canvasB.current]) if (c) fitCanvas(c, each, ar, stacked ? 360 : 420);
      dirtyRef.current = true;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(grid);
    return () => ro.disconnect();
  }, [analysis.width, analysis.height, pair]);

  // One render loop for both panes keeps them in step.
  useEffect(() => {
    if (!pair) return undefined;
    const colors = overlayColors();
    let raf;
    const last = { a: -1, b: -1 };
    const draw = (key, video, canvas, rep) => {
      if (!video || !canvas || video.readyState < 2) return;
      const t = video.currentTime;
      if (t === last[key] && !dirtyRef.current) return;
      last[key] = t;
      const ctx = canvas.getContext('2d');
      drawVideoFrame(ctx, video, rotation, canvas.width, canvas.height);
      if (showSkeleton) {
        drawSkeleton(ctx, analysis, t, {
          scale: canvas.width / analysis.width,
          dpr: canvas.width / parseFloat(canvas.style.width || canvas.width),
          colors,
          statusColor: colors[rep.status] || colors.unknown,
          highlight,
        });
      }
    };
    const tick = () => {
      checkEnds();
      draw('a', videoA.current, canvasA.current, pair.baseline);
      draw('b', videoB.current, canvasB.current, pair.other);
      dirtyRef.current = false;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [pair, analysis, rotation, showSkeleton, highlight, checkEnds]);

  if (!pair) {
    return (
      <EmptyState title="Nothing to compare yet">
        A side-by-side needs at least one scored rep after your baseline reps. This set only had baseline reps.
      </EmptyState>
    );
  }

  const otherStatus = pair.other.status;
  const otherLabel = pair.kind === 'breakdown' ? (analysis.breakdown.kind === 'breakdown' ? 'Breakdown rep' : 'Where form changed') : 'Last rep';
  const otherSub = pair.kind === 'breakdown' ? '' : 'No breakdown found, so this compares with the final rep';

  return (
    <div className="compare">
      <div className="compare-grid" ref={gridRef}>
        <Pane
          label="Baseline"
          sub={pair.baseline.score != null ? `Score ${pair.baseline.score}` : ''}
          rep={pair.baseline}
          status={pair.baseline.status}
          canvasRef={canvasA}
          videoRef={videoA}
          src={src}
          metrics={metrics}
          side="a"
          hover={hover}
        />
        <Pane
          label={otherLabel}
          sub={otherSub || (pair.other.score != null ? `Score ${pair.other.score} · ${(STATUS[otherStatus] || STATUS.unknown).label}` : '')}
          rep={pair.other}
          status={otherStatus}
          canvasRef={canvasB}
          videoRef={videoB}
          src={src}
          metrics={metrics}
          side="b"
          hover={hover}
        />
      </div>
      {metrics.length === 0 && <p className="muted small">These two reps measured within a few units of each other on every metric.</p>}
      <div className="player-controls compare-controls">
        <button type="button" className="btn btn-secondary btn-small" onClick={playing ? stop : play}>
          {playing ? 'Pause both' : 'Play both from the start'}
        </button>
        <div className="controls-right">
          <PlaybackControls
            rate={rate}
            onRate={onRate}
            showSkeleton={showSkeleton}
            onToggleSkeleton={onToggleSkeleton}
            loop={loop}
            onToggleLoop={() => setLoop((l) => !l)}
            loopLabel="Repeat"
          />
        </div>
      </div>
      {metrics.length > 0 && (
        <p className="compare-summary muted small">
          Biggest differences: {metrics.map((m) => `${m.def.label.toLowerCase()} ${fmt(m.va, m.def)} vs ${fmt(m.vb, m.def)}`).join(', ')}.
        </p>
      )}
    </div>
  );
}
