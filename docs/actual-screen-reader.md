# Actual screen-reader evidence

Passage can record actual Orca output from a real Firefox window inside a dedicated Linux VM. This is an automated assistive-technology observation. It does not establish usability for a human screen-reader user, independent accessibility acceptance, or persisted business completion.

## Reproduce locally

Start the isolated repository worker and serve the exact repository build using Passage. Build the runner from the official Guidepup image and pinned npm lockfile:

```sh
docker --context colima-passage build -t passage-orca-runner:v3 scripts/assistive-runner
npx tsx scripts/capture-actual-at.ts \
  --build .passage/repository-worker/cases/todomvc-react.build.json \
  --image passage-orca-runner:v3 \
  --out .passage/repository-worker/cases/new-v3-original-capture.json
```

The command resolves the runner image to an immutable ID, verifies that the receipt names a local repository preview, runs an isolated graphical browser with Orca, and saves the unmodified speech receipt, screenshot, and separate execution receipt. It force-removes its own container after copying evidence. It does not mount a host directory or provide API credentials to the runner. Keep Passage's preview server running during the capture. The runner uses the Colima host gateway to reach the loopback preview through a small internal proxy; it is not a no-network container like the source build worker.

The default `todomvc-keyboard` protocol creates a fictional task, follows three actual Tab transitions, activates the reached control with Enter, and, if editing is possible, changes the text and presses Escape before moving focus. The same protocol must be used for before and after. `--case todomvc` is a separately labelled diagnostic that uses the upstream double-click edit gesture to isolate cancellation behavior. `--case tab-observation` records eight Tab transitions without a task-completion claim.

## Configuration qualification

The runner pins Guidepup 0.36.2 and its official image by digest. That release indexes its Orca userspace asset for Linux kernel 7, while this local Colima VM runs Linux 6.8. The Dockerfile explicitly extends the asset manifest for Linux 6 and maps the same userspace asset cache. Receipts disclose `local-linux6-userspace-asset-qualification` and the actual kernel. This is a locally qualified compatibility configuration, not a claim of upstream support. Host macOS VoiceOver settings are unchanged.

The v3 runner also corrects a diagnosed Speech Dispatcher module-path defect. Guidepup starts Speech Dispatcher 0.12.1 with a private `--module-dir` containing its custom `guidepup` module. Speech Dispatcher automatically initializes `sd_espeak-ng` and `sd_dummy` fallback modules too. In the retained v2 candidate attempt 01, both fallback executables were absent from that private directory: the daemon logged `ENOENT` and died with `SIGPIPE` 44 ms after spawn. Guidepup then surfaced its generic five-second socket-discovery timeout. This was a daemon exit before Firefox navigation, not a slow application or an observed user barrier.

V3 links the actual fallback binaries already installed in the pinned upstream image into the private module directory. The Docker build checks their SHA-256 values before linking:

| Module | System executable SHA-256 |
| --- | --- |
| `sd_espeak-ng` | `795d48ae97fb41ef1d9b775f68a2521bc5cac72d88d7148fab43e38cc095e8e5` |
| `sd_dummy` | `419c9d26f8311889f8a8e2364ca65ba811ca81eff3c8c8197d13d01e018aa407` |

The Guidepup capture module, five-second readiness timeout, keyboard protocol, container limits and protected application source remain unchanged by this infrastructure correction. V3 receipts disclose `local-linux6-userspace-asset-qualification+system-speechd-fallback-links-v3`. The immutable runner image is `sha256:fa3b2b19680618f023925053d380a024790707669de48ffbd5cef0147686f6a1`.

Transparent process observers collect bounded daemon stdout/stderr, exit status, log tails and resource information. These diagnostics are emitted only for a failed capture, and do not enable Guidepup debug mode, alter daemon arguments or retry a failed attempt. The separate instrumentation self-test intentionally supplied an invalid Speech Dispatcher CLI option; it is explicitly labelled `actualATRun: false` and is not an AT observation or qualification attempt.

Captured phrases come from Guidepup's Orca capture API, not from DOM text converted into speech. Focus and visible task state are additional browser observations. A nonempty phrase log is required for `captured`; a task may still be blocked or incorrect. Individual actions may produce no speech and retain that empty observation. Infrastructure failures and earlier configuration attempts are retained separately from any fixed-configuration reliability series.

The initial unmodified TodoMVC capture demonstrated `keyboard-edit-blocked`. A separate double-click diagnostic captured the cancelled replacement text being committed. Both refer to the original pinned upstream source and an in-memory task; no database persistence or participant result is asserted. Later candidate evidence must bind its own build and source digest. No stability percentage should be claimed without the complete numbered repeat series and its fixed protocol/image identity.


## Retained configuration series · 28 October 2026

These are separate local cohorts. Earlier failures were neither removed nor recounted as v3 successes.

| Configuration and source | Completed attempts | Actual speech captured | Observed task result |
| --- | ---: | ---: | --- |
| V1 original source | 20 | 18 | Captured attempts: keyboard edit blocked; attempts 01 and 04: startup socket timeout |
| V2 observer-only original diagnostics | 10 | 10 | Keyboard edit blocked |
| V2 observer-only Nebius candidate, interrupted after diagnosis | 7 | 6 | Six cancellation-preserved observations; attempt 01: diagnosed daemon `SIGPIPE` |
| V3 original control, same final image and protocol | 1 | 1 | Keyboard edit blocked |
| V3 final Nebius candidate, complete fixed series | 20 | 20 | All 20 cancelled edits preserved the original task title; zero startup or task failures |

The final candidate build is `e01b6565eb7a0c130739a9159325ea77a6e4e5de33dae77328829b0f0ed8a88d`, source digest `690f06b51778ff623d101fd1e04e0baa3f6cc45c443a35e2ca7af130b0c343c0`. The same-image original control uses build `c1c9aac38e2bdf9385f31f814d37ea0afe160a6697a63ece1e738ca9ecf95488`, source digest `2d1ee075787eae25413c97f37ce3fe2586ae109045607c2a42f18a8771168b7d`.

The final series used the stable loopback preview on port 4105, the immutable v3 image above, Guidepup 0.36.2, Firefox and the unchanged `todomvc-keyboard` protocol. Every attempt used a fresh distinct browser/session. Audit checked raw receipt SHA-256 against its separate execution receipt, exact image/build/source/protocol identity, sequential nonoverlapping execution times, nonempty actual speech logs, retained screenshot hashes and the observed original title after Escape. The [public machine summary](actual-at-qualification-2026-10-28.json) preserves the full per-run receipt and screenshot hashes. Its byte-identical local copy is `.passage/repository-worker/cases/qualification-v3-nebius/series-summary.json`; raw `run-01` through `run-20` receipts, execution receipts and screenshots remain beside it. The matching before/after pair is `original-control.json` and `run-01.json` in that directory.

V1 and v2 evidence remains under `qualification-v1`, `qualification-v2-diagnostic` and `qualification-v2-nebius`. The interrupted v2 candidate series has its own summary explaining the stop after seven completed attempts. The diagnostic cap was ten original-source attempts; there were no hidden per-attempt retries. The later v3 candidate series was a new, explicitly numbered 20-attempt series after the module-path correction.

Twenty local repeated observations establish the reported outcomes for this pinned setup; they are not a population reliability guarantee. All automated AT receipts retain `humanParticipant: false`, `independentlyReviewed: false` and `backendOutcomeVerified: false`. Participant count is zero. TodoMVC state here is in memory, with no claim of protected business persistence.
