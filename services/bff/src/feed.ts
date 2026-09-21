import { uuidv7 } from '@sklum/events';
import { fallbackPromise, upstream, type Order, type Product, type Promise_, type SourceName } from './upstream.js';
import { RANKING_STRATEGY, rank, type Affinity } from './ranking.js';

export type FeedItem = {
  id: string;
  type: 'order_status' | 'saved' | 'product' | 'inspiration';
  position: number;
  title: string;
  /** Sent to the client so taps and saves can carry it — the affinity signal needs it. */
  category?: string;
  image?: string;
  price_cents?: number;
  delivery?: { window_days: number; earliest: string; confidence: string; source: string };
  status?: string;
  /** Never sent to the client for display — inputs to ranking, kept for debuggability. */
  rank_signals: { days_old: number; category?: string; business_boost: number };
};

export type FeedResponse = {
  feed_request_id: string;
  ranking_strategy: string;
  degraded: SourceName[];
  items: FeedItem[];
  timings_ms: Record<string, number>;
};

export async function buildFeed(opts: {
  customerId?: string | undefined;
  anonymousId?: string | undefined;
  limit: number;
}): Promise<FeedResponse> {
  const feed_request_id = uuidv7();
  const degraded: SourceName[] = [];
  const timings: Record<string, number> = {};

  /**
   * Fan out. allSettled rather than all: one slow or dead source must never take
   * the screen down with it. This is the single most important behaviour in the
   * service.
   */
  const hasSubject = Boolean(opts.customerId || opts.anonymousId);
  const [productsRes, ordersRes, affinityRes] = await Promise.all([
    upstream.products(opts.limit),
    opts.customerId
      ? upstream.orders(opts.customerId)
      : Promise.resolve({ ok: true as const, source: 'orders' as const, data: { orders: [] as Order[] }, ms: 0 }),
    hasSubject
      ? upstream.affinity({ customerId: opts.customerId, anonymousId: opts.anonymousId })
      : Promise.resolve({ ok: true as const, source: 'affinity' as const, data: { affinity: {} }, ms: 0 }),
  ]);

  timings['catalogue'] = productsRes.ms;
  timings['orders'] = ordersRes.ms;
  timings['affinity'] = affinityRes.ms;

  /**
   * No affinity means rank on recency and business rules alone. The feed is still
   * correct, just not personal — which is why this degradation is reported to the
   * client but never shown to the customer.
   */
  const affinity: Affinity = affinityRes.ok ? affinityRes.data.affinity : {};
  if (!affinityRes.ok) degraded.push('affinity');

  const products: Product[] = productsRes.ok ? productsRes.data.products : [];
  if (!productsRes.ok) degraded.push('catalogue');

  const orders: Order[] = ordersRes.ok ? ordersRes.data.orders : [];
  if (!ordersRes.ok) degraded.push('orders');

  /**
   * Delivery promises are fetched per SKU and each one degrades independently.
   * One SKU with a slow promise lookup must not cost the other nineteen their
   * delivery information.
   */
  const promiseTargets = products.slice(0, 8);
  const promiseStart = Date.now();
  const promiseResults = await Promise.all(promiseTargets.map((p) => upstream.promise(p.id)));
  timings['promise'] = Date.now() - promiseStart;

  const promises = new Map<string, Promise_>();
  let promiseDegraded = false;
  promiseTargets.forEach((p, i) => {
    const res = promiseResults[i]!;
    if (res.ok) {
      promises.set(p.id, res.data);
    } else {
      promiseDegraded = true;
      promises.set(p.id, fallbackPromise(p.id));
    }
  });
  if (promiseDegraded) degraded.push('promise');

  const items: FeedItem[] = [];

  for (const order of orders) {
    items.push({
      id: order.id,
      type: 'order_status',
      position: 0,
      title: order.line_items[0]?.title ?? 'Your order',
      status: order.status,
      rank_signals: { days_old: 0, business_boost: 1 },
    });
  }

  /**
   * If the orders source is down we still tell the customer something true. An
   * empty space where the order card was reads as "Sklum lost my order"; an
   * explicit placeholder reads as "the tracking service is briefly unavailable".
   * The difference is entirely trust, and trust is the Year 1 north star.
   */
  if (!ordersRes.ok && opts.customerId) {
    items.push({
      id: 'order_unavailable',
      type: 'order_status',
      position: 0,
      title: 'Order tracking is temporarily unavailable',
      status: 'unavailable',
      rank_signals: { days_old: 0, business_boost: 1 },
    });
  }

  for (const p of products) {
    const promise = promises.get(p.id);
    items.push({
      id: p.id,
      type: 'product',
      position: 0,
      title: p.title,
      category: p.category,
      image: p.image,
      price_cents: p.price_cents,
      ...(promise
        ? {
            delivery: {
              window_days: promise.promise_window_days,
              earliest: promise.earliest,
              confidence: promise.confidence,
              source: promise.source,
            },
          }
        : {}),
      rank_signals: {
        days_old: p.created_days_ago,
        category: p.category,
        business_boost: p.price_cents > 30000 ? 0.6 : 0.3,
      },
    });
  }

  return {
    feed_request_id,
    ranking_strategy: RANKING_STRATEGY,
    degraded,
    items: rank(items, affinity).slice(0, opts.limit),
    timings_ms: timings,
  };
}
