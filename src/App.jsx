import { useCallback, useEffect, useRef, useState } from 'react';
import SetupView from './components/SetupView.jsx';
import AnalyzingView from './components/AnalyzingView.jsx';
import RejectedView from './components/RejectedView.jsx';
import ResultsView from './components/ResultsView.jsx';
import HistoryView from './components/HistoryView.jsx';
import { runAnalysis } from './lib/pipeline.js';
import { AnalysisCancelled } from './lib/pose/extract.js';
import { buildTemplateReport } from './lib/report/template.js';
import { buildPayload } from './lib/report/payload.js';
import { fetchLlmReport, fetchReportStatus } from './lib/report/client.js';
import { saveSession, sessionFromAnalysis } from './lib/history.js';
import { EXERCISES } from './config/exercises/index.js';
import { initialInput, rememberInput, weightFor } from './lib/prefs.js';

const DEFAULT_INPUT = {
  exerciseId: 'curl',
  weight: '',
  unit: 'lb',
  bodyweight: false,
  plannedReps: '',
  painReported: false,
  notes: '',
};

export default function App() {
  const [screen, setScreen] = useState('setup');
  const [input, setInput] = useState(() => {
    const init = initialInput(DEFAULT_INPUT);
    return EXERCISES[init.exerciseId] ? init : DEFAULT_INPUT;
  });
  const [runInput, setRunInput] = useState(null); // input of the analysis in progress or shown
  const [prepared, setPrepared] = useState(null);
  const [progress, setProgress] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [historyExercise, setHistoryExercise] = useState(null);
  const abortRef = useRef(null);

  // Remember the selected exercise and weight for next time.
  useEffect(() => {
    rememberInput(input);
  }, [input.exerciseId, input.weight, input.unit, input.bodyweight]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the page scrolled to the top on screen changes.
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
  }, [screen]);

  const releasePrepared = useCallback((p) => {
    if (p?.url) URL.revokeObjectURL(p.url);
  }, []);

  const startOver = useCallback(
    (keepInput = true) => {
      abortRef.current?.abort();
      releasePrepared(prepared);
      setPrepared(null);
      setResult(null);
      setError(null);
      setProgress(null);
      if (!keepInput) setInput(DEFAULT_INPUT);
      setScreen('setup');
    },
    [prepared, releasePrepared],
  );

  const analyze = useCallback(
    async (finalInput, preparedVideo) => {
      // The sample carries its own inputs; the user's form stays as it was.
      if (!finalInput.sample) setInput(finalInput);
      setRunInput(finalInput);
      setPrepared(preparedVideo);
      setScreen('analyzing');
      setError(null);
      setProgress({ stage: 'model', fraction: 0 });
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const analysis = await runAnalysis({
          prepared: preparedVideo,
          exerciseId: finalInput.exerciseId,
          painReported: finalInput.painReported,
          signal: controller.signal,
          onProgress: setProgress,
        });
        if (controller.signal.aborted) return;
        if (import.meta.env.DEV) window.__spotter = { analysis };
        if (analysis.status !== 'ok') {
          setResult({ analysis, input: finalInput });
          setScreen('rejected');
          return;
        }
        const report = buildTemplateReport(analysis, finalInput);
        // The bundled sample isn't the user's set, so it stays out of their history.
        if (!finalInput.sample) saveSession(finalInput.exerciseId, sessionFromAnalysis(analysis, finalInput, report.headline));
        const { llm: llmAvailable } = await fetchReportStatus();
        setResult({ analysis, input: finalInput, report, llmPending: llmAvailable });
        setScreen('results');
        if (!llmAvailable) return;
        const llm = await fetchLlmReport(buildPayload(analysis, finalInput, report), { signal: controller.signal });
        if (controller.signal.aborted) return;
        setResult((prev) =>
          prev && prev.analysis === analysis
            ? { ...prev, report: llm ? { ...llm, cues: finalInput.painReported ? [] : llm.cues } : prev.report, llmPending: false }
            : prev,
        );
      } catch (err) {
        if (err instanceof AnalysisCancelled) return;
        console.error(err);
        setError(err?.message || 'Something went wrong while analyzing the video.');
        setScreen('setup');
      }
    },
    [],
  );

  // Dev-only: render an analysis produced in the console (used to review UI states).
  useEffect(() => {
    if (!import.meta.env.DEV) return undefined;
    window.__spotterShow = (analysis, overrides = {}) => {
      const finalInput = { ...input, exerciseId: analysis.exerciseId, ...overrides };
      setInput(finalInput);
      setResult({ analysis, input: finalInput, report: buildTemplateReport(analysis, finalInput), llmPending: false });
      setScreen('results');
    };
    return () => {
      delete window.__spotterShow;
    };
  }, [input]);

  const cancelAnalysis = useCallback(() => {
    abortRef.current?.abort();
    setProgress(null);
    setScreen('setup');
  }, []);

  const showHistory = useCallback((exerciseId) => {
    setHistoryExercise(exerciseId || null);
    setScreen('history');
  }, []);

  return (
    <div className="app">
      <header className="topbar">
        <button className="brand" onClick={() => (screen === 'analyzing' ? null : startOver(true))} aria-label="Spotter, start a new set">
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 32 32" width="22" height="22">
              <path d="M6 23 L13 10 L18 17 L26 7" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <span className="brand-name">Spotter</span>
        </button>
        <nav className="topnav" aria-label="Main">
          <button
            className={`navlink ${screen !== 'history' ? 'is-active' : ''}`}
            onClick={() => (screen === 'history' ? setScreen(result?.report ? 'results' : 'setup') : null)}
            disabled={screen === 'analyzing'}
          >
            {result?.report && screen === 'history' ? 'Last set' : 'Analyze'}
          </button>
          <button
            className={`navlink ${screen === 'history' ? 'is-active' : ''}`}
            onClick={() => showHistory(input.exerciseId)}
            disabled={screen === 'analyzing'}
          >
            History
          </button>
        </nav>
      </header>

      <main className="main" key={screen}>
        {screen === 'setup' && (
          <SetupView
            input={input}
            onInputChange={setInput}
            onAnalyze={analyze}
            initialPrepared={prepared}
            onDiscardPrepared={() => {
              releasePrepared(prepared);
              setPrepared(null);
            }}
            error={error}
            onDismissError={() => setError(null)}
          />
        )}
        {screen === 'analyzing' && <AnalyzingView progress={progress} input={runInput || input} onCancel={cancelAnalysis} />}
        {screen === 'rejected' && result && (
          <RejectedView
            analysis={result.analysis}
            input={result.input}
            onRetry={() => startOver(true)}
            onRetryAs={(exerciseId) => {
              // Same video, different exercise: no need to upload again.
              const w = weightFor(exerciseId);
              const next = {
                ...result.input,
                exerciseId,
                bodyweight: EXERCISES[exerciseId].allowBodyweight && Boolean(w ? w.bodyweight : result.input.bodyweight),
                ...(w && !w.bodyweight ? { weight: Number(w.weight), unit: w.unit } : {}),
              };
              analyze(next, prepared);
            }}
          />
        )}
        {screen === 'results' && result?.report && (
          <ResultsView
            analysis={result.analysis}
            input={result.input}
            report={result.report}
            llmPending={result.llmPending}
            prepared={prepared}
            onNewSet={() => startOver(true)}
            onHistory={() => showHistory(result.input.exerciseId)}
          />
        )}
        {screen === 'history' && (
          <HistoryView
            initialExercise={historyExercise || input.exerciseId}
            onStart={(exerciseId) => {
              startOver(true);
              if (exerciseId && EXERCISES[exerciseId]) {
                const w = weightFor(exerciseId);
                setInput((i) => ({
                  ...i,
                  exerciseId,
                  ...(w ? { weight: w.weight ?? '', unit: w.unit === 'kg' ? 'kg' : 'lb', bodyweight: EXERCISES[exerciseId].allowBodyweight && Boolean(w.bodyweight) } : {}),
                }));
              }
            }}
          />
        )}
      </main>

      <footer className="footer">
        <p>Video analysis runs on this device. Your video is never uploaded.</p>
      </footer>
    </div>
  );
}
