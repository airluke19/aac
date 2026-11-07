# syntax=docker/dockerfile:1.10@sha256:865e5dd094beca432e8c0a1d5e1c465db5f998dca4e439981029b3b81fb39ed5
# AAC frontend: nginx non privilegiato (utente 101, porta 8080) che serve i file statici
# e inoltra /api, /auth e /demo al backend.
FROM nginxinc/nginx-unprivileged:1.31.7-alpine
LABEL org.opencontainers.image.source=https://github.com/airluke19/aac \
      org.opencontainers.image.description="AAC frontend (nginx: static app + proxy to the backend)"

ENV NGINX_ENTRYPOINT_QUIET_LOGS=1

USER root
# Patch di sicurezza di Alpine uscite dopo l'immagine base; curl non serve (healthcheck con wget di busybox)
RUN apk upgrade --no-cache && apk del --no-cache curl

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY security-headers.conf proxy-headers.conf /etc/nginx/snippets/
COPY public /usr/share/nginx/html

# Librerie e font serviti dal frontend (niente CDN o Google Fonts a runtime): versioni fissate
# e checksum SHA-256 verificati in build. Per aggiornarle cambia versione e checksum insieme.
ADD --checksum=sha256:206b6e8bb00fc7bba2c7ee80ca41db3e9e05ba7be0aa35abeba9cfd5357f5d0e \
    https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js /usr/share/nginx/html/vendor/chart-4.4.7.umd.min.js
ADD --checksum=sha256:be9633c4d870e26fb37f1cfe5c5a77181667114003ea16207ac7850d8da8add1 \
    https://cdn.jsdelivr.net/npm/maplibre-gl@4.7.1/dist/maplibre-gl.js /usr/share/nginx/html/vendor/maplibre-gl-4.7.1.js
ADD --checksum=sha256:576b085fdd9487a65a19215328c1e086c07ce5bf6da09b666b3806d3d008dae9 \
    https://cdn.jsdelivr.net/npm/maplibre-gl@4.7.1/dist/maplibre-gl.css /usr/share/nginx/html/vendor/maplibre-gl-4.7.1.css
ADD --checksum=sha256:2c295d99e26dcf357d4d01bcf270fd6924b600c9a13dd8c363ef114f4c6976fa \
    https://cdn.jsdelivr.net/npm/@fontsource-variable/inter@5.3.0/files/inter-latin-opsz-normal.woff2 /usr/share/nginx/html/vendor/inter-5.3.0-latin-opsz.woff2
ADD --checksum=sha256:5e6d4fe9d9f4bff8b2a2469d25ab19576bb85331e22c6ed51398e16f95d56a9c \
    https://cdn.jsdelivr.net/npm/@fontsource-variable/inter@5.3.0/files/inter-latin-ext-opsz-normal.woff2 /usr/share/nginx/html/vendor/inter-5.3.0-latin-ext-opsz.woff2

# Versione dei file nei link (?v=__V__): hash del contenuto di CSS e JS, cosi' il browser
# li tiene in cache finche' non cambiano. File di proprieta' di root e in sola lettura per nginx.
RUN cd /usr/share/nginx/html \
    && v=$(cat css/*.css js/*.js | sha256sum | cut -c1-12) \
    && sed -i "s/__V__/$v/g" index.html login.html \
    && ! grep -q __V__ index.html login.html \
    && chown -R root:root /usr/share/nginx/html && chmod -R a+rX,go-w /usr/share/nginx/html
USER 101

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/frontend-healthz || exit 1
