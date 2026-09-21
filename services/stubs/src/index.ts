import { serve } from '@hono/node-server';
import { createStubsApp } from './app.js';

const port = Number(process.env.PORT ?? 4000);
serve({ fetch: createStubsApp().fetch, port });
console.log(`[stubs] catalogue, orders and promise listening on :${port}`);
