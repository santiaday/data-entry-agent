# syntax=docker/dockerfile:1

# ── Dependencies ───────────────────────────────────────────────
FROM node:20-bookworm-slim AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# ── Build ──────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS builder
WORKDIR /app
RUN corepack enable
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# No build-time app config is needed: the data-entry API base is hardcoded
# (lib/api/client.ts) and the bearer is injected at RUNTIME by the server layout
# from the container env (DATA_ENTRY_API_TOKEN). Deliberately NOT using
# NEXT_PUBLIC_* — those would be inlined here at build time, where deploy-time
# env is unavailable, so they could never reach the browser.
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

# ── Runtime ────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

# Next.js standalone output: a minimal self-contained server.
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
