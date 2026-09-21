import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Offline analytics over the collector's store: the funnel the ranking will
 * eventually be trained on, and a data-quality report. Reads the SQLite file
 * directly — a stand-in for what would be a warehouse query in production.
 */
const path =
  process.env.SKLUM_DB ??
  fileURLToPath(new URL('../../../services/collector/data/events.sqlite', import.meta.url));

if (!existsSync(path)) {
  console.error(`No event store at ${path}. Start the collector and use the app first.`);
  process.exit(1);
}

const db = new Database(path, { readonly: true });
const q = <T>(sql: string, ...params: unknown[]) => db.prepare(sql).all(...params) as T[];
const one = <T>(sql: string) => db.prepare(sql).get() as T;

console.log(`\nEvent store: ${path}\n`);

console.log('Events by type');
console.table(q(`SELECT event_name, COUNT(*) AS events FROM events GROUP BY event_name ORDER BY events DESC`));

/**
 * Impression → tap → save, per ranking strategy. The strategy comes from the
 * feed_viewed event sharing the feed_request_id, which is why every event on a
 * ranked surface carries that id: it makes every ranking change attributable.
 */
console.log('Funnel by ranking strategy');
console.table(
  q(`
    WITH strategy AS (
      SELECT feed_request_id, json_extract(payload, '$.ranking_strategy') AS ranking_strategy
      FROM events WHERE event_name = 'feed_viewed'
    )
    SELECT s.ranking_strategy,
           COUNT(DISTINCT s.feed_request_id)                              AS feeds,
           SUM(e.event_name = 'feed_item_impressed')                      AS impressions,
           SUM(e.event_name = 'feed_item_tapped')                         AS taps,
           SUM(e.event_name = 'item_saved')                               AS saves,
           ROUND(100.0 * SUM(e.event_name = 'feed_item_tapped')
                 / NULLIF(SUM(e.event_name = 'feed_item_impressed'), 0), 1) AS tap_rate_pct
    FROM strategy s LEFT JOIN events e ON e.feed_request_id = s.feed_request_id
    GROUP BY s.ranking_strategy`),
);

console.log('Delivery promises shown, by confidence');
console.table(
  q(`
    SELECT json_extract(payload, '$.confidence') AS confidence,
           json_extract(payload, '$.source')     AS source,
           COUNT(*)                              AS shown
    FROM events WHERE event_name = 'delivery_promise_shown'
    GROUP BY 1, 2 ORDER BY shown DESC`),
);

const counters = Object.fromEntries(
  q<{ name: string; value: number }>(`SELECT name, value FROM ingest_counters`).map((r) => [r.name, r.value]),
);
const quality = one<{ total: number; clamped: number; late: number; identified: number }>(`
  SELECT COUNT(*) AS total,
         SUM(clamped) AS clamped,
         SUM((julianday(received_at) - julianday(occurred_at_raw)) * 86400 > 300) AS late,
         SUM(customer_id IS NOT NULL) AS identified
  FROM events`);

console.log('Data quality');
console.table([
  { check: 'events stored', value: quality.total },
  { check: 'duplicates absorbed by event_id', value: counters['duplicates'] ?? 0 },
  { check: 'rejected at the collector', value: counters['rejected'] ?? 0 },
  { check: 'dropped on device under backpressure', value: counters['client_dropped'] ?? 0 },
  { check: 'device clock clamped', value: quality.clamped ?? 0 },
  { check: 'arrived more than 5 min late', value: quality.late ?? 0 },
  { check: 'identity links (anonymous → customer)', value: one<{ n: number }>(`SELECT COUNT(*) AS n FROM identity_resolutions`).n },
]);

const rejections = q(`SELECT reason, COUNT(*) AS n FROM ingest_rejections GROUP BY reason ORDER BY n DESC LIMIT 5`);
if (rejections.length) {
  console.log('Top rejection reasons');
  console.table(rejections);
}
