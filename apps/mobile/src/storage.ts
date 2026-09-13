import { createMMKV } from 'react-native-mmkv';

/**
 * Two separate stores on purpose. Identity must survive a cache clear; the feed
 * snapshot is disposable. Putting them in one instance means any future "clear
 * cache" affordance risks orphaning the anonymous_id, which would silently break
 * anonymous-to-known stitching — the hardest correctness property in the system.
 */
export const identityStore = createMMKV({ id: 'sklum.identity' });
export const cacheStore = createMMKV({ id: 'sklum.cache' });

const ANON_KEY = 'anonymous_id';

export function getAnonymousId(mint: () => string): string {
  const existing = identityStore.getString(ANON_KEY);
  if (existing) return existing;
  const fresh = mint();
  identityStore.set(ANON_KEY, fresh);
  return fresh;
}

const LAST_GOOD_FEED = 'last_good_feed';

export function saveLastGoodFeed(json: string): void {
  cacheStore.set(LAST_GOOD_FEED, json);
}

export function readLastGoodFeed(): string | undefined {
  return cacheStore.getString(LAST_GOOD_FEED);
}
