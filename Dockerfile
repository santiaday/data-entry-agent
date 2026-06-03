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
# NEXT_PUBLIC_* are read at runtime by server code only (no browser usage),
# so the build does not require any secrets.
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
# SQL migrations — read at boot by the instrumentation hook (runMigrations).
COPY --from=builder --chown=nextjs:nodejs /app/supabase ./supabase

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
