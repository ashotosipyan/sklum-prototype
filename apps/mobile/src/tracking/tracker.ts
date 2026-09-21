import {
  eventSchema,
  semanticIssue,
  uuidv7,
  type Batch,
  type EventName,
  type PayloadInput,
  type SklumEvent,
} from '@sklum/events';

/**
 * Device-side event capture. No React Native imports, deliberately: every
 * correctness property below is tested in plain Node, in CI, against the real
 * collector. The RN wiring in ./index.ts only supplies storage, transport and
 * lifecycle hooks.
 *
 * Guarantees, in order of importance:
 *
 *  1. Write-ahead. An event is persisted before any network call is attempted,
 *     so it survives the app being killed at any point.
 *  2. Idempotent retry. event_id is minted at the call site, never at flush
 *     time, so a batch resent after a lost acknowledgement carries identical ids
 *     and the collector dedups it. Delivery is at-least-once; the effect is
 *     exactly-once per user action.
 *  3. No poison pills. A batch the collector says is malformed is dropped and
 *     counted, never retried forever behind everything else in the queue.
 *  4. Bounded. The queue has a cap; under pressure the cheapest events go first
 *     and the loss is reported, not hidden.
 */

export interface KeyValueStore {
  getString(key: string): string | undefined;
  set(key: string, value: string): void;
}

export type SendOutcome =
  /** 2xx — every event reached a final state server-side. Delete the batch. */
  | { kind: 'ok' }
  /** 4xx — the batch can never succeed. Delete it and count the loss. */
  | { kind: 'rejected' }
  /** 5xx or network failure. Keep the batch, back off. */
  | { kind: 'retry' };

export interface Transport {
  send(batch: Batch): Promise<SendOutcome>;
}

export type TrackerIdentity = {
  anonymous_id: string;
  customer_id?: string | undefined;
  session_id: string;
  app_version: string;
};

export type TrackOptions = {
  surface: SklumEvent['surface'];
  feed_request_id?: string | undefined;
};

export type TrackerOptions = {
  store: KeyValueStore;
  transport: Transport;
  identity: TrackerIdentity;
  batchSize?: number;
  maxQueue?: number;
  backoffBaseMs?: number;
  backoffMaxMs?: number;
  now?: () => number;
  random?: () => number;
  /** Called when the app tries to emit an event the contract forbids. Loud in dev. */
  onInvalid?: (issue: string, attempted: unknown) => void;
};

const QUEUE_KEY = 'queue.v1';
const DROPPED_KEY = 'dropped.v1';

/** When the queue is full, these go first: high volume, individually low value. */
const DROP_FIRST: ReadonlySet<EventName> = new Set(['feed_item_impressed', 'delivery_promise_shown']);


export class Tracker {
  private readonly store: KeyValueStore;
  private readonly transport: Transport;
  private identity: TrackerIdentity;
  private readonly batchSize: number;
  private readonly maxQueue: number;
  private readonly backoffBaseMs: number;
  private readonly backoffMaxMs: number;
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly onInvalid: (issue: string, attempted: unknown) => void;

  private inFlight: Promise<void> | null = null;
  private attempt = 0;
  private nextAttemptAt = 0;
  private listeners = new Set<() => void>();

  constructor(opts: TrackerOptions) {
    this.store = opts.store;
    this.transport = opts.transport;
    this.identity = { ...opts.identity };
    this.batchSize = opts.batchSize ?? 20;
    this.maxQueue = opts.maxQueue ?? 500;
    this.backoffBaseMs = opts.backoffBaseMs ?? 1_000;
    this.backoffMaxMs = opts.backoffMaxMs ?? 60_000;
    this.now = opts.now ?? Date.now;
    this.random = opts.random ?? Math.random;
    this.onInvalid = opts.onInvalid ?? (() => {});
  }

  /**
   * Record one user action. Returns the event_id, or null if the event violated
   * the contract and was refused. Refusing on device is the point: an event the
   * collector would reject is an event silently lost.
   */
  track<N extends EventName>(name: N, payload: PayloadInput<N>, opts: TrackOptions): string | null {
    const candidate = {
      event_id: uuidv7(),
      event_name: name,
      schema_version: 1,
      occurred_at: new Date(this.now()).toISOString(),
      anonymous_id: this.identity.anonymous_id,
      ...(this.identity.customer_id ? { customer_id: this.identity.customer_id } : {}),
      session_id: this.identity.session_id,
      surface: opts.surface,
      app_version: this.identity.app_version,
      ...(opts.feed_request_id ? { feed_request_id: opts.feed_request_id } : {}),
      payload,
    };

    const parsed = eventSchema.safeParse(candidate);
    if (!parsed.success) {
      this.onInvalid(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '), candidate);
      return null;
    }
    const event = parsed.data as SklumEvent;
    const semantic = semanticIssue(event);
    if (semantic) {
      this.onInvalid(semantic, candidate);
      return null;
    }

    this.enqueue(event);
    return event.event_id;
  }

  /**
   * Anonymous → known. Emitted from the anonymous identity so the collector can
   * link the two; every later event carries the customer_id. Nothing already
   * queued is rewritten.
   */
  identify(customerId: string, surface: TrackOptions['surface'] = 'account'): string | null {
    const previous = this.identity.anonymous_id;
    this.identity = { ...this.identity, customer_id: customerId };
    return this.track('identity_resolved', { previous_anonymous_id: previous }, { surface });
  }

  /**
   * Sign-out on a shared device. A fresh anonymous id is required, not optional:
   * keeping the old one would attribute the next person's behaviour to the
   * customer who just left, through the identity link already on the server.
   */
  resetIdentity(freshAnonymousId: string): void {
    this.identity = {
      anonymous_id: freshAnonymousId,
      session_id: this.identity.session_id,
      app_version: this.identity.app_version,
    };
  }

  getIdentity(): Readonly<TrackerIdentity> {
    return this.identity;
  }

  pending(): number {
    return this.readQueue().length;
  }

  droppedUnreported(): number {
    return Number(this.store.getString(DROPPED_KEY) ?? '0');
  }

  /** Milliseconds until the next retry is allowed; 0 when a flush may run now. */
  backoffRemainingMs(): number {
    return Math.max(0, this.nextAttemptAt - this.now());
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Send at most one batch. Single-flight: concurrent callers share the same
   * attempt instead of racing to send the same events twice.
   */
  flush(opts: { ignoreBackoff?: boolean } = {}): Promise<void> {
    if (this.inFlight) return this.inFlight;
    if (!opts.ignoreBackoff && this.backoffRemainingMs() > 0) return Promise.resolve();

    const batch = this.readQueue().slice(0, this.batchSize);
    if (batch.length === 0) return Promise.resolve();

    const dropped = this.droppedUnreported();
    this.inFlight = this.transport
      .send({
        sent_at: new Date(this.now()).toISOString(),
        events: batch,
        ...(dropped > 0 ? { client_dropped: dropped } : {}),
      })
      .catch((): SendOutcome => ({ kind: 'retry' }))
      .then((outcome) => this.settle(batch, dropped, outcome))
      .finally(() => {
        this.inFlight = null;
      });

    return this.inFlight;
  }

  /** Flush until the queue is empty or the transport asks us to back off. */
  async drain(maxBatches = 50): Promise<void> {
    for (let i = 0; i < maxBatches && this.pending() > 0; i++) {
      const before = this.pending();
      await this.flush();
      if (this.pending() >= before) return;
    }
  }

  // ─── internals ────────────────────────────────────────────────────────────

  private settle(batch: SklumEvent[], droppedReported: number, outcome: SendOutcome): void {
    if (outcome.kind === 'retry') {
      this.attempt += 1;
      const exp = Math.min(this.backoffMaxMs, this.backoffBaseMs * 2 ** (this.attempt - 1));
      // Equal jitter: never retry sooner than half the backoff, spread the rest,
      // so a fleet of devices coming back online does not stampede the collector.
      this.nextAttemptAt = this.now() + exp / 2 + this.random() * (exp / 2);
      this.emit();
      return;
    }

    this.attempt = 0;
    this.nextAttemptAt = 0;

    // Remove by id, re-reading the queue: events may have been appended while the
    // request was in flight, and they must not be lost to a stale snapshot.
    const sent = new Set(batch.map((e) => e.event_id));
    this.writeQueue(this.readQueue().filter((e) => !sent.has(e.event_id)));

    if (outcome.kind === 'ok') {
      // The server received the drop count we sent; only newer drops remain unreported.
      this.store.set(DROPPED_KEY, String(Math.max(0, this.droppedUnreported() - droppedReported)));
    } else {
      // A 400 means the batch was never processed, so the drop count it carried was
      // not received either. Keep it, and add the batch itself to the losses.
      this.store.set(DROPPED_KEY, String(this.droppedUnreported() + batch.length));
    }
    this.emit();
  }

  private enqueue(event: SklumEvent): void {
    const queue = this.readQueue();
    queue.push(event);

    let dropped = 0;
    while (queue.length > this.maxQueue) {
      const cheap = queue.findIndex((e) => DROP_FIRST.has(e.event_name));
      queue.splice(cheap >= 0 ? cheap : 0, 1);
      dropped += 1;
    }

    this.writeQueue(queue);
    if (dropped > 0) this.store.set(DROPPED_KEY, String(this.droppedUnreported() + dropped));
    this.emit();
  }

  private readQueue(): SklumEvent[] {
    const raw = this.store.getString(QUEUE_KEY);
    if (!raw) return [];
    try {
      return JSON.parse(raw) as SklumEvent[];
    } catch {
      // A corrupt queue must not brick capture forever. Start clean and count it.
      this.store.set(DROPPED_KEY, String(this.droppedUnreported() + 1));
      return [];
    }
  }

  private writeQueue(queue: SklumEvent[]): void {
    this.store.set(QUEUE_KEY, JSON.stringify(queue));
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }
}

/** In-memory store for tests and for any surface without durable storage. */
export class MemoryStore implements KeyValueStore {
  private readonly map = new Map<string, string>();
  getString(key: string) {
    return this.map.get(key);
  }
  set(key: string, value: string) {
    this.map.set(key, value);
  }
}
