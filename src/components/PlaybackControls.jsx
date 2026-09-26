// Speed, loop and skeleton controls shared by the main player and the
// side-by-side comparison, so both always use the same settings.

export const RATES = [1, 0.5, 0.25];

export default function PlaybackControls({ rate, onRate, showSkeleton, onToggleSkeleton, loop, onToggleLoop, loopLabel = 'Loop rep' }) {
  return (
    <>
      <div className="segmented segmented-small" role="group" aria-label="Playback speed">
        {RATES.map((r) => (
          <button type="button" key={r} className={rate === r ? 'is-active' : ''} aria-pressed={rate === r} onClick={() => onRate(r)}>
            {r}×
          </button>
        ))}
      </div>
      {onToggleLoop && (
        <button type="button" className={`chip ${loop ? 'is-on' : ''}`} aria-pressed={loop} onClick={onToggleLoop} title="Repeat the selected rep">
          {loopLabel}
        </button>
      )}
      <button type="button" className={`chip ${showSkeleton ? 'is-on' : ''}`} aria-pressed={showSkeleton} onClick={onToggleSkeleton}>
        Skeleton
      </button>
    </>
  );
}
