# Deliverable 4 — Evaluation of the prototype

## Summary

The prototype does one thing convincingly: it proves that behavioural signal can be captured on a
mobile device, delivered exactly once per user action through offline periods, process death and
lost acknowledgements, stitched from anonymous to known identity without rewriting history, and
fed back into what the customer sees next — while the feed stays usable when any upstream fails.
That is the foundation the business case rests on, and it is tested rather than asserted.

It does not prove that the ranking is any good, that customers want the app, or that the numbers
in the business case are right. Those are different questions, and the gaps are listed below
without softening.

## How well it serves the business case

| Business-case lever | Delivers | Falls short |
|---|---|---|
| **Known-customer share** | Stitching works, is reversible, and handles the shared-device case | No real auth; identity is whatever header the client sends |
| **Delivery trust** | Degradation is honest and tested; `delivery_promise_shown` makes promise-vs-actual measurable | No reconciliation against actual delivery — half of the measurement is missing |
| **Repeat opens** | Cold and warm opens both captured | Session boundary is process launch, not inactivity |
| **Signal from day one** | Exactly-once suite, mutation-checked; data-quality report | Single-node SQLite; no streaming path; no consent gate |
| **Repeat purchase / basket** | Nothing | The prototype has no PDP, no checkout, no conversion event |

The last row is deliberate. The business case says Year 1's return is the identified-customer base
and the event stream, not direct revenue, and the prototype is scoped to exactly that. But it means
the revenue side of the case is untested by anything in this repo.

## Where it falls short, in order of how much it matters

**1. No consent gate.** Every event fires without a purpose-scoped consent check. For a retailer
operating across ten-plus EU markets this is a launch blocker, not a scaling concern. The contract
has no purpose field, so adding consent is a contract change — better made before real data exists.

**2. Identity is trusted from the client.** `x-customer-id` is a header the app sets. Anyone can
send any value. In production the BFF must derive the customer from a verified token and never
accept it as input. The prototype is honest about this in code comments but does not fix it.

**3. The ranking is trivially gameable and narrows fast.** Three saves in one category push that
category to the top of every feed. There is no exploration, no diversity constraint, and affinity
is category-level only. A real customer furnishing a whole flat would see their feed collapse into
whatever they saved first. This is acceptable for proving the loop closes; it is not a ranking.

**4. Native build unverified in my environment.** Metro bundles cleanly for both iOS and Android,
and bundling runs in CI. The native build — `expo prebuild` and the Xcode and Gradle compile — has
not been run by me, because the environment had no simulator. See *Verification status* below.

**5. Saved items are local.** They do not follow the customer across devices. The *event* is what
production would emit, but the *state* lives in the wrong place.

**6. Everything else in `PRODUCTION-DELTA.md`**, each with the threshold at which it breaks.

## What building it taught me that the design did not

The design document was coherent. Building it surfaced thirteen real defects, and they cluster into
five lessons that I would carry into the production build.

### A contract that compiles is not a contract that constrains

The first version of the shared event schema built its discriminated union with `Object.entries`,
which erased the literal types. It compiled, it ran, and it validated far less than it appeared to.
`tsx` executed it happily; only `tsc --build` exposed it. The design said "a client that compiles
can only emit valid events", and the first implementation did not deliver that property.

The related lesson came later: tap events originally carried no category, so the collector could
not use taps as affinity signal without a catalogue join it had no business making. **The analytics
consumer has to shape the event contract up front**, not discover its gaps afterwards — because
events already emitted cannot be enriched.

### In a React Native monorepo, the version matrix is the platform

Six of the thirteen defects were version or resolution problems, none of which a design review would
have caught:

- `apps/*` was missing from the workspaces array, so mobile dependencies silently did not install.
- React 19.1 against React Native's peer requirement of 19.2.3.
- I pinned React Native 0.87.1 — "latest" — while Expo SDK 57 is built against 0.86.3. Also a
  guessed `expo-status-bar` version and a mismatched FlashList.
- react-native-mmkv v4 replaced its constructor with `createMMKV()`, and requires
  `react-native-nitro-modules` as a peer. Missing it compiles fine and crashes at launch.
- npm installed **two copies of React Native** — one nested, one stale at the root that other
  packages' `"*"` peers resolved to. Two copies in one bundle is the classic runtime collision.
  Fixed with workspace-wide `overrides`, verified by inspecting the lockfile.

The transferable rule: in an Expo project, `expo/bundledNativeModules.json` is the source of truth
for native versions, not npm's `latest` tag. I now read installed type definitions rather than
trusting remembered APIs, and every one of these was caught by checking installed artefacts rather
than by reading documentation.

### Failure paths hide second-order bugs

On a 400 the tracker drops the batch and counts the loss. The first version also subtracted the
drop count that batch had carried — but a batch the server rejected was never processed, so the
count it carried was never received either. Losses were being under-reported, precisely in the
situation where accurate reporting matters most. No happy-path test would ever find this.

### Operational hygiene is part of the demo

During a live end-to-end run, the data-quality report showed zero events when the collector had
just accepted nine. The cause: killing an `npx` process does not kill the `node` grandchild it
spawns, so a collector from a previous run was still alive, holding the port, writing to a database
file already deleted. The dev runner had the same flaw and would have failed with `EADDRINUSE` on
the second start of demo day. It now manages process groups, verified across two consecutive
start-stop cycles with zero orphans.

Similarly, the Dockerfile's native SQLite dependency fell back to a source build that the slim base
image could not perform. That became a two-stage build with the toolchain isolated to the build
stage.

### A green suite has not proven anything until it has been seen failing

All 21 tests passed on the first run, which is a reason for suspicion rather than confidence. I
deliberately broke three guarantees and confirmed each was caught:

| Mutation | Caught by |
|---|---|
| Collector stops deduplicating (`OR IGNORE` → `OR REPLACE`) | 1 test |
| Impressions stop deduplicating within a feed | 1 test |
| Tracker mints `event_id` at flush time instead of at the call site | 4 tests |

The third is the important one. It is the subtlest possible way to break idempotency — the code
still looks reasonable — and four independent tests fail. The same technique proved the dependency
boundary checker exits non-zero on a planted violation.

## What it would take to close the gap

In priority order, with rough effort for a small team:

1. **Consent and purpose tagging on the contract** — 1–2 weeks, before any real traffic.
2. **Verified identity at the BFF** — 1 week, reusing the existing auth provider.
3. **Promise-vs-actual reconciliation** — join `delivery_promise_shown` to delivery confirmations
   from the TMS; 2 weeks. This completes the delivery-trust measurement.
4. **Streaming path** — managed Kafka or Kinesis, object storage, warehouse; 3–4 weeks, mostly
   buy-and-configure.
5. **Ranking v1.5** — item-level affinity, an exploration slot, a diversity constraint, and an A/B
   harness; 3 weeks.
6. **Account-backed saved items** — 1 week.

Items 1 and 2 are launch blockers. Items 3 to 6 are Year 1 roadmap.

## Verification status

What I verified, and how, versus what only a real device can confirm.

| Check | Status | How |
|---|---|---|
| Backend typecheck (services, tools, tests) | ✅ | `tsc --build`, `tsc -p tests` |
| Mobile typecheck | ✅ | `tsc --noEmit` against the Expo 57 config |
| 21 tests, mutation-checked | ✅ | `vitest run` |
| Dependency boundaries | ✅ | `check-boundaries.mjs`, mutation-checked |
| Metro bundle, iOS and Android | ✅ | `expo export` for both platforms, 708–710 modules to Hermes bytecode |
| Single copy of React and React Native | ✅ | lockfile inspection after clean install |
| Live processes, file-backed store, report tool | ✅ | end-to-end run: loop closes, duplicates absorbed, drops reported |
| Dev runner lifecycle | ✅ | two start–stop cycles, zero orphaned processes |
| Docker image excludes React Native | ✅ | simulated the Dockerfile's install: 126 MB, no RN or Expo |
| `docker compose up` | ⬜ | no Docker in my environment |
| `expo prebuild` + native compile | ⬜ | no Xcode or Android SDK in my environment |
| App renders, MMKV persists across relaunch | ⬜ | needs a simulator or device |
| FlashList viewability fires as modelled | ⬜ | needs a device; logic itself is unit-tested |
