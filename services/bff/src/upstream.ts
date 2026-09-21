/** Read lazily so tests and containers can point the BFF elsewhere without a rebuild. */
const coreBase = () => process.env.CORE_BASE_URL ?? 'http://localhost:4000';
const collectorBase = () => process.env.COLLECTOR_URL ?? 'http://localhost:4200';

/**
 * Per-source budget. The feed has a ~400ms p95 target end to end, so no single
 * upstream is allowed to spend more than 300ms of it. A source that misses its
 * budget is treated exactly like a source that failed — the distinction matters
 * to operators, not to the customer waiting for a screen.
 */
export const SOURCE_BUDGET_MS = 300;

/**
 * Personalisation gets a tighter budget than commerce data. If affinity is slow
 * the right answer is an unpersonalised feed now, not a personalised one late —
 * the customer cannot tell the difference, but they can tell a slow screen.
 */
export const AFFINITY_BUDGET_MS = 150;

export type SourceName = 'catalogue' | 'orders' | 'promise' | 'affinity';

export type SourceResult<T> =
  | { ok: true; source: SourceName; data: T; ms: number }
  | { ok: false; source: SourceName; reason: 'timeout' | 'error'; ms: number };

async function call<T>(
  source: SourceName,
  url: string,
  budgetMs = SOURCE_BUDGET_MS,
): Promise<SourceResult<T>> {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), budgetMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      return { ok: false, source, reason: 'error', ms: Date.now() - started };
    }
    return { ok: true, source, data: (await res.json()) as T, ms: Date.now() - started };
  } catch (err) {
    const reason = (err as Error).name === 'AbortError' ? 'timeout' : 'error';
    return { ok: false, source, reason, ms: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}

export type Product = {
  id: string;
  title: string;
  category: string;
  price_cents: number;
  image: string;
  created_days_ago: number;
};

export type Order = {
  id: string;
  customer_id: string;
  status: string;
  placed_at: string;
  line_items: { sku: string; title: string; qty: number }[];
};

export type Promise_ = {
  sku: string;
  promise_window_days: number;
  earliest: string;
  confidence: 'high' | 'medium' | 'low';
  source: 'live' | 'cached' | 'fallback';
};

export type AffinityResponse = { affinity: Record<string, number> };

export const upstream = {
  products: (limit: number) =>
    call<{ products: Product[] }>('catalogue', `${coreBase()}/catalogue/products?limit=${limit}`),
  orders: (customerId: string) =>
    call<{ orders: Order[] }>('orders', `${coreBase()}/orders/${encodeURIComponent(customerId)}`),
  promise: (sku: string) => call<Promise_>('promise', `${coreBase()}/promise/${encodeURIComponent(sku)}`),
  affinity: (subject: { customerId?: string | undefined; anonymousId?: string | undefined }) => {
    const qs = new URLSearchParams();
    if (subject.customerId) qs.set('customer_id', subject.customerId);
    if (subject.anonymousId) qs.set('anonymous_id', subject.anonymousId);
    return call<AffinityResponse>('affinity', `${collectorBase()}/v1/affinity?${qs}`, AFFINITY_BUDGET_MS);
  },
};

/**
 * When the promise service is unavailable we do NOT omit the delivery
 * information and we do NOT guess a date. We widen the window and mark it
 * low-confidence, because a vague honest answer costs less trust than a
 * confident wrong one. The client renders this differently on purpose.
 */
export function fallbackPromise(sku: string): Promise_ {
  return {
    sku,
    promise_window_days: 21,
    earliest: new Date(Date.now() + 21 * 864e5).toISOString(),
    confidence: 'low',
    source: 'fallback',
  };
}
