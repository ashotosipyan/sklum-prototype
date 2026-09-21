import { serve, type ServerType } from '@hono/node-server';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { uuidv7 } from '@sklum/events';
import { createBffApp } from '../services/bff/src/app';
import type { FeedResponse } from '../services/bff/src/feed';
import { createCollectorApp } from '../services/collector/src/app';
import { openDb } from '../services/collector/src/db';
import { createStubsApp } from '../services/stubs/src/app';

/**
 * The BFF is exercised over real HTTP against the real stubs and collector,
 * because what is under test is its behaviour when upstreams are slow or dead,
 * and that only exists across a real network boundary.
 */
let stubs: ServerType;
let collector: ServerType;
let coreUrl: string;
let collectorUrl: string;
const bff = createBffApp();

const listen = (fetch: (req: Request) => Response | Promise<Response>) =>
  new Promise<{ server: ServerType; url: string }>((resolve) => {
    const server = serve({ fetch, port: 0 }, (info: AddressInfo) =>
      resolve({ server, url: `http://127.0.0.1:${info.port}` }),
    );
  });

beforeAll(async () => {
  ({ server: stubs, url: coreUrl } = await listen(createStubsApp().fetch));
  ({ server: collector, url: collectorUrl } = await listen(createCollectorApp(openDb(':memory:')).fetch));
  process.env.CORE_BASE_URL = coreUrl;
  process.env.COLLECTOR_URL = collectorUrl;
});

afterAll(() => {
  for (const s of [stubs, collector]) {
    (s as unknown as { closeAllConnections?: () => void }).closeAllConnections?.();
    s.close();
  }
});

beforeEach(async () => {
  process.env.COLLECTOR_URL = collectorUrl;
  await fetch(`${coreUrl}/_control/reset`, { method: 'POST' });
});

const control = (service: string, body: object) =>
  fetch(`${coreUrl}/_control/${service}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

async function getFeed(headers: Record<string, string> = {}): Promise<{ status: number; body: FeedResponse; ms: number }> {
  const started = Date.now();
  const res = await bff.request('/v1/feed?limit=20', { headers });
  return { status: res.status, body: (await res.json()) as FeedResponse, ms: Date.now() - started };
}

describe('BFF: degrade, never fail', () => {
  it('pins the active order above everything on the happy path', async () => {
    const { status, body } = await getFeed({ 'x-customer-id': 'cust_1', 'x-anonymous-id': 'anon_A' });
    expect(status).toBe(200);
    expect(body.degraded).toEqual([]);
    expect(body.items[0]?.type).toBe('order_status');
    expect(body.items.filter((i) => i.type === 'product').every((i) => i.category)).toBe(true);
  });

  it('with the orders service down, still returns 200 and tells the customer something true', async () => {
    await control('orders', { fail: true });
    const { status, body } = await getFeed({ 'x-customer-id': 'cust_1' });

    expect(status).toBe(200);
    expect(body.degraded).toContain('orders');
    expect(body.items[0]).toMatchObject({ id: 'order_unavailable', type: 'order_status', status: 'unavailable' });
    expect(body.items.some((i) => i.type === 'product')).toBe(true);
  });

  it('with the promise service slower than its budget, widens every promise instead of waiting or guessing', async () => {
    await control('promise', { latency_ms: 2000 });
    const { body, ms } = await getFeed({ 'x-customer-id': 'cust_1' });

    expect(ms).toBeLessThan(1000);
    expect(body.degraded).toContain('promise');
    const promised = body.items.filter((i) => i.delivery);
    expect(promised.length).toBeGreaterThan(0);
    for (const item of promised) {
      expect(item.delivery).toMatchObject({ confidence: 'low', source: 'fallback', window_days: 21 });
    }
  });

  it('with the event store unreachable, serves an unpersonalised feed rather than no feed', async () => {
    process.env.COLLECTOR_URL = 'http://127.0.0.1:1';
    const { status, body } = await getFeed({ 'x-anonymous-id': 'anon_A' });

    expect(status).toBe(200);
    expect(body.degraded).toEqual(['affinity']);
    expect(body.items.length).toBeGreaterThan(0);
  });
});

describe('the loop closes: captured signal changes the next feed', () => {
  it('saves in a category move that category to the top of the next ranking', async () => {
    const anon = `anon_${uuidv7()}`;
    const firstProduct = (feed: FeedResponse) => feed.items.find((i) => i.type === 'product');

    const before = await getFeed({ 'x-anonymous-id': anon });
    expect(firstProduct(before.body)?.category).not.toBe('outdoor');

    const events = ['sku_0003', 'sku_0009', 'sku_0015'].map((item_id) => ({
      event_id: uuidv7(),
      event_name: 'item_saved',
      schema_version: 1,
      occurred_at: new Date().toISOString(),
      anonymous_id: anon,
      session_id: 's',
      surface: 'home',
      app_version: '0.1.0',
      payload: { item_id, category: 'outdoor' },
    }));
    const ingest = await fetch(`${collectorUrl}/v1/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sent_at: new Date().toISOString(), events }),
    });
    expect(ingest.status).toBe(200);

    const after = await getFeed({ 'x-anonymous-id': anon });
    expect(after.body.degraded).toEqual([]);
    expect(firstProduct(after.body)?.category).toBe('outdoor');
  });
});
