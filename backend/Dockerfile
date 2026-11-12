# syntax=docker/dockerfile:1.10@sha256:865e5dd094beca432e8c0a1d5e1c465db5f998dca4e439981029b3b81fb39ed5
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
    && ONNXRUNTIME_NODE_INSTALL=skip npm ci --omit=dev --no-audit --no-fund \
    # di onnxruntime serve solo il motore CPU per linux x64: via CUDA, TensorRT e gli altri sistemi
    && cd node_modules/onnxruntime-node/bin/napi-v6 \
    && rm -rf darwin win32 linux/arm64 linux/x64/libonnxruntime_providers_cuda.so linux/x64/libonnxruntime_providers_tensorrt.so

# Chat: modello di embedding multilingual-e5-small (MIT, ONNX quantizzato) per capire le domande.
# Revisione Hugging Face fissata e checksum SHA-256 verificati in build; a runtime niente rete.
ARG E5=https://huggingface.co/Xenova/multilingual-e5-small/resolve/761b726dd34fb83930e26aab4e9ac3899aa1fa78
ADD --checksum=sha256:f80102d3f2a1229f387d3c81909990d8945513e347b0eab049f7de3c6f98c193 ${E5}/onnx/model_quantized.onnx modello/onnx/model_quantized.onnx
ADD --checksum=sha256:0b44a9d7b51c3c62626640cda0e2c2f70fdacdc25bbbd68038369d14ebdf4c39 ${E5}/tokenizer.json modello/tokenizer.json
ADD --checksum=sha256:a1d6bc8734a6f635dc158508bef000f8e2e5a759c7d92f984b2c86e5ff53425b ${E5}/tokenizer_config.json modello/tokenizer_config.json
# vettori delle frasi d'esempio calcolati qui una volta, non alla prima domanda
COPY capire.js chat-esempi.js ./
RUN chmod -R a+rX modello \
    && ORT_DISABLE_TELEMETRY=1 node capire.js --vettori chat-vettori.json

# ---------- Stage 2: immagine di runtime minimale ----------
FROM node:22-bookworm-slim
LABEL org.opencontainers.image.source=https://github.com/airluke19/aac \
      org.opencontainers.image.description="AAC backend (API, sync, plan engine)"
ENV NODE_ENV=production \
    TZ=Europe/Rome \
    ORT_DISABLE_TELEMETRY=1 \
    PORT=3000 \
    DB_PATH=/data/corse.db
WORKDIR /app

# npm, npx, corepack e yarn servono solo nella build: a runtime basta node.
# Toglierli riduce la superficie d'attacco (le loro dipendenze hanno CVE segnalate da Trivy).
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
           /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
           /usr/local/bin/yarn /usr/local/bin/yarnpkg /opt/yarn-*

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/modello ./modello
COPY --from=build /app/chat-vettori.json ./
COPY package.json server.js account.js demo.js notifiche.js strava.js chat.js capire.js chat-esempi.js ./

# /data e' il punto di mount del volume persistente con corse.db. Il codice in /app resta di root:
# il processo (utente node) non puo' modificarlo, e non si duplicano node_modules e modello in un layer.
RUN mkdir -p /data && chown -R node:node /data
USER node

EXPOSE 3000
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
