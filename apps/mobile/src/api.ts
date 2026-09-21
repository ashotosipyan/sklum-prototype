import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';
import { BFF_URL } from './config';
import type { RootState } from './store';
import { tracker } from './tracking';

export type FeedItem = {
  id: string;
  type: 'order_status' | 'saved' | 'product' | 'inspiration';
  position: number;
  title: string;
  category?: string;
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
    baseUrl: BFF_URL,
    prepareHeaders: (headers, { getState }) => {
      const customerId = (getState() as RootState).session.customerId;
      if (customerId) headers.set('x-customer-id', customerId);
      // Read from the tracker, not storage: it is the single source of the
      // current anonymous identity, including right after a sign-out rotation.
      headers.set('x-anonymous-id', tracker.getIdentity().anonymous_id);
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
