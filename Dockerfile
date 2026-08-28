# Next.js app image.
#
# Note: Vercel does NOT use this file — it runs its own native build. This
# exists so `docker compose up` gives anyone a working app + database in one
# command, and as demonstrable container competence. Say that plainly in the
# README rather than implying it's the production path.

FROM node:20-alpine AS deps
WORKDIR /app
# Manifests first so Docker caches the install layer — dependencies are only
# re-fetched when the lockfile actually changes, not on every source edit.
COPY package.json package-lock.json ./
RUN npm ci

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# The build has no database or secrets available, and env validation would
# reject the empty environment. It runs for real at server start instead.
ENV SKIP_ENV_VALIDATION=true
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001

# `output: "standalone"` puts a minimal server.js plus only the node_modules
# actually reached at runtime into .next/standalone. static/ and public/ are not
# included in that trace and have to be copied separately.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

USER nextjs

EXPOSE 3000
ENV PORT=3000
# Without this the server binds 127.0.0.1 inside the container and is
# unreachable from the host even with the port published.
ENV HOSTNAME=0.0.0.0

CMD ["node", "server.js"]
