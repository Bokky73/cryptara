# syntax=docker/dockerfile:1
# Multi-stage build for the Cryptara Next.js frontend.
# Produces a minimal, non-root production image using the Next.js standalone output.

# ── Stage 1: dependency install ───────────────────────────────────────────────
FROM node:22-alpine AS deps
WORKDIR /app

# Root workspace deps (scripts/ uses pg, etc.)
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

# Frontend deps
COPY frontend/package.json frontend/package-lock.json ./frontend/
RUN npm ci --prefix frontend --ignore-scripts

# ── Stage 2: build ────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/frontend/node_modules ./frontend/node_modules

# Copy source (outputFileTracingRoot is repo root, so copy everything needed)
COPY frontend/ ./frontend/
COPY scripts/ ./scripts/
COPY db/ ./db/
COPY package.json ./

RUN npm run build --prefix frontend

# ── Stage 3: production runtime ───────────────────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# Non-root user required by acceptance criteria
RUN addgroup --system --gid 1001 nodejs \
 && adduser  --system --uid 1001 nextjs

# Next.js standalone output is self-contained; copy it plus static assets
COPY --from=builder --chown=nextjs:nodejs /app/frontend/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/frontend/.next/static     ./frontend/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/frontend/public            ./frontend/public

# Migration scripts and DB dir so `node scripts/migrate.mjs` works in the container
COPY --from=builder --chown=nextjs:nodejs /app/scripts ./scripts
COPY --from=builder --chown=nextjs:nodejs /app/db      ./db
COPY --from=builder --chown=nextjs:nodejs /app/node_modules ./node_modules

USER nextjs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/health || exit 1

CMD ["node", "frontend/server.js"]
