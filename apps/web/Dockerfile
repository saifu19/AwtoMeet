# ─── Build stage ──────────────────────────────────────────────
FROM node:22-alpine AS build

RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

WORKDIR /repo

# VITE_API_URL is baked into the bundle at build time.
# Empty = relative URLs (same-origin), nginx proxies /api/v0 → api:3001.
ARG VITE_API_URL=""
ENV VITE_API_URL=$VITE_API_URL

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/

RUN pnpm install --frozen-lockfile

COPY packages/shared packages/shared
COPY apps/web apps/web

RUN pnpm --filter @meeting-app/shared build \
 && pnpm --filter web build

# ─── Runtime stage ────────────────────────────────────────────
FROM nginx:1.27-alpine AS runtime

COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
