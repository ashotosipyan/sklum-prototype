/**
 * Viewability, measured honestly. An item counts as impressed only once it has
 * been at least half on screen for a minimum dwell, and only once per item per
 * ranked feed. Without the dwell floor, a fast scroll past twenty cards reports
 * twenty impressions the customer never saw — and a ranking model trained on
 * that would learn that everything is ignored.
 *
 * Pure logic, no React Native: the component only forwards viewability changes.
 */

export type Viewable<T> = { key: string; index: number; item: T };

export type ImpressionHandler<T> = (item: T, position: number, dwellMs: number) => void;

export const MIN_DWELL_MS = 500;

export class ImpressionTracker<T> {
  private feedRequestId: string | null = null;
  private visibleSince = new Map<string, { at: number; item: T; index: number }>();
  private reported = new Set<string>();

  constructor(
    private readonly onImpression: ImpressionHandler<T>,
    private readonly now: () => number = Date.now,
    private readonly minDwellMs: number = MIN_DWELL_MS,
  ) {}

  /**
   * A new ranked feed resets the dedup scope: the same product appearing in a
   * freshly ranked feed is a new impression of a new ranking decision, and the
   * ranking dataset needs both.
   */
  setFeed(feedRequestId: string): void {
    if (feedRequestId === this.feedRequestId) return;
    this.endAll();
    this.feedRequestId = feedRequestId;
    this.reported.clear();
  }

  /** Forward the full set of currently viewable items on every change. */
  update(viewable: Viewable<T>[]): void {
    const current = new Set(viewable.map((v) => v.key));

    for (const key of [...this.visibleSince.keys()]) {
      if (!current.has(key)) this.end(key);
    }
    const at = this.now();
    for (const v of viewable) {
      if (!this.visibleSince.has(v.key)) this.visibleSince.set(v.key, { at, item: v.item, index: v.index });
    }
  }

  /** App backgrounded, screen unmounted, feed replaced: close every open view. */
  endAll(): void {
    for (const key of [...this.visibleSince.keys()]) this.end(key);
  }

  private end(key: string): void {
    const open = this.visibleSince.get(key);
    this.visibleSince.delete(key);
    if (!open || !this.feedRequestId) return;

    const dwell = this.now() - open.at;
    const dedupKey = `${this.feedRequestId}:${key}`;
    if (dwell < this.minDwellMs || this.reported.has(dedupKey)) return;

    this.reported.add(dedupKey);
    this.onImpression(open.item, open.index, dwell);
  }
}

/**
 * Fires a callback once per id. Used for feed_viewed: React may render the same
 * feed many times, but one ranked feed is one view.
 */
export function oncePer(fn: (id: string) => void): (id: string) => boolean {
  const seen = new Set<string>();
  return (id) => {
    if (seen.has(id)) return false;
    seen.add(id);
    fn(id);
    return true;
  };
}
