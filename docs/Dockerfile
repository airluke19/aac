# Documentazione di Always Adaptive Coach (docs.aac.run): Astro + Starlight, sito statico senza login.
# Build con Node, poi solo i file statici serviti da nginx non privilegiato.
FROM node:22-bookworm-slim AS build
ENV ASTRO_TELEMETRY_DISABLED=1
WORKDIR /docs
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM nginxinc/nginx-unprivileged:1.31.7-alpine
USER root
RUN rm -rf /usr/share/nginx/html/* /etc/nginx/conf.d/default.conf
COPY nginx.conf /etc/nginx/conf.d/docs.conf
COPY --from=build /docs/dist /usr/share/nginx/html
# Stesso font dell'app (Inter, servito in locale: nessuna richiesta a Google Fonts), con checksum verificati in build
ADD --checksum=sha256:2c295d99e26dcf357d4d01bcf270fd6924b600c9a13dd8c363ef114f4c6976fa \
    https://cdn.jsdelivr.net/npm/@fontsource-variable/inter@5.3.0/files/inter-latin-opsz-normal.woff2 /usr/share/nginx/html/fonts/inter-5.3.0-latin-opsz.woff2
ADD --checksum=sha256:5e6d4fe9d9f4bff8b2a2469d25ab19576bb85331e22c6ed51398e16f95d56a9c \
    https://cdn.jsdelivr.net/npm/@fontsource-variable/inter@5.3.0/files/inter-latin-ext-opsz-normal.woff2 /usr/share/nginx/html/fonts/inter-5.3.0-latin-ext-opsz.woff2
RUN chown -R root:root /usr/share/nginx/html && chmod -R a+rX,go-w /usr/share/nginx/html
USER 101
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
