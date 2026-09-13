# Backend services only. The mobile app is not containerised — it builds natively
# via `expo prebuild` and runs on a simulator or device.
FROM node:22-alpine

WORKDIR /app

# Only the backend workspaces are installed. Pulling in apps/mobile would drag
# react-native and the Expo toolchain into a server image for no reason.
COPY package.json package-lock.json tsconfig.base.json tsconfig.json ./
COPY packages/events/package.json packages/events/
COPY services/bff/package.json services/bff/
COPY services/stubs/package.json services/stubs/
COPY services/collector/package.json services/collector/

RUN npm install \
  --include-workspace-root \
  --workspace=packages/events \
  --workspace=services/bff \
  --workspace=services/stubs \
  --workspace=services/collector

COPY packages/events packages/events
COPY services services

# tsx runs the TypeScript directly. There is no build step because the prototype
# never ships a bundle — adding one would be ceremony a reviewer has to wait for.
CMD ["npx", "tsx", "services/bff/src/index.ts"]
