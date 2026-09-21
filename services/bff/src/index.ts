import { serve } from '@hono/node-server';
import { createBffApp } from './app.js';

const port = Number(process.env.PORT ?? 4100);
serve({ fetch: createBffApp().fetch, port });
console.log(`[bff] listening on :${port}`);
