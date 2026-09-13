import { Image, StyleSheet, Text, View } from 'react-native';
import type { FeedItem } from '../api';

const euros = (cents: number) => `€${(cents / 100).toFixed(2)}`;

/**
 * Delivery confidence is rendered differently rather than flattened into a date.
 * A `low` / `fallback` promise is shown as a range with hedged language, because
 * the moment the app shows a confident date it cannot meet, the delivery-trust
 * north star is the thing that pays for it.
 */
function Delivery({ delivery }: { delivery: NonNullable<FeedItem['delivery']> }) {
  const confident = delivery.confidence === 'high';
  const text = confident
    ? `Arrives in ${delivery.window_days} days`
    : `Estimated ${delivery.window_days} days`;

  return (
    <View style={styles.deliveryRow}>
      <View style={[styles.dot, confident ? styles.dotHigh : styles.dotSoft]} />
      <Text style={styles.delivery}>{text}</Text>
      {delivery.source === 'fallback' ? (
        <Text style={styles.fallback}>· estimate only</Text>
      ) : null}
    </View>
  );
}

function OrderCard({ item }: { item: FeedItem }) {
  const unavailable = item.status === 'unavailable';
  return (
    <View style={[styles.card, styles.orderCard]}>
      <Text style={styles.orderLabel}>
        {unavailable ? 'Tracking' : `Your order · ${item.status?.replace('_', ' ')}`}
      </Text>
      <Text style={styles.orderTitle}>{item.title}</Text>
    </View>
  );
}

function ProductCard({ item }: { item: FeedItem }) {
  return (
    <View style={styles.card}>
      {item.image ? <Image source={{ uri: item.image }} style={styles.image} /> : null}
      <View style={styles.body}>
        <Text style={styles.title}>{item.title}</Text>
        {item.price_cents != null ? (
          <Text style={styles.price}>{euros(item.price_cents)}</Text>
        ) : null}
        {item.delivery ? <Delivery delivery={item.delivery} /> : null}
      </View>
    </View>
  );
}

/**
 * Card types resolve through this map. Adding a surface is one entry here plus
 * one member on the union — deliberately, because the live session includes the
 * team designing a twist and this is where a new card type lands.
 */
export function FeedCard({ item }: { item: FeedItem }) {
  switch (item.type) {
    case 'order_status':
      return <OrderCard item={item} />;
    default:
      return <ProductCard item={item} />;
  }
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#fff',
    borderRadius: 14,
    marginHorizontal: 16,
    marginBottom: 14,
    overflow: 'hidden',
  },
  orderCard: { padding: 16, backgroundColor: '#F3EFE9' },
  orderLabel: { fontSize: 12, letterSpacing: 0.6, textTransform: 'uppercase', color: '#8A7F70' },
  orderTitle: { fontSize: 17, marginTop: 6, color: '#2B2621' },
  image: { width: '100%', height: 200, backgroundColor: '#EFEAE4' },
  body: { padding: 14 },
  title: { fontSize: 16, color: '#2B2621' },
  price: { fontSize: 15, marginTop: 4, color: '#2B2621', fontWeight: '600' },
  deliveryRow: { flexDirection: 'row', alignItems: 'center', marginTop: 8 },
  dot: { width: 7, height: 7, borderRadius: 4, marginRight: 7 },
  dotHigh: { backgroundColor: '#4E8A5B' },
  dotSoft: { backgroundColor: '#C2A25B' },
  delivery: { fontSize: 13, color: '#6B6157' },
  fallback: { fontSize: 13, color: '#A2968A', marginLeft: 4 },
});
