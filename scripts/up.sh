#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
command -v docker >/dev/null || { echo 'Install Docker Engine and Docker Compose v2 first.' >&2; exit 1; }
docker compose up -d --build
for attempt in {1..30}; do
  if curl --fail --silent "http://127.0.0.1:${FORMA_PORT:-8192}/api/health"; then
    echo
    echo "Forma is running on port ${FORMA_PORT:-8192}."
    exit 0
  fi
  sleep 2
done
docker compose logs --tail=60
exit 1
