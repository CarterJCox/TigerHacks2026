import { readFileSync } from 'node:fs';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { createReportHandler } from './server/report/node.js';

// Mounts the report endpoint inside the Vite dev server (and vite preview) so
// `npm run dev` is the only command needed. server/index.js and the Vercel
// functions in api/ use the same service (server/report/).
function reportApi(env) {
  return {
    name: 'spotter-report-api',
    configureServer(server) {
      server.middlewares.use('/api', createReportHandler(env));
    },
    configurePreviewServer(server) {
      server.middlewares.use('/api', createReportHandler(env));
    },
  };
}

const mediapipeVersion = JSON.parse(readFileSync(new URL('./node_modules/@mediapipe/tasks-vision/package.json', import.meta.url), 'utf8')).version;

export default defineConfig(({ mode }) => {
  // Load every variable (not only VITE_*) for the server side. None of these
  // are exposed to the browser bundle.
  const env = { ...process.env, ...loadEnv(mode, process.cwd(), '') };
  return {
    plugins: [react(), reportApi(env)],
    optimizeDeps: {
      // ffmpeg.wasm spawns its own worker and must not be pre-bundled.
      exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'],
    },
    worker: { format: 'es' },
    // Where scripts/setup-assets.mjs put the MediaPipe wasm (public/mediapipe/<version>/wasm).
    define: { __MEDIAPIPE_VERSION__: JSON.stringify(mediapipeVersion) },
    build: { target: 'es2022', chunkSizeWarningLimit: 1200 },
    // The copied MediaPipe wasm never changes while developing. Watching it
    // on Windows can crash the dev server (EBUSY) if npm install re-copies it.
    server: { watch: { ignored: ['**/public/mediapipe/**'] } },
  };
});
