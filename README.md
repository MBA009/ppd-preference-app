# Privacy Preferences PWA frontend

A phone-first progressive web app for the privacy preference authoring tool: scan a device's privacy code, see what the
device says it does with your data compared with your household rules, and decide on the flows that need you.

**First launch asks questions.** Before anything else the app asks seven short questions (about data leaving the home, what
companies may use it for, sharing, inference, retention, and how to keep you posted). The answers generate a household policy:
a list of rules, each *Never*, *Ask me first* or *Allowed*. The person then reviews the policy, and can change, switch off,
delete or add rules. Verdicts for every device are computed from those rules. The questions are derived from four published
IoT privacy studies; see [`docs/household-policy-decision-tree.md`](docs/household-policy-decision-tree.md) for the tree,
the answer-to-rule mapping and the citations.

It implements the nine phone screens from the design canvas (1a Scan, 1b/1c Preview, 2a New device, 2b Flow detail and decision,
3a My home, 3b Device library, 3c Device detail, 3d Household rules), plus the questions, the policy review page, the rule
editor and a sources page. The backend does not exist yet, so every call is answered from static JSON in `public/mock/`.

App: https://ppd-preference-app.vercel.app/#/rules

## Run it

```bash
npm install
npm run dev          # http://localhost:5173  (the camera works on localhost)
npm run build        # type-checks, then builds to dist/
npm run preview      # serves dist/ on :4173 so you can test the installed-app behaviour
```

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

## Where the "backend" is

Everything the screens need goes through one interface, `PpdApi` in `src/api/types.ts`:

| Call | Returns |
| --- | --- |
| `getQuestionnaire()` | the decision tree (`public/mock/questionnaire.json`) |
| `listRules()`, `savePolicy({answers, rules, profile})`, `upsertRule`, `deleteRule` | the household's rules and the answers they came from |
| `listLibrary()` / `getDevice(id)` | device summaries / a device with all its flows and verdicts |
| `resolveCode(text)` | which device a scanned code points to |
| `getHousehold()`, `addDevice`, `removeDevice`, `saveForLater`, `markJoinedSeen`, `saveDecision` | the household's devices and saved preferences |

`src/api/mockClient.ts` implements it from `public/mock/*.json` and keeps the household in `localStorage`. To connect a real
backend, write another `PpdApi` implementation and change the one line in `src/api/index.ts`. The screens do not change.

### The fixtures

`tools/build_mock.py` reads the research workbook (`tools/Dataflow_updated_v3.xlsx`) and writes `public/mock/`:

```bash
pip install openpyxl
npm run mock         # or: python3 tools/build_mock.py path/to/workbook.xlsx
```

Each flow carries its taxonomy fields (fine-grained, and the coarse `core` terms household rules are written in),
plain-language labels, control type and note from the workbook.

**The verdicts are placeholders.** They are computed in the browser by `src/api/mockEngine.ts` from the household's current
rules (a stricter rule wins: Never, then Ask me first, then Allowed; no matching rule and the flow leaves the home means
"needs your decision"). It exists so every state has data to render and so editing a rule visibly changes the verdicts. It says
nothing about what the PPD protocol would return. Replace it with the backend's real comparison: `getDevice` should return each
flow's `evaluation` block computed server-side.

### The questions

`public/mock/questionnaire.json` is the decision tree: questions, branching (`show_if`), prefills, the rule each answer makes,
the "why we ask" text and the sources. `src/policy/generate.ts` walks it. To change a question, edit the JSON, then regenerate
the document: `python3 tools/build_tree_doc.py` (writes `docs/household-policy-decision-tree.md`).

The questions are derived from factors the cited papers studied. The wording, branching and mapping are this project's design
and are not user-tested.

## Design rules kept in the code

- **Verdicts compare flows with the household's rules and nothing else.** Control (can the user limit the flow) is one read-only line on
  the flow screen, from the workbook. It never changes a verdict or a chip.
- **Chips count flows needing attention.** A decision you have saved leaves the "need a decision" count and shows
  "You chose: …" on the flow.
- **The app never claims a device complies.** "Confirmed" means the device acknowledged receiving the rules.
- **Five verdicts, one colour each:** green matches, blue with limits, orange needs a decision, red conflicts, grey can't tell.

## Where this differs from the design canvas

- Counts come from the fixtures and from the rules the answers make, so they differ from the mock-up numbers.
- The canvas shows five fixed rules. The app has no fixed rules: the household's rules come from the questions.
- The preference form starts with nothing selected and *Save* disabled, rather than pre-selecting "Allow with limits".
- Navigable rows have a small chevron.
- Added: "Type the code instead" on Scan (useful without a camera), a "Saved" tag in the library, a "Remove from my home" row,
  an "About this declaration" block on the device screen, and the Test tools page.
- Added: the first-launch questions, the policy review page, the rule editor, and the sources page (none are in the canvas).
- Not built: real accounts, sending the summaries and warnings chosen in the last question, push notifications, real declaration fetching.

## Project map

```
src/api/           contract (types.ts), mock backend, the one-line switch (index.ts)
src/scanner/       camera + QR decoding
src/screens/       one file per screen (Questionnaire, Rules and RuleEditor make up the household policy)
src/policy/        the decision tree as code: generate.ts (answers to rules), scope.ts (rule matching), choices.ts (editor wording)
src/components/    app bars, lists, chips, form controls, the shared device report
src/lib/           verdict labels and counting, device helpers
src/state/         household store and data hooks
src/styles/app.css design tokens and component styles from the canvas
public/mock/       generated fixtures
tools/             fixture builder, decision-tree document builder, icon generator
docs/              household-policy-decision-tree.md (generated)
```

## PWA details

`vite-plugin-pwa` generates the manifest and the service worker. The app shell (HTML, JS, CSS, icons, the QR decoder) is
precached, so the app opens offline. Requests for `/mock/*.json` are network-first with a cache fallback, so edits to fixtures
show up on reload and the last data still works offline. The worker updates itself when a new build is deployed.
