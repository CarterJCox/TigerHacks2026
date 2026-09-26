import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { createReportHandler } from './server/report.js';

// Mounts the report endpoint inside the Vite dev server so `npm run dev`
// is the only command needed. `npm start` serves the same handler in production.
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
    build: { target: 'es2022', chunkSizeWarningLimit: 1200 },
  };
});
