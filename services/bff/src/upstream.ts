const CORE_BASE = process.env.CORE_BASE_URL ?? 'http://localhost:4000';

/**
 * Per-source budget. The feed has a ~400ms p95 target end to end, so no single
 * upstream is allowed to spend more than 300ms of it. A source that misses its
 * budget is treated exactly like a source that failed — the distinction matters
 * to operators, not to the customer waiting for a screen.
 */
export const SOURCE_BUDGET_MS = 300;

export type SourceName = 'catalogue' | 'orders' | 'promise';

export type SourceResult<T> =
  | { ok: true; source: SourceName; data: T; ms: number }
  | { ok: false; source: SourceName; reason: 'timeout' | 'error'; ms: number };

async function call<T>(
  source: SourceName,
  path: string,
  budgetMs = SOURCE_BUDGET_MS,
): Promise<SourceResult<T>> {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), budgetMs);
  try {
    const res = await fetch(`${CORE_BASE}${path}`, { signal: controller.signal });
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

export const upstream = {
  products: (limit: number) =>
    call<{ products: Product[] }>('catalogue', `/catalogue/products?limit=${limit}`),
  orders: (customerId: string) => call<{ orders: Order[] }>('orders', `/orders/${customerId}`),
  promise: (sku: string) => call<Promise_>('promise', `/promise/${sku}`),
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
