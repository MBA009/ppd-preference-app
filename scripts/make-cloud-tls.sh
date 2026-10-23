#!/usr/bin/env bash
# Makes the household CA and certificates for the cloud deployment with CableLabs' generate-dev-tls
# (habanero-ppd-gateway/tools/habanero-demo), and sorts them by where they go:
#
#   .cloud-tls/all/      everything, including the CA private key. Keep it off the server and out of git.
#   .cloud-tls/server/   what the Coolify server mounts read-only at TLS_DIR (no CA key, no ESP32 key)
#   .cloud-tls/esp32/    what goes into the ESP32's ppd_config.h
#
#   scripts/make-cloud-tls.sh                       for devices.baktisatria.com
#   DEVICES_HOST=devices.example.org scripts/make-cloud-tls.sh
#
# Running it again replaces every certificate; devices then need their new files. Valid for 365 days.
set -euo pipefail

APP_REPO="$(cd "$(dirname "$0")/.." && pwd)"
GATEWAY_REPO="${GATEWAY_REPO:-$APP_REPO/../habanero-ppd-gateway}"
DEVICES_HOST="${DEVICES_HOST:-devices.baktisatria.com}"
OUT="$APP_REPO/.cloud-tls"
[ -d "$GATEWAY_REPO/tools/habanero-demo" ] || { echo "missing $GATEWAY_REPO (set GATEWAY_REPO)"; exit 1; }

# Every simulated device that joins through PPD gets its own client certificate.
sim_ids="$(node -e 'const r=require(process.argv[1]).devices; console.log(r.filter(d=>d.simulator&&d.simulator.mode==="ppd").map(d=>d.device_id).join(","))' "$APP_REPO/server/config/devices.json")"

rm -rf "$OUT"
mkdir -p "$OUT/server" "$OUT/esp32"
# "gateway" is the name app-api uses inside the Compose stack; it checks the certificate against DEVICES_HOST.
(cd "$GATEWAY_REPO/tools/habanero-demo" && go run . generate-dev-tls -out-dir "$OUT/all" -valid-days 365 \
  -gateway-sans "$DEVICES_HOST,gateway" -device-id superduperlight-bulb-esp32 -device-ids "$sim_ids") >/dev/null

cp "$OUT/all/gateway-ca.pem" "$OUT/all/gateway-cert.pem" "$OUT/all/gateway-key.pem" \
  "$OUT/all/operator-cert.pem" "$OUT/all/operator-key.pem" "$OUT/server/"
for id in ${sim_ids//,/ }; do cp "$OUT/all/$id-cert.pem" "$OUT/all/$id-key.pem" "$OUT/server/"; done
cp "$OUT/all/gateway-ca.pem" "$OUT/all/device-cert.pem" "$OUT/all/device-key.pem" "$OUT/esp32/"

cat <<EOF
Certificates for $DEVICES_HOST are in $OUT (keep "all/" private: it has the CA key).

Copy them to the server and give each key to the container user that reads it
(gateway runs as uid 10001, app-api as uid 1000):

  scp -r "$OUT/server" <you>@<server>:/tmp/ppd-tls
  ssh <you>@<server> 'sudo mkdir -p /opt/ppd-demo && sudo rm -rf /opt/ppd-demo/tls && sudo mv /tmp/ppd-tls /opt/ppd-demo/tls \\
    && cd /opt/ppd-demo/tls && sudo chown root:root * && sudo chmod 644 *-cert.pem gateway-ca.pem \\
    && sudo chown 10001 gateway-key.pem && sudo chown 1000 operator-key.pem $(for id in ${sim_ids//,/ }; do printf '%s ' "$id-key.pem"; done)\\
    && sudo chmod 400 *-key.pem && sudo chmod 755 .'

ESP32 (ppd_config.h): gateway URL https://$DEVICES_HOST:8443, and the PEM text of
  $OUT/esp32/gateway-ca.pem, device-cert.pem, device-key.pem
EOF
