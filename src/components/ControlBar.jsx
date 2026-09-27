import { fmtClock } from './status.js';

export const RATES = [1, 0.5, 0.25];

function PlayIcon({ playing }) {
  return playing ? (
    <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
      <rect x="4.5" y="3.5" width="4" height="13" rx="1.2" fill="currentColor" />
      <rect x="11.5" y="3.5" width="4" height="13" rx="1.2" fill="currentColor" />
    </svg>
  ) : (
    <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
      <path d="M6 3.8 L16 10 L6 16.2 Z" fill="currentColor" />
    </svg>
  );
}

function Chevron({ dir }) {
  return (
    <svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true">
      <path d={dir < 0 ? 'M12.5 4.5 L7 10 L12.5 15.5' : 'M7.5 4.5 L13 10 L7.5 15.5'} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function ControlBar({
  mode,
  playing,
  time,
  tStart,
  tEnd,
  compareText,
  onToggle,
  onStep,
  rate,
  onRate,
  loop,
  onLoop,
  showSkeleton,
  onSkeleton,
  onDetails,
}) {
  return (
    <div className="controls" role="toolbar" aria-label="Playback">
      <button type="button" className="ctl-play" onClick={onToggle} aria-label={playing ? 'Pause' : 'Play'} title={mode === 'compare' ? 'Play both reps (Space)' : 'Play or pause (Space)'}>
        <PlayIcon playing={playing} />
      </button>
      <div className="ctl-steps">
        <button type="button" className="ctl-icon" onClick={() => onStep(-1)} aria-label="Previous rep" title="Previous rep (Left arrow)">
          <Chevron dir={-1} />
        </button>
        <button type="button" className="ctl-icon" onClick={() => onStep(1)} aria-label="Next rep" title="Next rep (Right arrow)">
          <Chevron dir={1} />
        </button>
      </div>
      <span className="ctl-clock">
        {mode === 'compare' ? (
          compareText
        ) : (
          <>
            {fmtClock(time)} <span className="muted">/ {fmtClock(tEnd)}</span>
          </>
        )}
      </span>
      <span className="ctl-keys" aria-hidden="true">
        <kbd>Space</kbd> play <kbd>←</kbd>
        <kbd>→</kbd> reps
      </span>
      <div className="ctl-group">
        <div className="ctl-seg" role="group" aria-label="Playback speed">
          {RATES.map((r) => (
            <button type="button" key={r} className={rate === r ? 'is-active' : ''} aria-pressed={rate === r} onClick={() => onRate(r)}>
              {r}×
            </button>
          ))}
        </div>
        <button type="button" className={`ctl-toggle ${loop ? 'is-on' : ''}`} aria-pressed={loop} onClick={onLoop} title={mode === 'compare' ? 'Repeat both reps' : 'Repeat the selected rep'}>
          Loop
        </button>
        <button type="button" className={`ctl-toggle ${showSkeleton ? 'is-on' : ''}`} aria-pressed={showSkeleton} onClick={onSkeleton}>
          Skeleton
        </button>
        <span className="ctl-divider" aria-hidden="true" />
        <button type="button" className="ctl-details" onClick={onDetails}>
          Details
        </button>
      </div>
      <span className="visually-hidden">Keyboard: Space plays or pauses, left and right arrows move between reps. Start {fmtClock(tStart)}.</span>
    </div>
  );
}
