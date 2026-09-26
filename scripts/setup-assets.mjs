// Copies the MediaPipe wasm runtime into public/ and downloads the pose model
// once, so pose detection runs fully on-device with no CDN at runtime.
import { cp, mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const wasmSrc = join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
const wasmDest = join(root, 'public', 'mediapipe', 'wasm');
const modelDest = join(root, 'public', 'models', 'pose_landmarker_full.task');
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task';

async function exists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

await mkdir(wasmDest, { recursive: true });
await cp(wasmSrc, wasmDest, { recursive: true });
console.log('[spotter] MediaPipe wasm copied to public/mediapipe/wasm');

if (await exists(modelDest)) {
  console.log('[spotter] Pose model already present');
} else {
  await mkdir(dirname(modelDest), { recursive: true });
  console.log('[spotter] Downloading pose model...');
  const res = await fetch(MODEL_URL);
  if (!res.ok) {
    console.error(`[spotter] Model download failed (${res.status}). Download it manually from\n  ${MODEL_URL}\nand save it to public/models/pose_landmarker_full.task`);
    process.exit(0);
  }
  await writeFile(modelDest, Buffer.from(await res.arrayBuffer()));
  console.log('[spotter] Pose model saved to public/models/');
}
