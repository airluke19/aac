# AAC frontend: nginx non privilegiato (utente 101, porta 8080) che serve i file statici
# e inoltra /api, /auth e /demo al backend.
FROM nginxinc/nginx-unprivileged:1.30.6-alpine
LABEL org.opencontainers.image.source=https://github.com/airluke19/aac \
      org.opencontainers.image.description="AAC frontend (nginx: static app + proxy to the backend)"

ENV NGINX_ENTRYPOINT_QUIET_LOGS=1

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY security-headers.conf proxy-headers.conf /etc/nginx/snippets/
COPY public /usr/share/nginx/html

# Versione dei file nei link (?v=__V__): hash del contenuto di CSS e JS, cosi' il browser
# li tiene in cache finche' non cambiano.
USER root
# Patch di sicurezza di Alpine uscite dopo l'immagine base; curl non serve (healthcheck con wget di busybox)
RUN apk upgrade --no-cache && apk del --no-cache curl
RUN cd /usr/share/nginx/html \
    && v=$(cat css/*.css js/*.js | sha256sum | cut -c1-12) \
    && sed -i "s/__V__/$v/g" index.html login.html \
    && ! grep -q __V__ index.html login.html \
    && chown -R root:root /usr/share/nginx/html && chmod -R a+rX,go-w /usr/share/nginx/html
USER 101

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/frontend-healthz || exit 1
