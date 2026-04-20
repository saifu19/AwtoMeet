# ─── Build stage ──────────────────────────────────────────────
FROM node:22-alpine AS build

RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

WORKDIR /repo

# Copy workspace manifest + lockfile first for dependency-layer caching
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/

RUN pnpm install --frozen-lockfile

# Copy sources and build
COPY packages/shared packages/shared
COPY apps/api apps/api

RUN pnpm --filter @meeting-app/shared build \
 && pnpm --filter api build

# Prune dev deps into /out for the runtime stage.
# --legacy is required on pnpm v10+ when inject-workspace-packages isn't set.
RUN pnpm --filter api --prod deploy --legacy /out

# ─── Runtime stage ────────────────────────────────────────────
FROM node:22-alpine AS runtime

WORKDIR /app

# Non-root for safety
RUN addgroup -S app && adduser -S app -G app
USER app

COPY --from=build --chown=app:app /out/dist ./dist
COPY --from=build --chown=app:app /out/node_modules ./node_modules
COPY --from=build --chown=app:app /out/package.json ./

# NODE_ENV intentionally unset: this is a dev/test stack. The api's
# assertProductionEnv() check is skipped so SMTP/LiveKit/etc. can be added
# incrementally. Cookies stay SameSite=Lax + non-Secure, which is exactly
# what same-origin http://<host> needs.
EXPOSE 3001
CMD ["node", "dist/index.js"]
