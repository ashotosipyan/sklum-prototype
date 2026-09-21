# Running the prototype

## Prerequisites

- Node 22+
- For iOS: Xcode 16+ and CocoaPods (`brew install cocoapods`)
- For Android: Android Studio with an API 35 emulator image
- Optional: Docker, to run the backend without Node version concerns

The app is a **native dev build**. It uses native modules (MMKV via Nitro, FlashList) that Expo Go
cannot load, so `expo prebuild` generates real `ios/` and `android/` projects. Those folders are
gitignored: they are generated from `app.json` and are build output, not source.

## 1. Install

```bash
npm install
```

## 2. Start the backend

**One command** — all three services with prefixed output; one Ctrl-C stops all of them cleanly:

```bash
npm run dev
```

**Or separately**, which is better for the demo because you can stop the collector on its own:

```bash
npm run stubs        # :4000  fake commerce core, orders, delivery promise
npm run collector    # :4200  event ingestion and affinity
npm run bff          # :4100  /v1/feed
```

**Or with Docker:**

```bash
docker compose up --build
```

Check it:

```bash
curl -s localhost:4000/health localhost:4200/health localhost:4100/health
curl -s -H 'x-anonymous-id: anon_1' 'localhost:4100/v1/feed?limit=3'
```

## 3. Build and run the app

```bash
cd apps/mobile
npx expo prebuild --clean
npx expo run:ios            # or: npx expo run:android
```

| Target | Backend address |
|---|---|
| iOS simulator | `localhost` (default) |
| Android emulator | `10.0.2.2` (default) |
| Physical device | set `EXPO_PUBLIC_BFF_URL=http://<LAN-IP>:4100` and `EXPO_PUBLIC_COLLECTOR_URL=http://<LAN-IP>:4200` |

If the native build complains about versions, run `npx expo-doctor` from `apps/mobile` — every
native dependency is pinned to Expo SDK 57's manifest, so a mismatch means something drifted.

## 4. The demo sequence

Run the backend as three separate processes for this.

1. **Open the app, signed out.** A neutral feed; no order card.
2. **Tap Sign in.** The order card appears pinned at the top.
3. **Save two outdoor items and tap a third.** Pull to refresh: outdoor rises to the top.
4. **Stop the collector** (Ctrl-C in its terminal, or `docker compose stop collector`).
   Save three more. The footer reads *3 events waiting to send*.
5. **Force-quit the app and relaunch.** Still *3 events waiting* — the queue survived process death.
6. **Start the collector again and pull to refresh.** The count drains to zero.
7. **Break the backend and pull to refresh after each:**

   ```bash
   curl -X POST localhost:4000/_control/orders  -H 'content-type: application/json' -d '{"fail":true}'
   curl -X POST localhost:4000/_control/promise -H 'content-type: application/json' -d '{"latency_ms":2000}'
   curl -X POST localhost:4000/_control/reset
   ```

   Orders down: the order card says tracking is unavailable and the order is safe. Promise slow:
   every delivery line becomes *Delivery estimate updating*, never a guessed date.
8. **Stop the BFF and relaunch the app.** The last good feed renders, marked offline.
9. **Show the data:**

   ```bash
   npm run report
   curl -s localhost:4200/v1/stats
   ```

## Resetting

```bash
rm -f services/collector/data/events.sqlite*      # wipe captured events
```

To reset the app's identity and queue, delete and reinstall it from the simulator.
