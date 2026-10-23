# Deploying the PPD demo on Coolify

One Docker Compose resource on the Coolify server runs four containers:

```
ppd.baktisatria.com      Cloudflare (proxied, Access sign-in) -> Coolify proxy :443 -> web -> /api -> app-api
devices.baktisatria.com  DNS only -> server :8443 -> gateway (mutual TLS)        app-api -> gateway (mutual TLS)
                                                    gateway -> repository (private)
```

- **web**: the app (Nginx); the only container behind Coolify's proxy.
- **app-api**: the household backend and the demo device simulator.
- **gateway**: the PPD gateway; ESP32s and simulated devices register here with client certificates.
- **repository**: stores the published household policy; reachable only by the gateway.

The images are built by GitHub Actions and pulled from ghcr.io, so the server never needs the source code.
The compose file is [`deploy/compose.example.yaml`](../deploy/compose.example.yaml).

Assumes: an x86-64 server with Coolify v4 installed, and `baktisatria.com` on Cloudflare.

## 1. Build the images (GitHub)

Each repository has `.github/workflows/images.yml`. A push to the branch builds and pushes:

| Repository | Branch | Images |
| --- | --- | --- |
| `MBA009/ppd-preference-app` | `feature/gateway-integration`, `main` | `ghcr.io/mba009/ppd-web`, `ghcr.io/mba009/ppd-app-api` |
| `baktistr/habanero-ppd-gateway` | `capstone/cloud-demo` | `ghcr.io/baktistr/ppd-gateway`, `ghcr.io/baktistr/ppd-repository` |

Tags: the branch name with `/` turned into `-` (`feature-gateway-integration`, `capstone-cloud-demo`) and
`sha-<commit>`.

1. **Enable Actions on the gateway fork.** GitHub turns workflows off on forks: open
   `github.com/baktistr/habanero-ppd-gateway/actions` and click *I understand my workflows, go ahead and
   enable them*. Then run the workflow once (*Container images* → *Run workflow* → branch
   `capstone/cloud-demo`).
2. In the app repository the workflow runs on the next push to `feature/gateway-integration`.
3. Check both runs are green, and that the four packages appear under the owners' *Packages* tabs.

## 2. Let the server pull the images

The gateway images are private (CableLabs code). Packages published by Actions inherit access from their
repository, so a token from an account with access to both repositories can pull all four.

1. GitHub → Settings → Developer settings → **Personal access tokens (classic)** → *Generate new token*,
   scope **`read:packages`** only. (Fine-grained tokens cannot pull from ghcr.io.)
2. On the server, as the user Coolify deploys with (root by default):

   ```bash
   echo '<token>' | sudo docker login ghcr.io -u baktistr --password-stdin
   sudo docker pull ghcr.io/baktistr/ppd-gateway:capstone-cloud-demo   # check it works
   ```

## 3. Certificates

On your laptop (needs Go and Node; the gateway repository next to this one):

```bash
scripts/make-cloud-tls.sh
```

It makes a household CA and the certificates in `.cloud-tls/` (ignored by git) and prints the exact `scp`
and `ssh` commands to put `server/` at `/opt/ppd-demo/tls` with the right owners: the gateway container runs
as uid 10001, app-api as uid 1000, and each key must be readable by the one that uses it.

- `.cloud-tls/all/` has the CA private key. Keep it on your laptop only; you need it to issue new device
  certificates.
- `.cloud-tls/esp32/` goes into the ESP32 (step 8).
- Certificates last 365 days. Running the script again replaces all of them.

## 4. Server firewall

Open **TCP 8443** for the devices, in the server firewall (`sudo ufw allow 8443/tcp`) and in the hosting
provider's firewall if it has one. Ports 80/443 are Coolify's. Nothing else needs to be open.

## 5. Cloudflare DNS

| Type | Name | Content | Proxy |
| --- | --- | --- | --- |
| A | `ppd` | server IPv4 | **Proxied** (orange) |
| A | `devices` | server IPv4 | **DNS only** (grey) |

`devices` must stay grey: Cloudflare's proxy would end the TLS connection itself, so the device's client
certificate would never reach the gateway (and Cloudflare does not proxy arbitrary ports anyway).

SSL/TLS → Overview: set the mode to **Full (strict)**; Coolify gets a Let's Encrypt certificate for `ppd`.

## 6. Cloudflare Access (sign-in for the web app)

app-api refuses to start in production without it.

1. Cloudflare dashboard → **Zero Trust** → Access → Applications → *Add an application* → **Self-hosted**.
2. Name `PPD demo`, domain `ppd.baktisatria.com`, session duration as you like.
3. Policy: action *Allow*, include *Emails* → your team's addresses (or an email domain).
4. Save, open the application again and copy the **Application Audience (AUD) Tag**.
5. Your team domain (`<team>.cloudflareaccess.com`) is shown under Zero Trust → Settings.

## 7. Coolify

1. Projects → **PPD Capstone** (create it) → environment **demo** → *+ New* → **Docker Compose Empty**.
2. Paste `deploy/compose.example.yaml`. Name the resource `ppd-demo`.
3. **Environment variables** (Coolify lists the ones the file uses):

   | Variable | Value |
   | --- | --- |
   | `OPERATOR_TOKEN`, `REPOSITORY_TOKEN`, `DEMO_TOKEN` | three different `openssl rand -hex 32` |
   | `CF_ACCESS_TEAM_DOMAIN` | `<team>.cloudflareaccess.com` |
   | `CF_ACCESS_AUD` | the AUD tag |
   | `OPERATOR_EMAILS` | who may publish rules and drive devices (comma-separated) |
   | `DEVICES_HOST` | `devices.baktisatria.com` (default) |
   | `TLS_DIR` | `/opt/ppd-demo/tls` (default) |
   | `APP_TAG`, `GATEWAY_TAG` | defaults follow the branches; use `sha-<commit>` to pin |

   Mark the tokens and the AUD as secrets (locked).
4. On the **web** service set the domain `https://ppd.baktisatria.com`. Leave the other services without a
   domain.
5. **Deploy.** All four containers should turn healthy within a minute.

## 8. Check it

```bash
# From your laptop: the gateway answers devices with certificates only.
curl --cacert .cloud-tls/all/gateway-ca.pem --cert .cloud-tls/all/device-cert.pem --key .cloud-tls/all/device-key.pem \
  https://devices.baktisatria.com:8443/.well-known/ppd
#   -> "security_profile":"direct-certificate", "service_base_uri":"https://devices.baktisatria.com:8443/ppd/v1/"
curl https://devices.baktisatria.com:8443/.well-known/ppd     # -> TLS error (no certificate): correct
```

- `https://ppd.baktisatria.com` asks you to sign in, then shows the questions (first launch).
- System status: gateway and repository pass; "Devices prove who they are with certificates".
- Demo devices: *Connect* the Aqara; it reaches "Has your rules" in a few seconds.
- ESP32: in `ppd_config.h` set the gateway URL `https://devices.baktisatria.com:8443` and paste the three
  PEMs from `.cloud-tls/esp32/`; flash; it joins My home over the phone hotspot.

## Updating

Push to the branch → the workflow builds new images → Coolify → `ppd-demo` → **Redeploy** (it pulls the
branch tags again). To be able to roll back, set `APP_TAG`/`GATEWAY_TAG` to the `sha-…` tags and change them
on purpose. Data lives in the `app-data`, `gateway-data` and `repository-data` volumes and survives redeploys.

## When something is wrong

| Symptom | Likely cause |
| --- | --- |
| Pull fails: `denied` / `unauthorized` | Step 2 login missing, or token without `read:packages` |
| app-api restarts: "needs CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUD" | Step 6 values not set |
| System status: gateway unreachable, certificate error | `DEVICES_HOST` differs from the certificate, or app-api cannot read `operator-key.pem` (owner must be uid 1000) |
| gateway restarts: cannot read key | `gateway-key.pem` must be owned by uid 10001 |
| ESP32 / curl to `:8443` times out | port 8443 closed, or `devices` record is proxied (orange) |
| Simulated devices never appear on the network | `sim-network` volume not shared (both services must mount it) |
| Web app shows an old version | the service worker; reload twice or clear site data |
