// load.js: Turns a user-selected file into a decodable <video> plus the rotation that
// still needs to be applied when drawing it. Tries the browser's own decoder
// first and falls back to an in-browser ffmpeg conversion.

import { probeContainer, describeCodec } from './probe.js';
import { seekVideo } from './frame.js';

export class VideoLoadError extends Error {
  constructor(message, detail) {
    super(message);
    this.name = 'VideoLoadError';
    this.detail = detail;
  }
}

// Longer videos can be loaded and then trimmed to the set before analysis.
const MAX_DURATION_SEC = 600;

function createVideo(url) {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.crossOrigin = 'anonymous';
  video.src = url;
  return video;
}

function waitForMetadata(video, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      video.removeEventListener('loadeddata', ok);
      video.removeEventListener('error', bad);
    };
    const ok = () => {
      cleanup();
      resolve();
    };
    const bad = () => {
      cleanup();
      reject(new Error(video.error?.message || 'decode error'));
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('timed out waiting for the first frame'));
    }, timeoutMs);
    if (video.readyState >= 2) ok();
    video.addEventListener('loadeddata', ok);
    video.addEventListener('error', bad);
  });
}

// Browsers sometimes "open" an HEVC file and play its audio while producing
// blank frames. Draw a real frame and make sure it has picture content.
async function frameLooksDecoded(video) {
  const t = Math.min(0.5, Math.max(0, (video.duration || 1) / 3));
  await seekVideo(video, t);
  const c = document.createElement('canvas');
  c.width = 48;
  c.height = 48;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(video, 0, 0, 48, 48);
  const { data } = ctx.getImageData(0, 0, 48, 48);
  let sum = 0;
  let sumSq = 0;
  const n = data.length / 4;
  for (let i = 0; i < data.length; i += 4) {
    const l = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    sum += l;
    sumSq += l * l;
  }
  const mean = sum / n;
  const variance = sumSq / n - mean * mean;
  return variance > 4 || mean > 8;
}

async function openNatively(url) {
  const video = createVideo(url);
  await waitForMetadata(video);
  if (!video.videoWidth || !video.videoHeight) throw new Error('no video track decoded');
  if (!(await frameLooksDecoded(video))) throw new Error('frames decode as blank');
  return video;
}

/**
 * Decide how much rotation we still have to apply ourselves. Modern browsers
 * apply the container's rotation matrix automatically; if the element's size
 * still matches the unrotated coded size for a 90/270 rotation, they didn't.
 */
function residualRotation(probe, video) {
  if (!probe || !probe.rotation) return 0;
  if (probe.rotation === 90 || probe.rotation === 270) {
    const codedLandscape = probe.width > probe.height;
    const shownLandscape = video.videoWidth > video.videoHeight;
    if (probe.width !== probe.height && codedLandscape === shownLandscape) return probe.rotation;
  }
  return 0;
}

/**
 * @returns {Promise<{ video, url, rotation, transcoded, probe, duration }>}
 */
export async function prepareVideo(file, { onStatus = () => {}, onConvertProgress = () => {} } = {}) {
  if (!file) throw new VideoLoadError('No file selected.');
  if (file.type && !file.type.startsWith('video/') && !/\.(mov|mp4|m4v|webm|mkv|avi|3gp|hevc)$/i.test(file.name)) {
    throw new VideoLoadError('That file is not a video. Choose an .mp4 or .mov recording of your set.');
  }
  onStatus('Reading video');
  const probe = await probeContainer(file);
  const originalUrl = URL.createObjectURL(file);
  let video;
  let url = originalUrl;
  let transcoded = false;
  let nativeError = null;

  try {
    video = await openNatively(originalUrl);
  } catch (err) {
    nativeError = err;
  }

  if (!video) {
    URL.revokeObjectURL(originalUrl);
    onStatus(`Converting ${describeCodec(probe?.codec)} video on this device`);
    let blob;
    try {
      blob = await transcodeToH264File(file, onConvertProgress);
    } catch (err) {
      throw new VideoLoadError(
        "This video couldn't be decoded in your browser, and converting it on-device failed too.",
        `${describeCodec(probe?.codec)} · ${nativeError?.message || 'unknown'} · ${err.message}. ` +
          'Try exporting it as H.264 MP4 (on iPhone: Settings > Camera > Formats > Most Compatible), or open Spotter in Safari or Chrome.',
      );
    }
    url = URL.createObjectURL(blob);
    try {
      video = await openNatively(url);
      transcoded = true;
    } catch (err) {
      URL.revokeObjectURL(url);
      throw new VideoLoadError("This video couldn't be decoded, even after converting it.", err.message);
    }
  }

  const duration = video.duration;
  if (!Number.isFinite(duration) || duration <= 0.5) {
    URL.revokeObjectURL(url);
    throw new VideoLoadError('This video is too short or its length could not be read.');
  }
  if (duration > MAX_DURATION_SEC) {
    URL.revokeObjectURL(url);
    throw new VideoLoadError(
      `This video is ${Math.round(duration / 60)} minutes long. Cut it down to under ${MAX_DURATION_SEC / 60} minutes around the set (most phones can trim in the Photos app) and upload it again.`,
    );
  }

  return {
    video,
    url,
    rotation: transcoded ? 0 : residualRotation(probe, video),
    transcoded,
    probe,
    duration,
  };
}

async function transcodeToH264File(file, onProgress) {
  const { transcodeToH264 } = await import('./transcode.js');
  return transcodeToH264(file, onProgress);
}
