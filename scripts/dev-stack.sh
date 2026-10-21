#!/usr/bin/env bash
# Runs the whole PPD demo stack on one machine, configured like the cloud deployment:
#
#   repository :8081  ->  gateway :8080  ->  app-api :3000  ->  web app :5173
#                            ^  simulated participants (host stub, --loop)
#                            ^  a real ESP32 bulb, if you provision it with http://<this machine>:8080
#
# The gateway requires the operator token on its operator routes and relays the /ppd-demo/v1
# extensions to app-api, exactly as in Coolify. Tokens here are development-only.
#
# Needs: Go (gateway), Node 24+ (app-api, web app), Python 3 (simulated devices), and the two
# CableLabs repositories next to this one (override with GATEWAY_REPO / CLIENTS_REPO).
#
#   scripts/dev-stack.sh            start everything
#   SIMULATED=0 scripts/dev-stack.sh   without the simulated participants
#   Ctrl-C                          stop everything
set -euo pipefail

APP_REPO="$(cd "$(dirname "$0")/.." && pwd)"
GATEWAY_REPO="${GATEWAY_REPO:-$APP_REPO/../habanero-ppd-gateway}"
CLIENTS_REPO="${CLIENTS_REPO:-$APP_REPO/../habanero-ppd-clients}"
STATE="$APP_REPO/.dev-stack"
LOGS="$STATE/logs"
OPERATOR_TOKEN="${OPERATOR_TOKEN:-dev-operator-token}"
REPOSITORY_TOKEN="${REPOSITORY_TOKEN:-dev-repository-token}"
DEMO_TOKEN="${DEMO_TOKEN:-dev-demo-token}"
FRESHNESS="${PPD_ASSOCIATION_FRESHNESS:-2m}"

for repo in "$GATEWAY_REPO" "$CLIENTS_REPO"; do
  [ -d "$repo" ] || { echo "missing $repo (set GATEWAY_REPO / CLIENTS_REPO)"; exit 1; }
done
mkdir -p "$LOGS" "$STATE/bin" "$STATE/gateway-data"

pids=()
cleanup() {
  echo; echo "stopping…"
  for pid in "${pids[@]}"; do kill "$pid" 2>/dev/null || true; done
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

wait_for() { # url, name
  for _ in $(seq 1 60); do curl -fsS -o /dev/null "$1" 2>/dev/null && return 0; sleep 0.5; done
  echo "$2 did not start; see $LOGS"; exit 1
}

echo "building gateway and repository from $GATEWAY_REPO"
(cd "$GATEWAY_REPO/go-ppd-repository" && go build -o "$STATE/bin/ppd-repository" .)
(cd "$GATEWAY_REPO/go-ppd" && go build -o "$STATE/bin/ppd-gateway" .)

PPD_DATA_DIR="$STATE/gateway-data" PPD_REPOSITORY_AUTH_TOKEN="$REPOSITORY_TOKEN" \
  "$STATE/bin/ppd-repository" >"$LOGS/repository.log" 2>&1 &
pids+=($!)
PPD_DATA_DIR="$STATE/gateway-data" PPD_LISTEN_ADDR=0.0.0.0:8080 \
  PPD_REPOSITORY_URL=http://127.0.0.1:8081 PPD_REPOSITORY_AUTH_TOKEN="$REPOSITORY_TOKEN" \
  PPD_OPERATOR_TOKEN="$OPERATOR_TOKEN" PPD_ASSOCIATION_FRESHNESS="$FRESHNESS" \
  PPD_DEMO_APP_API_URL=http://127.0.0.1:3000 PPD_DEMO_APP_API_TOKEN="$DEMO_TOKEN" \
  "$STATE/bin/ppd-gateway" >"$LOGS/gateway.log" 2>&1 &
pids+=($!)
wait_for http://127.0.0.1:8080/.well-known/ppd gateway

[ -d "$APP_REPO/server/node_modules" ] || npm --prefix "$APP_REPO/server" install
[ -d "$APP_REPO/node_modules" ] || npm --prefix "$APP_REPO" install
APP_ENV=development DATABASE_PATH="$STATE/app.db" GATEWAY_URL=http://127.0.0.1:8080 \
  GATEWAY_OPERATOR_TOKEN="$OPERATOR_TOKEN" INTERNAL_SERVICE_TOKEN="$DEMO_TOKEN" \
  npm --prefix "$APP_REPO/server" run dev >"$LOGS/app-api.log" 2>&1 &
pids+=($!)
wait_for http://127.0.0.1:3000/api/health app-api

(cd "$APP_REPO" && npx vite --host 0.0.0.0 --port 5173 --strictPort) >"$LOGS/web.log" 2>&1 &
pids+=($!)
wait_for http://127.0.0.1:5173/ "web app"

if [ "${SIMULATED:-1}" = "1" ]; then
  python3 "$APP_REPO/tools/build_simulated_devices.py" >/dev/null
  for reg in "$APP_REPO"/simulated/*.registration.json; do
    id="$(basename "$reg" .registration.json)"
    python3 -u "$CLIENTS_REPO/devices/raspberry-pi-zero-2w/client/ppd_client_stub.py" \
      --gateway-url http://127.0.0.1:8080 --execute --loop \
      --registration "$reg" --declaration "$APP_REPO/simulated/$id.declaration.json" \
      >"$LOGS/sim-$id.log" 2>&1 &
    pids+=($!)
  done
fi

ip="$( (hostname -I 2>/dev/null || ipconfig getifaddr en0 2>/dev/null || echo localhost) | awk '{print $1}')"
simulated="off"
if [ "${SIMULATED:-1}" = "1" ]; then
  simulated=""
  for reg in "$APP_REPO"/simulated/*.registration.json; do simulated="$simulated $(basename "$reg" .registration.json)"; done
fi
cat <<EOF

PPD demo stack is running (logs in $LOGS):
  web app            http://localhost:5173/      (from another device: http://$ip:5173/)
  app-api            http://localhost:3000/api/health
  gateway            http://localhost:8080/.well-known/ppd   (ESP32: provision http://$ip:8080)
  repository         http://localhost:8081   (internal)
  simulated devices ${simulated}

Press Ctrl-C to stop.
EOF
wait
