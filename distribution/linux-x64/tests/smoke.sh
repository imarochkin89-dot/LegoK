#!/usr/bin/env bash
set -Eeuo pipefail

REPOSITORY_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../../.." && pwd -P)"
TEST_ROOT="$(mktemp -d /tmp/kontur-smoke.XXXXXX)"
SERVER_PID=""

cleanup() {
  if [[ -n "$SERVER_PID" ]] && kill -0 "$SERVER_PID" >/dev/null 2>&1; then
    kill -TERM "$SERVER_PID" >/dev/null 2>&1 || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  if [[ -d "$TEST_ROOT" && "$TEST_ROOT" == /tmp/kontur-smoke.* ]]; then
    rm -rf -- "$TEST_ROOT"
  fi
}
trap cleanup EXIT

show_logs() {
  for log_file in "$TEST_ROOT/server.stdout.log" "$TEST_ROOT/server.stderr.log" "$TEST_ROOT/logs/kontur-runtime.log" "$TEST_ROOT/logs/workers.log"; do
    if [[ -f "$log_file" ]]; then
      printf '\n--- %s ---\n' "$log_file" >&2
      tail -n 120 "$log_file" >&2
    fi
  done
}

mkdir -p "$TEST_ROOT"/{config,data,logs,run,tls}
export KONTUR_INSTALL_ROOT="$TEST_ROOT"
export KONTUR_APP_ROOT="$REPOSITORY_ROOT"
export KONTUR_DATA_ROOT="$TEST_ROOT/data"
export KONTUR_LOG_ROOT="$TEST_ROOT/logs"
export KONTUR_TLS_PFX="$TEST_ROOT/tls/gateway.pfx"
export KONTUR_PID_FILE="$TEST_ROOT/run/kontur.pid.json"
export KONTUR_RUNTIME_CONFIG_ROOT="$TEST_ROOT/run"
export KONTUR_PLANNER_HOST="planner.kontur.test"
export KONTUR_PORTAL_HOST="portal.kontur.test"
export KONTUR_HTTP_PORT="18080"
export KONTUR_HTTPS_PORT="18443"
export KONTUR_PLANNER_WORKER_PORT="18173"
export KONTUR_PORTAL_WORKER_PORT="18174"
export KONTUR_PLANNER_INSPECTOR_PORT="19173"
export KONTUR_PORTAL_INSPECTOR_PORT="19174"
export KONTUR_ALLOWED_NETWORKS="127.0.0.1/32"
export KONTUR_ADMIN_EMAIL="owner@example.test"
export KONTUR_ADMIN_PASSWORD="Strong-Integration-Password"
export KONTUR_PFX_PASSWORD="Strong-Test-Pfx-Password"

node "$REPOSITORY_ROOT/distribution/linux-x64/runtime/config-tool.mjs" create --config "$TEST_ROOT/config/kontur.json" >/dev/null
openssl req -x509 -newkey rsa:2048 -nodes -days 2 \
  -subj "/CN=planner.kontur.test" \
  -addext "subjectAltName=DNS:planner.kontur.test,DNS:portal.kontur.test" \
  -keyout "$TEST_ROOT/tls/gateway.key" \
  -out "$TEST_ROOT/tls/gateway.crt" >/dev/null 2>&1
openssl pkcs12 -export \
  -inkey "$TEST_ROOT/tls/gateway.key" \
  -in "$TEST_ROOT/tls/gateway.crt" \
  -passout pass:Strong-Test-Pfx-Password \
  -out "$TEST_ROOT/tls/gateway.pfx"

node "$REPOSITORY_ROOT/distribution/linux-x64/runtime/server.mjs" --config "$TEST_ROOT/config/kontur.json" \
  >"$TEST_ROOT/server.stdout.log" 2>"$TEST_ROOT/server.stderr.log" &
SERVER_PID=$!

READY="false"
for _ in {1..150}; do
  if ! kill -0 "$SERVER_PID" >/dev/null 2>&1; then
    show_logs
    exit 1
  fi
  if curl --silent --insecure --noproxy '*' --connect-timeout 2 --max-time 5 --output /dev/null \
    --resolve planner.kontur.test:18443:127.0.0.1 \
    --write-out '%{http_code}' https://planner.kontur.test:18443/ | grep -qx '401'; then
    READY="true"
    break
  fi
  sleep 1
done
[[ "$READY" == "true" ]] || { show_logs; exit 1; }

PLANNER_STATUS="$(curl --silent --insecure --noproxy '*' --connect-timeout 2 --max-time 10 --output /dev/null \
  --resolve planner.kontur.test:18443:127.0.0.1 \
  --user 'owner@example.test:Strong-Integration-Password' \
  --write-out '%{http_code}' https://planner.kontur.test:18443/)"
PORTAL_STATUS="$(curl --silent --insecure --noproxy '*' --connect-timeout 2 --max-time 10 --output /dev/null \
  --resolve portal.kontur.test:18443:127.0.0.1 \
  --write-out '%{http_code}' https://portal.kontur.test:18443/)"

[[ "$PLANNER_STATUS" =~ ^[234] ]] || { echo "Planner returned HTTP $PLANNER_STATUS" >&2; exit 1; }
[[ "$PORTAL_STATUS" =~ ^[234] ]] || { echo "Portal returned HTTP $PORTAL_STATUS" >&2; exit 1; }
[[ -d "$TEST_ROOT/data/planner" && -d "$TEST_ROOT/data/portal" ]] || { echo "Local storage was not created." >&2; exit 1; }

echo "Linux runtime smoke test passed."
