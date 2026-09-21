import { serve } from '@hono/node-server';
import { fileURLToPath } from 'node:url';
import { createCollectorApp } from './app.js';
import { openDb } from './db.js';

const dbPath =
  process.env.SKLUM_DB ?? fileURLToPath(new URL('../data/events.sqlite', import.meta.url));

const db = openDb(dbPath);
const app = createCollectorApp(db);

const port = Number(process.env.PORT ?? 4200);
serve({ fetch: app.fetch, port });
console.log(`[collector] listening on :${port}, store ${dbPath}`);
