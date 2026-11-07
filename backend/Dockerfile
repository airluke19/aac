# ---------- Stage 1: build delle dipendenze native (better-sqlite3) ----------
FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
# CA aggiuntiva opzionale (es. proxy aziendale con ispezione TLS):
#   docker build --secret id=extra_ca,src=/percorso/ca.pem ...
# Non finisce nell'immagine; senza il secret il build funziona normalmente.
RUN --mount=type=secret,id=extra_ca,required=false \
    if [ -s /run/secrets/extra_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/extra_ca; fi \
    && npm ci --omit=dev --no-audit --no-fund

# ---------- Stage 2: immagine di runtime minimale ----------
FROM node:22-bookworm-slim
LABEL org.opencontainers.image.source=https://github.com/airluke19/aac \
      org.opencontainers.image.description="AAC backend (API, sync, plan engine)"
ENV NODE_ENV=production \
    TZ=Europe/Rome \
    PORT=3000 \
    DB_PATH=/data/corse.db
WORKDIR /app

# npm, npx, corepack e yarn servono solo nella build: a runtime basta node.
# Toglierli riduce la superficie d'attacco (le loro dipendenze hanno CVE segnalate da Trivy).
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
           /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
           /usr/local/bin/yarn /usr/local/bin/yarnpkg /opt/yarn-*

COPY --from=build /app/node_modules ./node_modules
COPY package.json server.js account.js demo.js ./

# /data e' il punto di mount del volume persistente con corse.db
RUN mkdir -p /data && chown -R node:node /data /app
USER node

EXPOSE 3000
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
