// Vercel function: GET /api/health. Tells the browser whether Claude is
// configured, so it only asks for a written report when it can get one.

import { createWebHandlers } from '../server/report/web.js';

const handlers = createWebHandlers();

export default {
  fetch(request) {
    return handlers.health(request);
  },
};
