# ---------- Stage 1: dipendenze native (better-sqlite3) ----------
FROM node:25-bookworm-slim AS build
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# ---------- Stage 2: runtime ----------
FROM node:25-bookworm-slim
LABEL org.opencontainers.image.source=https://github.com/airluke19/aac \
      org.opencontainers.image.description="AAC backup (nightly verified backups of the databases, with rotation and restore)"
ENV NODE_ENV=production \
    TZ=Europe/Rome
WORKDIR /app

# Come nel backend: a runtime basta node, niente npm/npx/corepack/yarn
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
           /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
           /usr/local/bin/yarn /usr/local/bin/yarnpkg /opt/yarn-*

COPY --from=build /app/node_modules ./node_modules
COPY package.json backup.js restore.js ./
RUN mkdir -p /data /backups && chown node:node /data /backups
USER node

VOLUME ["/backups"]

# Sano se l'ultimo backup riuscito ha meno di 26 ore (il primo parte all'avvio)
HEALTHCHECK --interval=5m --timeout=10s --start-period=2m --retries=2 \
  CMD node -e "const s=JSON.parse(require('fs').readFileSync('/backups/.stato.json','utf8'));process.exit(Date.now()-Date.parse(s.ultimo_ok)<26*3600e3?0:1)"

CMD ["node", "backup.js"]
