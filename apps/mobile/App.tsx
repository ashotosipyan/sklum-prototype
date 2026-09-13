import { FlashList } from '@shopify/flash-list';
import { useEffect, useMemo } from 'react';
import { ActivityIndicator, RefreshControl, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Provider } from 'react-redux';
import { useGetFeedQuery, type FeedResponse } from './src/api';
import { FeedCard } from './src/components/FeedCard';
import { readLastGoodFeed, saveLastGoodFeed } from './src/storage';
import { store } from './src/store';

function DegradedBanner({ sources }: { sources: string[] }) {
  if (sources.length === 0) return null;
  return (
    <View style={styles.banner}>
      <Text style={styles.bannerText}>
        Some information is temporarily unavailable ({sources.join(', ')}). Everything else is up to
        date.
      </Text>
    </View>
  );
}

function Feed() {
  const { data, isLoading, isFetching, refetch, isError } = useGetFeedQuery({ limit: 20 });

  /**
   * Persist the last successful feed. A cold start with no network then renders
   * the previous feed rather than a spinner or an error — the app should never be
   * a blank screen just because the network is.
   */
  useEffect(() => {
    if (data) saveLastGoodFeed(JSON.stringify(data));
  }, [data]);

  const fallback = useMemo<FeedResponse | undefined>(() => {
    const raw = readLastGoodFeed();
    return raw ? (JSON.parse(raw) as FeedResponse) : undefined;
  }, []);

  const feed = data ?? (isError ? fallback : undefined);

  if (!feed && isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  if (!feed) {
    return (
      <View style={styles.center}>
        <Text style={styles.empty}>Can't reach Sklum right now. Pull to try again.</Text>
      </View>
    );
  }

  return (
    <>
      <DegradedBanner sources={feed.degraded} />
      {!data && fallback ? (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>Showing your last saved feed — you're offline.</Text>
        </View>
      ) : null}
      <FlashList
        data={feed.items}
        keyExtractor={(item) => `${item.type}:${item.id}`}
        renderItem={({ item }) => <FeedCard item={item} />}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={isFetching}
            onRefresh={() => {
              void refetch();
            }}
          />
        }
      />
    </>
  );
}

export default function App() {
  return (
    <Provider store={store}>
      <SafeAreaView style={styles.screen}>
        <StatusBar style="dark" />
        <Text style={styles.heading}>For you</Text>
        <Feed />
      </SafeAreaView>
    </Provider>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#FAF7F3' },
  heading: {
    fontSize: 28,
    fontWeight: '600',
    color: '#2B2621',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 14,
  },
  list: { paddingBottom: 32 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  empty: { color: '#6B6157', textAlign: 'center' },
  banner: {
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 12,
    borderRadius: 10,
    backgroundColor: '#F0E7D8',
  },
  bannerText: { fontSize: 13, color: '#6B5A3E' },
});
