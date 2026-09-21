import { z } from 'zod';

/**
 * The event contract is defined once, here, and imported by both the app SDK and
 * the collector. A client that can compile can only emit events the collector
 * accepts. This is the whole reason the package exists.
 */

export const SURFACES = ['home', 'pdp', 'account', 'checkout'] as const;
export const ITEM_TYPES = ['order_status', 'saved', 'product', 'inspiration'] as const;
export const PROMISE_CONFIDENCE = ['high', 'medium', 'low'] as const;
export const PROMISE_SOURCE = ['live', 'cached', 'fallback'] as const;

/** Fields present on every event, regardless of type. */
export const envelopeSchema = z.object({
  /** UUIDv7, generated at the call site — this is the idempotency key. */
  event_id: z.string().uuid(),
  /** Per-event schema version, so one event can evolve without a coordinated release. */
  schema_version: z.number().int().positive(),
  /** Device clock. The collector records received_at separately and never overwrites this. */
  occurred_at: z.string().datetime(),
  /** Minted at first launch, persisted in secure storage, survives logout. */
  anonymous_id: z.string().min(1),
  /** Present only after login. Never inferred client-side. */
  customer_id: z.string().min(1).optional(),
  session_id: z.string().min(1),
  surface: z.enum(SURFACES),
  app_version: z.string().min(1),
  /** Correlates a client-side impression with the exact server ranking that produced it. */
  feed_request_id: z.string().uuid().optional(),
});

export type Envelope = z.infer<typeof envelopeSchema>;

/** Payload schema per event name. Adding an event = one entry here. */
export const payloads = {
  app_opened: z.object({
    cold_start: z.boolean(),
  }),

  feed_viewed: z.object({
    ranking_strategy: z.string().min(1),
    item_count: z.number().int().nonnegative(),
    degraded_sources: z.array(z.string()).default([]),
  }),

  feed_item_impressed: z.object({
    item_id: z.string().min(1),
    item_type: z.enum(ITEM_TYPES),
    position: z.number().int().nonnegative(),
    dwell_ms: z.number().int().nonnegative(),
  }),

  feed_item_tapped: z.object({
    item_id: z.string().min(1),
    item_type: z.enum(ITEM_TYPES),
    position: z.number().int().nonnegative(),
    /** Carried on the event so affinity can be computed without a catalogue join. */
    category: z.string().min(1).optional(),
  }),

  item_saved: z.object({
    item_id: z.string().min(1),
    category: z.string().min(1),
  }),

  item_unsaved: z.object({
    item_id: z.string().min(1),
    category: z.string().min(1),
  }),

  /**
   * Emitted every time a promise is *shown*, not every time one is fetched.
   * This is what makes promise-vs-actual measurable, which is the Year 1
   * delivery-trust north star.
   */
  delivery_promise_shown: z.object({
    item_id: z.string().min(1),
    promise_window_days: z.number().int().positive(),
    confidence: z.enum(PROMISE_CONFIDENCE),
    source: z.enum(PROMISE_SOURCE),
  }),

  /**
   * Anonymous-to-known stitching. Append-only: prior events are never rewritten,
   * the warehouse joins through the resolution table instead.
   */
  identity_resolved: z.object({
    previous_anonymous_id: z.string().min(1),
  }),
} as const;

export type EventName = keyof typeof payloads;

/** What a caller passes to track() — defaults not yet applied. */
export type PayloadInput<N extends EventName> = z.input<(typeof payloads)[N]>;
export const EVENT_NAMES = Object.keys(payloads) as EventName[];

/** Discriminated union of every valid event. */
const variants = EVENT_NAMES.map((name) =>
  envelopeSchema.extend({
    event_name: z.literal(name),
    payload: payloads[name],
  }),
);

export const eventSchema = z.discriminatedUnion(
  'event_name',
  variants as [(typeof variants)[number], ...(typeof variants)[number][]],
);

export type SklumEvent = {
  [N in EventName]: Envelope & {
    event_name: N;
    payload: z.infer<(typeof payloads)[N]>;
  };
}[EventName];

/**
 * The batch envelope is validated separately from the events inside it. One
 * malformed event must not cost the other nineteen in the batch their delivery,
 * so the collector validates events individually and reports per-event results.
 */
export const batchEnvelopeSchema = z.object({
  sent_at: z.string().datetime(),
  events: z.array(z.unknown()).min(1).max(100),
  /** Events the client discarded under backpressure since its last acknowledged batch. */
  client_dropped: z.number().int().nonnegative().optional(),
});

export type Batch = { sent_at: string; events: SklumEvent[]; client_dropped?: number };

/**
 * Rules the type system cannot express. Shared, so the device refuses to enqueue
 * what the collector would reject — a rejected event is an event lost.
 */
export function semanticIssue(event: SklumEvent): string | null {
  if (event.event_name === 'identity_resolved') {
    if (!event.customer_id) return 'identity_resolved requires customer_id';
    if (event.payload.previous_anonymous_id !== event.anonymous_id) {
      return 'identity_resolved must link the anonymous_id it was emitted from';
    }
  }
  return null;
}

/**
 * UUIDv7 — time-ordered, so event_id sorts by creation and gives the warehouse a
 * usable partition hint for free. Generated on device at the call site so a retried
 * batch carries identical ids and dedups on primary key.
 */
export function uuidv7(): string {
  const ms = Date.now();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[0] = (ms / 2 ** 40) & 0xff;
  bytes[1] = (ms / 2 ** 32) & 0xff;
  bytes[2] = (ms / 2 ** 24) & 0xff;
  bytes[3] = (ms / 2 ** 16) & 0xff;
  bytes[4] = (ms / 2 ** 8) & 0xff;
  bytes[5] = ms & 0xff;
  bytes[6] = (bytes[6]! & 0x0f) | 0x70;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Device clocks lie. Clamp occurred_at into a plausible window relative to server
 * time, but keep the original so a wrongly-timestamped event stays distinguishable
 * from a genuinely late one.
 */
export const CLOCK_SKEW_TOLERANCE_MS = 24 * 60 * 60 * 1000;

export function clampOccurredAt(
  occurredAt: string,
  receivedAt: Date = new Date(),
): { occurred_at: string; clock_skew_ms: number; clamped: boolean } {
  const raw = new Date(occurredAt).getTime();
  const skew = raw - receivedAt.getTime();
  if (Math.abs(skew) <= CLOCK_SKEW_TOLERANCE_MS) {
    return { occurred_at: occurredAt, clock_skew_ms: skew, clamped: false };
  }
  return {
    occurred_at: receivedAt.toISOString(),
    clock_skew_ms: skew,
    clamped: true,
  };
}
