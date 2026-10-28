# Evaluation and measured scope

These are actual local engineering checks, separate from planned research. No participant study, accessibility-specialist review, VoiceOver/NVDA validation, matched-agent comparison or locked holdout evaluation has been completed. No improvement over another method is claimed.

## Development protocol

Six authored React applications use fictional appointments and four component implementations: date picker, combobox, modal wizard and asynchronous availability. Northstar International shares the Northstar Care calendar; Riverside Evening shares the Riverside Support combobox. **Six variants are not six independent codebases.**

Each original and separately compiled handcrafted reference receives the same enabled contract and protected service. The verifier uses actual keyboard input, reads actual focus and service records, and checks the requested/displayed/stored date. Candidate source cannot edit this verifier. ARIA snapshots are DOM evidence, not a screen reader's output.

The nine default checks are keyboard reachability, selection/recovery, focus restoration, required-field protection, unavailable-date rejection, exact saved outcome, confirmation focus, Escape cancellation and error semantics. A result passes only when all enabled checks pass. Environment failures are not successful repairs.

## Measured fixture sweep

The 28 October 2026 sweep completed at **06:10 UTC** ran original/reference source for all six variants with verifier **passage-browser-v3**, headless Chromium **156.0.8078.4**, macOS arm64, Node **22.22.3**. Each run records its own source and build identity.

| Fixture | Family | Original | Handcrafted reference | Reference checks |
|---|---|---|---|---|
| Northstar Care | Date picker | Blocked; no booking | Selected date saved | 9 / 9 |
| Riverside Support | Combobox | Blocked; no booking | Selected date saved | 9 / 9 |
| Atlas Learning | Modal wizard | Review blocked; no booking | Both steps completed; date saved | 9 / 9 |
| Civic Advice | Async validation | Recovery blocked; no booking | Recovered from actual server rejection; date saved | 9 / 9 |
| Northstar International | German calendar | Blocked; no booking | Selected date saved | 9 / 9 |
| Riverside Evening | Long-label combobox | Blocked; no booking | Selected date saved | 9 / 9 |

Denominator: **6 original runs and 6 reference runs**. All six originals failed; all six references passed. This validates fixture/verifier execution and is **not an AI repair-rate estimate**. The compact measured record is [the timestamped v3 sweep](evaluation-results-2026-10-28T061041Z-v3.json). The [05:40 UTC v2 sweep](evaluation-results-2026-10-28T054015Z-v2.json) and [05:20 UTC initial sweep](evaluation-results.json) remain unchanged as historical evidence.

```sh
npm run verify:fixtures
npm run verify:fixtures -- civic-assistance combined
```

Full local reports, screenshots, traces and receipts are written under `.passage/reports/` and excluded from Git. The UI can independently start fresh runs and export per-run evidence.

## Challenges and adversarial checks

Six public scenarios exercise standard conditions, an unavailable first date, 900 ms validation, long labels, German labels, and their combination. The locale challenge changes the host shell and date choices; fixed controls in authored widgets can remain English. It tests task robustness under those label changes, not complete translation quality. Results record actual conditions, seed, source, contract and environment. These are **development challenges**, not untouched holdouts.

The automated suite rejects a plausible keyboard-operable repair that saves another valid date. It also checks original failure, repaired execution under combined conditions, source-scope attacks, tampered bundles, protected business invariants, cancellation, restart recovery, stale contracts, hostile origins, malformed/truncated model output, and capture digest/binding/deletion behavior.

The independent application walkthrough completed a reference repair with 9/9 checks, then a combined challenge with 9/9 against the same candidate digest. The saved date changed from November 16 to November 17 because the first date became unavailable. Human validation remained pending.

## Provider compatibility

The first live Nemotron call returned a length-limited response: **4,102 input / 6,000 output tokens, 97.414 seconds, $0.00168612**. It was rejected without execution and remains in the persistent ledger. Primary provider/model guidance confirmed the non-reasoning request option for concise JSON output. Subsequent measured live outcomes belong to their actual receipts; reference success is never substituted.

The broker allows at most three candidate attempts per loop. The validated Nebius Super/Lightning profiles use 6,000 completion tokens per request and a 120-second timeout; the separately authorized development profiles below use larger bounds. Actual/unknown usage is preserved. A fair comparison would require identical tool/time/token budgets and repeated case-level trials; none has been run.

### Verifier correction, with history preserved

Development exposed an adapter limitation and a false-negative timing bug. A legitimate `ref.current.querySelectorAll` focus pattern was initially rejected by a broad denylist. The adapter now permits only declared local React-ref descendant queries with literal selectors, covered by global/ancestor/alias/dynamic negative tests. Separately, the initial verifier read a calendar selection after 35 ms even when a valid handler awaited a 120 ms response. Verifier `passage-browser-v2` waits for the intended state within a bounded scenario-aware timeout; a delayed-calendar regression reproduces this case.

The retained Super candidate with source digest `b01733747668b1c3eb3089bc1a63aad8f611a383ff9f5f7a86764c311d1a2326` was re-executed under combined German/long-label/delayed/unavailable-first conditions. It passed **9/9** and saved November 17. That audit made no model request and did not overwrite the historical rejected run. An independent manual keyboard walkthrough of the same build completed, but it is developer QA, not a participant trial. The history distinguishes invalid candidates from checks affected by earlier verifier limitations.

Before fresh family validation, the ledger contained ten actual requests costing **$0.02341704**: one truncated Lightning response, three further Lightning candidates, three Super candidates rejected by the initial query guard, and three Super candidates evaluated by the initial timing logic. The final candidate in the last group is the exact source revalidated above. These development attempts are not a benchmark denominator and remain in the history.

Verifier **passage-browser-v3** then closed a distinct false-acceptance gap: a widget could commit a date on opening or focus, leaving the expected value present before Enter. V3 captures the protected value before opening, checks Escape against that original value, and requires the intended value to be uncommitted before keyboard activation. Two negative browser tests can save the expected date yet correctly fail the interaction contract. Existing positive roving-focus, delayed-selection and recovery cases still pass.

The four accepted Nebius Super sources and the first two accepted Fireworks Ultra sources were recompiled from their exact retained source and rechecked with v3 under baseline and combined conditions. **All twelve rechecks passed 9/9**, with no inference call and no mutation of historical acceptance. The [versioned source-revalidation record](live-source-revalidation-2026-10-28-v3.json) retains original generation receipts, historical verifier versions and new build/check identities. The app's evidence report and challenge details display their actual verifier version.

## Live Nebius validation across four families

After the verifier correction, actual **NVIDIA Nemotron 3 Super** source repairs were generated for one authored application in each interaction family. Each final source was independently built, passed the nine enabled checks, and then passed those same checks under the combined challenge. No handcrafted reference was substituted for a model result.

| Family | Model requests in this validation | Final candidate | Combined challenge | Saved date: standard / combined |
|---|---|---|---|---|
| Date picker | 1 | 9 / 9 | 9 / 9 | November 16 / 17 |
| Combobox | 2 | 9 / 9 | 9 / 9 | November 16 / 17 |
| Modal wizard | 3 rejected, then 1 in an explicit retry | 9 / 9 | 9 / 9 | November 16 / 17 |
| Async validation | 3 rejected, then 1 in an explicit retry | 9 / 9 | 9 / 9 | November 17 / 18 |

The wizard's rejected source attempted to focus a nonfocusable container; Escape therefore did not reach its panel handler. The async source retained a mouse-only retry control. Prompt v5 supplies the previous source, diff, observed browser trace and public failures together, with native-action and focus-transition guidance. Both fresh retries passed on their first candidate. The verifier's acceptance criteria were unchanged for these retries. Each loop remains limited to three requests; an explicit retry is a new recorded run. The async case genuinely recovers from a late server rejection and saves the next available date.

These are **development cases with feedback-driven prompt improvements**, not a held-out repair-rate estimate. The validation used eleven model requests across six recorded runs, including the two failed parent runs. Combined challenges reuse each accepted source digest and make no additional inference request. Independent manual keyboard QA used the separately revalidated earlier Super calendar source described above; the fresh date-picker repair was initiated and challenged through the app UI.

The complete development ledger contains **21 requests**, **133,352 input / 26,777 output tokens**, and an estimated **$0.05358294** at verified uncached token rates. All usage is known; no uncertain reservations remain. Four Lightning requests account for $0.00336984 and seventeen Super requests for $0.05021310. These are usage-based estimates, not a provider invoice. The [live validation record](live-validation-results-2026-10-28.json) contains all family attempts, failed development runs, exact digests, prompt versions, request receipts, checks, outcomes and the complete usage ledger.

## Fireworks Ultra development validation

After explicit authorization for paid development on Fireworks/Together, **NVIDIA Nemotron 3 Ultra** on Fireworks generated actual accepted source for all four families. The exact route is `accounts/fireworks/models/nemotron-3-ultra-nvfp4`. Each accepted source has passed the nine enabled checks under baseline and combined conditions with verifier v3. The wizard and async sources were generated under v2 and rechecked unchanged under v3; their historical acceptance was not rewritten.

| Family | Accepted prompt / output profile | Current v3 baseline / combined | Saved date: standard / combined | Exact public source |
|---|---|---|---|---|
| Date picker | v7 · prompt schema · high requested · 32k / 480s | 9 / 9 and 9 / 9 | November 16 / 17 | [DatePicker.jsx](samples/date-picker/DatePicker.jsx) |
| Combobox | v8 · prompt schema · high requested · 32k / 480s | 9 / 9 and 9 / 9 | November 16 / 17 | [SessionCombobox.jsx](samples/combobox/SessionCombobox.jsx) |
| Modal wizard | v5 · JSON object · high requested · 16k / 240s | 9 / 9 and 9 / 9 | November 16 / 17 | [BookingWizard.jsx](samples/modal-wizard/BookingWizard.jsx) |
| Async validation | v5 · JSON object · high requested · 16k / 240s | 9 / 9 and 9 / 9 | November 17 / 18 | [AvailabilityControl.jsx](samples/async-validation/AvailabilityControl.jsx) |

The full history contains **15 Fireworks requests**, not only the four accepted responses:

| Profile | Requests | Observed outcome |
|---|---|---|
| v5, high / 16k / 240s, `json_object` | 4 | Wizard and async accepted; date output failed schema validation; combobox output reached its token limit |
| v6, high / 32k / 480s, `json_object` | 6 | Five sources rejected by unchanged syntax constraints; one date response reached its token limit |
| v7, high / 32k / 480s, schema in prompt | 4 | Date accepted on its first fresh attempt; three combobox sources rejected for unsupported loop/index syntax |
| v8, high / 32k / 480s, schema in prompt | 1 | Combobox accepted on its first fresh attempt after precise capability guidance |

V7 omitted the `response_format` field while retaining the full JSON schema in the prompt and strict local parsing. It also clarified supported React ref/index patterns. V8 explicitly prohibited replacing one unsupported loop with another; source diagnostics now identify the operation, line and bounded expression and explain permitted alternatives. **Source-guard predicates and verifier acceptance criteria were not weakened.** This was feedback-driven protocol/prompt development, not a controlled comparison. The earlier malformed/truncated outputs are observed failures; attributing them specifically to JSON-object mode would be an untested hypothesis. [Fireworks' structured-output documentation](https://docs.fireworks.ai/structured-responses/structured-response-formatting) warns specifically about `json_schema` and recommends a schema in the prompt when reasoning and JSON are both needed.

The first malformed date and truncated combobox final payloads predated diagnostic capture and were not retained. Later failures preserve bounded final-content digests and schema diagnostics. Provider `reasoning_content` fields are excluded; unexpected explanatory prose can still appear in malformed `message.content`, so no claim is made that final-content diagnostics are semantically free of reasoning. The public evaluation record contains metadata and error summaries, not that prose.

The Fireworks application ledger records **107,301 input / 98,106 output tokens**, estimated **$0.299835** at uncached rates, with no unknown usage. This excludes separate orchestrator compatibility/visual-review probes outside Passage's application ledger. The [complete Fireworks validation record](live-fireworks-validation-2026-10-28.json) preserves every recorded request and rejected attempt with the actual provider/profile/version. Together's application ledger remains empty; its transport was separately qualified, not used to claim a Passage repair. Nebius's earlier 21-call ledger is unchanged. Nebius Ultra completion qualification remains pending for final submission.

The wizard and v7 date sources also completed independent manual keyboard journeys under combined conditions. Those observations are developer QA, not participant or assistive-technology study data. These public fixtures and iterative retries are not a held-out repair-rate estimate.

### Reproduce without the original local database

The [public generated-source examples](samples/README.md) preserve all four accepted JSX files byte for byte alongside sanitized receipts and historical checks. `npm run verify:source` accepts a matching authored fixture, bounded source file, public scenario and optional expected digest. It uses a fresh protected default contract, its own ephemeral loopback host and the same browser verifier, without API credentials, inference or the original runtime database.

The date example was independently replayed from a fresh copy of only prospective public repository files, with no `.env` or `.passage` history and credentials removed from the child environment. It passed the combined challenge **9/9** under v3. Digest mismatch and oversized-file rejection were also checked. Replays record new contract/build/environment identities rather than claiming historical custom-contract reproduction.

## Final local quality gates

- `npm test`: **63 tests passed** across five files, including real Chromium execution, provider isolation, format correction, reasoning-field exclusion, precise source diagnostics and negative acceptance cases.
- `npm run build`: TypeScript validation and production UI build passed.
- `npm run test:e2e`: **2 tests passed**, covering the full reproduce → reference repair → challenge → manifest/ZIP download workflow, responsive layout, automated accessibility checks and settings persistence.
- `npm audit`: **0 vulnerabilities** after the final dependency update.
- Independent browser review checked the live date repair, keyboard completion, combined challenge, portable archive integrity, responsive product pages, rejected-candidate presentation and restart recovery. These observations remain developer QA.

## Human and final-study requirements

The product accepts consented, bound operator notes or actual speech-viewer transcripts. Those are operator-attested, without independent review or automatic verification of the human session's backend outcome. Synthetic QA notes do not count as participant observations.

A later study requires consenting participants using familiar AT, exact environment versions, an independent specialist, counterbalanced tasks, time/intervention measurements, failures in the denominator and an untouched application/family split. The planned 60-case evaluation and 12–16 participant study remain unperformed.

Passage's own automated accessibility scans, responsive checks and keyboard walkthrough are engineering gates. They do not replace actual screen-reader/human review or establish universal WCAG compliance.
