import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { buildFeed } from './feed.js';
import type { Affinity } from './ranking.js';

const app = new Hono();

/**
 * Affinity normally comes from the event store via tools/analyze. Until the
 * collector lands it is injectable, so the ranking loop can be exercised and
 * tested independently of the pipeline that feeds it.
 */
let affinity: Affinity = {};

app.get('/health', (c) => c.json({ ok: true }));

app.put('/_debug/affinity', async (c) => {
  affinity = await c.req.json<Affinity>();
  return c.json({ affinity });
});

app.get('/v1/feed', async (c) => {
  const limit = Math.min(Number(c.req.query('limit') ?? 20), 50);
  const customerId = c.req.header('x-customer-id');
  const feed = await buildFeed({ customerId, limit, affinity });

  /**
   * A degraded feed is still a successful response. Returning 5xx because one
   * upstream is unhealthy would hand the client a decision it cannot make well;
   * naming the degradation lets it render honestly instead.
   */
  c.header('x-degraded', feed.degraded.join(',') || 'none');
  return c.json(feed);
});

const port = Number(process.env.PORT ?? 4100);
serve({ fetch: app.fetch, port });
console.log(`[bff] listening on :${port}`);
