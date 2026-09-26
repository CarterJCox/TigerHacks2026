// Optional trim before analysis: a filmstrip with start and end handles and a
// preview of the frame under the handle being moved. Only the kept range is
// analyzed. The default is the whole video.

import { useCallback, useEffect, useRef, useState } from 'react';
import { drawVideoFrame, rotatedSize, seekVideo } from '../lib/video/frame.js';
import { fmtClock } from './status.js';

export const MIN_TRIM_SEC = 2;
export const MAX_ANALYSIS_SEC = 180;
const THUMBS = 12;

// All seeks on the shared <video> go through one queue so the filmstrip and
// the preview never fight over its position.
function useSeekQueue() {
  const chain = useRef(Promise.resolve());
  return useCallback((fn) => {
    const next = chain.current.then(fn, fn);
    chain.current = next.catch(() => {});
    return next;
  }, []);
}

export default function TrimControl({ prepared, rotation, trim, onChange, children }) {
  const { video, duration } = prepared;
  const queue = useSeekQueue();
  const canvasRef = useRef(null);
  const trackRef = useRef(null);
  const drag = useRef(null);
  const pending = useRef(null);
  const busy = useRef(false);
  const [thumbs, setThumbs] = useState([]);
  const [focus, setFocus] = useState(null); // 'start' | 'end' | null
  const start = trim?.start ?? 0;
  const end = trim?.end ?? duration;
  // Latest values, so several quick moves before a re-render build on each other.
  const latest = useRef({ start, end });
  latest.current = { start, end };

  const size = rotatedSize(video.videoWidth, video.videoHeight, rotation);

  const drawAt = useCallback(
    async (t) => {
      await seekVideo(video, Math.max(0, Math.min(duration - 0.02, t)));
      const c = canvasRef.current;
      if (!c) return;
      const scale = Math.min(1, 720 / Math.max(size.width, size.height));
      const w = Math.round(size.width * scale);
      const h = Math.round(size.height * scale);
      if (c.width !== w || c.height !== h) {
        c.width = w;
        c.height = h;
      }
      drawVideoFrame(c.getContext('2d'), video, rotation, w, h);
    },
    [video, duration, rotation, size.width, size.height],
  );

  // Latest-wins preview: while dragging, only the most recent position is drawn.
  const preview = useCallback(
    async (t) => {
      pending.current = t;
      if (busy.current) return;
      busy.current = true;
      while (pending.current != null) {
        const next = pending.current;
        pending.current = null;
        await queue(() => drawAt(next)).catch(() => {});
      }
      busy.current = false;
    },
    [queue, drawAt],
  );

  // Filmstrip thumbnails, then the first preview frame.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const out = [];
      const tw = 96;
      const th = Math.round((tw * size.height) / size.width);
      const c = document.createElement('canvas');
      c.width = tw;
      c.height = th;
      const ctx = c.getContext('2d');
      for (let i = 0; i < THUMBS && !cancelled; i++) {
        const t = ((i + 0.5) / THUMBS) * duration;
        try {
          await queue(async () => {
            await seekVideo(video, t);
            drawVideoFrame(ctx, video, rotation, tw, th);
          });
          out.push(c.toDataURL('image/jpeg', 0.6));
        } catch {
          out.push(null);
        }
      }
      if (!cancelled) setThumbs(out);
    })();
    preview(Math.min(duration / 2, 1.5));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prepared, rotation]);

  const set = (which, t) => {
    let { start: s, end: e } = latest.current;
    if (which === 'start') s = Math.max(0, Math.min(t, e - MIN_TRIM_SEC));
    else e = Math.min(duration, Math.max(t, s + MIN_TRIM_SEC));
    const full = s <= 0.01 && e >= duration - 0.01;
    latest.current = { start: s, end: e };
    onChange(full ? null : { start: s, end: e });
    preview(which === 'start' ? s : e);
  };

  const timeFromEvent = (e) => {
    const rect = trackRef.current.getBoundingClientRect();
    return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * duration;
  };

  const onPointerDown = (e) => {
    const t = timeFromEvent(e);
    const which = e.target.dataset.handle || (Math.abs(t - start) <= Math.abs(t - end) ? 'start' : 'end');
    drag.current = which;
    setFocus(which);
    e.currentTarget.setPointerCapture(e.pointerId);
    set(which, t);
  };

  const onKey = (which) => (e) => {
    const step = e.shiftKey ? 1 : 0.1;
    const cur = latest.current[which];
    let t = null;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') t = cur - step;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') t = cur + step;
    if (e.key === 'Home') t = 0;
    if (e.key === 'End') t = duration;
    if (t === null) return;
    e.preventDefault();
    set(which, t);
  };

  const pct = (t) => `${(t / duration) * 100}%`;
  const length = end - start;
  const tooLong = length > MAX_ANALYSIS_SEC;

  return (
    <div className="trim">
      <canvas ref={canvasRef} className="preview-canvas" aria-label="Preview of the frame at the trim handle" />
      {children}
      <div className="trim-head">
        <span className="trim-title">Trim</span>
        <span className="muted small">Optional. Drag the handles to cut dead time; only the kept part is analyzed.</span>
      </div>
      <div
        ref={trackRef}
        className="trim-track"
        onPointerDown={onPointerDown}
        onPointerMove={(e) => drag.current && set(drag.current, timeFromEvent(e))}
        onPointerUp={() => {
          drag.current = null;
        }}
      >
        <div className="trim-strip" aria-hidden="true">
          {Array.from({ length: THUMBS }, (_, i) => (thumbs[i] ? <img key={i} src={thumbs[i]} alt="" draggable="false" /> : <span key={i} />))}
        </div>
        <div className="trim-shade" style={{ left: 0, width: pct(start) }} />
        <div className="trim-shade" style={{ left: pct(end), right: 0 }} />
        <div className="trim-range" style={{ left: pct(start), width: `calc(${pct(end)} - ${pct(start)})` }} />
        {['start', 'end'].map((which) => {
          const t = which === 'start' ? start : end;
          return (
            <div
              key={which}
              data-handle={which}
              className={`trim-handle trim-handle-${which} ${focus === which ? 'is-focus' : ''}`}
              style={{ left: pct(t) }}
              role="slider"
              tabIndex={0}
              aria-label={which === 'start' ? 'Trim start' : 'Trim end'}
              aria-valuemin={0}
              aria-valuemax={Math.round(duration * 10) / 10}
              aria-valuenow={Math.round(t * 10) / 10}
              aria-valuetext={fmtClock(t)}
              onKeyDown={onKey(which)}
              onFocus={() => {
                setFocus(which);
                preview(t);
              }}
            />
          );
        })}
      </div>
      <div className="trim-meta">
        <span>
          Start <strong>{fmtClock(start)}</strong>
        </span>
        <span>
          End <strong>{fmtClock(end)}</strong>
        </span>
        <span className={tooLong ? 'trim-warn' : ''}>
          Kept <strong>{length.toFixed(1)} s</strong>
          {trim ? ` of ${duration.toFixed(1)} s` : ' (whole video)'}
        </span>
        {trim && (
          <button type="button" className="link" onClick={() => onChange(null)}>
            Use whole video
          </button>
        )}
      </div>
      {tooLong && <p className="field-error">Trim to {MAX_ANALYSIS_SEC / 60} minutes or less so the analysis stays quick.</p>}
    </div>
  );
}
