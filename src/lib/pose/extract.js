// extract.js:Samples frames from the video (~15 fps, downscaled) and runs MediaPipe Pose
// Landmarker on each one, entirely in the browser.

import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import { drawVideoFrame, rotatedSize, seekVideo } from '../video/frame.js';
import { NUM_LANDMARKS } from './landmarks.js';

const BASE = import.meta.env.BASE_URL || '/';
const WASM_PATH = `${BASE}mediapipe/wasm`;
const MODEL_PATH = `${BASE}models/pose_landmarker_full.task`;

let filesetPromise = null;

function getFileset() {
  if (!filesetPromise) {
    filesetPromise = FilesetResolver.forVisionTasks(WASM_PATH).catch((err) => {
      filesetPromise = null;
      throw err;
    });
  }
  return filesetPromise;
}

async function createLandmarker() {
  const fileset = await getFileset();
  const options = (delegate) => ({
    baseOptions: { modelAssetPath: MODEL_PATH, delegate },
    runningMode: 'VIDEO',
    numPoses: 1,
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
    outputSegmentationMasks: false,
  });
  try {
    return { landmarker: await PoseLandmarker.createFromOptions(fileset, options('GPU')), delegate: 'GPU' };
  } catch (err) {
    console.warn('[spotter] GPU pose delegate unavailable, using CPU', err);
    return { landmarker: await PoseLandmarker.createFromOptions(fileset, options('CPU')), delegate: 'CPU' };
  }
}

export class AnalysisCancelled extends Error {
  constructor() {
    super('Analysis cancelled');
    this.name = 'AnalysisCancelled';
  }
}

/**
 * start/end (seconds) limit analysis to a trimmed range; times stay in the
 * original video's clock so playback can seek straight to them.
 * @returns {Promise<Track>} where Track = {
 *   n, fps, width, height, duration, t0,
 *   times: Float64Array(n),              // seconds in the original video
 *   raw: Float32Array(n * 33 * 4),       // x, y (normalized 0..1), z, visibility
 *   hasPose: Uint8Array(n),
 *   delegate,
 * }
 */
export async function extractPose({ video, rotation = 0, fps = 15, maxSide = 640, start = 0, end = null, onProgress = () => {}, signal }) {
  const { landmarker, delegate } = await createLandmarker();
  try {
    const size = rotatedSize(video.videoWidth, video.videoHeight, rotation);
    const scale = Math.min(1, maxSide / Math.max(size.width, size.height));
    const width = Math.max(2, Math.round(size.width * scale));
    const height = Math.max(2, Math.round(size.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { alpha: false });

    const t0 = Math.max(0, Math.min(start, video.duration - 0.1));
    const t1 = Math.min(video.duration, end ?? video.duration);
    const duration = Math.max(0.1, t1 - t0);
    const n = Math.max(1, Math.floor(duration * fps - 1e-6) + 1);
    const times = new Float64Array(n);
    const raw = new Float32Array(n * NUM_LANDMARKS * 4);
    const hasPose = new Uint8Array(n);
    video.pause();

    const started = performance.now();
    for (let i = 0; i < n; i++) {
      if (signal?.aborted) throw new AnalysisCancelled();
      const t = Math.min(t0 + i / fps, Math.max(0, t1 - 0.02));
      times[i] = t;
      await seekVideo(video, t);
      drawVideoFrame(ctx, video, rotation, width, height);
      // Timestamps must strictly increase within one landmarker instance.
      const result = landmarker.detectForVideo(canvas, Math.round(i * (1000 / fps)) + 1);
      const pose = result?.landmarks?.[0];
      if (pose && pose.length >= NUM_LANDMARKS) {
        hasPose[i] = 1;
        const base = i * NUM_LANDMARKS * 4;
        for (let j = 0; j < NUM_LANDMARKS; j++) {
          const p = pose[j];
          raw[base + j * 4] = p.x;
          raw[base + j * 4 + 1] = p.y;
          raw[base + j * 4 + 2] = p.z;
          raw[base + j * 4 + 3] = p.visibility ?? 0;
        }
      }
      if (i % 3 === 0 || i === n - 1) {
        const elapsed = (performance.now() - started) / 1000;
        const eta = i > 5 ? (elapsed / (i + 1)) * (n - i - 1) : null;
        onProgress({ done: i + 1, total: n, eta });
      }
    }
    const secs = (performance.now() - started) / 1000;
    console.info(`[spotter] pose: ${n} frames in ${secs.toFixed(1)} s (${(n / secs).toFixed(1)} frames/s, ${delegate})`);
    return { n, fps, width, height, duration, t0, times, raw, hasPose, delegate };
  } finally {
    landmarker.close();
  }
}
