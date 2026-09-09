# Sklum App — prototype

A vertical slice of the Sklum App: React Native feed → BFF → typed event capture →
deterministic ranking → reordered feed. Local only, no cloud dependencies.

## Status

| Package | State |
|---|---|
| `packages/events` | Done — shared Zod contracts, UUIDv7, clock-skew clamp |
| `services/stubs` | Done — catalogue, orders, delivery promise, with latency and fail switches |
| `services/bff` | Next — `/v1/feed` aggregation, per-source timeouts, degradation |
| `services/collector` | Next — `/v1/events`, schema validation, dedup, SQLite |
| `apps/mobile` | Next — Expo Home feed |
| `tools/analyze` | Next — affinity and funnel queries |

## Run

```bash
npm install
npm run stubs        # :4000
```

## Poke at the stubs

```bash
curl localhost:4000/promise/sku_0007
curl localhost:4000/orders/cust_1

# make orders fail, to demonstrate BFF degradation
curl -X POST localhost:4000/_control/orders \
  -H 'content-type: application/json' -d '{"fail":true}'

# make the promise service slow, to demonstrate the timeout path
curl -X POST localhost:4000/_control/promise \
  -H 'content-type: application/json' -d '{"latency_ms":2000}'

curl localhost:4000/_control    # current state of all three
```

## Why the stubs have a fail switch

The interesting behaviour of this system is not the happy path. It is what the feed does when the
orders service is down and the promise service is slow: the feed must still render, and the
customer must still get an honest answer. Being able to cause that on demand is what makes the
behaviour demonstrable in a live walkthrough rather than merely claimed in a document.
