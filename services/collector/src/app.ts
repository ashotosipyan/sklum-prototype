import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import {
  batchEnvelopeSchema,
  clampOccurredAt,
  eventSchema,
  semanticIssue,
  type SklumEvent,
} from '@sklum/events';
import { AFFINITY_WINDOW_DAYS, computeAffinity } from './affinity.js';
import { bumpCounter, type DB } from './db.js';

export type IngestResult = {
  accepted: number;
  duplicates: number;
  rejected: { index: number; event_id?: string; reason: string }[];
};

/**
 * Response contract with the device, and the reason it is shaped this way:
 *
 *   200 — every event in the batch has reached a final state (stored, already
 *         stored, or permanently invalid). The device deletes the whole batch.
 *   400 — the batch envelope itself is malformed. Retrying cannot fix it, so the
 *         device drops it and counts the loss rather than retrying forever.
 *   5xx — transient. The device keeps the batch and backs off.
 *
 * A permanently invalid event is acknowledged, not retried: a poison event that
 * is retried forever blocks every valid event queued behind it.
 */
export function createCollectorApp(db: DB, now: () => Date = () => new Date()) {
  const app = new Hono();

  const insertEvent = db.prepare(
    `INSERT OR IGNORE INTO events (
       event_id, event_name, schema_version, occurred_at, occurred_at_raw, clock_skew_ms,
       clamped, received_at, anonymous_id, customer_id, session_id, surface, app_version,
       feed_request_id, payload
     ) VALUES (
       @event_id, @event_name, @schema_version, @occurred_at, @occurred_at_raw, @clock_skew_ms,
       @clamped, @received_at, @anonymous_id, @customer_id, @session_id, @surface, @app_version,
       @feed_request_id, @payload
     )`,
  );
  const insertResolution = db.prepare(
    `INSERT OR IGNORE INTO identity_resolutions (anonymous_id, customer_id, resolved_at, event_id)
     VALUES (?, ?, ?, ?)`,
  );
  const insertRejection = db.prepare(
    `INSERT INTO ingest_rejections (received_at, event_id, reason, raw) VALUES (?, ?, ?, ?)`,
  );

  const ingest = db.transaction((events: unknown[], clientDropped: number): IngestResult => {
    const receivedAt = now();
    const received_at = receivedAt.toISOString();
    const result: IngestResult = { accepted: 0, duplicates: 0, rejected: [] };

    events.forEach((raw, index) => {
      const parsed = eventSchema.safeParse(raw);
      const rawId = (raw as { event_id?: unknown })?.event_id;
      const eventId = typeof rawId === 'string' ? rawId : undefined;

      if (!parsed.success) {
        const reason = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
        insertRejection.run(received_at, eventId ?? null, reason, JSON.stringify(raw));
        result.rejected.push({ index, ...(eventId ? { event_id: eventId } : {}), reason });
        return;
      }

      const event = parsed.data as SklumEvent;
      const semantic = semanticIssue(event);
      if (semantic) {
        insertRejection.run(received_at, event.event_id, semantic, JSON.stringify(raw));
        result.rejected.push({ index, event_id: event.event_id, reason: semantic });
        return;
      }

      const clock = clampOccurredAt(event.occurred_at, receivedAt);
      const info = insertEvent.run({
        event_id: event.event_id,
        event_name: event.event_name,
        schema_version: event.schema_version,
        occurred_at: clock.occurred_at,
        occurred_at_raw: event.occurred_at,
        clock_skew_ms: clock.clock_skew_ms,
        clamped: clock.clamped ? 1 : 0,
        received_at,
        anonymous_id: event.anonymous_id,
        customer_id: event.customer_id ?? null,
        session_id: event.session_id,
        surface: event.surface,
        app_version: event.app_version,
        feed_request_id: event.feed_request_id ?? null,
        payload: JSON.stringify(event.payload),
      });

      if (info.changes === 0) {
        result.duplicates += 1;
        return;
      }
      result.accepted += 1;

      if (event.event_name === 'identity_resolved' && event.customer_id) {
        insertResolution.run(event.anonymous_id, event.customer_id, clock.occurred_at, event.event_id);
      }
    });

    bumpCounter(db, 'duplicates', result.duplicates);
    bumpCounter(db, 'rejected', result.rejected.length);
    bumpCounter(db, 'client_dropped', clientDropped);
    return result;
  });

  app.get('/health', (c) => c.json({ ok: true }));

  app.post('/v1/events', bodyLimit({ maxSize: 512 * 1024 }), async (c) => {
    const body = await c.req.json().catch(() => null);
    const envelope = batchEnvelopeSchema.safeParse(body);
    if (!envelope.success) {
      return c.json({ error: 'malformed batch', issues: envelope.error.issues }, 400);
    }
    const result = ingest(envelope.data.events, envelope.data.client_dropped ?? 0);
    return c.json(result);
  });

  app.get('/v1/affinity', (c) => {
    const customerId = c.req.query('customer_id') || undefined;
    const anonymousId = c.req.query('anonymous_id') || undefined;
    if (!customerId && !anonymousId) {
      return c.json({ error: 'customer_id or anonymous_id required' }, 400);
    }
    return c.json({
      customer_id: customerId ?? null,
      anonymous_id: anonymousId ?? null,
      window_days: AFFINITY_WINDOW_DAYS,
      affinity: computeAffinity(db, { customerId, anonymousId }, now()),
    });
  });

  /** Everything needed to narrate the demo without opening a SQL shell. */
  app.get('/v1/stats', (c) => {
    const byName = db
      .prepare(`SELECT event_name, COUNT(*) AS n FROM events GROUP BY event_name ORDER BY n DESC`)
      .all();
    const counters = Object.fromEntries(
      (db.prepare(`SELECT name, value FROM ingest_counters`).all() as { name: string; value: number }[]).map(
        (r) => [r.name, r.value],
      ),
    );
    const total = (db.prepare(`SELECT COUNT(*) AS n FROM events`).get() as { n: number }).n;
    return c.json({ total_events: total, by_event: byName, counters });
  });

  return app;
}
