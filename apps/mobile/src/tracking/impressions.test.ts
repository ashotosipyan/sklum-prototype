import { describe, expect, it } from 'vitest';
import { ImpressionTracker, MIN_DWELL_MS, oncePer } from './impressions';

type Item = { id: string };
const v = (id: string, index: number) => ({ key: id, index, item: { id } });

function setup() {
  let clock = 0;
  const seen: { id: string; position: number; dwell: number }[] = [];
  const t = new ImpressionTracker<Item>((item, position, dwell) => seen.push({ id: item.id, position, dwell }), () => clock);
  return { t, seen, advance: (ms: number) => (clock += ms) };
}

describe('impressions measure what the customer actually saw', () => {
  it('one ranked feed is one view, however many times React renders it', () => {
    const views: string[] = [];
    const firstView = oncePer((id) => views.push(id));
    firstView('feed_1');
    firstView('feed_1');
    firstView('feed_1');
    firstView('feed_2');
    expect(views).toEqual(['feed_1', 'feed_2']);
  });

  it('a card scrolled past faster than the dwell floor is not an impression', () => {
    const { t, seen, advance } = setup();
    t.setFeed('feed_1');
    t.update([v('a', 0), v('b', 1)]);
    advance(MIN_DWELL_MS - 1);
    t.update([]);
    expect(seen).toEqual([]);
  });

  it('the same card seen twice in one feed is one impression; in a newly ranked feed it is a new one', () => {
    const { t, seen, advance } = setup();
    t.setFeed('feed_1');
    t.update([v('a', 0)]);
    advance(800);
    t.update([]);
    t.update([v('a', 0)]);
    advance(800);
    t.update([]);
    expect(seen.map((s) => s.id)).toEqual(['a']);

    t.setFeed('feed_2');
    t.update([v('a', 3)]);
    advance(800);
    t.update([]);
    expect(seen.map((s) => [s.id, s.position])).toEqual([['a', 0], ['a', 3]]);
  });

  it('closes every open view when the app backgrounds, so dwell is not lost', () => {
    const { t, seen, advance } = setup();
    t.setFeed('feed_1');
    t.update([v('a', 0), v('b', 1)]);
    advance(1200);
    t.endAll();
    expect(seen.map((s) => [s.id, s.dwell])).toEqual([['a', 1200], ['b', 1200]]);
  });
});
