// Vercel function: POST /api/report. The logic lives in server/report/, shared
// with the Vite dev server and server/index.js. maxDuration is set in vercel.json.

import { createWebHandlers } from '../server/report/web.js';

const handlers = createWebHandlers();

export default {
  fetch(request) {
    return handlers.report(request);
  },
};
