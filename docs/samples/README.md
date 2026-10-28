# Replay an actual generated repair

These are accepted NVIDIA Nemotron 3 Ultra source files from actual Fireworks development requests. The JSX is preserved **byte for byte**; each `provenance.json` binds its SHA-256, original request receipt, requested generation settings, historical contract and measured results. Do not run a formatter over these source files.

The eight source/provenance files are also listed in [SHA256SUMS](SHA256SUMS).

No API key, original `.passage` database, running Passage API, or inference request is needed to reproduce the browser checks. From a fresh clone:

```sh
npm ci
npx playwright install chromium
npm run verify:source -- northstar-appointments docs/samples/date-picker/DatePicker.jsx combined fc15b7706c15e8a79454fd81149a58145ce34402ab031f1927b3609c04e41e28
```

The command validates a bounded UTF-8 regular file, checks the optional expected digest, applies the same source guard, compiles the component, and runs actual keyboard actions against the protected fixture service. It starts its own ephemeral loopback preview port and does not load provider configuration or environment files. The generated component is browser code; it is not imported into Node or given a shell.

The replay uses a **fresh protected default contract**, with all nine default checks enabled. It does not recreate a historical custom contract or overwrite an old result. Its contract ID/timestamp/digest will differ, and a different Node version, platform or dependency lockfile produces a different build identity. Source digest, actual verifier/browser versions, checks, saved date and local evidence paths are recorded in `.passage/source-replays/<unique-run>/report.json`. Exit status is nonzero for rejected source or failed checks.

| Example | Fixture ID | Source | Generation profile |
|---|---|---|---|
| Date picker | `northstar-appointments` | [DatePicker.jsx](date-picker/DatePicker.jsx) · [receipt](date-picker/provenance.json) | Prompt v7; requested high reasoning, 32k output allowance, 480 seconds, schema in prompt, no `response_format` |
| Combobox | `riverside-support` | [SessionCombobox.jsx](combobox/SessionCombobox.jsx) · [receipt](combobox/provenance.json) | Prompt v8; requested high reasoning, 32k output allowance, 480 seconds, schema in prompt, no `response_format` |
| Modal wizard | `atlas-onboarding` | [BookingWizard.jsx](modal-wizard/BookingWizard.jsx) · [receipt](modal-wizard/provenance.json) | Prompt v5; requested high reasoning, 16k output allowance, 240 seconds, JSON-object response format |
| Async validation | `civic-assistance` | [AvailabilityControl.jsx](async-validation/AvailabilityControl.jsx) · [receipt](async-validation/provenance.json) | Prompt v5; requested high reasoning, 16k output allowance, 240 seconds, JSON-object response format |

Replace `combined` with `baseline`, `unavailable-date`, `late-validation`, `long-labels` or `german` to choose a public scenario. Exported candidate JSX from any Passage ZIP can be used with its matching authored fixture ID and source digest. The CLI deliberately does not execute arbitrary repositories or ZIP contents.

The date and combobox examples were generated and accepted with verifier v3. The wizard and async examples retain their historical v2 results; their exact source also passed independent baseline/combined rechecks with v3 in [the source-revalidation record](../live-source-revalidation-2026-10-28-v3.json). These are development cases, not held-out benchmark or human-study results.
