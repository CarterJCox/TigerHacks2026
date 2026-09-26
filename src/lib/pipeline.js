// pipeline.js: End-to-end analysis of a prepared video. Everything here runs on-device.

import { extractPose } from './pose/extract.js';
import { analyzeTrack } from './analysis/analyze.js';

export const SAMPLE_FPS = 15;
export const ANALYSIS_MAX_SIDE = 640;

export async function runAnalysis({ prepared, exerciseId, painReported, onProgress, signal }) {
  onProgress({ stage: 'model', fraction: 0 });
  const track = await extractPose({
    video: prepared.video,
    rotation: prepared.rotation,
    fps: SAMPLE_FPS,
    maxSide: ANALYSIS_MAX_SIDE,
    signal,
    onProgress: ({ done, total, eta }) => onProgress({ stage: 'pose', fraction: done / total, done, total, eta }),
  });
  onProgress({ stage: 'measure', fraction: 1 });
  // Let the UI paint the final stage before the (fast) synchronous analysis.
  await new Promise((r) => setTimeout(r, 30));
  const analysis = analyzeTrack(track, exerciseId, { painReported });
  analysis.delegate = track.delegate;
  return analysis;
}
