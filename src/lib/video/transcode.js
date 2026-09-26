// transcode.js:Fallback for videos the browser can't decode (most often iPhone HEVC .mov
// files in browsers without HEVC support). ffmpeg.wasm runs entirely inside
// this tab: the file is converted in memory and never uploaded anywhere.
// ffmpeg also applies the rotation metadata while converting.

import { FFmpeg } from '@ffmpeg/ffmpeg';
import coreURL from '@ffmpeg/core?url';
import wasmURL from '@ffmpeg/core/wasm?url';

let ffmpegPromise = null;

async function getFFmpeg() {
  if (!ffmpegPromise) {
    ffmpegPromise = (async () => {
      const ffmpeg = new FFmpeg();
      await ffmpeg.load({ coreURL, wasmURL });
      return ffmpeg;
    })().catch((err) => {
      ffmpegPromise = null;
      throw err;
    });
  }
  return ffmpegPromise;
}

const MAX_TRANSCODE_BYTES = 700 * 1024 * 1024;

/**
 * Converts `file` to a small H.264 MP4 (long side 720 px, max 30 fps, no audio).
 * onProgress receives 0..1. Returns a Blob.
 */
export async function transcodeToH264(file, onProgress = () => {}) {
  if (file.size > MAX_TRANSCODE_BYTES) {
    throw new Error('This video is too large to convert in the browser. Trim it to just the set and try again.');
  }
  const ffmpeg = await getFFmpeg();
  const ext = (file.name.split('.').pop() || 'mov').toLowerCase().replace(/[^a-z0-9]/g, '') || 'mov';
  const input = `input.${ext}`;
  const output = 'output.mp4';
  const progress = ({ progress }) => {
    if (Number.isFinite(progress)) onProgress(Math.max(0, Math.min(1, progress)));
  };
  let log = '';
  const logger = ({ message }) => {
    log = (log + '\n' + message).slice(-4000);
  };
  ffmpeg.on('progress', progress);
  ffmpeg.on('log', logger);
  try {
    await ffmpeg.writeFile(input, new Uint8Array(await file.arrayBuffer()));
    const code = await ffmpeg.exec([
      '-i', input,
      '-an',
      '-vf', "scale='if(gt(iw,ih),min(720,iw),-2)':'if(gt(iw,ih),-2,min(720,ih))',format=yuv420p",
      '-fpsmax', '30',
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-crf', '24',
      '-movflags', '+faststart',
      output,
    ]);
    if (code !== 0) {
      const reason = /Invalid data|could not find codec|Decoder .* not found|Unknown/i.test(log)
        ? 'The file format was not recognised.'
        : 'The converter could not read this video.';
      throw new Error(reason);
    }
    const data = await ffmpeg.readFile(output);
    return new Blob([data], { type: 'video/mp4' });
  } finally {
    ffmpeg.off('progress', progress);
    ffmpeg.off('log', logger);
    await ffmpeg.deleteFile(input).catch(() => {});
    await ffmpeg.deleteFile(output).catch(() => {});
  }
}
