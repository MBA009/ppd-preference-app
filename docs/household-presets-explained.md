# How `ppd-household-presets` works

A guide to [baktistr/ppd-household-presets](https://github.com/baktistr/ppd-household-presets), the repository that produces the household presets and onboarding questions used by this app. It explains what each step does, why, and which numbers it produced.

**Basis of this guide.** Written from commit `834a0f7` (5 Nov 2026) by reading the README, the notebooks and their saved outputs, `data/parameters.json` and the exported files. The notebooks were not rerun. Statements about what cited papers say, such as Smullen et al. 2020, are the repository's own and were not rechecked here.

> **Everything here rests on synthetic households, not survey data.** Every accuracy figure below measures how well the pipeline reproduces its own simulated households. None measures real people, and the questions have not been user-tested.

## Contents

1. [The short version](#1-the-short-version)
2. [Terms](#2-terms)
3. [Pipeline at a glance](#3-pipeline-at-a-glance)
4. [Notebook 01: the grid of data flows](#4-notebook-01-the-grid-of-data-flows)
5. [Notebook 02: the synthetic households](#5-notebook-02-the-synthetic-households)
6. [Notebook 03: clustering into profiles](#6-notebook-03-clustering-into-profiles)
7. [Notebook 04: profiles into presets](#7-notebook-04-profiles-into-presets)
8. [Notebook 05: the onboarding questions](#8-notebook-05-the-onboarding-questions)
9. [Notebook 06: sensitivity](#9-notebook-06-sensitivity)
10. [Notebook 07: export](#10-notebook-07-export)
11. [How the app uses the output](#11-how-the-app-uses-the-output)
12. [Results](#12-results)
13. [Evidence and assumptions](#13-evidence-and-assumptions)
14. [Known limits](#14-known-limits)
15. [Running and changing it](#15-running-and-changing-it)

## 1. The short version

The repository answers one question: **how can a household get a sensible privacy policy from a few questions, before it owns a device?**

1. List every kind of data flow the PPD taxonomy can describe (6,272).
2. Simulate 5,000 households deciding on every flow, using effects from published studies plus documented assumptions.
3. Group households that decide alike into 4 profiles.
4. Compress each profile into 30 readable rules, called a preset.
5. Learn a decision tree that places a household in a preset from about 6 questions.
6. Use the rest of a 15-question budget on the situations that preset is least sure about, and write each answer into the rules.
7. Export the result as JSON for the app.

The household never sees or chooses a preset. It answers questions and ends up with its own rules, 43 on average.

## 2. Terms

| Term | Meaning |
| --- | --- |
| **Item** or **flow** | One combination of data type, purpose, action, source and handling context. There are 6,272. |
| **Cell** or **situation** | One combination of data type, purpose and handling context. It covers 28 items (4 actions × 7 sources). There are 224 cells, of which 105 are asked about. |
| **Handling context** | Where the data goes: the household, the vendor (maker), a third party, or the public. |
| **Decision** | What a household says about one item: `deny`, `allow`, or `allow_if` a condition. |
| **Profile** | A cluster of households, plus the most common decision and agreement level on every item. |
| **Preset** | A profile compressed into non-overlapping rules. |
| **Leaf** | An end point of the decision tree. There are 57, and each names a preset and an ordered list of follow-ups. |
| **Grade** | How well a number is supported: **A** smart-home study with an exact term match, **B** looser match, **C** other domain or a conversion, **D** the team's assumption. |

Study abbreviations used in the notebooks: A18 (Apthorpe 2018), N17 (Emami-Naeini 2017), Z21 (Zhang 2021), S20 (Smullen 2020), L16 (Liu 2016).

## 3. Pipeline at a glance

```
01 items            6,272 flows, 224 cells, 88 real device flows
      │
02 households       5,000 households × 6,272 decisions, plus answers to 114 candidate questions
      │
03 clustering       profiles for k = 2…24, and which k are stable and distinct
      │
04 presets          each profile compressed to a set number of rules
      │
05 onboarding       decision tree and follow-ups; chooses k = 4, depth 6
      │
06 sensitivity      reruns 02–05 on seven changed sets of assumptions
      │
07 export           export/presets.json, export/onboarding.json
      │
ppd-preference-app  public/mock/household-presets.json, public/mock/onboarding.json
```

All code lives in the notebooks. Each ends its steps with `assert` checks, so running the notebooks is the test suite. `decisions.json` records the chosen k and depth.

## 4. Notebook 01: the grid of data flows

**Output:** `data/items.csv`, `data/corpus/flows.csv`, `device_classes.csv`, `device_fit.csv`

**Why 6,272.** A PPD rule names exactly one value per core field, and a policy should not hold two rules with the same fields and different effects (protocol-04 §7.11). So one decision per combination is exactly the granularity a policy can express:

| Field | Terms |
| --- | --- |
| Data type | 7 |
| Purpose | 8 |
| Action | 4 |
| Source | 7 |
| Handling context | 4 |

7 × 8 × 4 × 7 × 4 = **6,272**.

**Conditions are not columns.** Qualifiers refine a decision rather than identify a flow, so `allow_if:retention=ppd:ephemeral` is one rule: `allow` plus a constraint. Retention can apply to any action. Processing boundary (`inHomeOnly`, `onDeviceOnly`) applies only to use and inference. Jurisdiction is not modelled.

**Plausibility flag.** Public audience only makes sense with `transfer`, so 1,176 items are flagged and 5,096 stay plausible. Nothing is removed.

**Real devices.** The 88 researched flows (Aqara 22, LG 19, Level 21, Reolink 26) reduce to only **52 distinct items**, because the taxonomy is deliberately coarse. These 52 are used to report accuracy on flows real devices declare.

**Device classes.** PPD has no device field, so classes (camera, lock and entry, thermostat and sensors, voice assistant, TV and media, light and plug, appliance) exist only inside the household model. They make a household slightly more accepting of the cells its devices need, but never become a column.

## 5. Notebook 02: the synthetic households

**Output:** `data/parameters.json` (committed), `households.csv`, `answers.csv`, `questions.json`, `decisions.npy`, `DATACARD.md`

This is the core of the repository, and it has four parts.

### Part A: from studies to parameters

Studies use their own vocabularies, so `references/crosswalk.csv` first maps 65 study terms onto PPD terms, each with a match type. 36 of them are used as effects. Then, per field:

1. Take each study's effects on the log-odds of allowing, as a difference from a shared baseline term.
2. Average the levels that map to the same PPD term, within the study.
3. Average across studies, each counting once.
4. Grade the result by its best source.

Apthorpe reports acceptability on a −2 to +2 scale, so one point is converted to 1.4 log-odds (`KAPPA`, grade C).

| Purpose | Effect | Grade | | Data type | Effect | Grade |
| --- | --- | --- | --- | --- | --- | --- |
| Core functionality | 0 | B | | Sensor | +1.46 | A |
| Security | −0.76 | B | | Device and network | +1.46 | D (= sensor) |
| Notifications | −1.05 | D | | Usage | +0.07 | A |
| Diagnostics | −1.32 | A | | Location | 0 | A (baseline) |
| Legal compliance | −1.35 | D | | Identifier | −0.01 | B |
| Analytics and improvement | −1.69 | B | | Profile | −0.01 | D (= identifier) |
| Personalization | −2.25 | D | | Content (video, audio) | −0.31 | A |
| Advertising | −2.85 | A | | | | |

Handling context: household 0, vendor −1.44, public −1.57, third party −1.73.

### Part B: the decision model

Each household decides each item with a mixed-effects logistic model:

```
η = β0 + β_type[t] + β_purpose[p] + fit[t,p] + w[a]·β_context[c] + β_action[a] + β_source[s]    population effects
      + device fit, if a class the household owns needs this cell
      + facts (devices, age, children) + concern
      + concern-type penalty, if the household guards this data type × purpose
      + S · ( b0 + b_purpose[p] + b_type[t] + w[a]·b_context[c] + b_type×purpose[t,p] )         household effects

u = η + τ · ( √ρ · noise[household, cell] + √(1−ρ) · noise[household, flow] )
```

| Part | What it does |
| --- | --- |
| `w[a]` | How much of the context effect an action carries: use 0.6, the others 1 (grade D). |
| Household effects | Normal draws per household. Standard deviations: overall 0.6, per purpose 0.4–1.2 (highest for ads), per data type 0.6, per context 0.6–0.8, per data type × purpose 0.4 (all grade D). |
| Facts | Devices +0.1 per band (C), age −0.05 per band (D), children −0.3 on content and location (D). |
| Concern | −0.6 × (concern − 0.5). Small, because S20 found concern scales were not predictive. |
| Noise | Half shared within a cell and half per flow. The per-flow part is the same across contexts, so a household rarely allows a third party what it denies the maker. |

**From `u` to a decision:**

1. `u ≥ 0`: `allow`.
2. Otherwise, try each condition in turn: not kept (flows leaving the home only), then in-home only, then on-device only (use and inference only).
3. Otherwise: `deny`.

Conditions end up on about 5.5% of decisions.

**Concern types.** Each household has one primary concern (recordings, whereabouts, identity, habits, telemetry, or none) and a 30% chance of a weaker second one. A concern lowers acceptance of its data type × purpose cells, fully when data leaves the home and by a third inside it. For example, *recordings* covers content used for personalization, notifications, diagnostics, analytics, legal duties and ads. Sizes and shares are grade D. This is what lets households differ in *what* they guard rather than just *how strict* they are.

**Calibration.** Three numbers are fitted instead of being taken from studies:

| Number | Fitted value | Target | Source |
| --- | --- | --- | --- |
| β0, overall level | 1.984 | 47% of flows leaving the home accepted | N17 |
| S, scale of household differences | 0.851 | Population majority fits 78% of decisions | N17 |
| τ, decision noise | 0.223 | Redrawing noise changes 5.1% of decisions | L16 |

**Worked example**, using population effects only, before household effects, facts and concerns:

| | Security camera video sent to the maker for ads | Temperature reading collected at home so the device works |
| --- | --- | --- |
| Terms | content, advertising, transfer, vendor, device-generated | sensor, core, collection, household, device-observed |
| β0 | +1.98 | +1.98 |
| Data type | −0.31 | +1.46 |
| Purpose | −2.85 | 0 |
| Data type × purpose fit | −0.50 | +0.50 |
| Context | −1.44 | 0 |
| Source | −0.05 | −0.15 |
| **Total** | **−3.17** | **+3.79** |

The first needs a household effect far above average to reach `allow`. The second is allowed unless a household is well below average. Most interesting differences between households sit between these extremes.

### Part C: answers to candidate questions

The tree needs answers to learn from. Each household answers **114 candidates**:

| Kind | Count | Answer comes from |
| --- | --- | --- |
| Situations | 105 | Its own accepted share in that cell, plus noise |
| Real-device flows | 6 | Its own decision on that flow, with a chance of slipping to another answer |
| Facts (devices, size, age) | 3 | The fact itself |

For a situation:

```
score = share of the cell's plausible items accepted + noise
noise = Normal(0, 1) × (0.05 + 0.10 × (1 − literacy))

score < 0.3  →  No
score > 0.7  →  Yes
otherwise    →  Not sure
```

The 0.3 and 0.7 cut points are the team's assumption. Of 224 cells, only the **105 "realistic" ones** become questions: the maker for any purpose except legal duties, other companies for analytics, ads, personalization or diagnostics, and the home for core features, personalization, security or alerts. Public disclosure and legal duties are never asked about.

### Part D: checks against the studies

The notebook reruns study contrasts on the synthetic households, requiring the same sign on every clear contrast and a similar order of terms. Rank correlations are data type 0.68, purpose 0.97 and handling context 1.0. Data is reproducible: the same notebooks and seed give the same SHA-256 hash of the decisions.

## 6. Notebook 03: clustering into profiles

**Output:** `data/profiles/` for k = 2…24, including `quality.csv`

| Smullen et al. 2020 | This repository |
| --- | --- |
| Agglomerative hierarchical clustering | **k-means** on 224 cell averages. Ward and average linkage are compared, and Ward was unstable. |
| 10-fold cross-validation | 5-fold, to keep the run to about a minute |
| No consensus at 80%: ask the user | **The profile must still decide** (no asking), with fallbacks compared |

**Building a profile.** Cluster training households, then record each item's most common decision and the share who made it. A test household joins the profile with the closest cell averages by Manhattan distance. This uses its full decisions, so it's an upper bound on what questions can achieve.

**Measures.** *Accuracy* requires an exact match on deny, allow or the specific condition. *Allow/deny accuracy* counts any `allow_if` as allow. *Coverage* is the share of items where a profile reaches 80% agreement.

| k | Accuracy | Allow/deny | Coverage |
| --- | --- | --- | --- |
| 1 | 75.1% | 77.2% | 42.6% |
| 2 | 78.7% | 81.1% | 53.2% |
| 4 | 80.1% | 82.4% | 58.1% |
| 10 | 81.1% | 83.5% | 60.8% |
| 24 | 81.8% | 84.3% | 63.4% |

Returns diminish quickly. Most of the possible gain arrives by about k = 4 to 12.

**Well-defined profiles.** A k only counts if both tests pass:

- **Stable:** every profile's bootstrap Jaccard overlap is at least 0.75 across 20 resamples (Hennig 2007).
- **Distinct:** every pair of profiles differs on at least 10% of items.

| k | Lowest stability | Stable profiles |
| --- | --- | --- |
| 2 | 0.990 | 2 of 2 |
| 3 | 0.967 | 3 of 3 |
| 4 | 0.944 | 4 of 4 |
| 5 | 0.600 | 3 of 5 |
| 6 | 0.618 | 3 of 6 |
| 10 | 0.371 | 1 of 10 |
| 20 | 0.226 | 1 of 20 |

This sharp drop after k = 4 is why the final choice can't exceed 4.

## 7. Notebook 04: profiles into presets

**Output:** `data/presets/`

A profile is 6,272 decisions, which nobody can read. Each becomes a short rule list in three steps.

1. **Fill the gaps.** Items below 80% agreement take the profile's majority decision (`FALLBACK = "majority"`). The alternatives were *home/away* (allow only inside the home) and *strict* (deny). Majority was the most accurate, but this is partly a privacy choice as well as a statistical one.
2. **Compress.** A decision tree over the five fields predicts each item's decision. Each leaf is a block of combinations, which is exactly a rule scope, and leaves don't overlap, so one rule decides each flow.
3. **Keep rules valid.** A leaf mixing use or inference with other actions is split so that a processing-boundary condition only sits on actions it's valid for.

**How many rules.** Counts from 5 to 160 are tried, and the knee of the curve is chosen (Kneedle). For k = 4 that's **30 rules**, with 97.2% fidelity to the profile. The rule count doesn't change what devices receive in principle, since the compiler sends one atomic rule per declared flow. It changes how closely a household's rules follow its profile and how long the rules page is.

**The four presets:**

| ID | Internal name | Allows | Households |
| --- | --- | --- | --- |
| `k4-p0` | Strict · no fixing problems or legal duties | 22% | 19% |
| `k4-p1` | Strict · no product improvement or personalization · OK with features | 41% | 35% |
| `k4-p3` | Careful · no ads · OK with security and device details | 60% | 31% |
| `k4-p2` | Relaxed · OK with legal duties and fixing problems | 82% | 15% |

The profiles are mostly strictness levels. Preferences about specific combinations come in through the follow-ups. **None of the exported rules carries a condition**, even though the model produces conditional decisions: they don't survive compression at this k.

## 8. Notebook 05: the onboarding questions

**Output:** `data/onboarding_tree.json`, `reports/`

### Stage 1: the tree

A `DecisionTreeClassifier` learns to predict a household's preset from its answers, encoded in order (No < Not sure < Yes).

| Setting | Value | Why |
| --- | --- | --- |
| `max_depth` | 6 (chosen) | At most 6 questions on a path |
| `min_samples_leaf` | 25 | No preset is chosen from a handful of households |
| `class_weight` | balanced | Small profiles still get splits |
| Candidates | 114 | The tree picks; nobody curates |

Two ways of choosing a leaf's preset are compared: the most common *cluster label*, and the *best match* to the leaf's households' decisions.

The final tree has **57 leaves and uses 37 distinct questions**. Each path asks about 6. No household fact (devices, size, age) is ever used, so the three facts add nothing. Of 56 splits, 27 group Not sure with No and 29 group it with Yes, so Not sure doesn't consistently lean one way.

The first question is *usage data × notifications × maker*. It then branches to *sensor data × diagnostics × other companies* after No or Not sure, or to *identifier data × analytics × other companies* after Yes.

### Stage 2: follow-ups

The remaining budget (15 minus stage 1, so about 9) goes to the situations the leaf is least sure about. For each leaf:

```
q      = weighted average acceptance of each cell, across the leaf's two most likely profiles
unsure = 1 − |2q − 1|
```

`unsure = 1` means households like this split 50/50, and `0` means they all agree. Situations already asked on the path are skipped. A *Not sure* answer leaves the preset's decision alone.

### Choosing k and depth

A (k, depth) pair is eligible only if:

1. Its profiles are well defined (section 6).
2. Every preset is used in every cross-validation fold.
3. Each profile's held-out households get their own preset at least 50% of the time.
4. No path asks more than 12 questions.

59 of 264 combinations qualify. Among them, the highest match on all items after follow-ups wins, and within 0.1 points fewer questions wins. The result is **k = 4, depth 6**.

### Placement quality

The right preset reaches **64%** of households. That sounds low, but the preset given agrees with their own profile's preset on **97% of real-device flows**, because the presets are similar on the flows real devices declare.

### Past the cap: refining

"Help me refine my settings" has no cap. Each leaf exports its full queue of 105 situations, most unsure first. The app reports a "good picture" once everything left is under `stop_unsure = 0.3`, meaning households like this agree at least 85/15. That takes 43 follow-ups on average and lands within half a point of answering everything.

### Robustness to careless answers

| Answers replaced at random | Match, all flows | Match, real flows |
| --- | --- | --- |
| 0% | 78.6% | 89.1% |
| 10% | 78.1% | 88.8% |
| 20% | 77.4% | 88.6% |
| 30% | 76.9% | 88.5% |
| One preset for everyone | 73.9% | 87.9% |

These are stage 1 figures. Removing household facts changes nothing.

## 9. Notebook 06: sensitivity

Reruns notebooks 02–05 with seven changed sets of grade C and D assumptions:

| Variant | Chosen k | Depth |
| --- | --- | --- |
| Base | 4 | 6 |
| Concern weight ×0.5 | 4 | 7 |
| Concern weight ×1.5 | 4 | 5 |
| Household spreads ×0.5 | 4 | 6 |
| Household spreads ×1.5 | 3 | 5 |
| Study effects ×0.75 | 4 | 6 |
| Study effects ×1.25 | 4 | 6 |
| No data type × purpose fit | 4 | 6 |

In every variant the data keeps the studies' directions, k = 2, 3 and 4 are the only well-defined options, and the 15 questions beat one preset for everyone by 5.6 to 6.4 points on all flows.

Three things to read carefully:

- A few internal checks fail in some variants (concern ×1.5, spreads ×0.5, effects ×0.75, no fit). They're recorded rather than fatal.
- The README notes that k = 3 versus 4 is a near-tie that can flip between runs.
- Every variant changes the *size* of effects, not the *shape* of how households differ. See [section 14](#14-known-limits).

## 10. Notebook 07: export

**Output (committed):** `export/presets.json`, `export/onboarding.json`, `export/onboarding-tree.svg`

**`presets.json`** holds the 4 presets. A rule looks like this (lists shortened):

```json
{
  "id": "k4-p0-r0",
  "effect": "dont_allow",
  "condition": null,
  "scope": {
    "data_type": ["ppd:contentData", "ppd:identifierData", "..."],
    "purpose": ["ppd:advertisingAndMarketing", "..."],
    "handling_context": ["..."]
  }
}
```

A missing field in `scope` means any value. Each preset also records `internal_name`, `description`, `accepted_share`, `households_share` and `reached_by_onboarding`.

**`onboarding.json`** holds:

| Key | Contents |
| --- | --- |
| `splash`, `follow_up_intro` | Intro text |
| `questions` | The 105 situations: prompt, options, data type, purpose, context, examples per device class |
| `root` | The tree. A node has `question` and `branches`; a leaf has `preset`, `follow_up_budget`, `follow_ups`, `queue` |
| `walk`, `rules`, `refine`, `rerun` | Plain-language instructions for how to use all this |
| `stop_unsure` | 0.3 |
| `source` | Provenance and cross-validated results, marked as synthetic |

A queue entry looks like `{"question": "cell_…", "unsure": 0.976, "accept": 0.488}`.

**Writing answers into rules.** A situation is a block of 28 flows. When a Yes or No disagrees with the rule covering it, that rule is split into at most three pieces (the other data types; this data type with other purposes; this data type and purpose with other contexts), and a new rule holds the answer. Rules never overlap, so no rule has to outrank another. Households end with 43 rules on average and at most 66, about 10 of them from answers.

**Checks.** The notebook reads its own exported files as the app would, and confirms that the rules reproduce each preset exactly, that writing answers matches notebook 05's result, that exactly one rule decides every flow, and that every term and condition is valid PPD.

## 11. How the app uses the output

| Presets repository | App |
| --- | --- |
| `export/presets.json` | `public/mock/household-presets.json` (byte-identical at this commit) |
| `export/onboarding.json` | `public/mock/onboarding.json` (byte-identical at this commit) |

The files are copied by hand, and [shared/onboarding.ts](../shared/onboarding.ts) does the rest:

1. **Stage 1:** walks the tree, reusing an answer if a question comes back.
2. **Stage 2:** asks the leaf's follow-ups up to the budget.
3. **Rules:** copies the preset and writes in the answers.

**Wording now differs from the export.** In the app's working copy, as of this guide, question text and examples come from `questionText` in [shared/onboarding.ts](../shared/onboarding.ts), following the week 10 meeting. They use the exported `prompt` only as a fallback. Changing the wording in notebook 02 therefore no longer changes what people see, though the tree, presets, follow-ups and rules still come from the export. This change wasn't committed when this guide was written.

## 12. Results

| Stage | All 6,272 flows | Real-device flows |
| --- | --- | --- |
| One preset for everyone | 73.9% | 87.9% |
| After stage 1 (about 6 questions) | 78.6% | 89.1% |
| **After stage 2 (15 questions)** | **80.3%** | **90.0%** |
| Good picture (about 43 follow-ups) | 82.9% | 93.1% |
| Every situation (about 99 follow-ups) | 83.4% | 93.9% |

These are cross-validated on held-out **synthetic** households. Exact match is required, so a wrong condition counts as wrong.

Each answer settles 28 flows, so even answering all 105 situations settles about 2,900 of 6,272. The rest keep the preset's decision unless the person writes a rule.

## 13. Evidence and assumptions

`data/parameters.json` holds 140 graded values:

| Grade | Count | Examples |
| --- | --- | --- |
| A | 9 | Ads, diagnostics, sensor, content, location, usage, vendor, device fit |
| B | 9 | Security, analytics, identifier, third party, public, inference, ownership, "not kept" |
| C | 4 | `KAPPA`, device step, concern weight, starting noise |
| D | 118 | Household spreads, concern types, fit table, action weights, sources, ownership shares |

The D count is inflated by long tables: 56 fit-table entries are one assumption repeated per pair. Even so, the main population effects are largely evidenced, while **how households differ from each other is largely assumed**. That second part is what clustering works on.

Three main effects are worth noticing as assumed: personalization, notifications and legal duties. The first question in the tree is about notifications.

## 14. Known limits

**From the repository's own README:**

- A decision holds one condition, while a PPD rule can carry several.
- Jurisdiction isn't modelled.
- Matching "in-home only" against a declared "on-device only" is left to the compiler step.

**From reading the pipeline:**

- **No real validation.** The questions and presets have never been tested on people. Answers are simulated from the same decisions they're used to predict, plus a small amount of noise, so they're probably easier to predict than real answers, even with the robustness test in section 8.
- **k = 4 may reflect the model.** Household effects are smooth normal draws plus a few concern types, which doesn't form sharply separated groups. The stability test then rejects larger k. Sensitivity varies sizes, not this shape, so it can't test the assumption. The notebooks say to re-derive k once real answers exist.
- **Small gain on real devices.** 15 questions add 2.1 points on real flows against 6.4 on all flows. Clustering uses all 224 cells even though only 105 can be asked about and 52 items are declared by the researched devices.
- **A Yes or No covers more than the sentence says.** One answer sets all 4 actions and 7 sources, including inference, while the question only says "share" or "use".
- **Implausible situations can be selected.** The tree optimizes separation, not believability, so it can choose pairs such as account details used for security.
- **No retention question.** The model has conditions and the rules can carry them, but no question asks about retention, and no exported preset rule uses a condition.
- **Mobile-app evidence is indirect.** Several assumptions lean on mobile-permission studies, not smart-home ones.

**Out-of-date text in the repository at this commit:**

- Notebook 03's commentary still calls k = 10 "the team's k".
- The README quotes old question wording and links plans in a `docs/` folder that isn't in the repository.
- `references/README.md` says the Zhang 2020 report (CMU-ISR-20-114) was not found online, but it's available from the [CMU reports archive](http://reports-archive.adm.cs.cmu.edu/anon/isr2020/CMU-ISR-20-114.pdf).

## 15. Running and changing it

Needs Python 3.11+ and [uv](https://docs.astral.sh/uv/).

```bash
make setup       # creates .venv
make notebooks   # runs every notebook in order and its checks
make lab         # opens Jupyter Lab
```

The Makefile uses `.venv/bin/` paths, so on Windows it probably needs WSL. `data/` is generated and mostly gitignored, except `parameters.json`, `data/corpus/` and `data/sample/`, while the PDFs in `references/` are kept locally only.

| To change | Edit | Then rerun |
| --- | --- | --- |
| A study effect or assumption | Part A of notebook 02 | 02–05, 07 |
| How households differ | Parts A and B of notebook 02 | 02–05, 07, ideally 06 |
| Which situations can be asked | `REALISTIC` in notebook 02 | 02, 05, 07 |
| Stability or distinctness thresholds | Settings in notebook 03 | 03–05, 07 |
| Gap-filling behaviour | `FALLBACK` in notebook 04 | 04, 05, 07 |
| Question cap | `TOTAL_QUESTIONS` in notebook 05 | 05, 07 |
| Intro text | Notebook 07 | 07 |

If the choice of k or depth changes, notebook 05 stops until `decisions.json` agrees, which is deliberate: update the file and rerun 03–05.

After any rerun that changes the export, copy both JSON files into `public/mock/` in the app. Answers saved by existing households may not fit a changed tree.
