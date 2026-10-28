# Passage

**Every journey deserves a way through.**

Passage turns a blocked keyboard interaction into a source repair with inspectable evidence. Reproduce the barrier, review an interaction contract, generate a scoped React change with **NVIDIA Nemotron on Nebius Token Factory**, and let an independent browser verifier attempt the task against a protected appointment service.

This is a working local engineering product for the **Coding and Agentic Engineering** track of the Nebius × NVIDIA Global AI Hackathon. It includes six authored applications, four interaction families, a repair workbench, meaningful challenges, immutable source/build receipts, and a consented human-evidence intake. All appointment data is fictional.

## Run locally

Requires Node.js **22.12 or newer** (tested with 22.22.3), npm, and Chromium. Node's built-in SQLite API is used; its experimental warning is expected on Node 22.

```sh
npm ci
npx playwright install chromium
npm run dev
```

Open [Passage](http://127.0.0.1:4101). The API listens on `127.0.0.1:4102`; isolated application previews use `127.0.0.1:4103`. All three services bind to loopback. The browser helper reuses an existing Playwright Chromium installation when available. An explicit `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` may select an already-installed compatible browser; every verification records its actual version.

For a stable walkthrough without development hot reload, build once and run the production UI with the local API:

```sh
npm run build
npm run demo
```

The default **offline reference mode** needs no credentials. It applies an explicitly labeled, handcrafted source repair, builds that source, and runs the same real verifier. It never presents a reference patch as model output.

To use the actual NVIDIA model, copy `.env.example` to `.env`, supply your Nebius key, and deliberately enable live inference:

```sh
PASSAGE_PROVIDER=nebius NEBIUS_MODEL=nvidia/nemotron-3-super-120b-a12b PASSAGE_ALLOW_LIVE=true npm run demo
```

The server reads credentials in this order: explicit shell environment, project `.env`, then parent `.env` as a fallback. No credential reaches the client or fixture preview. Do not commit either environment file. **Nemotron 3 Super has completed real local repair validation on Nebius.** The command above overrides a different parent-file model without editing that file. The stronger Nebius Ultra route is catalog-supported but still needs real completion qualification before submission; no Ultra result on another provider is presented as Nebius evidence.

For explicitly authorized development, choose Fireworks Nemotron 3 Ultra:

```sh
PASSAGE_PROVIDER=fireworks PASSAGE_ALLOW_LIVE=true npm run demo
```

This uses `FIREWORKS_AI_API_KEY` and the pinned `accounts/fireworks/models/nemotron-3-ultra-nvfp4` route. It requests high reasoning with a 32,000-token response allowance and a 480-second timeout, supplies the output schema in the prompt, and validates returned JSON locally. `FIREWORKS_AI_MODEL` and `FIREWORKS_AI_BASE_URL` may select only supported routes. Together has a separate `TOGETHER_AI_*` configuration. The UI names the selected recipient and distinguishes development from submission. Adding keys never switches providers, and errors never trigger fallback.

Nebius remains the default submission provider and retains its **$2 local admission budget**. Its validated Super/Lightning profiles use 6,000 tokens and 120 seconds; explicitly selecting catalog-listed Ultra uses 16,000 tokens and 240 seconds, with completion qualification still pending. The separately authorized Fireworks/Together development routes have no artificial dollar cap; their calls are still paid and recorded. All routes keep serial execution, bounded attempts, immutable receipts and separate usage ledgers. Unknown usage remains conservative within the affected provider. See [architecture and safety](docs/architecture.md) for the exact model allowlist, pricing and limits.

## Try the complete journey

1. Choose **Try a blocked journey** and consent to capturing the authored, fictional sample.
2. The independent browser reproduces the keyboard failure. Inspect focus events, source mappings, enabled assertions, and the missing business outcome.
3. Review the versioned **Contract**. Required business invariants cannot be removed. A changed contract makes earlier runs stale.
4. Choose **Offline · handcrafted reference patch** or **Live · Nemotron** on the provider named in the interface, then generate a repair. Source validation and an immutable build precede actual keyboard verification.
5. Open the original or repaired application in its own tab. The preview is the actual compiled source, with a fresh isolated session.
6. In **Challenges**, try an unavailable first date, late validation, long labels, German shell/date labels, or all conditions together. Each result stays bound to its source and contract. Fixed widget controls can remain English; this is not a complete translation audit.
7. Inspect the diff and receipt, download the **portable ZIP** (sources, patch, contract, receipts, screenshots, traces, verification JSON and SHA-256 checksums), and reopen the run from **Evidence**. Individual patch and manifest downloads are also available.
8. For an actual consenting participant session, use the bound assistive-evidence form to record the exact environment and import an operator note or actual speech-viewer transcript. Text is content-hashed; imported observations are explicitly unreviewed. They do not automatically become verified human outcomes.

Cancellation preserves finished artifacts and prevents later success writes. Retry creates a new run. Refresh resumes persisted state. A server restart marks unfinished work interrupted instead of fabricating completion.

## What is implemented

| Surface | Working local behavior |
|---|---|
| Journey library | Six authored applications across date pickers, comboboxes, modal wizards, and asynchronous validation |
| Browser evidence | Actual Tab/Enter/Escape actions, active-element checks, screenshots, ARIA snapshots, and persisted business outcomes |
| Source repair | Real server-side Nemotron integration, strict component scope, source diff, bounded retries, failed-candidate preservation |
| Verification | Protected business service and verifier outside the repairable source; wrong-date repairs are rejected |
| Contracts | Typed assertion vocabulary, protected invariants, optimistic versioning, immutable revisions and stale-result handling |
| Challenge studio | Actual re-execution with visible conditions, seed, browser version, source digest and result |
| Local reliability | SQLite WAL, idempotency keys, persisted event stream, cancellation fencing, crash recovery and cost ledger |
| Human evidence | Consent, exact revision/environment binding, one-time text-manifest import, SHA-256 verification, private download, expiry and deletion tombstones |
| Review and export | Candidate history, actual diff, model receipts, portable evidence ZIP, manifest, patch download and explicit limitations |
| Interface | Responsive editorial studio, keyboard controls, focus states, reduced-motion and high-contrast preferences |

## Verification

```sh
npm run typecheck
npm test
npm run build
npm run test:e2e
npm run verify:fixtures
```

The fixture sweep launches a separate preview host on port 4193. To examine a particular sample or scenario:

```sh
npm run verify:fixtures -- civic-assistance combined
```

Replay an [actual generated Ultra source sample](docs/samples/README.md), or candidate JSX extracted from an evidence ZIP, without credentials or the original run database:

```sh
npm run verify:source -- northstar-appointments docs/samples/date-picker/DatePicker.jsx combined fc15b7706c15e8a79454fd81149a58145ce34402ab031f1927b3609c04e41e28
```

This creates a fresh protected default contract and a separate ephemeral preview host. It records the actual source digest, verifier, browser and evidence under `.passage/source-replays/`; it makes no inference request and does not rewrite the historical receipt.

The test suite includes durable-state/idempotency checks, malformed provider output, credit/budget handling, cross-origin protections, source-scope attacks, tampered build artifacts, real browser failure/repaired success, wrong-date false acceptance, UI workflow, responsive overflow checks and automated accessibility checks. No test calls a paid model unless a live call is explicitly initiated outside the deterministic suite.

Actual Nemotron 3 Super repairs on Nebius and Ultra repairs on Fireworks passed the enabled checks and combined challenge for all four interaction families. The [measured evaluation](docs/evaluation.md) preserves failed attempts, protocol/prompt changes, exact receipts, the 21-request Nebius ledger (estimated $0.0536) and 15-request Fireworks ledger (estimated $0.2998). The deterministic suite has 63 passing tests and the UI workflow has 2 passing E2E tests. Public exact-source samples can be replayed without inference. These are engineering checks, **not** a human-impact study or held-out benchmark.

## Scope, privacy, and honest limits

- Actual participant recruitment, specialist review, VoiceOver/Safari and NVDA/Windows validation, and a locked comparative benchmark have **not** been performed. Browser ARIA observations are not recorded screen-reader speech.
- The local adapter accepts only the authored, scoped React interaction components. Arbitrary repository import/build, remote isolation, cloud deployment, and pull-request publication are unavailable. Their absence is shown in the product. No untrusted package scripts or model-selected shell commands execute on the host.
- Local synthetic run artifacts persist under `.passage/` and are excluded from Git. Private assistive text captures have a separate revocable store and expiry policy; deletion cannot recall downloaded copies or external backups. See [privacy](docs/privacy.md).
- Several fixtures share component ancestry. Scenario counts must not be presented as independent applications or people helped. No universal accessibility or WCAG certification is claimed.
- The preview origin, CSP, source checks, network restrictions and protected backend form a limited adapter boundary. This is not a general hostile-code sandbox suitable for arbitrary repositories.

See [architecture](docs/architecture.md), [evaluation](docs/evaluation.md), [implementation ledger](docs/implementation-ledger.md), and [asset notices](NOTICE.md). Authored source and illustrations are [MIT licensed](LICENSE). Private planning files are intentionally excluded from this public project.
