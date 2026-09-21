import { AppState, type AppStateStatus } from 'react-native';
import { uuidv7, type Batch } from '@sklum/events';
import { APP_VERSION, COLLECTOR_URL } from '../config';
import { eventsStore, getAnonymousId, getCustomerId } from '../storage';
import { Tracker, type SendOutcome, type Transport } from './tracker';

export { ImpressionTracker, oncePer } from './impressions';

const httpTransport: Transport = {
  async send(batch: Batch): Promise<SendOutcome> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8_000);
    try {
      const res = await fetch(`${COLLECTOR_URL}/v1/events`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(batch),
        signal: controller.signal,
      });
      if (res.ok) return { kind: 'ok' };
      // 408 and 429 are the server asking us to come back later, not refusals.
      if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) {
        return { kind: 'rejected' };
      }
      return { kind: 'retry' };
    } catch {
      return { kind: 'retry' };
    } finally {
      clearTimeout(timer);
    }
  },
};

/**
 * One session per process launch. A production session would also roll over
 * after ~30 minutes in the background; noted in PRODUCTION-DELTA.md.
 */
export const tracker = new Tracker({
  store: eventsStore,
  transport: httpTransport,
  identity: {
    anonymous_id: getAnonymousId(uuidv7),
    customer_id: getCustomerId(),
    session_id: uuidv7(),
    app_version: APP_VERSION,
  },
  onInvalid: (issue, attempted) => {
    if (__DEV__) console.error('[tracking] refused an event that breaks the contract:', issue, attempted);
  },
});

const backgroundHooks = new Set<() => void>();

/** Register work that must happen before the app leaves the foreground. */
export function onBackground(hook: () => void): () => void {
  backgroundHooks.add(hook);
  return () => backgroundHooks.delete(hook);
}

let started = false;

export function startTracking(): void {
  if (started) return;
  started = true;

  tracker.track('app_opened', { cold_start: true }, { surface: 'home' });

  setInterval(() => void tracker.flush(), 5_000);
  tracker.subscribe(() => {
    if (tracker.pending() >= 20) void tracker.flush();
  });

  let previous: AppStateStatus = AppState.currentState;
  AppState.addEventListener('change', (next) => {
    if (next === 'background' || next === 'inactive') {
      // Close open impressions and push what we have while the OS still lets us.
      backgroundHooks.forEach((hook) => hook());
      void tracker.flush({ ignoreBackoff: true });
    }
    if (next === 'active' && previous !== 'active') {
      // Warm opens count: "repeat app opens" is a Year 1 north star.
      if (previous === 'background') tracker.track('app_opened', { cold_start: false }, { surface: 'home' });
      void tracker.flush({ ignoreBackoff: true });
    }
    previous = next;
  });
}
