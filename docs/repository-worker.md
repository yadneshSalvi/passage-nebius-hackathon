# Isolated React repository worker

The first repository adapter builds immutable, reviewed public Git source blobs using a fixed React/esbuild toolchain. It does not run a repository's package scripts, accept its build plugins, install candidate-selected packages, or claim support for arbitrary applications. Dependencies are explicitly pinned in `scripts/repository-worker-image/package-lock.json`.

## Local setup

Use an available Linux Docker engine. On this Mac, a separate Colima profile is used because the existing Docker Desktop daemon did not respond. It leaves the user's default Docker context unchanged:

```sh
colima start passage --cpu 2 --memory 4 --disk 20 --vm-type vz --mount none --activate=false --ssh-config=false --ssh-agent=false
sh scripts/repository-worker-setup.sh
```

The setup builds a reviewed worker image, records its immutable image ID in ignored local state and installs only pinned registry packages. The image-build phase needs registry network access; imported source is never executed in that phase. At job runtime the container has no network, no host mounts, no provider credentials, no capabilities, no privilege escalation, a read-only root and bounded CPU/memory/processes. Source enters through standard input as a bounded manifest, not by mounting a checkout or the Docker socket. A 120-second build deadline removes the job container on completion or failure.

## Admission and identity

`inspectRepository` reads exact regular Git blobs from a full commit and checks the configured public HTTPS remote. Worktree edits, symlinks, dotfiles, configuration, package manifests and node_modules do not enter the snapshot. `applyRepositoryPatch` can change only reviewed existing paths. Both manifest and file hashes are verified before execution. The original revision and resulting patched source digest remain separate.

`buildRepository` produces an immutable source/image/bundle-bound receipt. Static previews bind only to loopback on port 4104, verify asset hashes and deny network connections and form submission. This protects the local application boundary; it is not a public multi-tenant hostile-code security certification. Production workers require their own deployment qualification.

Manifest identity uses canonical adapter-field and alias ordering. Earlier v1 component receipts hashed the three bootstrap fields in insertion order; validation accepts those six equivalent serializations of the same exact fields. No-op builds preserve the historical source digest, while changed source receives a canonical new digest. Changed bootstrap bytes or meaning still invalidate the receipt. This compatibility rule keeps the first qualified react-modal baseline intact after API schema parsing reordered its fields.

The preview lifecycle is managed by `startRepositoryPreview` / `stopRepositoryPreview`. Application shutdown must stop the preview. Receipts and artifacts persist in `.passage/repository-worker/artifacts`, so historical builds can be served after restart by starting the preview server again.

## Independent outcomes

For a component library, a separately disclosed, hash-bound mount bootstrap and module aliases may mount an upstream example with the pinned React runtime. This adapter is outside the candidate patch paths. It must remain unchanged in before/after comparisons, and component-level results must not be described as a whole upstream application repair. Repository source files still come from exact Git blobs.

`RepositoryOutcomeObserver` is a read-only trusted extension owned by the evaluator, outside candidate source. It receives exact build/source/session identity and returns its own identity, records and verification state. No observer is installed by default. Therefore repository builds explicitly report `outcomeVerification: not-configured`. UI transitions, even successful ones, are not persisted business completion. The authored booking fixture's protected service is a separate existing integration.

Actual external-case receipts belong in the implementation ledger only after execution. A component demonstration or adapter qualification is not a maintainer-accepted repair or an independently recruited participant study.
