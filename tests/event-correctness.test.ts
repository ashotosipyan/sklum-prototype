import { describe, expect, it } from 'vitest';
import { MemoryStore, Tracker, type SendOutcome, type Transport } from '../apps/mobile/src/tracking/tracker';
import { computeAffinity } from '../services/collector/src/affinity';
import { createCollectorApp } from '../services/collector/src/app';
import { openDb } from '../services/collector/src/db';

/**
 * These tests run the device tracker against the real collector, in process.
 * Nothing is mocked except the network, which is exactly the part that fails in
 * the real world: it goes offline, and it drops acknowledgements after the
 * server has already done the work.
 */
function harness() {
  const db = openDb(':memory:');
  const collector = createCollectorApp(db);
  const net = { online: true, loseNextAck: false, rejectNext: false };

  const transport: Transport = {
    async send(batch): Promise<SendOutcome> {
      if (!net.online) return { kind: 'retry' };
      if (net.rejectNext) {
        net.rejectNext = false;
        return { kind: 'rejected' };
      }
      const res = await collector.request('/v1/events', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(batch),
      });
      if (net.loseNextAck) {
        // The server stored the batch; the response never reached the device.
        net.loseNextAck = false;
        throw new Error('connection reset after the server processed the request');
      }
      if (res.ok) return { kind: 'ok' };
      return res.status < 500 ? { kind: 'rejected' } : { kind: 'retry' };
    },
  };

  const store = new MemoryStore();
  const tracker = (opts: { anon?: string; maxQueue?: number; onStore?: MemoryStore } = {}) =>
    new Tracker({
      store: opts.onStore ?? store,
      transport,
      identity: { anonymous_id: opts.anon ?? 'anon_A', session_id: 'sess_1', app_version: '0.1.0' },
      maxQueue: opts.maxQueue ?? 500,
      onInvalid: (issue) => {
        throw new Error(`tracker refused an event the test expected to be valid: ${issue}`);
      },
    });

  const count = (eventName?: string): number =>
    (
      (eventName
        ? db.prepare('SELECT COUNT(*) AS n FROM events WHERE event_name = ?').get(eventName)
        : db.prepare('SELECT COUNT(*) AS n FROM events').get()) as { n: number }
    ).n;

  const counter = (name: string): number =>
    (db.prepare('SELECT value FROM ingest_counters WHERE name = ?').get(name) as { value: number } | undefined)
      ?.value ?? 0;

  return { db, collector, net, store, tracker, count, counter };
}

const save = (t: Tracker, itemId: string, category: string) =>
  t.track('item_saved', { item_id: itemId, category }, { surface: 'home' });

describe('event correctness: exactly once per user action', () => {
  it('three saves made offline arrive exactly once after reconnecting', async () => {
    const h = harness();
    const t = h.tracker();
    h.net.online = false;

    const ids = [save(t, 'sku_1', 'sofas'), save(t, 'sku_2', 'sofas'), save(t, 'sku_3', 'lighting')];
    await t.flush();

    expect(h.count()).toBe(0);
    expect(t.pending()).toBe(3);

    h.net.online = true;
    await t.flush({ ignoreBackoff: true });

    expect(h.count('item_saved')).toBe(3);
    expect(t.pending()).toBe(0);
    const stored = (h.db.prepare('SELECT event_id FROM events ORDER BY event_id').all() as { event_id: string }[]).map(
      (r) => r.event_id,
    );
    expect(stored).toEqual([...ids].sort());
  });

  it('an acknowledgement lost after the server stored the batch does not duplicate on retry', async () => {
    const h = harness();
    const t = h.tracker();
    for (let i = 0; i < 5; i++) save(t, `sku_${i}`, 'outdoor');

    h.net.loseNextAck = true;
    await t.flush();
    expect(h.count()).toBe(5); // the server has them
    expect(t.pending()).toBe(5); // the device does not know that

    await t.flush({ ignoreBackoff: true });
    expect(h.count()).toBe(5);
    expect(t.pending()).toBe(0);
    expect(h.counter('duplicates')).toBe(5);
  });

  it('the queue survives the process being killed mid-flush, with no loss and no duplication', async () => {
    const h = harness();
    const doomed = h.tracker();
    for (let i = 0; i < 4; i++) save(doomed, `sku_${i}`, 'storage');

    h.net.loseNextAck = true;
    await doomed.flush(); // server stores, device never learns; then the process dies

    const relaunched = h.tracker(); // same persistent store, fresh process
    expect(relaunched.pending()).toBe(4);
    await relaunched.drain();

    expect(h.count()).toBe(4);
    expect(relaunched.pending()).toBe(0);
  });

  it('a double tap is two actions and two events; one action sent twice is one event', async () => {
    const h = harness();
    const t = h.tracker();
    const first = save(t, 'sku_9', 'decor');
    const second = t.track('item_unsaved', { item_id: 'sku_9', category: 'decor' }, { surface: 'home' });

    expect(first).not.toBe(second);

    h.net.loseNextAck = true;
    await t.flush();
    await t.flush({ ignoreBackoff: true });

    expect(h.count()).toBe(2);
  });
});

describe('identity: anonymous to known, and back', () => {
  it('attributes pre-login activity to the customer without rewriting a single row', async () => {
    const h = harness();
    const t = h.tracker({ anon: 'anon_A' });

    save(t, 'sku_1', 'outdoor');
    save(t, 'sku_2', 'outdoor');
    t.track('feed_item_tapped', { item_id: 'sku_3', item_type: 'product', position: 2, category: 'lighting' }, { surface: 'home' });
    t.identify('cust_9');
    save(t, 'sku_4', 'outdoor');
    await t.drain();

    expect(computeAffinity(h.db, { customerId: 'cust_9' })).toEqual({ outdoor: 9, lighting: 1 });

    const untouched = h.db
      .prepare(`SELECT COUNT(*) AS n FROM events WHERE anonymous_id = 'anon_A' AND customer_id IS NULL`)
      .get() as { n: number };
    expect(untouched.n).toBe(3);

    const link = h.db.prepare('SELECT * FROM identity_resolutions').all();
    expect(link).toEqual([expect.objectContaining({ anonymous_id: 'anon_A', customer_id: 'cust_9' })]);
  });

  it('after sign-out on a shared device, the next person is not attributed to the last customer', async () => {
    const h = harness();
    const t = h.tracker({ anon: 'anon_A' });
    save(t, 'sku_1', 'outdoor');
    t.identify('cust_9');
    t.resetIdentity('anon_B'); // sign-out rotates the anonymous id

    save(t, 'sku_5', 'dining');
    save(t, 'sku_6', 'dining');
    await t.drain();

    expect(computeAffinity(h.db, { customerId: 'cust_9' })).toEqual({ outdoor: 3 });
    expect(computeAffinity(h.db, { anonymousId: 'anon_B' })).toEqual({ dining: 6 });
  });
});

describe('failure handling: poison, pressure, and invalid input', () => {
  it('drops a batch the server says can never succeed, counts it, and reports the loss', async () => {
    const h = harness();
    const t = h.tracker();
    save(t, 'sku_1', 'sofas');
    save(t, 'sku_2', 'sofas');

    h.net.rejectNext = true;
    await t.flush();
    expect(t.pending()).toBe(0); // not retried forever
    expect(t.droppedUnreported()).toBe(2);

    save(t, 'sku_3', 'sofas');
    await t.flush();
    expect(h.counter('client_dropped')).toBe(2);
    expect(t.droppedUnreported()).toBe(0);
  });

  it('under backpressure drops impressions before saves, and reports how many it dropped', async () => {
    const h = harness();
    const t = h.tracker({ maxQueue: 5 });
    h.net.online = false;

    save(t, 'sku_1', 'lighting');
    for (let i = 0; i < 6; i++) {
      t.track('feed_item_impressed', { item_id: `sku_${i}`, item_type: 'product', position: i, dwell_ms: 800 }, { surface: 'home' });
    }
    expect(t.pending()).toBe(5);
    expect(t.droppedUnreported()).toBe(2);

    h.net.online = true;
    await t.drain();
    expect(h.count('item_saved')).toBe(1);
    expect(h.counter('client_dropped')).toBe(2);
  });

  it('refuses on device the events the collector would reject', () => {
    const h = harness();
    const refused: string[] = [];
    const t = new Tracker({
      store: new MemoryStore(),
      transport: { send: async () => ({ kind: 'ok' }) },
      identity: { anonymous_id: 'anon_A', session_id: 's', app_version: '0.1.0' },
      onInvalid: (issue) => refused.push(issue),
    });

    // @ts-expect-error — missing category is a compile error too; this proves the runtime guard
    expect(t.track('item_saved', { item_id: 'sku_1' }, { surface: 'home' })).toBeNull();
    expect(t.track('identity_resolved', { previous_anonymous_id: 'anon_A' }, { surface: 'account' })).toBeNull();

    expect(t.pending()).toBe(0);
    expect(refused).toHaveLength(2);
    expect(refused[1]).toMatch(/customer_id/);
    void h;
  });
});

describe('collector: validation at the edge', () => {
  const event = (overrides: Record<string, unknown> = {}) => ({
    event_id: '0190f0a0-0000-7000-8000-000000000001',
    event_name: 'item_saved',
    schema_version: 1,
    occurred_at: new Date().toISOString(),
    anonymous_id: 'anon_A',
    session_id: 's',
    surface: 'home',
    app_version: '0.1.0',
    payload: { item_id: 'sku_1', category: 'sofas' },
    ...overrides,
  });

  const post = (collector: ReturnType<typeof createCollectorApp>, body: unknown) =>
    collector.request('/v1/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('stores the valid events of a batch that also contains an invalid one', async () => {
    const { collector, count } = harness();
    const res = await post(collector, {
      sent_at: new Date().toISOString(),
      events: [
        event(),
        event({ event_id: '0190f0a0-0000-7000-8000-000000000002', payload: { item_id: 'sku_2' } }),
        event({ event_id: '0190f0a0-0000-7000-8000-000000000003' }),
      ],
    });
    const body = (await res.json()) as { accepted: number; rejected: { index: number }[] };

    expect(res.status).toBe(200);
    expect(body.accepted).toBe(2);
    expect(body.rejected.map((r) => r.index)).toEqual([1]);
    expect(count()).toBe(2);
  });

  it('clamps a lying device clock but keeps exactly what the device sent', async () => {
    const { collector, db } = harness();
    const future = new Date(Date.now() + 3 * 864e5).toISOString();
    await post(collector, { sent_at: new Date().toISOString(), events: [event({ occurred_at: future })] });

    const row = db.prepare('SELECT occurred_at, occurred_at_raw, clamped FROM events').get() as {
      occurred_at: string;
      occurred_at_raw: string;
      clamped: number;
    };
    expect(row.clamped).toBe(1);
    expect(row.occurred_at_raw).toBe(future);
    expect(new Date(row.occurred_at).getTime()).toBeLessThan(new Date(future).getTime());
  });

  it('rejects a malformed batch envelope with 400 so the device stops retrying it', async () => {
    const { collector } = harness();
    expect((await post(collector, { events: [] })).status).toBe(400);
    expect((await post(collector, 'not json at all')).status).toBe(400);
  });
});
