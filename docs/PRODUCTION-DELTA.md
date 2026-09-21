# Production delta

Every simplification in the prototype, what production would use instead, and — the useful part —
the point at which the simplification stops being acceptable. Some thresholds are scale; some are
legal and apply on day one regardless of scale.

## Launch blockers — change before any real customer

| Prototype | Production | Why it cannot wait |
|---|---|---|
| No consent check; every event fires | Consent SDK gating capture by purpose; purpose field on the event contract | GDPR across 10+ EU markets. A contract change, cheapest before data exists |
| Customer identity taken from an `x-customer-id` header | BFF derives identity from a verified token; never accepts it as input | Anyone can impersonate anyone |
| `/_control` endpoints on the stubs, unauthenticated | Stubs do not exist in production; any admin surface behind auth | — |
| No crash or performance reporting | Sentry (or equivalent) for crashes and app performance; OpenTelemetry traces BFF → core | You cannot run what you cannot see |

## Scale thresholds

| Prototype | Production | Breaks when |
|---|---|---|
| Collector writes to single-node SQLite | Managed Kafka or Kinesis → object storage (Iceberg) → warehouse | Any real traffic; more than one collector instance |
| Dedup by SQLite primary key | Keyed dedup window in the stream processor, plus `MERGE` on `event_id` in the warehouse | The moment ingest is distributed |
| Affinity computed per feed request with a SQL aggregate | Precomputed features in a feature store, updated from the stream | Affinity p95 above ~50ms, or roughly 10k daily actives |
| Device queue stored as one JSON value in MMKV, rewritten on each event | Append-only log on device — one MMKV key per event, or on-device SQLite | Queue caps above ~1,000 events, or impression volume on long sessions |
| Session = process launch | Session rolls over after ~30 minutes in the background | Any session-based metric is reported |
| Promise lookups: one parallel call per SKU, each with its own budget | Batch endpoint on the promise service, plus an aggregate budget for the phase | Feeds with more than ~10 promised items; tail latency compounds |
| `rules_v1` category-level ranking | Item embeddings and learning-to-rank behind the same interface, A/B-tested | ~12 months of impression logs with positions — Year 2 |
| No exploration or diversity in ranking | Exploration slot and category diversity constraint | Immediately in production — the feed collapses to the first saved category |
| Saved items in local storage | Account service, synced across devices | A customer uses a second device |
| Ranking strategy fixed in code | Remote config and feature flags for strategy rollout and holdouts | The first ranking A/B test |

## Delivery and operations

| Prototype | Production | Why |
|---|---|---|
| `expo prebuild` + `expo run:ios` on a developer machine | EAS Build for signed binaries; EAS Update for over-the-air JS updates with release channels | Reproducible builds; fixing a JS bug without an App Store review |
| Services run TypeScript directly via `tsx` | Compiled with esbuild into the container image | Faster cold starts; no compiler in production |
| Stub product images from a placeholder service | CDN with responsive sizes; `expo-image` for disk caching and placeholders | Real catalogue imagery, mobile bandwidth |
| CI: boundaries, typecheck, unit and integration tests, Metro bundles | Plus end-to-end tests on real devices (Maestro or Detox on a device farm) | Viewability and lifecycle behaviour only exist on devices |
| One region, local processes | BFF deployed near users in the EU; the Hono runtime was chosen partly so it can run at the edge | Latency budget of 400ms p95 across markets |

## Choices that are already production-grade

Listed because it would be easy to assume everything in a prototype is a shortcut.

- **Native dev build, not Expo Go** — real `ios/` and `android/` projects via continuous native
  generation.
- **FlashList, MMKV, RTK Query** — the production data and rendering stack.
- **Shared, runtime-validated event contract** between device and collector.
- **Write-ahead queue, idempotent retry, poison-batch handling, bounded backpressure with reported
  loss** — the capture guarantees would not change in production; only the storage beneath them.
- **Append-only identity resolution with sign-out rotation.**
- **Per-source budgets and honest degradation in the BFF.**
- **Single React Native version enforced across the workspace**, and native versions pinned to the
  Expo SDK's manifest rather than npm's latest.
