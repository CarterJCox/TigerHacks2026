// In-browser check that a MediaRecorder recording goes through the full
// pipeline: load (WebM with no stored duration) -> pose -> analysis.
// Vitest can't decode video, so this runs in a real browser against the
// dev server or a production preview:
//   const { run } = await import('/tests/browser/recorded-webm.js'); await run();
// It re-records the bundled sample clip through a canvas stream (the same
// MediaRecorder path the Record view uses), analyzes the recording, and
// compares it with the analysis of the original MP4.

import { prepareVideo } from '../../src/lib/video/load.js';
import { probeContainer } from '../../src/lib/video/probe.js';
import { runAnalysis } from '../../src/lib/pipeline.js';
import { SAMPLE } from '../../src/config/sample.js';
import { pickRecordingType } from '../../src/lib/live/recorder.js';

async function recordThroughCanvas(url) {
  const src = document.createElement('video');
  src.src = url;
  src.muted = true;
  src.playsInline = true;
  await new Promise((resolve, reject) => {
    src.onloadeddata = resolve;
    src.onerror = () => reject(new Error('sample failed to load'));
  });
  const canvas = document.createElement('canvas');
  canvas.width = src.videoWidth;
  canvas.height = src.videoHeight;
  const ctx = canvas.getContext('2d');
  const type = pickRecordingType();
  const recorder = new MediaRecorder(canvas.captureStream(30), { mimeType: type.mimeType, videoBitsPerSecond: 5_000_000 });
  const chunks = [];
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const timer = setInterval(() => ctx.drawImage(src, 0, 0, canvas.width, canvas.height), 1000 / 30);
  ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
  recorder.start(1000);
  await src.play();
  await new Promise((resolve) => {
    src.onended = resolve;
  });
  recorder.stop();
  await new Promise((resolve) => {
    recorder.onstop = resolve;
  });
  clearInterval(timer);
  return new File(chunks, `recording.${type.extension}`, { type: type.mimeType });
}

async function analyze(file) {
  const prepared = await prepareVideo(file);
  const analysis = await runAnalysis({ prepared, exerciseId: SAMPLE.input.exerciseId, painReported: false, onProgress: () => {} });
  return { prepared, analysis };
}

export async function run() {
  const started = performance.now();
  const file = await recordThroughCanvas(SAMPLE.url);
  const probe = await probeContainer(file);
  const rec = await analyze(file);
  const original = await analyze(new File([await (await fetch(SAMPLE.url)).blob()], SAMPLE.fileName, { type: 'video/mp4' }));
  const summary = (a) => ({ status: a.status, reps: a.reps.length, scored: a.reps.filter((r) => r.scorable).length, severity: a.form?.severity ?? null });
  const result = {
    type: file.type,
    bytes: file.size,
    probe,
    duration: Math.round(rec.prepared.duration * 100) / 100,
    transcoded: rec.prepared.transcoded,
    recorded: summary(rec.analysis),
    original: summary(original.analysis),
    seconds: Math.round((performance.now() - started) / 100) / 10,
  };
  result.ok = result.recorded.status === 'ok' && Number.isFinite(result.duration) && Math.abs(result.recorded.reps - result.original.reps) <= 1;
  console.info('[spotter] recorded WebM pipeline check', result);
  return result;
}
