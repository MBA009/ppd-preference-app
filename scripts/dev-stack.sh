#!/usr/bin/env bash
# Runs the whole PPD demo stack on one machine:
#
#   repository :8081  ->  gateway :8080  ->  app-api :3000  ->  web app :5173
#                            ^  demo devices from app-api's simulator (Demo devices page)
#                            ^  a real ESP32 bulb, if you provision it with http://<this machine>:8080
#
# The gateway relays the /ppd-demo/v1 extensions to app-api, as in Coolify. The gateway reads the
# simulator's DHCP lease file instead of this machine's network, so only demo devices appear on the
# "home network". Tokens here are development-only.
#
# Needs: Go (gateway), Node 24+ (app-api, web app), and the habanero-ppd-gateway repository next to
# this one (override with GATEWAY_REPO).
#
#   scripts/dev-stack.sh            start everything
#   SIMULATOR=0 scripts/dev-stack.sh   without the demo device simulator
#   GATEWAY_PORT=18080 scripts/dev-stack.sh   gateway on another port
#   CLOUD_AUTH=1 scripts/dev-stack.sh  operator routes need the token, as in the cloud
#   MTLS=1 scripts/dev-stack.sh        HTTPS with client certificates (direct-certificate profile), see below
#   Ctrl-C                          stop everything
#
# MTLS=1: the first run makes a development household CA in .dev-stack/tls with CableLabs' generate-dev-tls
# (gateway certificate, app-api's operator certificate, and one client certificate per device: the ESP32 bulb
# plus every simulated PPD device). The gateway then only accepts clients with a certificate from that CA, and
# a device's certificate must name its device_id. A browser has no certificate, so the CableLabs dashboard
# only opens after importing .dev-stack/tls/operator.p12 (empty password). Gateway state is kept apart from
# the plain-HTTP mode (.dev-stack/gateway-data-mtls), because identities bound without certificates cannot
# be reused. GATEWAY_SANS adds names or IPs to the gateway certificate (the address an ESP32 uses); delete
# .dev-stack/tls to make new certificates.
set -euo pipefail

APP_REPO="$(cd "$(dirname "$0")/.." && pwd)"
GATEWAY_REPO="${GATEWAY_REPO:-$APP_REPO/../habanero-ppd-gateway}"
STATE="$APP_REPO/.dev-stack"
LOGS="$STATE/logs"
OPERATOR_TOKEN="${OPERATOR_TOKEN:-dev-operator-token}"
# By default the gateway leaves its operator routes open so the CableLabs dashboard
# (/ppd/v1/status, /ppd/v1/service-health) keeps working next to the web app. CLOUD_AUTH=1 requires the
# operator token like the cloud deployment does; the dashboard then shows no data.
GATEWAY_OPERATOR_TOKEN_SETTING=""
[ "${CLOUD_AUTH:-0}" = "1" ] && GATEWAY_OPERATOR_TOKEN_SETTING="$OPERATOR_TOKEN"
REPOSITORY_TOKEN="${REPOSITORY_TOKEN:-dev-repository-token}"
DEMO_TOKEN="${DEMO_TOKEN:-dev-demo-token}"
FRESHNESS="${PPD_ASSOCIATION_FRESHNESS:-2m}"
# Set GATEWAY_PORT when something else already uses 8080 (VS Code port forwarding often does).
GATEWAY_PORT="${GATEWAY_PORT:-8080}"

[ -d "$GATEWAY_REPO" ] || { echo "missing $GATEWAY_REPO (set GATEWAY_REPO)"; exit 1; }
SIMULATOR="${SIMULATOR:-1}"
MTLS="${MTLS:-0}"
LEASES="$STATE/sim/dhcp.leases"
TLS="$STATE/tls"
GATEWAY_DATA="$STATE/gateway-data"
[ "$MTLS" = "1" ] && GATEWAY_DATA="$STATE/gateway-data-mtls"
mkdir -p "$LOGS" "$STATE/bin" "$GATEWAY_DATA" "$STATE/sim"
[ -f "$LEASES" ] || : >"$LEASES"
ip="$( (hostname -I 2>/dev/null || ipconfig getifaddr en0 2>/dev/null || echo localhost) | awk '{print $1}')"

SCHEME=http
CURL_TLS=()
GATEWAY_TLS_ENV=()
APP_TLS_ENV=()
if [ "$MTLS" = "1" ]; then
  if [ ! -f "$TLS/gateway-ca.pem" ]; then
    # Every simulated device that joins through PPD gets its own client certificate.
    sim_ids="$(node -e 'const r=require(process.argv[1]).devices; console.log(r.filter(d=>d.simulator&&d.simulator.mode==="ppd").map(d=>d.device_id).join(","))' "$APP_REPO/server/config/devices.json")"
    echo "making a development household CA in $TLS"
    (cd "$GATEWAY_REPO/tools/habanero-demo" && go run . generate-dev-tls -out-dir "$TLS" -valid-days 365 \
      -gateway-sans "localhost,127.0.0.1,$ip,$(hostname)${GATEWAY_SANS:+,$GATEWAY_SANS}" \
      -device-id superduperlight-bulb-esp32 -device-ids "$sim_ids") >"$LOGS/generate-dev-tls.log"
    if command -v openssl >/dev/null; then
      openssl pkcs12 -export -passout pass: -in "$TLS/operator-cert.pem" -inkey "$TLS/operator-key.pem" \
        -certfile "$TLS/gateway-ca.pem" -out "$TLS/operator.p12" 2>/dev/null || true
    fi
  fi
  SCHEME=https
  CURL_TLS=(--cacert "$TLS/gateway-ca.pem" --cert "$TLS/operator-cert.pem" --key "$TLS/operator-key.pem")
  GATEWAY_TLS_ENV=(PPD_TLS_CERT_FILE="$TLS/gateway-cert.pem" PPD_TLS_KEY_FILE="$TLS/gateway-key.pem" PPD_TLS_CLIENT_CA_FILE="$TLS/gateway-ca.pem")
  APP_TLS_ENV=(GATEWAY_CA_FILE="$TLS/gateway-ca.pem" GATEWAY_CLIENT_CERT_FILE="$TLS/operator-cert.pem" GATEWAY_CLIENT_KEY_FILE="$TLS/operator-key.pem" SIMULATOR_CERT_DIR="$TLS")
fi

pids=()
cleanup() {
  echo; echo "stopping…"
  for pid in "${pids[@]}"; do kill "$pid" 2>/dev/null || true; done
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

wait_for() { # url, name, curl options...
  local url="$1" name="$2"; shift 2
  for _ in $(seq 1 60); do curl -fsS -o /dev/null "$@" "$url" 2>/dev/null && return 0; sleep 0.5; done
  echo "$name did not start; see $LOGS"; exit 1
}

echo "building gateway and repository from $GATEWAY_REPO"
(cd "$GATEWAY_REPO/go-ppd-repository" && go build -o "$STATE/bin/ppd-repository" .)
(cd "$GATEWAY_REPO/go-ppd" && go build -o "$STATE/bin/ppd-gateway" .)

PPD_DATA_DIR="$GATEWAY_DATA" PPD_REPOSITORY_AUTH_TOKEN="$REPOSITORY_TOKEN" \
  "$STATE/bin/ppd-repository" >"$LOGS/repository.log" 2>&1 &
pids+=($!)
env "${GATEWAY_TLS_ENV[@]}" PPD_DATA_DIR="$GATEWAY_DATA" PPD_LISTEN_ADDR=0.0.0.0:$GATEWAY_PORT \
  PPD_REPOSITORY_URL=http://127.0.0.1:8081 PPD_REPOSITORY_AUTH_TOKEN="$REPOSITORY_TOKEN" \
  PPD_OPERATOR_TOKEN="$GATEWAY_OPERATOR_TOKEN_SETTING" PPD_ASSOCIATION_FRESHNESS="$FRESHNESS" \
  PPD_DEMO_APP_API_URL=http://127.0.0.1:3000 PPD_DEMO_APP_API_TOKEN="$DEMO_TOKEN" \
  PPD_DHCP_LEASES_FILE="$LEASES" PPD_ARP_TABLE_FILE=/dev/null PPD_FINGERPRINT_TIMEOUT=100ms \
  "$STATE/bin/ppd-gateway" >"$LOGS/gateway.log" 2>&1 &
pids+=($!)
wait_for "$SCHEME://127.0.0.1:$GATEWAY_PORT/.well-known/ppd" gateway "${CURL_TLS[@]}"

[ -d "$APP_REPO/server/node_modules" ] || npm --prefix "$APP_REPO/server" install
[ -d "$APP_REPO/node_modules" ] || npm --prefix "$APP_REPO" install
env "${APP_TLS_ENV[@]}" APP_ENV=development DATABASE_PATH="$STATE/app.db" GATEWAY_URL="$SCHEME://127.0.0.1:$GATEWAY_PORT" \
  GATEWAY_OPERATOR_TOKEN="$OPERATOR_TOKEN" INTERNAL_SERVICE_TOKEN="$DEMO_TOKEN" \
  SIMULATOR="$SIMULATOR" SIMULATOR_LEASES_FILE="$LEASES" \
  npm --prefix "$APP_REPO/server" run dev >"$LOGS/app-api.log" 2>&1 &
pids+=($!)
wait_for http://127.0.0.1:3000/api/health app-api

(cd "$APP_REPO" && npx vite --host 0.0.0.0 --port 5173 --strictPort) >"$LOGS/web.log" 2>&1 &
pids+=($!)
wait_for http://127.0.0.1:5173/ "web app"

cat <<EOF

PPD demo stack is running (logs in $LOGS):
  web app            http://localhost:5173/      (from another device: http://$ip:5173/)
  app-api            http://localhost:3000/api/health
  gateway            $SCHEME://localhost:$GATEWAY_PORT/.well-known/ppd   (ESP32: provision $SCHEME://$ip:$GATEWAY_PORT)
  CableLabs dashboard $SCHEME://localhost:$GATEWAY_PORT/ppd/v1/status   (from another device: $SCHEME://$ip:$GATEWAY_PORT/ppd/v1/status)$( [ "${CLOUD_AUTH:-0}" = "1" ] && echo "  [no data: CLOUD_AUTH=1]")$( [ "$MTLS" = "1" ] && echo "  [browser: import $TLS/operator.p12]")
  repository         http://localhost:8081   (internal)
  demo devices       $( [ "$SIMULATOR" = "1" ] && echo "http://localhost:5173/#/demo-devices" || echo "off (SIMULATOR=0)")

$( [ "$MTLS" = "1" ] && printf '%s\n' "mutual TLS: certificates in $TLS (CA gateway-ca.pem; bulb device-cert.pem/device-key.pem; simulated devices <id>-cert.pem)" "" )
Press Ctrl-C to stop.
EOF
wait
