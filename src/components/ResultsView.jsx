// Results as a single-screen app view: the tracked video is the hero, the
// rep strip is the navigation, a slim panel explains the rep in focus, and
// the full detail lives in a drawer.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getExercise } from '../config/exercises/index.js';
import FullPlayer from './FullPlayer.jsx';
import ComparePlayer from './ComparePlayer.jsx';
import { typicalBaselineRep } from './repFocus.js';
import RepStrip from './RepStrip.jsx';
import ControlBar from './ControlBar.jsx';
import SidePanel from './SidePanel.jsx';
import DetailsDrawer from './DetailsDrawer.jsx';
import ExportBar from './ExportBar.jsx';
import { HighlightContext } from './highlight.js';
import { highlightFor } from './overlay.js';
import { buildShortHeadline } from '../lib/report/template.js';

function isTypingTarget(el) {
  const tag = el?.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || Boolean(el?.isContentEditable);
}

function isInteractive(el) {
  return Boolean(el?.closest?.('button, a, summary, [role="button"], [role="tab"], [role="slider"], [role="radio"]'));
}

export default function ResultsView({ analysis, input, report, llmPending, prepared, onNewSet, onHistory }) {
  const cfg = getExercise(analysis.exerciseId);
  const fullRef = useRef(null);
  const compareRef = useRef(null);
  const reps = analysis.reps;

  const [mode, setMode] = useState('full'); // 'full' | 'compare'
  const [selectedRep, setSelectedRep] = useState(null);
  const [rate, setRate] = useState(1);
  const [showSkeleton, setShowSkeleton] = useState(true);
  const [loop, setLoop] = useState(false);
  const [highlightMetric, setHighlightMetric] = useState(null);
  const [drawer, setDrawer] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(analysis.t0 || 0);

  const highlight = useMemo(() => highlightFor(analysis, highlightMetric), [analysis, highlightMetric]);
  const headline = useMemo(() => buildShortHeadline(analysis), [analysis]);
  const leftRep = useMemo(() => typicalBaselineRep(analysis), [analysis]);

  // The rep in focus: what the user picked, else the breakdown rep, else the last rep.
  const scored = reps.filter((r) => r.scorable);
  const lastRep = scored[scored.length - 1] ?? reps[reps.length - 1] ?? null;
  const defaultRep = analysis.breakdown ? reps.find((r) => r.index === analysis.breakdown.rep) : lastRep;
  const focusRep = (selectedRep && reps.find((r) => r.index === selectedRep)) || defaultRep;
  const focusReason = selectedRep
    ? null
    : analysis.breakdown
      ? analysis.breakdown.kind === 'breakdown'
        ? 'where form broke down'
        : 'where form changed'
      : lastRep === reps[reps.length - 1]
        ? 'last rep'
        : 'last scored rep';
  const rightRep = focusRep;

  const onState = useCallback((patch) => {
    if ('playing' in patch) setPlaying(patch.playing);
    if ('time' in patch) setTime(patch.time);
  }, []);

  const chooseRep = useCallback(
    (index) => {
      setSelectedRep(index);
      if (mode === 'full') fullRef.current?.playRep(index);
    },
    [mode],
  );

  const step = useCallback(
    (dir) => {
      if (!reps.length) return;
      const current = focusRep?.index ?? (dir > 0 ? 0 : reps.length + 1);
      chooseRep(Math.max(1, Math.min(reps.length, current + dir)));
    },
    [reps, focusRep, chooseRep],
  );

  const togglePlay = useCallback(() => {
    if (mode === 'compare') compareRef.current?.togglePlay();
    else fullRef.current?.togglePlay();
  }, [mode]);

  const switchMode = (next) => {
    if (next === mode) return;
    fullRef.current?.pause();
    compareRef.current?.pause();
    setPlaying(false);
    setMode(next);
  };

  // Keyboard: Space plays or pauses, arrows move between reps. Off while
  // typing or while the details drawer is open.
  useEffect(() => {
    const onKey = (e) => {
      if (drawer || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || isTypingTarget(e.target)) return;
      if (e.key === ' ' || e.code === 'Space') {
        if (isInteractive(e.target)) return;
        e.preventDefault();
        togglePlay();
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        if (e.target?.closest?.('[role="slider"], [role="tablist"]')) return;
        e.preventDefault();
        step(e.key === 'ArrowRight' ? 1 : -1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawer, togglePlay, step]);

  const weightText = input.weightLabel || (input.bodyweight ? 'Bodyweight' : `${input.weight} ${input.unit}`);
  const date = useMemo(() => new Date().toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }), []);
  const t0 = analysis.t0 || 0;

  return (
    <HighlightContext.Provider value={setHighlightMetric}>
      <article className="rv">
        <header className="rv-head">
          <div className="rv-titles">
            <p className="rv-label">
              {cfg.name} · {weightText} · {date}
              {input.sample && <span className="rv-tag">Sample</span>}
            </p>
            <h1 className="rv-headline">{headline}</h1>
          </div>
          <div className="rv-actions">
            <ExportBar analysis={analysis} input={input} report={report} />
            <button type="button" className="btn btn-primary btn-small" onClick={onNewSet}>
              New set
            </button>
          </div>
        </header>

        <div className="rv-body">
          <section className="stage" aria-label="Video">
            <div className="stage-bar">
              <div className="mode-toggle" role="tablist" aria-label="View">
                <button role="tab" aria-selected={mode === 'full'} className={mode === 'full' ? 'is-active' : ''} onClick={() => switchMode('full')}>
                  Full set
                </button>
                <button role="tab" aria-selected={mode === 'compare'} className={mode === 'compare' ? 'is-active' : ''} onClick={() => switchMode('compare')} disabled={!leftRep}>
                  Compare
                </button>
              </div>
              <p className="stage-hint">
                {mode === 'compare'
                  ? `Baseline rep ${leftRep?.index} on the left. Pick a rep below to put it on the right.`
                  : 'Pick a rep below to jump to it. Hover a measurement to see the joints it tracks.'}
              </p>
            </div>

            <div className="stage-main">
              {mode === 'full' ? (
                <FullPlayer
                  ref={fullRef}
                  src={prepared?.url}
                  rotation={prepared?.rotation || 0}
                  analysis={analysis}
                  selectedRep={selectedRep}
                  onSelectRep={setSelectedRep}
                  rate={rate}
                  showSkeleton={showSkeleton}
                  loop={loop}
                  highlight={highlight}
                  onState={onState}
                />
              ) : (
                <ComparePlayer
                  ref={compareRef}
                  src={prepared?.url}
                  rotation={prepared?.rotation || 0}
                  analysis={analysis}
                  leftRep={leftRep}
                  rightRep={rightRep}
                  rate={rate}
                  showSkeleton={showSkeleton}
                  loop={loop}
                  highlight={highlight}
                  onState={onState}
                />
              )}
            </div>

            <RepStrip
              analysis={analysis}
              mode={mode}
              time={time}
              selectedRep={mode === 'compare' ? rightRep?.index : selectedRep}
              compareLeft={leftRep?.index}
              onRep={chooseRep}
              onSeek={(t) => fullRef.current?.seek(t)}
            />

            <ControlBar
              mode={mode}
              playing={playing}
              time={time}
              tStart={t0}
              tEnd={t0 + analysis.duration}
              compareText={leftRep && rightRep ? `Rep ${leftRep.index} vs rep ${rightRep.index}` : ''}
              onToggle={togglePlay}
              onStep={step}
              rate={rate}
              onRate={setRate}
              loop={loop}
              onLoop={() => {
                if (!loop && mode === 'full' && !selectedRep && focusRep) setSelectedRep(focusRep.index);
                setLoop((l) => !l);
              }}
              showSkeleton={showSkeleton}
              onSkeleton={() => setShowSkeleton((s) => !s)}
              onDetails={() => setDrawer(true)}
            />
          </section>

          <SidePanel analysis={analysis} input={input} rep={focusRep} reason={focusReason} />
        </div>

        <DetailsDrawer
          open={drawer}
          onClose={() => setDrawer(false)}
          analysis={analysis}
          input={input}
          report={report}
          llmPending={llmPending}
          selectedRep={focusRep?.index}
          onRep={(i) => {
            setDrawer(false);
            chooseRep(i);
          }}
          onHistory={onHistory}
        />
      </article>
    </HighlightContext.Provider>
  );
}
