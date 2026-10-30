# Passage

**Every journey deserves a way through.**

Passage turns a blocked task into a reviewed temporal contract, a source repair, and a runnable regression guard. Its Journey Compiler records actual browser events, separates observations from inferred requirements, asks **NVIDIA Nemotron** to inspect and patch bounded React source, and independently replays the frozen requirements.

This is a local engineering product for the **Coding and Agentic Engineering** track of the Nebius × NVIDIA Global AI Hackathon. The compiler supports authored appointment journeys and an isolated, fixed-dependency external React adapter. A real TodoMVC edit repair and an unchanged react-modal sound control use the same generic interpreter. The original six authored applications and four-family repair studio remain available. All task and appointment data in the development evidence is fictional.

Read the [current upgrade evidence and limits](docs/journey-compiler.md) before interpreting a passing check as broader accessibility acceptance.

For a short presentation from the prepared workspace, follow the [three-minute demo walkthrough](docs/DEMO.md).

## Run locally

Requires Node.js **22.12 or newer** (tested with 22.22.3), npm, and Chromium. Node's built-in SQLite experimental warning is expected on Node 22.

```sh
npm ci
npx playwright install chromium
npm run dev
```

Open [Passage](http://127.0.0.1:4101). The API uses `127.0.0.1:4102`, the original authored preview host uses `127.0.0.1:4103`, and repository artifacts use `127.0.0.1:4104`. The compiler has a separate ephemeral loopback fixture port; saved capture links resolve its current origin after a restart. `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` can select an installed compatible browser.

For a stable walkthrough without hot reload:

```sh
npm run build
npm run demo
```

The compiler's **observed draft** and **handcrafted reference** checks need no credentials. Observed mode organizes supplied requirements and trace references for review; it is not model generation. The original studio's offline repair is also explicitly labeled as a handcrafted reference. Live drafting, repair, and schedule exploration use the provider displayed in the interface.

To select the final NVIDIA route on Nebius:

```sh
PASSAGE_PROVIDER=nebius \
NEBIUS_MODEL=nvidia/Nemotron-3-Ultra-550b-a55b \
NEBIUS_BASE_URL=https://api.tokenfactory.us-central1.nebius.com/v1 \
PASSAGE_NEBIUS_BUDGET_USD=4 \
PASSAGE_ALLOW_LIVE=true npm run demo
```

The server reads credentials from the shell, project `.env`, then parent `.env`. No credential reaches the client, build worker or preview. Do not commit environment files. The exact regional Nebius Ultra route completed a fresh live contract → inspection → localization → repair → verification workflow on the independent TodoMVC source. Its receipts are separate from Fireworks development evidence and from the historical Super qualification.

For explicitly authorized development:

```sh
PASSAGE_PROVIDER=fireworks PASSAGE_ALLOW_LIVE=true npm run demo
```

Fireworks uses `FIREWORKS_AI_API_KEY` and `accounts/fireworks/models/nemotron-3-ultra-nvfp4`: high reasoning, 32,000 output tokens, a 480-second timeout, schema in the prompt and strict local JSON validation. The current Nebius Ultra profile uses 32,000 tokens/480 seconds, temperature 1, top-p 0.95, thinking and `force_nonempty_content` enabled, with prompt schema. This follows [NVIDIA's coding-agent example](https://huggingface.co/nvidia/NVIDIA-Nemotron-3-Ultra-550B-A55B-NVFP4#api-client); the earlier external qualification used temperature 0.2 and remains a separate record. Settings shows qualification for the exact requested endpoint/model/generation fingerprint. Historical Nebius Super/Lightning profiles retain 6,000 tokens/120 seconds. Together has separate `TOGETHER_AI_*` settings. Keys never change the selected provider and failures never silently substitute a provider.

Nebius defaults to a $2 local admission limit. `PASSAGE_NEBIUS_BUDGET_USD` can set an allowance from $0 to $100 within the user's existing authorization; this upgrade's later qualification and the command above use a $4 local cap without resetting prior spend. This was an application configuration change within the existing paid allowance and redeemed credit, not a new purchase or approval. Fresh clones can omit the variable to retain the $2 default. Authorized Fireworks/Together development has no artificial dollar cap. Serial execution, bounded attempts and per-provider usage receipts remain active. Application estimates are not provider invoices. See [routing and historical safety details](docs/architecture.md), [current compiler evidence](docs/journey-compiler.md), and the exact receipt in the product.

## Try the complete journey

1. Use **Try the keyboard** on the home page's actual application. Choose **Repair a journey**, state the task and consent to recording the fictional sample.
2. **Record attempt** executes the selected bounded task in a fresh browser. Inspect actions, focus, real request/response events and the first failed assertion. Unexecuted checks remain inconclusive.
3. **Review the contract** creates an observed or live typed draft. Review inferred requirements and evidence references. Select truthful review provenance: automated development or an operator's attestation. Neither is authenticated independent review.
4. Freeze the exact draft. Live repair inspects source, validates exact citations, proposes a scoped patch and tests the frozen suite. New authored repairs also require a separately reported pointer-booking and keyboard-Close preservation gate. Failed citations and candidates remain visible; the agent cannot change acceptance rules to make its patch pass.
5. **Challenge & keep** checks completion, modal boundaries, or Escape while a real availability response is held and later released. An optional live probe selects only approved actions and dependencies. Failed schedules can be reduced through fresh executions that reproduce the same failure signature.
6. Download **Runnable guard** and check a later source revision. It contains the contract, source identities, runtime and lockfile, and needs no inference credentials or original database. Guards declaring the new combined policy require both frozen and preservation gates, with separate results; historical guards keep their original scope. A changed task requires a new review.
7. For external source, open **External React repository**. Follow the [worker setup](docs/repository-worker.md), inspect exact Git blobs or import a public source manifest, and supply reviewed semantic bindings. No repository package scripts or arbitrary dependency installs run. The two [development cases](docs/journey-compiler.md#external-development-cases) disclose their adaptation and outcome scope.
8. Attach actual screen-reader receipts to their exact external build. The original studio also has a fresh bound participant-session workflow with exact outcome verification and a separately named review. No participants or independent reviewers were available for this upgrade; their results are not invented.

The original four-family flow remains at `/journeys/new`, with its historical contract, challenge and portable evidence interfaces. Cancellation preserves completed artifacts. A restart marks unfinished jobs interrupted instead of fabricating success.

## Implemented scope

| Capability | Working behavior |
| --- | --- |
| Journey Compiler | Actual trace evidence, typed proposed assertions, explicit corrections, exact draft review and frozen acceptance |
| Temporal interpreter | Semantic bindings; bounded actions/events; value preservation, modal containment, focus return and exact protected outcome assertions |
| External React adapter | Immutable public source, fixed locked dependencies in a disposable Linux worker, no host mounts/build network/provider secrets |
| External cases | TodoMVC keyboard edit/cancel/save repair; unchanged react-modal Forms containment control, with upstream MIT notices |
| Source repair | Generic manifest inspection and exact source citations; scoped cumulative patches; all failed receipts retained |
| Continuing guard | Standalone replay, later revision checks, public bounded schedules and same-failure reduction |
| Protected outcome | Actual fictional appointment record from the trusted authored service; external callbacks must be separately registered |
| Assistive evidence | Actual Orca automation separated from participant results; fresh consented attempt binding, stored outcome verification, review attestation, expiry and deletion |
| Local reliability | SQLite WAL, idempotency, cancellation fencing, interrupted-job recovery, source/build integrity and provider usage ledgers |
| Product | Immediate actual task, failure-first trace detail, responsive workflow, readable scope/provenance, reduced-motion and high-contrast settings |

## Verify and replay

```sh
npm run typecheck
npm test
npm run build
npm run test:e2e
npm run verify:fixtures
```

The suite covers durable state, hostile/malformed source and model data, credits and provider profiles, contract weakening, fabricated page events, exact citations, cumulative multi-file retry, cancel/modal behavior, wrong business results, AT receipt binding, complete UI flows and responsive accessibility. Deterministic tests do not call paid models.

The fixture sweep runs on a separate host at port 4193. Historical exact-source replay remains available without credentials or the original database:

```sh
npm run verify:source -- northstar-appointments docs/samples/date-picker/DatePicker.jsx combined fc15b7706c15e8a79454fd81149a58145ce34402ab031f1927b3609c04e41e28
```

Runnable compiler packages also work independently:

```sh
# Inside an extracted authored guard package:
npm ci --ignore-scripts
npx playwright install chromium
npm run verify:guard -- --guard guard.json --source path/to/next.jsx
# Separately check pointer booking and keyboard access to the existing Close control:
npm run verify:preservation -- --guard guard.json --source path/to/next.jsx --output preservation.json

# Inside an extracted external React guard package, after worker setup:
npm run verify:repository-guard -- --guard guard.json
npm run verify:repository-guard -- --guard guard.json --snapshot next-snapshot.json
```

The [historical evaluation](docs/evaluation.md) is unchanged: Super on Nebius and Ultra on Fireworks passed the original nine enabled checks and combined challenge across four authored families. Its 21-request Nebius ledger ($0.05358294 estimated), 15-request Fireworks ledger ($0.299835 estimated), 63 tests and two E2E tests are the original dated snapshot. The stronger temporal tests reproduce gaps outside that scope, including the exact old date source's modal escape/cancel race and the old combobox source's missing arrow exploration. Current upgrade outcomes and test counts are separate in [Journey Compiler](docs/journey-compiler.md).

## Evidence limits

- No participant study, independent specialist/maintainer review, VoiceOver/Safari or NVDA/Windows validation, locked holdout or matched-baseline comparison has occurred. Actual Orca automation uses the disclosed local compatibility configuration; see [the runner record](docs/actual-screen-reader.md). Browser focus and speech capture are not participant success.
- External support is a fixed-dependency React/static-component adapter, not arbitrary monorepo support or a general hostile-code service. It runs no repository package scripts, model-selected shell commands, or repository-selected dependency installation. Deployment and pull-request publication remain unavailable.
- TodoMVC checks its actual in-memory task state. No persistent storage or transaction is claimed. External business assertions need a separately registered protected observer and error if it is absent. Uploaded hashes do not authenticate upstream Git ancestry.
- The two external cases are public development cases, one a component demo, with possible training exposure. They are not two repaired applications or a held-out benchmark. No universal accessibility or WCAG certification is claimed.
- Run artifacts remain local under ignored `.passage/`. Private human text has a separate revocable store, expiry and deletion policy; deleting it cannot recall downloads or backups. See [privacy](docs/privacy.md).

See [current compiler architecture and evidence](docs/journey-compiler.md), [implementation ledger](docs/implementation-ledger.md), [evaluation protocol](docs/upgrade-evaluation-protocol.md), and [asset notices](NOTICE.md). Authored code is [MIT licensed](LICENSE); external source notices remain with exported snapshots. Private planning files are excluded from Git.
