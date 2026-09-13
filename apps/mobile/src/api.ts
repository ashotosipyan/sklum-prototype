import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';
import { Platform } from 'react-native';

/**
 * The iOS simulator reaches the host machine on localhost; the Android emulator
 * needs 10.0.2.2. On a physical device over a dev build this must be the LAN IP
 * of the machine running the BFF — set EXPO_PUBLIC_BFF_URL.
 */
const HOST =
  process.env.EXPO_PUBLIC_BFF_URL ??
  (Platform.OS === 'android' ? 'http://10.0.2.2:4100' : 'http://localhost:4100');

export type FeedItem = {
  id: string;
  type: 'order_status' | 'saved' | 'product' | 'inspiration';
  position: number;
  title: string;
  image?: string;
  price_cents?: number;
  status?: string;
  delivery?: {
    window_days: number;
    earliest: string;
    confidence: 'high' | 'medium' | 'low';
    source: 'live' | 'cached' | 'fallback';
  };
};

export type FeedResponse = {
  feed_request_id: string;
  ranking_strategy: string;
  degraded: string[];
  items: FeedItem[];
  timings_ms: Record<string, number>;
};

export const api = createApi({
  reducerPath: 'api',
  baseQuery: fetchBaseQuery({
    baseUrl: HOST,
    prepareHeaders: (headers) => {
      headers.set('x-customer-id', 'cust_1');
      return headers;
    },
    timeout: 5000,
  }),
  tagTypes: ['Feed'],
  endpoints: (builder) => ({
    getFeed: builder.query<FeedResponse, { limit?: number }>({
      query: ({ limit = 20 }) => `/v1/feed?limit=${limit}`,
      providesTags: ['Feed'],
      /**
       * The BFF returns 200 with a `degraded` array rather than an error when an
       * upstream is unhealthy, so there is deliberately no retry here. Retrying a
       * successful-but-degraded response would hammer a service that is already
       * struggling, and the customer already has a usable screen.
       */
    }),
  }),
});

export const { useGetFeedQuery } = api;
