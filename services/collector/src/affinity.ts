import type { DB } from './db.js';

export const AFFINITY_WINDOW_DAYS = 30;

/**
 * Action strength. A save is a deliberate statement of interest; a tap is
 * curiosity. Impressions are deliberately absent: they are training data for a
 * future ranking model, not evidence of affinity, and weighting them would make
 * the feed reinforce whatever it already showed.
 */
const WEIGHTS = { item_saved: 3, item_unsaved: -3, feed_item_tapped: 1 } as const;

export type Affinity = Record<string, number>;

/**
 * Identity is resolved at read time. For a known customer this includes every
 * anonymous id ever linked to them, so behaviour from before login counts —
 * without a single event row having been rewritten.
 */
export function computeAffinity(
  db: DB,
  subject: { customerId?: string | undefined; anonymousId?: string | undefined },
  now: Date = new Date(),
): Affinity {
  const since = new Date(now.getTime() - AFFINITY_WINDOW_DAYS * 864e5).toISOString();

  const rows = db
    .prepare(
      `WITH linked AS (
         SELECT anonymous_id FROM identity_resolutions WHERE customer_id = @customer_id
         UNION
         SELECT @anonymous_id WHERE @anonymous_id IS NOT NULL
       )
       SELECT json_extract(payload, '$.category') AS category,
              SUM(CASE event_name
                    WHEN 'item_saved'       THEN ${WEIGHTS.item_saved}
                    WHEN 'item_unsaved'     THEN ${WEIGHTS.item_unsaved}
                    WHEN 'feed_item_tapped' THEN ${WEIGHTS.feed_item_tapped}
                    ELSE 0 END) AS score
       FROM events
       WHERE event_name IN ('item_saved', 'item_unsaved', 'feed_item_tapped')
         AND occurred_at >= @since
         AND json_extract(payload, '$.category') IS NOT NULL
         AND (
           (@customer_id IS NOT NULL AND customer_id = @customer_id)
           OR anonymous_id IN (SELECT anonymous_id FROM linked)
         )
       GROUP BY category
       HAVING score > 0`,
    )
    .all({
      customer_id: subject.customerId ?? null,
      anonymous_id: subject.anonymousId ?? null,
      since,
    }) as { category: string; score: number }[];

  return Object.fromEntries(rows.map((r) => [r.category, r.score]));
}
