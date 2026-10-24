# Privacy Preferences — PWA frontend

A phone-first progressive web app for the privacy preference authoring tool: scan a device's privacy code, see what the
device says it does with your data compared with your household rules, and see where they conflict.

**First launch places the household in a preset.** Before anything else the app asks a few questions (at most five), walking
a decision tree to one of eight **household presets**: a short set of rules, each *Never*, *Allowed only if* (not kept,
processed in the home, or on the device) or *Allowed*. The person sees the preset, can pick another, and can then change,
switch off, delete or add rules. The household is never asked about single flows (CableLabs guidance): its preset and rules
decide, and devices receive them. The presets and the tree come from clustering thousands of synthetic households built from
published IoT privacy studies, following Smullen et al. 2020; see
[ppd-household-presets](https://github.com/baktistr/ppd-household-presets).

It implements the nine phone screens from the design canvas (1a Scan, 1b/1c Preview, 2a New device, 2b Flow detail,
3a My home, 3b Device library, 3c Device detail, 3d Household rules), plus the onboarding questions, the preset picker,
the rule editor and a page on how the presets were made. Its backend is **app-api** (`server/`), which stores the household and computes the verdicts;
an offline mock mode answers the same calls from static JSON in `public/mock/`.

App: https://ppd-preference-app.vercel.app/#/rules

## Run it

Needs Node 24 or later (app-api uses Node's built-in SQLite).

### The whole demo stack (recommended)

With the `habanero-ppd-gateway` repository checked out next to this one, and Go installed:

```bash
scripts/dev-stack.sh
```

It builds and starts the PPD preference repository and gateway (demo extensions relayed to app-api), app-api with the
demo device simulator, and the web app on http://localhost:5173. A real ESP32 bulb provisioned with
`http://<this machine>:8080` joins too. Logs go to `.dev-stack/logs`; Ctrl-C stops everything.

**Demo devices** (http://localhost:5173/#/demo-devices, also in the side rail) is the presenter's page. *Connect* makes a
simulated device (Aqara hub, Reolink camera, Level lock) join the network and run the PPD lifecycle against the gateway
(register, declare, fetch the policy, acknowledge, renew); *Unplug* stops it renewing and takes it off the network: it moves to "Need attention" in My home and goes stale
after the gateway's freshness interval (2 minutes), and then *Forget this device* on its page deletes it from the gateway
(`POST /ppd/v1/device/forget/{id}`, an operator route in the gateway fork) and the household. *Join network* puts the LG TV on the
network without PPD, so it shows under "On your network, no PPD" in My home and as Unmanaged on the CableLabs dashboard
(`http://<this machine>:8080/ppd/v1/status`). The simulator writes a DHCP lease file that the gateway reads in place of a real
router's, which is how the gateway "sees" devices on the network.

**With certificates (`MTLS=1 scripts/dev-stack.sh`).** The first run makes a development household CA in
`.dev-stack/tls` with CableLabs' `generate-dev-tls`: a gateway certificate, app-api's operator certificate, and one client
certificate per device (the ESP32 bulb's `device-cert.pem`, and `<device_id>-cert.pem` for each simulated device). The gateway
then serves HTTPS and accepts only clients with a certificate from that CA whose name matches the `device_id` they claim
(the PPD `direct-certificate` profile). System status shows "Devices prove who they are with certificates". A browser has
no certificate, so the CableLabs dashboard opens only after importing `.dev-stack/tls/operator.p12` (empty password). Gateway
state is kept separately in this mode. For the ESP32, put `gateway-ca.pem`, `device-cert.pem` and `device-key.pem` in
`ppd_config.h`, and add the address it uses to the gateway certificate with `GATEWAY_SANS` (delete `.dev-stack/tls` to
make new certificates).

### Pieces on their own

```bash
npm install
npm install --prefix server

npm run api          # app-api on http://localhost:3000 (household stored in server/data/app.db)
npm run dev          # the app on http://localhost:5173; Vite forwards /api to app-api
npm run dev:mock     # the app alone, offline: public/mock/ + localStorage, no app-api needed

npm run build                    # type-checks, then builds the app to dist/
npm --prefix server run build    # type-checks, then bundles app-api to server/dist/
npm --prefix server test         # app-api route tests
npm run preview                  # serves dist/ on :4173 (also forwards /api) to test the installed-app behaviour
```

Run `npm run api` and `npm run dev` in two terminals. Settings are in `.env.example` (the app) and
`server/.env.example` (app-api); the defaults need no changes on a workstation.

### Trying it on a phone (the camera needs HTTPS)

Browsers only allow the camera on a secure page. Three ways to get one:

1. **Same Wi-Fi:** `npm run dev:https`, then open the `https://<your-computer-ip>:5173` address it prints. Accept the
   self-signed certificate warning once.
2. **Deploy the `dist/` folder** to any static host that serves HTTPS (GitHub Pages, Netlify, Cloudflare Pages, S3 + CloudFront).
   The app uses hash routes and relative paths, so it works from a sub-path with no server rules.
3. **A tunnel** (for example `cloudflared` or `ngrok`) pointed at `npm run preview`.

Then open **My home → Rules → Test tools**. It shows a QR code for every device in the fixtures, plus a Matter setup code the
app should refuse. Point the phone at them from your laptop screen. The same page lists what the phone supports
(secure page, built-in QR detector, installed or not, service worker).

To install: Android Chrome → menu → *Install app*; iPhone Safari → Share → *Add to Home Screen*.

## How scanning works

`src/scanner/useQrScanner.ts` opens the rear camera and checks about eight frames a second.

- Chrome on Android has a built-in `BarcodeDetector`, so the app uses it.
- Safari on iPhone and Firefox do not, so the app falls back to **jsQR**, a small JavaScript decoder. It loads only when needed
  and is cached for offline use.

The scanned text goes to `api.resolveCode()`. In the fixtures a privacy code is a placeholder URL such as
`https://ppd.example/d/aqara-w200-01`. A Matter setup code (`MT:…`) is recognised and refused with an explanation, because
the design separates the two codes. Replace `resolveCode` once the real code format is decided.

## Where the backend is

Everything the screens need goes through one interface, `PpdApi` in `shared/types.ts`:

| Call | Returns |
| --- | --- |
| `getOnboarding()`, `listHouseholdPresets()` | the onboarding tree and the presets (`public/mock/onboarding.json`, `household-presets.json`) |
| `choosePreset({preset_id, answers})`, `saveProfile(profile)` | the household's preset (its rules replace the previous preset's; custom rules stay) |
| `listRules()`, `upsertRule`, `deleteRule` | the household's rules |
| `listLibrary()` / `getDevice(id)` | device summaries / a device with all its flows and verdicts |
| `resolveCode(text)` | which device a scanned code points to |
| `getHousehold()`, `addDevice`, `removeDevice`, `saveForLater`, `markJoinedSeen` | the household's devices |
| `getOverview()`, `getSystemStatus()`, `getMe()` | the gateway's readiness summary, service checks, and who is signed in |
| `getPublishedPolicy()`, `previewPublish()`, `publish()` | the household policy the gateway serves, and sending a new one |
| `listPresets()`, `applyPreset()` | the gateway's fixed example policies (not shown in the app: automatic sending replaces them) |
| `disassociate()`, `listCommands()`, `sendCommand()`, `getTelemetry()` | operator actions and guided-demo controls for connected devices |

`src/api/httpClient.ts` implements it against app-api; each call is one route under `/api` (see `server/src/app.ts`). The browser
only ever calls `/api` on its own origin; app-api is the one that talks to the PPD gateway. `src/api/index.ts` picks the client:
app-api by default, or `src/api/mockClient.ts` (fixtures + `localStorage`) when `VITE_API_MODE=mock`. The screens do not change.

Both clients use the same code from `shared/` for what happens to the household (`household.ts`) and for the verdicts
(`engine.ts`), so mock mode behaves like app-api.

### app-api

`server/` is a Node + TypeScript service (Fastify), the web app's only backend. It:

- keeps the household (devices, preset, answers, rules) in SQLite with an audit log, and computes every device's verdicts
  on read;
- talks to the PPD gateway (`GATEWAY_URL`): it finds the API through `GET /.well-known/ppd` (draft-dsmullen-ppd-protocol-04),
  sends the operator token, and uses mutual TLS when certificate files are set;
- shows devices the gateway knows: they join My home on their own, their flows are their declared statements, and their
  live state (association, delivered policy, receipt, identity) is what the CableLabs dashboard shows;
- **sends the household policy on its own**: it compiles the rules into one PPD policy of atomic allow/deny rules, one per
  dataflow a connected device declared (`server/src/compiler.ts`), sends it to the gateway, and reads it back. An *Allowed
  only if* rule is sent as `allow` with its condition as constraints (protocol-04 section 7.12). There is no send button:
  `server/src/autopublish.ts` sends after every rule or preset change, and checks every `AUTO_PUBLISH_INTERVAL_MS`
  (default 10 s) for devices that joined or left, so the preset covers new devices without anyone acting. It sends only
  when the compiled policy differs from the gateway's, and nothing before the household has a preset. Loading one of the
  gateway's example policies (CableLabs dashboard) is therefore replaced by the household's within seconds;
- runs a **device console** per demo device (Demo devices → a device): the simulated devices get controls their real
  product offers (`server/src/simulator/models.ts`: lock and unlock, a person walking past the camera, turning the
  thermostat up, watching TV …). Each control triggers the data flows the device declares, and the device checks each
  one against the household policy it received: allowed flows are sent, denied or uncovered ones held back, unless it is
  set to ignore the rules. The TV has no PPD and sends everything. This is demo behaviour, not PPD;
- relays the cloud demo extensions: devices upload telemetry and poll for guided-demo commands through the gateway, which
  authenticates them and calls `/internal/*` with a service token;
- requires sign-in in production (it verifies Cloudflare Access tokens itself), refuses writes without the app's
  `X-PPD-Client` header, and marks every response `no-store`.

Settings are in `server/.env.example`; `server/config/devices.json` says which gateway devices are real hardware or
simulated, and gives each simulated device its network identity (MAC, IP, hostname) and mode (`ppd` or `network`).
With `SIMULATOR=1`, app-api also runs those simulated devices (`server/src/simulator/`).

### Taxonomy

Everything uses only the core `ppd:` terms of draft-dsmullen-ppd-taxonomy-05 (`shared/taxonomy.ts`): fixtures, rules,
declarations and published policies. No extension vocabulary or prefix declaration is needed, and terms compare by exact
identity. The workbook's finer research terms only feed the plain-language labels.

### The fixtures

`tools/build_mock.py` reads the research workbook (`tools/Dataflow_updated_v3.xlsx`) and writes `public/mock/`:

```bash
pip install openpyxl
npm run mock         # or: python3 tools/build_mock.py path/to/workbook.xlsx
```

Each flow carries its taxonomy (core `ppd:` terms, constraints as an object), plain-language labels, control type and
note from the workbook. A simulated device declares its research fixture's flows (only those the fixture marks as
declared by the device).

**The verdicts are this project's comparison, not the PPD protocol's.** app-api computes them with `shared/engine.ts` from the
household's current rules (a stricter rule wins: Never, then Allowed only if, then Allowed; no matching rule and the flow
leaves the home means it is not allowed), and `getDevice` returns each flow's `evaluation` block. The PPD protocol defines
these outcome names but not this procedure. A processing-boundary condition (in the home, on the device) is defined only for
use and inference (taxonomy-05 section 6.7.2), so such a rule covers only those actions.

### The presets and the questions

`public/mock/household-presets.json` and `public/mock/onboarding.json` are copied from `export/` in
[ppd-household-presets](https://github.com/baktistr/ppd-household-presets) (notebook 07). `shared/onboarding.ts` walks
the tree; a question that comes back lower down reuses its first answer. To change them, rerun the notebooks and copy the two
files again; `server/test/presets.test.ts` checks every path ends in a preset and every preset is reachable.

The data is synthetic, built from published studies; the questions and presets are not user-tested.

## Design rules kept in the code

- **Verdicts compare flows with the household's rules and nothing else.** Control (can the user limit the flow) is one read-only line on
  the flow screen, from the workbook. It never changes a verdict or a chip.
- **Only conflicts need attention.** The household is never asked to decide a single flow, and a flow we can't read is
  shown but never asked about.
- **The app never claims a device complies.** "Confirmed" means the device acknowledged receiving the rules.
- **Four verdicts, one colour each:** green matches, blue with limits, red conflicts, grey can't tell.

## Where this differs from the design canvas

- Counts come from the fixtures and from the household's preset, so they differ from the mock-up numbers.
- The canvas shows five fixed rules. The app has no fixed rules: the household's rules come from its preset.
- The canvas's per-flow preference form (2b) is gone: the flow screen is read-only, per CableLabs guidance.
- Navigable rows have a small chevron.
- Added: "Type the code instead" on Scan (useful without a camera), a "Saved" tag in the library, a "Remove from my home" row,
  an "About this declaration" block on the device screen, and the Test tools page.
- Added: the onboarding questions, the preset picker, the policy review page, the rule editor, and the page on how the presets
  were made (none are in the canvas).
- Added: live devices from the PPD gateway, System status, sending rules to devices, demo presets and controls, and a
  desktop layout (navigation rail and list-beside-detail panes from 1200 px).
- Not built: sending the summaries and warnings chosen on the rules page, push notifications.

## Deploying

`Dockerfile.web` (Nginx serving the build and forwarding `/api`) and `server/Dockerfile` (app-api) build from the repository
root; `.github/workflows/images.yml` builds both and pushes them to ghcr.io. `deploy/compose.example.yaml` runs the four
services on Coolify together with the gateway and repository images from the `habanero-ppd-gateway` fork, and
`scripts/make-cloud-tls.sh` makes the household CA and certificates. Step by step: [`docs/deploy-coolify.md`](docs/deploy-coolify.md).

## Project map

```
shared/            used by the app and app-api: the contract (types.ts), core taxonomy, household changes, verdict engine, rule matching, onboarding walk
server/            app-api: routes (src/routes/), policy compiler, gateway client, live devices, demo simulator, SQLite store, sign-in, tests
deploy/            compose.example.yaml for the cloud deployment (Coolify)
scripts/           dev-stack.sh: the whole demo stack on one machine
src/api/           app-api client, offline mock client, the switch between them (index.ts)
src/scanner/       camera + QR decoding
src/screens/       one file per screen (Onboarding, ChoosePreset, Rules and RuleEditor make up the household policy)
src/policy/        choices.ts (editor wording)
src/components/    app bars, lists, chips, form controls, the shared device report
src/lib/           verdict labels and counting, device helpers
src/state/         household store and data hooks
src/styles/app.css design tokens and component styles from the canvas
public/mock/       generated fixtures, and the presets and onboarding tree from ppd-household-presets
tools/             fixture builder, icon generator
docs/              deployment guide
```

## PWA details

`vite-plugin-pwa` generates the manifest and the service worker. The app shell (HTML, JS, CSS, icons, the QR decoder) is
precached, so the app opens offline. `/api` responses are never cached (app-api sends `Cache-Control: no-store` and the worker
leaves `/api` alone), so the app always shows the stored household. In mock mode, requests for `/mock/*.json` are network-first
with a cache fallback. The worker updates itself when a new build is deployed.
