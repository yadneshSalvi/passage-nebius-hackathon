# Capture, retention, and deletion

Passage runs locally and uses fictional fixtures by default. No patient, customer, or real-service account is required. Credentials remain on the server and are excluded from Git and build contexts.

## Separate evidence stores

**Synthetic run evidence** includes scoped source, fictional application screenshots, focus/action observations, ARIA snapshots, independent service outcomes, diffs and model receipts. It persists under `.passage/` for reproducibility. The capture-retention preference does not promise to delete these synthetic runs. The model receives authored source and relevant observations only when the operator deliberately chooses live mode. Consent and generation views identify the selected recipient: Nebius for submission, or Fireworks/Together for explicit development. No provider fallback occurs, and private assistive captures are not automatically sent to any model provider.

**Private assistive text captures** have separate consent and storage. An operator supplies a participant pseudonym, environment/AT versions, timing estimate and private-study consent. The session binds an accepted candidate, immutable build and current contract. A one-time token permits importing small UTF-8 operator notes or an actual speech-viewer transcript, with matching SHA-256 digests. Missing speech is never generated and relabeled as observation.

Audio/video recording, automatic VoiceOver/NVDA capture, public publication, and automatic sensitive-data detection are not implemented. Operators must minimize identifiers and review text before import. Imported text alone leaves `independentlyReviewed` and `backendOutcomeVerified` false.

The new bound-attempt workflow creates a fresh protected application session before a person acts. Outcome verification can set `backendOutcomeVerified` only after reading that exact session and matching the explicit intended fields, source, build and current contract. A separately named reviewer may attest to independence and record a decision; the UI labels this `reviewer-attested-independence` with `authenticatedIdentityVerified: false`. Local names are not identity authentication. Legacy imports cannot inherit an automated verifier booking and need a fresh bound attempt for this workflow. Deletion revokes the capture's private outcome binding and review; the application business record has its own retention policy.

**Public development AT receipts** are a separate evidence class. Actual Orca automation on fictional tasks can be attached to an exact external build with a raw-content hash, ordered timestamps and explicit automated provenance. These receipts have zero participants, no independent human review and no backend-outcome claim. They may be exported with public development source. The importer records an attestation, not proof that an uploaded transcript was authentically produced by an AT process. Private participant text must use the private consented intake instead. See [the actual screen-reader protocol](actual-screen-reader.md).

## Private capture lifecycle

1. **Pending:** private consent, exact revision and environment are recorded. The import token is shown once; only its hash is stored.
2. **Imported:** hashes and bindings validate, then the token is consumed. Content stays in a per-session private directory outside immutable run artifacts.
3. **Revoked:** deletion or expiry immediately blocks access and removes metadata, result, content references and token from the active record.
4. **Deleted / expired:** controlled text files and capture-dependent cached exports are removed. SQLite secure deletion is enabled and the active WAL checkpointed. A content-free tombstone and audit remain.
5. **Deletion pending:** if removal fails, access remains revoked and cleanup is retried; the actual status is displayed.

Retention is fixed at session creation from the current setting (default 30 days). It is enforced on relevant reads, at startup and by a periodic timer while the API runs. Changing the preference affects new sessions. Expired content is inaccessible even before the next disk-cleanup pass.

Exports include safe capture IDs, bindings, statuses and hashes, not private text or participant/operator metadata. Deletion revokes cached dependent exports under application control. Downloaded files, recipients' copies, Git history, OS snapshots and external backups cannot be recalled. Private-study consent never implies public-publication consent.

The older unbound human-observation write route is retired; new clients use bound captures. Historical exports and external copies retain these recall limitations. There is no claim of universal or forensic erasure.
