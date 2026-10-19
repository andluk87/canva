#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
command -v docker >/dev/null || { echo 'Install Docker Engine and Docker Compose v2 first.' >&2; exit 1; }
# Managed cloud homes can be read-only. Preserve an existing Docker configuration.
forma_docker_config=${DOCKER_CONFIG:-$HOME/.docker}
if { [[ -d "$forma_docker_config" ]] && [[ ! -w "$forma_docker_config" ]]; } || { [[ ! -d "$forma_docker_config" ]] && [[ ! -w "$(dirname "$forma_docker_config")" ]]; }; then
  export DOCKER_CONFIG="${TMPDIR:-/tmp}/forma-docker"
fi
compose=(docker compose -f compose.yaml)
forma_ca=${FORMA_BUILD_CA:-${NODE_EXTRA_CA_CERTS:-}}
forma_override=''
forma_hosts_override=''
trap 'if [[ -n "$forma_override" ]]; then rm -f "$forma_override"; fi; if [[ -n "$forma_hosts_override" ]]; then rm -f "$forma_hosts_override"; fi' EXIT
# Trust a supplied corporate/cloud CA only for the dependency build, without
# copying the CA or proxy configuration into the image or repository.
if [[ -n "$forma_ca" && -f "$forma_ca" ]]; then
  export FORMA_BUILD_CA="$forma_ca"
  forma_override=$(mktemp "${TMPDIR:-/tmp}/forma-compose.XXXXXX.yaml")
  cat > "$forma_override" <<'YAML'
services:
  forma:
    build:
      args:
        HTTP_PROXY: ${HTTP_PROXY:-}
        HTTPS_PROXY: ${HTTPS_PROXY:-}
        NO_PROXY: ${NO_PROXY:-}
      secrets:
        - cloud_ca
secrets:
  cloud_ca:
    file: ${FORMA_BUILD_CA}
YAML
  forma_proxy_authority=${HTTPS_PROXY:-${HTTP_PROXY:-}}
  forma_proxy_authority=${forma_proxy_authority#*://}
  forma_proxy_authority=${forma_proxy_authority%%/*}
  forma_proxy_authority=${forma_proxy_authority##*@}
  forma_proxy_host=${forma_proxy_authority%%:*}
  if [[ -n "$forma_proxy_host" ]] && command -v getent >/dev/null; then
    forma_proxy_ip=$(getent ahostsv4 "$forma_proxy_host" | awk 'NR==1 {print $1; exit}' || true)
    if [[ -n "$forma_proxy_ip" ]]; then
      export FORMA_PROXY_HOST="$forma_proxy_host" FORMA_PROXY_IP="$forma_proxy_ip"
      # Add the mapping under build, while keeping variable substitution in Compose.
      forma_hosts_override=$(mktemp "${TMPDIR:-/tmp}/forma-hosts.XXXXXX.yaml")
      cat > "$forma_hosts_override" <<'YAML'
services:
  forma:
    build:
      extra_hosts:
        - "${FORMA_PROXY_HOST}:${FORMA_PROXY_IP}"
YAML
      compose+=(-f "$forma_override" -f "$forma_hosts_override")
    else
      compose+=(-f "$forma_override")
    fi
  else
    compose+=(-f "$forma_override")
  fi
fi
"${compose[@]}" up -d --build
for attempt in {1..30}; do
  if "${compose[@]}" exec -T forma node -e "fetch('http://127.0.0.1:8192/api/health').then(async r=>{const h=await r.json();if(!r.ok||h.status!=='ok')process.exit(1)}).catch(()=>process.exit(1))" 2>/dev/null; then
    echo "Forma is running on port ${FORMA_PORT:-8192}."
    exit 0
  fi
  sleep 2
done
"${compose[@]}" logs --tail=60
exit 1
