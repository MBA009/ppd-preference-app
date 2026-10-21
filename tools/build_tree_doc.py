#!/usr/bin/env python3
"""Builds docs/household-policy-decision-tree.md from public/mock/questionnaire.json.

The JSON is the source of truth (the app reads it too). Run this after editing it:
    python3 tools/build_tree_doc.py

The worked examples are computed here by a small Python copy of src/policy/generate.ts,
so they also act as a cross-check on the app's generator (the app's smoke test expects the same counts).
"""
import json, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
Q = json.load(open(os.path.join(ROOT, "public/mock/questionnaire.json")))
QS = {q["id"]: q for q in Q["questions"]}

# ---------------------------------------------------------------- generator (mirror of src/policy/generate.ts)
def resolve(touched):
    out = {}
    for k in Q["questions"]:
        if k["type"] == "matrix": out[k["id"]] = {r["id"]: k["default"] for r in k["rows"]}
        elif k["type"] == "profile": out[k["id"]] = {f["id"]: f["default"] for f in k["fields"]}
        elif k["default"] is not None: out[k["id"]] = k["default"]
    for k in Q["questions"]:
        if k["type"] != "single": continue
        opt = next((o for o in k["options"] if o["id"] == touched.get(k["id"])), None)
        for p in (opt or {}).get("prefill", []):
            out[p["question"]] = {**out[p["question"]], p["row"]: p["value"]}
    for k, v in touched.items():
        out[k] = {**out[k], **v} if isinstance(v, dict) else v
    return out

def cond(c, a):
    if "not" in c: return not cond(c["not"], a)
    if "all" in c: return all(cond(x, a) for x in c["all"])
    if "any" in c: return any(cond(x, a) for x in c["any"])
    if "all_rows" in c:
        vals = list(a[c["all_rows"]["question"]].values())
        return bool(vals) and all(v == c["all_rows"]["equals"] for v in vals)
    v = a.get(c["answer"]["question"])
    return v == c["answer"].get("equals") if "equals" in c["answer"] else v in c["answer"].get("in", [])

def visible(a): return [k for k in Q["questions"] if "show_if" not in k or cond(k["show_if"], a)]

def generate(a):
    rules = []
    for k in visible(a):
        if k["type"] == "matrix":
            for r in k["rows"]:
                v = a[k["id"]].get(r["id"], k["default"])
                eff = next(s["effect"] for s in k["scale"] if s["id"] == v)
                rules.append((f'{k["id"]}.{r["id"]}', eff, r["titles"][v]))
        elif k["type"] == "single":
            opt = next((o for o in k["options"] if o["id"] == a.get(k["id"])), None)
            for r in (opt or {}).get("rules", []): rules.append((r["id"], r["effect"], r["title"]))
    return rules

# ---------------------------------------------------------------- helpers
EFFECT = {"dont_allow": "Never", "ask": "Ask me first", "allow": "Allowed"}
VERDICT = {"dont_allow": "Conflicts with your rules", "ask": "Needs your decision", "allow": "Matches your rules"}

def short(iri): return iri.replace("ppd:", "")

def scope_text(s):
    parts = []
    for k, label in (("data_type", "data"), ("purpose", "purpose"), ("handling_context", "handled by"), ("action", "action")):
        if s.get(k): parts.append(f'{label} = {" or ".join(short(i) for i in s[k])}')
    for c in s.get("constraints", []): parts.append(c.replace("ppd:", ""))
    return "; ".join(parts) or "any flow"

def cite(ids): return "; ".join(f'[{Q["sources"][i]["short"]}](#{i})' for i in ids)

def describe(c):
    if "not" in c: return "not (" + describe(c["not"]) + ")"
    if "all" in c: return " and ".join(describe(x) for x in c["all"])
    if "any" in c: return " or ".join(describe(x) for x in c["any"])
    if "all_rows" in c:
        r = c["all_rows"]; return f'every row of {r["question"].split("_")[0].upper()} is "{r["equals"]}"'
    a = c["answer"]; return f'{a["question"].split("_")[0].upper()} = {a.get("equals") or a.get("in")}'

def qn(k): return k["id"].split("_")[0].upper()

# Where a question goes beyond what the papers show. Kept here so the document always says it.
DESIGN = {
    "q1_children": "The papers do not test children's data as a factor. The expert study only lists it as a label item. Using \"yes\" to start the video and advertising choices on Never is this project's choice. Nothing is applied that the person cannot change.",
    "q2_data": "The six rows group the PPD core data types (contentData, locationData, sensorData, identifierData + profileData, usageData, deviceAndNetworkData). The 2017 study varied four kinds of data (presence, video, specific position, biometric); the app's rows are broader. Biometrics are not asked separately because no flow in the four devices' data mentions biometric data. The scale is Never / Ask / OK, which is this project's mapping onto rule effects.",
    "q3_purposes": "The six rows are the PPD core purposes, reworded. The papers tested \"device function\" versus \"monetization\" style purposes, not these exact six.",
    "q4_sharing": "The core PPD taxonomy has no \"sold\" value, so selling is folded into \"other companies\" and the question says so. The \"only when a feature I use needs it\" option is this project's wording for a rule that allows core functionality and notifications and blocks the rest.",
    "q5_inference": "Maps to the PPD action \"inference\". Whether a flow counts as inference comes from the device's declaration, not from anything the person says.",
    "q6_retention": "A device is only in conflict when it says it keeps data indefinitely. \"Not stated\" is never treated as forever, so this question has no effect on devices that do not state retention. The papers also found short retention helped (a week; delete right away), which this single question does not separate.",
    "q7_updates": "Saved with the policy only. Nothing sends summaries or warnings yet.",
}

L = []
w = L.append

w("# Household privacy questions: decision tree")
w("")
w(f'Version {Q["version"]}. Generated from `public/mock/questionnaire.json` by `tools/build_tree_doc.py`. The JSON is the machine-readable tree and the app reads it directly.')
w("")
w("> **Status.** " + Q["disclaimer"])
w("")
w("## 1. What this does")
w("")
w("On first launch the app asks a few questions. The answers are turned into a **household policy**: a list of rules, each saying **Never**, **Ask me first**, or **Allowed** for one kind of data flow. The person then reviews the rules and can change, switch off, delete or add any of them. Every device is compared against the household's current rules.")
w("")
w("```")
w("answers --(this tree)--> rules --(edited by the person)--> household policy --(compared with each flow)--> verdict")
w("```")
w("")
w("### Rule shape")
w("")
w("Each rule has an effect (`dont_allow` | `ask` | `allow`), a scope, a title the person sees, an on/off switch, and where it came from. A scope names PPD core taxonomy terms. A field left out means \"any\".")
w("")
w("```json")
w(json.dumps({"id": "q2_data.content", "effect": "dont_allow", "enabled": True,
              "scope": {"data_type": ["ppd:contentData"], "handling_context": ["ppd:vendorContext", "ppd:thirdPartyContext"]},
              "title": "Never send video, photos or sound out of my home",
              "origin": {"kind": "questionnaire", "question_id": "q2_data", "row_id": "content", "answer": "never"}}, indent=2))
w("```")
w("")
w("A flow matches a scope when each field the scope names has one of the listed values (checked against the flow's core term and its fine-grained term), and every listed constraint is present on the flow.")
w("")
w("### Which rule wins")
w("")
w("When several rules match one flow the stricter one wins: **" + " > ".join(EFFECT[e] for e in Q["precedence"]) + "**.")
w("")
w("| Order | What is checked | Verdict |")
w("|---|---|---|")
w("| 1 | The flow has no source yet (`needs_source`) | Can't tell |")
w("| 2 | A matching **Never** rule | Conflicts with your rules |")
w("| 3 | A matching **Ask me first** rule | Needs your decision |")
w("| 4 | The flow declares a limit (stays on the device or in the home, or is kept only briefly) | With limits |")
w("| 5 | A matching **Allowed** rule | Matches your rules |")
w("| 6 | No rule matches and the flow leaves the home | Needs your decision |")
w("| 7 | No rule matches and the flow stays in the home | Matches your rules |")
w("")
w("The app never says a device complies. This comparison is a stand-in written for the front end; the real comparison belongs to the backend. How a person can control a flow (a setting, a setup step) is shown as a read-only line and never changes a verdict.")
w("")

# ------------------------------------------------------------ diagram
w("## 2. The tree")
w("")
w("```mermaid")
w("flowchart TD")
w('  start(["First launch"]) --> Q1')
for k in Q["questions"]:
    label = f'{qn(k)}: {k["short"]}'
    w(f'  {qn(k)}["{label}"]')
q1 = QS["q1_children"]
prefills = "; ".join(f'{p["question"].split("_")[0].upper()} {p["row"]} = Never' for o in q1["options"] for p in o.get("prefill", []))
w(f'  Q1 -->|"Yes: starts {prefills}"| Q2')
w('  Q1 -->|"No"| Q2')
skip = [qn(k) for k in Q["questions"] if "show_if" in k]
w('  Q2 --> C{"Every row Never?"}')
w(f'  C -->|"Yes: skip {skip[0]} to {skip[-1]}"| Q7')
chain = [qn(k) for k in Q["questions"] if "show_if" in k]
w(f'  C -->|"No"| {chain[0]}')
for a, b in zip(chain, chain[1:]): w(f"  {a} --> {b}")
w(f"  {chain[-1]} --> Q7")
w('  Q7 --> G["Generate rules from the answers"]')
w('  G --> P["Policy page: review, edit, add, switch off"]')
w('  P -.->|"Answer the questions again"| Q1')
w("```")
w("")
w("Branching rules in the JSON (`show_if`):")
w("")
for k in Q["questions"]:
    if "show_if" in k: w(f'- **{qn(k)}** is shown when {describe(k["show_if"])}.')
w("")
w("Answers are resolved in this order: question defaults, then prefills from earlier answers, then whatever the person chose. The person's choice always wins over a prefill.")
w("")

# ------------------------------------------------------------ questions
w("## 3. Questions, answers and the rules they make")
w("")
for k in Q["questions"]:
    w(f'### {qn(k)}. {k["prompt"]}')
    w("")
    w(f'*{k["help"]}*')
    w("")
    w(f'- **Type:** {k["type"]}' + (f' · **default:** {k["default"] if k["default"] is not None else "none (the person has to pick)"}' if k["type"] != "profile" else ""))
    if "show_if" in k: w(f'- **Shown when:** {describe(k["show_if"])}')
    w(f'- **Why we ask (shown to the person):** {k["why"]}')
    w(f'- **Sources:** {cite(k["sources"])}')
    w(f'- **Design choice, not from the papers:** {DESIGN[k["id"]]}')
    w("")
    if k["type"] == "single":
        w("| Answer | Rules made | Effect | Scope |")
        w("|---|---|---|---|")
        for o in k["options"]:
            pre = ""
            if o.get("prefill"):
                pre = " Also starts " + ", ".join(f'{p["question"].split("_")[0].upper()} “{p["row"]}” at Never' for p in o["prefill"]) + "."
            if not o["rules"]:
                w(f'| {o["label"]} | none.{pre} | | |')
            for i, r in enumerate(o["rules"]):
                w(f'| {o["label"] if i == 0 else ""} | {r["title"]}{pre if i == 0 else ""} | {EFFECT[r["effect"]]} | `{scope_text(r["scope"])}` |')
    elif k["type"] == "matrix":
        sc = k["scale"]
        w("| Row | " + " | ".join(f'{s["label"]} → **{EFFECT[s["effect"]]}**' for s in sc) + " | Scope |")
        w("|---|" + "---|" * len(sc) + "---|")
        for r in k["rows"]:
            w(f'| **{r["label"]}**<br>{r["example"]} | ' + " | ".join(r["titles"][s["id"]] for s in sc) + f' | `{scope_text(r["scope"])}` |')
    else:
        for f in k["fields"]:
            if f["type"] == "single":
                w(f'- **{f["label"]}:** ' + " / ".join(o["label"] for o in f["options"]) + f' (default: {f["default"]})')
            else:
                w(f'- **{f["label"]}:** on / off (default: {"on" if f["default"] else "off"})')
        w("")
        w("These are stored as the policy's `profile` and make no rules.")
    w("")

# ------------------------------------------------------------ examples
def example(title, touched):
    a = resolve(touched)
    rules = generate(a)
    vis = visible(a)
    w(f"**{title}**")
    w("")
    w(f'Questions asked: {len(vis)} ({", ".join(qn(k) for k in vis)}). Rules made: {len(rules)}.')
    w("")
    w("| Effect | Rule |")
    w("|---|---|")
    for _, eff, t in sorted(rules, key=lambda r: Q["precedence"].index(r[1])):
        w(f"| {EFFECT[eff]} | {t} |")
    w("")
    return rules

w("## 4. Worked examples")
w("")
r1 = example("A. Children at home; \"Never\" to other companies; every other answer left on its default",
             {"q1_children": "yes", "q4_sharing": "never"})
r2 = example("B. Every kind of data kept in the home (the short path)",
             {"q1_children": "no", "q2_data": {r["id"]: "never" for r in QS["q2_data"]["rows"]}})
counts = {e: sum(1 for r in r1 if r[1] == e) for e in Q["precedence"]}
assert len(r1) == 15 and counts == {"dont_allow": 3, "ask": 12, "allow": 0}, counts
assert len(r2) == 6

# ------------------------------------------------------------ sources
w("## 5. Sources")
w("")
w("Links are the plain paper or DOI pages (the tracking parameters on the originally pasted links were removed).")
w("")
for sid, s in Q["sources"].items():
    w(f'<a id="{sid}"></a>**{s["short"]}.** {s["citation"]}  ')
    links = [f'[page]({s["url"]})']
    if s.get("pdf"): links.append(f'[PDF]({s["pdf"]})')
    used = ", ".join(qn(k) for k in Q["questions"] if sid in k["sources"])
    w(f'{" · ".join(links)} · used for: {used}')
    w("")

w("### What each paper supports")
w("")
w("**Emami-Naeini et al., 2017 (SOUPS).** 1,007 people (1,014 completed; 7 removed) each rated 14 of 380 scenarios. Eight factors were varied: location, kind of data, device type, user benefit, purpose, retention, whether the data is shared, and whether it is inferred. Findings used here: home was the only location that lowered comfort; biometric data was least comfortable; only short retention clearly raised comfort; sharing and inference lowered comfort; benefit to the user and specific purposes raised willingness to allow. Preferred summary frequency: monthly 63%, daily 23%, yearly 8%, never 6%.")
w("")
w("**Emami-Naeini et al., 2020 (S&P).** A three-round Delphi study with 22 experts, then 15 consumer interviews, about what an IoT privacy and security label should show. Privacy items on the first layer included the kind of data, the sensors, the purpose, where data is stored, who it is shared with and who it is sold to. Retention time, inference, linkage, children's data, user controls and collection frequency were on the second layer. All 15 consumers were worried about sharing or selling.")
w("")
w("**Emami-Naeini et al., 2021 (S&P).** 1,371 people judged labels built from 16 attribute and value pairs. Data sold to third parties raised perceived risk the most; no cloud retention lowered it the most; \"not shared with third parties\" had the strongest positive effect on willingness to buy; a purpose of \"device function\" was often not trusted. The authors recommended moving retention to the first layer and explaining purpose.")
w("")
w("**Emami-Naeini et al., 2022 (IEEE Security & Privacy).** A magazine article that summarizes the label work: 24 consumer and 22 expert interviews, 47 information items, a label generator, and a companion app where people set preferences for warnings. The companion app is the same idea this app builds on: the person states preferences first, and warnings follow from them.")
w("")
w("### Corrections to the notes the question list was based on")
w("")
w("The list pasted into the request had these errors. They are corrected above and in the JSON:")
w("")
w("- **2017 study:** notification and comfort were *outcome* questions, not factors that were varied. The eight varied factors are listed above.")
w("- **2017 study, prediction accuracy:** the abstract says \"up to 86%\". The tables show about 81% (comfort) and 79% (allow or deny), and Section 6.3 reports 88% for three observed decisions predicting eleven. These do not agree, so no accuracy figure is quoted in the app.")
w("- **2021 paper:** the authors are Emami-Naeini, Dheenadhayalan, Agarwal and Cranor (from the paper's own PDF). One publication page lists different authors, which looks wrong. The venue (IEEE S&P 2021) is taken from the authors' page; the PDF text I could read does not print it.")
w("- **2022 paper:** it is an IEEE Security & Privacy *magazine* article (March/April 2022, pp. 31 to 39, doi 10.1109/MSEC.2021.3132398). The \"2021 IEEE Symposium\" text on the PDF is a running header.")
w("- Every link carried a `utm_source=chatgpt.com` tracking parameter. Removed.")
w("")

# ------------------------------------------------------------ limits
w("## 6. Limits and open questions")
w("")
w("- **Derived, not validated.** The questions come from factors the papers studied. The wording, the order, the branching and the answer-to-rule mapping have not been tested with people. A short pilot would show whether the matrix questions are understood.")
w("- **Biometrics.** The 2017 study found biometric data the most uncomfortable. It is not a separate row because no flow in the four devices' data mentions biometric data. Add a row if a device declares one.")
w("- **Selling.** The core PPD taxonomy cannot express \"sold\". Q4 covers it as \"other companies\" and says so.")
w("- **Retention.** Q6 only bites when a device states that it keeps data forever. Silence is not a conflict.")
w("- **Children.** Q1 only changes the starting choices. It is not a finding of the papers.")
w("- **Rule scopes use core PPD terms.** Whether a PPD household policy can express these scopes this way is a question for the sponsor (Daniel Smullen).")
w("- **Placeholder engine.** The front end evaluates rules itself to make the demo work. The backend should own the comparison.")
w("- **Summaries and warnings (Q7)** are saved with the policy but nothing sends them yet.")
w("")

out = os.path.join(ROOT, "docs", "household-policy-decision-tree.md")
os.makedirs(os.path.dirname(out), exist_ok=True)
open(out, "w").write("\n".join(L) + "\n")
print("wrote", out, "·", len(L), "lines · example A:", counts, "· example B:", len(r2), "rules")
