# Running the prototype

Three processes. The stubs and BFF run on your machine; the app runs on a simulator or device
and talks to the BFF over the network.

## Prerequisites

- Node 22+
- Xcode 16+ (iOS) or Android Studio with an SDK 35 image (Android)
- CocoaPods (`brew install cocoapods`) for iOS

This is a **dev build**, not Expo Go. The app uses native modules (MMKV, FlashList) that Expo Go
cannot load, so real native projects are generated.

## 1. Install

```bash
npm install
```

## 2. Start the backend

Either Docker (no Node version concerns):

```bash
docker compose up --build
```

Or directly, in two terminals:

```bash
npm run stubs     # :4000 — fake commerce core, orders, delivery promise
npm run bff       # :4100 — /v1/feed
```

Both expose the same ports, so the app and the curl commands below work either way.

Verify:

```bash
curl -s -H 'x-customer-id: cust_1' 'localhost:4100/v1/feed?limit=3'
```

## 3. Generate native projects and run

```bash
cd apps/mobile
npx expo prebuild --clean     # creates ios/ and android/
npx expo run:ios              # or: npx expo run:android
```

`ios/` and `android/` are gitignored on purpose — they are generated from `app.json` by
continuous native generation, so they are build output, not source. Regenerate after any native
dependency change.

## Pointing the app at the BFF

| Target | URL |
|---|---|
| iOS simulator | `http://localhost:4100` (default) |
| Android emulator | `http://10.0.2.2:4100` (default) |
| Physical device | set `EXPO_PUBLIC_BFF_URL=http://<your-LAN-ip>:4100` |

## Demonstrating degradation

With the app running, break things from a terminal and pull to refresh:

```bash
# orders service down — feed survives, order card becomes an honest placeholder
curl -X POST localhost:4000/_control/orders \
  -H 'content-type: application/json' -d '{"fail":true}'

# delivery promise slow — 300ms budget trips, windows widen to low-confidence estimates
curl -X POST localhost:4000/_control/promise \
  -H 'content-type: application/json' -d '{"latency_ms":2000}'

# restore
curl -X POST localhost:4000/_control/orders \
  -H 'content-type: application/json' -d '{"fail":false}'
curl -X POST localhost:4000/_control/promise \
  -H 'content-type: application/json' -d '{"latency_ms":80}'
```

Kill the BFF entirely and pull to refresh to see the last-good-feed snapshot render from MMKV
instead of an error screen.
