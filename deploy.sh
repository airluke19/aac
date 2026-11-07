#!/usr/bin/env bash
# Deploy di AAC dall'immagine pubblicata su ghcr.io.
# Branch staging -> tag :staging, qualunque altro branch -> :latest.
# Uso: ./deploy.sh            (tag dal branch corrente)
#      AAC_TAG=sha-abc1234 ./deploy.sh   (versione precisa, per tornare indietro)
set -euo pipefail
cd "$(dirname "$0")"

if [ -z "${AAC_TAG:-}" ]; then
  branch=$(git rev-parse --abbrev-ref HEAD)
  if [ "$branch" = "staging" ]; then AAC_TAG=staging; else AAC_TAG=latest; fi
fi
export AAC_TAG
echo "Deploy di ghcr.io/airluke19/aac:$AAC_TAG"

docker compose pull backend
docker compose up -d backend

for _ in $(seq 1 30); do
  stato=$(docker inspect -f '{{.State.Health.Status}}' coach-backend 2>/dev/null || echo "?")
  [ "$stato" = "healthy" ] && break
  sleep 2
done
echo "Stato: $stato"
docker logs --tail 20 coach-backend
[ "$stato" = "healthy" ]
