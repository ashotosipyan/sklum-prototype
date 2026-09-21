import { memo } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import type { FeedItem } from '../api';

export const palette = {
  canvas: '#F6F4EF',
  card: '#FFFFFF',
  ink: '#2A2723',
  muted: '#6E665D',
  olive: '#5E6B3C',
  oliveWash: '#EDEFE4',
  ochre: '#B98D3E',
  hairline: '#E4DFD6',
} as const;

const euros = (cents: number) => `€${(cents / 100).toFixed(2).replace('.', ',')}`;

/**
 * Delivery confidence changes the words, not just a colour. A low-confidence or
 * fallback promise never renders as a date the customer could hold us to: the
 * moment the app shows a confident date it cannot meet, delivery trust — the
 * Year 1 north star — pays for it.
 */
function deliveryCopy(d: NonNullable<FeedItem['delivery']>): string {
  if (d.source === 'fallback') return `Delivery estimate updating. Usually within ${d.window_days} days`;
  if (d.confidence === 'high') return `Arrives in ${d.window_days} days`;
  if (d.confidence === 'medium') return `Usually arrives in ${d.window_days} days`;
  return `Estimated ${d.window_days} days`;
}

function Delivery({ delivery }: { delivery: NonNullable<FeedItem['delivery']> }) {
  const confident = delivery.confidence === 'high' && delivery.source !== 'fallback';
  return (
    <View style={styles.deliveryRow}>
      <View style={[styles.dot, { backgroundColor: confident ? palette.olive : palette.ochre }]} />
      <Text style={styles.delivery}>{deliveryCopy(delivery)}</Text>
    </View>
  );
}

const ORDER_STATUS: Record<string, string> = {
  in_transit: 'On its way',
  processing: 'Being prepared',
  delivered: 'Delivered',
};

function OrderCard({ item }: { item: FeedItem }) {
  const unavailable = item.status === 'unavailable';
  return (
    <View style={[styles.card, styles.orderCard]} accessibilityRole="summary">
      <Text style={styles.orderLabel}>{unavailable ? 'Order tracking' : 'Your order'}</Text>
      <Text style={styles.orderTitle}>{item.title}</Text>
      {!unavailable && item.status ? (
        <Text style={styles.orderStatus}>{ORDER_STATUS[item.status] ?? item.status}</Text>
      ) : null}
      {unavailable ? (
        <Text style={styles.orderStatus}>Your order is safe. Pull down to check again.</Text>
      ) : null}
    </View>
  );
}

type ProductProps = {
  item: FeedItem;
  saved: boolean;
  onPress: () => void;
  onToggleSave: () => void;
};

function ProductCard({ item, saved, onPress, onToggleSave }: ProductProps) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={item.title}
    >
      {item.image ? <Image source={{ uri: item.image }} style={styles.image} /> : null}
      <View style={styles.body}>
        <View style={styles.titleRow}>
          <View style={styles.titleBlock}>
            <Text style={styles.title}>{item.title}</Text>
            {item.price_cents != null ? <Text style={styles.price}>{euros(item.price_cents)}</Text> : null}
          </View>
          <Pressable
            onPress={onToggleSave}
            hitSlop={10}
            style={[styles.save, saved && styles.saveActive]}
            accessibilityRole="button"
            accessibilityState={{ selected: saved }}
            accessibilityLabel={saved ? `Remove ${item.title} from saved` : `Save ${item.title}`}
          >
            <Text style={[styles.saveText, saved && styles.saveTextActive]}>{saved ? 'Saved' : 'Save'}</Text>
          </Pressable>
        </View>
        {item.delivery ? <Delivery delivery={item.delivery} /> : null}
      </View>
    </Pressable>
  );
}

export type FeedCardProps = {
  item: FeedItem;
  saved: boolean;
  onPress: (item: FeedItem) => void;
  onToggleSave: (item: FeedItem) => void;
};

/**
 * Card types resolve here. A new surface is one case plus one union member —
 * deliberately small, because the live session includes designing a twist and
 * a new card type is the likeliest one.
 */
export const FeedCard = memo(function FeedCard({ item, saved, onPress, onToggleSave }: FeedCardProps) {
  switch (item.type) {
    case 'order_status':
      return <OrderCard item={item} />;
    default:
      return (
        <ProductCard
          item={item}
          saved={saved}
          onPress={() => onPress(item)}
          onToggleSave={() => onToggleSave(item)}
        />
      );
  }
});

const styles = StyleSheet.create({
  card: {
    backgroundColor: palette.card,
    borderRadius: 16,
    marginHorizontal: 16,
    marginBottom: 16,
    overflow: 'hidden',
  },
  pressed: { opacity: 0.92 },
  orderCard: { padding: 18, backgroundColor: palette.oliveWash, borderRadius: 12 },
  orderLabel: { fontSize: 13, color: palette.olive, fontWeight: '600' },
  orderTitle: { fontSize: 18, marginTop: 4, color: palette.ink },
  orderStatus: { fontSize: 14, marginTop: 6, color: palette.muted },
  image: { width: '100%', aspectRatio: 1.25, backgroundColor: palette.hairline },
  body: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 16 },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start' },
  titleBlock: { flex: 1, paddingRight: 12 },
  title: { fontSize: 16, lineHeight: 22, color: palette.ink },
  price: { fontSize: 15, marginTop: 2, color: palette.ink, fontWeight: '600' },
  save: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: palette.hairline,
  },
  saveActive: { backgroundColor: palette.olive, borderColor: palette.olive },
  saveText: { fontSize: 14, color: palette.ink },
  saveTextActive: { color: '#FFFFFF', fontWeight: '600' },
  deliveryRow: { flexDirection: 'row', alignItems: 'center', marginTop: 10 },
  dot: { width: 7, height: 7, borderRadius: 4, marginRight: 8 },
  delivery: { fontSize: 13, color: palette.muted, flexShrink: 1 },
});
