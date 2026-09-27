// Copies the MediaPipe wasm runtime into public/ and downloads the pose model
// once, so pose detection runs fully on-device with no CDN at runtime.
import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const wasmSrc = join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
// The wasm goes in a folder named after the MediaPipe version, so it can be
// cached forever (vercel.json) and an upgrade gets new URLs instead of
// mixing an old cached wasm with new JavaScript. src/lib/pose/extract.js
// reads the same version (vite.config.js defines __MEDIAPIPE_VERSION__).
const { version } = JSON.parse(await readFile(join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'package.json'), 'utf8'));
const wasmDest = join(root, 'public', 'mediapipe', version, 'wasm');
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

await rm(join(root, 'public', 'mediapipe'), { recursive: true, force: true }); // generated; drop older versions
await mkdir(wasmDest, { recursive: true });
await cp(wasmSrc, wasmDest, { recursive: true });
console.log(`[spotter] MediaPipe wasm copied to public/mediapipe/${version}/wasm`);

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
