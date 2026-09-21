# Sklum App — case study and prototype

A take-home for the Sklum App software engineering case. Five written deliverables and a working
vertical slice: a React Native feed, a BFF that degrades instead of failing, device-side event
capture with exactly-once-per-action guarantees, and a ranking loop that closes on real signal.

## The deliverables

| # | Document | What it covers |
|---|---|---|
| 01 | [Business case](docs/01-business-case.md) | Who it is for, the value at stake, how we would know it works |
| 02 | [System design](docs/02-system-design.md) | End-to-end architecture, build/buy/reuse, the three hard parts |
| 03 | [Domain deep-dive](docs/03-domain-deep-dive.md) | App + BFF + event capture: design, guarantees, demo script |
| 04 | [Evaluation](docs/04-evaluation.md) | Where the prototype delivers, where it falls short, what building it taught |
| 05 | [Three-year roadmap](docs/05-roadmap.md) | Technology and experience, sequenced by data dependencies |

Supporting: [monorepo architecture](docs/monorepo-architecture.md) ·
[production delta](docs/PRODUCTION-DELTA.md) · [running it](RUNNING.md)

## Quick start

```bash
npm install
npm run dev                       # stubs :4000 · collector :4200 · BFF :4100

cd apps/mobile
npx expo prebuild --clean         # native projects — this is a dev build, not Expo Go
npx expo run:ios                  # or: npx expo run:android
```

Full instructions, including Docker and the demo sequence, are in [RUNNING.md](RUNNING.md).

## Verify

```bash
npm run verify    # dependency boundaries → typecheck (services, tests, mobile) → 21 tests
npm run report    # funnel and data-quality report over captured events
```

## Repository

```
apps/mobile          Expo dev build · RN 0.86 · RTK Query · FlashList · MMKV
  src/tracking/      the capture engine — no React Native imports, tested in Node
packages/events      the event contract, shared by device and collector
services/bff         GET /v1/feed — four upstreams, per-source budgets, rules_v1 ranking
services/collector   POST /v1/events · GET /v1/affinity · GET /v1/stats · SQLite
services/stubs       fake commerce core, orders and delivery promise, with fail switches
tools/analyze        funnel and data-quality report
tests/               end to end: real tracker against real collector; BFF over real HTTP
scripts/             dev runner, dependency boundary check
docs/                the five deliverables
```

## What it demonstrates, in one line

Signal in, ranking out, no model — the AI-first foundation, executed rather than asserted.
