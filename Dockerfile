# Backend services only. The mobile app is not containerised — it builds natively
# via `expo prebuild` and runs on a simulator or device.

# ── deps: install with a native toolchain available ─────────────────────────────
# better-sqlite3 normally downloads a prebuilt binary. When none is available for
# the target (a new Node release, an unusual arch, a proxy blocking the download)
# it compiles from source, which needs python, make and a C++ compiler. They live
# in this stage only, so the runtime image does not carry them.
FROM node:22-bookworm-slim AS deps
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app

COPY package.json package-lock.json tsconfig.base.json tsconfig.json ./
COPY packages/events/package.json packages/events/
COPY services/bff/package.json services/bff/
COPY services/stubs/package.json services/stubs/
COPY services/collector/package.json services/collector/
COPY apps/mobile/package.json apps/mobile/
COPY tools/analyze/package.json tools/analyze/

# Backend workspaces only. The mobile manifest is present so npm reads the
# lockfile consistently; React Native and the Expo toolchain are never installed
# (verified: 126 MB here against 433 MB for the full workspace).
RUN npm install \
  --include-workspace-root \
  --workspace=packages/events \
  --workspace=services/bff \
  --workspace=services/stubs \
  --workspace=services/collector \
  && npm cache clean --force

# ── runtime ─────────────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.base.json tsconfig.json ./
COPY packages/events packages/events
COPY services services

CMD ["npx", "tsx", "services/bff/src/index.ts"]
