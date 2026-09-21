import { Hono } from 'hono';
import { buildFeed } from './feed.js';

export function createBffApp() {
  const app = new Hono();

  app.get('/health', (c) => c.json({ ok: true }));

  app.get('/v1/feed', async (c) => {
    const limit = Math.min(Math.max(Number(c.req.query('limit') ?? 20) || 20, 1), 50);
    const feed = await buildFeed({
      customerId: c.req.header('x-customer-id') || undefined,
      anonymousId: c.req.header('x-anonymous-id') || undefined,
      limit,
    });

    /**
     * A degraded feed is still a successful response. Returning 5xx because one
     * upstream is unhealthy would hand the client a decision it cannot make well;
     * naming the degradation lets it render honestly instead.
     */
    c.header('x-degraded', feed.degraded.join(',') || 'none');
    return c.json(feed);
  });

  return app;
}
