import type { FeedItem } from './feed.js';

export const RANKING_STRATEGY = 'rules_v1';

/**
 * Year 1 ranking is a deterministic function, not a model. Two reasons, both
 * argued in the system design: you cannot train a recommender on data you have
 * not collected yet, and shipping a model alongside a new event schema makes
 * every ranking bug a two-variable problem.
 *
 * The interface is the durable asset. Swapping this for a served model in Year 2
 * changes this file and nothing else.
 */

export type Affinity = Record<string, number>;

const WEIGHTS = { recency: 0.5, affinity: 0.3, boost: 0.2 } as const;

/** Exponential decay, half-life 30 days. */
function recencyScore(daysOld: number): number {
  return Math.pow(0.5, daysOld / 30);
}

function affinityScore(affinity: Affinity, category: string | undefined): number {
  if (!category) return 0;
  const raw = affinity[category] ?? 0;
  const max = Math.max(1, ...Object.values(affinity));
  return raw / max;
}

export function score(item: FeedItem, affinity: Affinity): number {
  return (
    WEIGHTS.recency * recencyScore(item.rank_signals.days_old) +
    WEIGHTS.affinity * affinityScore(affinity, item.rank_signals.category) +
    WEIGHTS.boost * item.rank_signals.business_boost
  );
}

export function rank(items: FeedItem[], affinity: Affinity): FeedItem[] {
  const pinned = items.filter((i) => i.type === 'order_status');
  const rest = items
    .filter((i) => i.type !== 'order_status')
    .map((item) => ({ item, s: score(item, affinity) }))
    .sort((a, b) => b.s - a.s)
    .map(({ item }) => item);

  /**
   * Order-status cards are pinned above everything regardless of score. Year 1 is
   * utility-first: a customer with an order in flight opened the app to find the
   * order, not to be inspired. This is a product decision expressed in code, and
   * it is the kind of rule that should never be left to a model to discover.
   */
  return [...pinned, ...rest].map((item, position) => ({ ...item, position }));
}
