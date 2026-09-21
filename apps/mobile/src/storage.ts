import { createMMKV } from 'react-native-mmkv';

/**
 * Three stores, separated by lifetime rather than by convenience:
 *
 *  identity — must survive any cache clear. Losing the anonymous_id silently
 *             breaks anonymous-to-known stitching.
 *  events   — the unsent event queue. Must survive a cache clear too, or a
 *             "clear cache" button becomes a data-loss button.
 *  cache    — disposable. The last good feed, locally saved ids.
 */
export const identityStore = createMMKV({ id: 'sklum.identity' });
export const eventsStore = createMMKV({ id: 'sklum.events' });
export const cacheStore = createMMKV({ id: 'sklum.cache' });

const ANON_KEY = 'anonymous_id';
const CUSTOMER_KEY = 'customer_id';

export function getAnonymousId(mint: () => string): string {
  const existing = identityStore.getString(ANON_KEY);
  if (existing) return existing;
  const fresh = mint();
  identityStore.set(ANON_KEY, fresh);
  return fresh;
}

/** On sign-out: the next person on this device must not inherit the last one's link. */
export function rotateAnonymousId(mint: () => string): string {
  const fresh = mint();
  identityStore.set(ANON_KEY, fresh);
  return fresh;
}

export function getCustomerId(): string | undefined {
  return identityStore.getString(CUSTOMER_KEY);
}

export function setCustomerId(customerId: string | null): void {
  if (customerId) identityStore.set(CUSTOMER_KEY, customerId);
  else identityStore.remove(CUSTOMER_KEY);
}

const LAST_GOOD_FEED = 'last_good_feed';
export const saveLastGoodFeed = (json: string) => cacheStore.set(LAST_GOOD_FEED, json);
export const readLastGoodFeed = () => cacheStore.getString(LAST_GOOD_FEED);

const SAVED_IDS = 'saved_ids';
export function readSavedIds(): Record<string, true> {
  const raw = cacheStore.getString(SAVED_IDS);
  try {
    return raw ? (JSON.parse(raw) as Record<string, true>) : {};
  } catch {
    return {};
  }
}
export const writeSavedIds = (ids: Record<string, true>) => cacheStore.set(SAVED_IDS, JSON.stringify(ids));
