import { FlashList } from '@shopify/flash-list';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, StyleSheet, Text, View, type ViewToken } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { Provider, useDispatch, useSelector } from 'react-redux';
import { useGetFeedQuery, type FeedItem, type FeedResponse } from './src/api';
import { FeedCard, palette } from './src/components/FeedCard';
import { DEMO_CUSTOMER_ID } from './src/config';
import { toggleSave } from './src/saved';
import { signIn, signOut } from './src/session';
import { readLastGoodFeed, saveLastGoodFeed } from './src/storage';
import { store, type AppDispatch, type RootState } from './src/store';
import { ImpressionTracker, oncePer, onBackground, startTracking, tracker } from './src/tracking';

startTracking();

/** Source names are system vocabulary. The customer only hears about what affects them. */
const USER_FACING: Record<string, string> = {
  orders: 'order tracking',
  promise: 'delivery estimates',
  catalogue: 'some products',
};

function DegradedBanner({ sources }: { sources: string[] }) {
  const visible = sources.map((s) => USER_FACING[s]).filter(Boolean);
  if (visible.length === 0) return null;
  return (
    <View style={styles.banner} accessibilityRole="alert">
      <Text style={styles.bannerText}>
        {`We can't load ${visible.join(' and ')} right now. Everything else is up to date.`}
      </Text>
    </View>
  );
}

/**
 * Queue depth, visible on screen. It exists for the demo — stop the collector,
 * save a few items, watch this count climb, restart it, watch it drain — and
 * because an event pipeline you cannot see is one you cannot trust.
 */
function PendingEvents() {
  const pending = useSyncExternalStore(
    (cb) => tracker.subscribe(cb),
    () => tracker.pending(),
  );
  if (pending === 0) return null;
  return (
    <Text style={styles.pending}>{pending === 1 ? '1 event waiting to send' : `${pending} events waiting to send`}</Text>
  );
}

function Header() {
  const dispatch = useDispatch<AppDispatch>();
  const customerId = useSelector((s: RootState) => s.session.customerId);
  return (
    <View style={styles.header}>
      <Text style={styles.heading}>For you</Text>
      <Pressable
        onPress={() => dispatch(customerId ? signOut() : signIn(DEMO_CUSTOMER_ID))}
        hitSlop={10}
        accessibilityRole="button"
      >
        <Text style={styles.account}>{customerId ? 'Sign out' : 'Sign in'}</Text>
      </Pressable>
    </View>
  );
}

function Feed() {
  const dispatch = useDispatch<AppDispatch>();
  const savedIds = useSelector((s: RootState) => s.saved.ids);
  const { data, isLoading, isFetching, refetch, isError } = useGetFeedQuery({ limit: 20 });

  useEffect(() => {
    if (data) saveLastGoodFeed(JSON.stringify(data));
  }, [data]);

  const snapshot = useMemo<FeedResponse | undefined>(() => {
    const raw = readLastGoodFeed();
    return raw ? (JSON.parse(raw) as FeedResponse) : undefined;
  }, []);

  const offline = !data && isError && Boolean(snapshot);
  const feed = data ?? (isError ? snapshot : undefined);
  const feedRequestId = feed?.feed_request_id;

  // ─── instrumentation ─────────────────────────────────────────────────────

  /** React renders the same feed many times; one ranked feed is one view. */
  const firstView = useMemo(() => oncePer(() => {}), []);
  useEffect(() => {
    if (!feed || !firstView(feed.feed_request_id)) return;
    tracker.track(
      'feed_viewed',
      {
        ranking_strategy: feed.ranking_strategy,
        item_count: feed.items.length,
        degraded_sources: offline ? [...feed.degraded, 'offline_snapshot'] : feed.degraded,
      },
      { surface: 'home', feed_request_id: feed.feed_request_id },
    );
  }, [feed, offline, firstView]);

  const feedIdRef = useRef<string | undefined>(undefined);
  feedIdRef.current = feedRequestId;

  const impressions = useRef(
    new ImpressionTracker<FeedItem>((item, position, dwellMs) => {
      const feed_request_id = feedIdRef.current;
      tracker.track(
        'feed_item_impressed',
        { item_id: item.id, item_type: item.type, position, dwell_ms: Math.round(dwellMs) },
        { surface: 'home', feed_request_id },
      );
      // "Shown" means seen: the promise is only counted once the card was
      // actually on screen long enough to read, which is what makes
      // promise-vs-actual a fair measurement.
      if (item.delivery) {
        tracker.track(
          'delivery_promise_shown',
          {
            item_id: item.id,
            promise_window_days: item.delivery.window_days,
            confidence: item.delivery.confidence,
            source: item.delivery.source,
          },
          { surface: 'home', feed_request_id },
        );
      }
    }),
  ).current;

  useEffect(() => {
    if (feedRequestId) impressions.setFeed(feedRequestId);
  }, [feedRequestId, impressions]);

  useEffect(() => {
    const off = onBackground(() => impressions.endAll());
    return () => {
      off();
      impressions.endAll();
    };
  }, [impressions]);

  // FlashList, like FlatList, expects a stable viewability callback.
  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken<FeedItem>[] }) => {
    impressions.update(
      viewableItems
        .filter((v) => v.isViewable && v.item)
        .map((v) => ({ key: v.key, index: v.index ?? 0, item: v.item })),
    );
  }).current;
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 50 }).current;

  const onPress = useCallback(
    (item: FeedItem) => {
      tracker.track(
        'feed_item_tapped',
        {
          item_id: item.id,
          item_type: item.type,
          position: item.position,
          ...(item.category ? { category: item.category } : {}),
        },
        { surface: 'home', feed_request_id: feedIdRef.current },
      );
    },
    [],
  );

  const onToggleSave = useCallback(
    (item: FeedItem) => dispatch(toggleSave(item, feedIdRef.current)),
    [dispatch],
  );

  // ─── render ──────────────────────────────────────────────────────────────

  if (!feed && isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={palette.olive} />
      </View>
    );
  }

  if (!feed) {
    return (
      <View style={styles.center}>
        <Text style={styles.empty}>Sklum isn't reachable. Check your connection, then pull down to reload.</Text>
      </View>
    );
  }

  return (
    <FlashList
      data={feed.items}
      keyExtractor={(item) => `${item.type}:${item.id}`}
      extraData={savedIds}
      renderItem={({ item }) => (
        <FeedCard item={item} saved={Boolean(savedIds[item.id])} onPress={onPress} onToggleSave={onToggleSave} />
      )}
      ListHeaderComponent={
        <>
          <DegradedBanner sources={feed.degraded} />
          {offline ? (
            <View style={styles.banner}>
              <Text style={styles.bannerText}>You're offline. This is the feed from your last visit.</Text>
            </View>
          ) : null}
        </>
      }
      ListFooterComponent={<PendingEvents />}
      contentContainerStyle={styles.list}
      onViewableItemsChanged={onViewableItemsChanged}
      viewabilityConfig={viewabilityConfig}
      refreshControl={
        <RefreshControl
          refreshing={isFetching}
          tintColor={palette.olive}
          onRefresh={() => {
            void refetch();
            void tracker.flush({ ignoreBackoff: true });
          }}
        />
      }
    />
  );
}

export default function App() {
  return (
    <Provider store={store}>
      <SafeAreaProvider>
        <SafeAreaView style={styles.screen} edges={['top']}>
          <StatusBar style="dark" />
          <Header />
          <Feed />
        </SafeAreaView>
      </SafeAreaProvider>
    </Provider>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.canvas },
  header: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 16,
  },
  heading: { fontSize: 30, fontWeight: '600', color: palette.ink, letterSpacing: -0.4 },
  account: { fontSize: 15, color: palette.olive, fontWeight: '600' },
  list: { paddingBottom: 40 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  empty: { color: palette.muted, textAlign: 'center', fontSize: 15, lineHeight: 22 },
  banner: {
    marginHorizontal: 16,
    marginBottom: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: palette.oliveWash,
  },
  bannerText: { fontSize: 14, lineHeight: 20, color: palette.ink },
  pending: { textAlign: 'center', color: palette.muted, fontSize: 13, marginTop: 8 },
});
