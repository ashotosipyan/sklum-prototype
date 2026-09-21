# Monorepo architecture

The repo layout is an argument about where the boundaries in this system are. "We used a monorepo"
is not a design decision — the package boundaries and the rules between them are.

## Layout

```
apps/
  mobile/            Expo dev build. The only package that ships to a store.
packages/
  events/            The event contract. Imported by both device and server.
services/
  bff/               /v1/feed — aggregation, per-source budgets, degradation, ranking
  collector/         /v1/events, /v1/affinity, /v1/stats — validation, dedup, storage
  stubs/             Fake commerce core, orders, delivery promise
tools/
  analyze/           Funnel and data-quality report
tests/               Cross-package integration tests
scripts/             Dev runner, dependency boundary check
docs/                The five deliverables
```

## The dependency rule

```
apps/      ──►  packages/
services/  ──►  packages/
tools/     ──►  packages/
```

Nothing else.

- **`apps/mobile` never imports from `services/`.** The app reaches the BFF over HTTP or not at all.
  The moment it imports a server module, the client is coupled to the core's internals and the BFF
  has stopped doing its job.
- **Services never import each other.** The BFF reaches the stubs and the collector over HTTP, the
  same way it would reach the real commerce core. If it could import them, the timeout and
  degradation behaviour — the most important thing in the prototype — would be untestable.
- **`packages/events` imports nothing from the workspace.** It is a leaf, and must stay one.

### How it is enforced

Two mechanisms, because one is not enough:

- **TypeScript project references** cover services, tools and packages. A violation is a compile
  error.
- **`scripts/check-boundaries.mjs`** covers the mobile app, which sits outside the reference graph
  because Expo owns its build. It runs first in CI and exits non-zero on a violation — verified by
  planting one.

### Tests are the one exemption

`tests/` may import across every boundary. An integration test is allowed to see the whole system
at once — the correctness suite runs the real device tracker against the real collector in one
process, which is the point. The product code may not; the tests may.

## Why `packages/events` is the only shared package

A shared package is a coupling you have chosen, and each one gives two teams a reason to coordinate
a release. `packages/types`, `packages/utils` and `packages/config` would all be easy to add and
none earns its place at this size.

`events` earns it because the contract genuinely has to be identical on both sides: a device that
compiles can only construct events the collector accepts. That property is structural rather than a
matter of discipline, and it is the deep-dive's central claim.

The device-side capture engine lives in `apps/mobile/src/tracking/`, not in a package, even though
it has no React Native imports. Only the app uses it. It is platform-agnostic so it can be tested in
Node, not so it can be shared — and those are different reasons.

## React Native in a monorepo: the three traps

**One copy of React Native, enforced.** npm resolved two copies — 0.86.3 for the app and a stale
0.87.1 hoisted at the root that other packages' `"*"` peers latched onto. Two copies in one bundle
collide at runtime when native views register. The root `package.json` now pins both React and
React Native with `overrides`, and the lockfile was checked after a clean install.

**Native versions come from the Expo SDK, not from npm.** `expo/bundledNativeModules.json` is the
source of truth for which React Native, FlashList, status bar and safe-area versions an SDK was
built against. Pinning npm's "latest" produced a React Native one minor version ahead of Expo 57,
which fails at native build time rather than at install.

**Metro does not follow workspace symlinks by default.** `apps/mobile/metro.config.js` adds the
workspace root to `watchFolders` and both `node_modules` directories to the resolution path.
Without it, `@sklum/events` resolves in the editor and fails at bundle time. CI bundles both
platforms to catch any regression here.

## Tooling

- **npm workspaces.** A reviewer runs `npm install` with no global tools, no package-manager
  version pinning, no daemon. Setup friction is a real cost when someone else has to run your code.
- **TypeScript project references** for incremental typecheck and boundary enforcement.
- **tsx** to run services directly; **vitest** for tests. No build step for services — nothing
  ships a server bundle.

At Sklum's real scale I would choose differently, and the difference is worth naming: **pnpm** for
strict dependency isolation — npm's hoisting lets a package import something it never declared,
which is how the duplicate React Native appeared — and **Turborepo** for remote caching once CI time
is measured in minutes. Neither solves a problem this repo has today.

## CI

Five steps, in the order that fails fastest:

1. Dependency boundaries
2. Typecheck: services and tools, tests, mobile
3. Tests: event correctness, BFF degradation, impressions
4. Metro bundle for iOS
5. Metro bundle for Android

Lint and formatting gates are deliberately absent from a prototype: they spend time on a class of
problem the reviewer is not evaluating.
