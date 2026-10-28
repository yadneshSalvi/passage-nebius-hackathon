import { useEffect, useId, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { ActualATCapture } from "../shared/assistive-capture";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowRight,
  ArrowUpRight,
  Braces,
  ChevronRight,
  Download,
  FileCode2,
  Fingerprint,
  GitBranch,
  Keyboard,
  LockKeyhole,
  Play,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import type {
  PublicRepositorySnapshot,
  RepositoryJourney,
  RepositoryJourneyBootstrap,
  RepositoryReplay,
} from "../shared/repository-journey";
import type { TemporalContractBody } from "../shared/temporal";
import { api, download, post } from "./api";
import { Badge, Notice, PageHead, short, time } from "./ui";
import { providerName } from "./providerLabels";
import { ReceiptSummary } from "./repair";

const repositoryBase = "/compiler/repositories";
const activeStates = new Set([
  "building",
  "capturing",
  "drafting",
  "repairing",
  "verifying",
]);
const endpoint = (id: string, action = "") =>
  `${repositoryBase}/${encodeURIComponent(id)}${action ? `/${action}` : ""}`;
type View = "observe" | "contract" | "repair" | "verify";
function JsonInput({
  label,
  value,
  onChange,
  disabled,
  onError,
  maxBytes = 9_000_000,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  onError: (message: string) => void;
  maxBytes?: number;
}) {
  return (
    <label className="repository-json-input">
      {label}
      <input
        type="file"
        accept=".json,application/json"
        disabled={disabled}
        onChange={async (event) => {
          const file = event.target.files?.[0];
          if (!file) return;
          if (file.size > maxBytes) {
            onError(
              `Choose a JSON file smaller than ${Math.round(maxBytes / 1000).toLocaleString()} KB.`,
            );
            return;
          }
          try {
            const contents = await file.text();
            JSON.parse(contents);
            onChange(contents);
          } catch {
            onError(`${label} must contain valid JSON.`);
          }
        }}
      />
      <textarea
        aria-label={`${label} JSON`}
        placeholder="Paste the JSON, or choose its local file above."
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={6}
        required
        disabled={disabled}
        spellCheck={false}
      />
    </label>
  );
}
function ReplayEvidence({
  replay,
  expectsOutcome,
}: {
  replay: RepositoryReplay;
  expectsOutcome: boolean;
}) {
  const [eventId, setEventId] = useState<number | null>(null);
  const trace = replay.execution.trace;
  const event =
    trace.find((item) => item.sequence === eventId) ??
    trace.find((item) =>
      replay.execution.checks.some(
        (check) =>
          (check.status === "failed" || check.status === "error") &&
          check.traceSequence === item.sequence,
      ),
    ) ??
    trace.find(
      (item) =>
        item.kind === "error" ||
        item.data?.status === "failed" ||
        item.data?.status === "error",
    ) ??
    trace.find((item) => item.kind === "assertion") ??
    trace[0];
  const traceList = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const list = traceList.current;
    const selected = list?.querySelector<HTMLButtonElement>(
      "button[aria-pressed='true']",
    );
    if (list && selected) {
      const offset =
        selected.getBoundingClientRect().top - list.getBoundingClientRect().top;
      if (offset < 0 || offset > list.clientHeight - selected.clientHeight)
        list.scrollTop += offset - 30;
    }
  }, [event?.sequence]);
  return (
    <div className="repository-replay">
      <div className="compiler-evidence-heading">
        <div>
          <p className="eyebrow">ACTUAL BROWSER EXECUTION</p>
          <h3>{replay.label}</h3>
        </div>
        <Badge tone={replay.execution.passed ? "neutral" : "warning"}>
          {replay.execution.status}
        </Badge>
      </div>
      <p className="small muted">
        Source <code>{short(replay.sourceDigest)}</code> · Contract{" "}
        <code>{short(replay.contractDigest)}</code> ·{" "}
        {(replay.execution.durationMs / 1000).toFixed(1)}s
      </p>
      <div className="compiler-trace-inspector">
        <ol className="compiler-trace" aria-label="Repository browser trace">
          {trace.map((item) => (
            <li key={item.sequence}>
              <button
                onClick={() => setEventId(item.sequence)}
                aria-pressed={event?.sequence === item.sequence}
                className={event?.sequence === item.sequence ? "selected" : ""}
              >
                <span className="mono">
                  {String(item.sequence).padStart(2, "0")}
                </span>
                <span>
                  <small>
                    {item.kind} · {item.elapsedMs}ms
                  </small>
                  <strong>{item.label}</strong>
                </span>
                <ChevronRight size={15} />
              </button>
            </li>
          ))}
        </ol>
        <div className="compiler-event-detail">
          {event ? (
            <>
              <p className="eyebrow">RECORDED {event.kind}</p>
              <h3>{event.label}</h3>
              <dl className="simple-facts">
                <div>
                  <dt>Trace authority</dt>
                  <dd>
                    {event.provenance?.replaceAll("-", " ") ??
                      "Legacy capture · provenance not recorded"}
                  </dd>
                </div>
                <div>
                  <dt>Trace sequence</dt>
                  <dd>{event.sequence}</dd>
                </div>
                {event.actionId ? (
                  <div>
                    <dt>Action</dt>
                    <dd className="mono">{event.actionId}</dd>
                  </div>
                ) : null}
                {event.target ? (
                  <div>
                    <dt>Target</dt>
                    <dd className="mono">{event.target}</dd>
                  </div>
                ) : null}
              </dl>
              {event.data ? (
                <div className="compiler-readable-event">
                  {typeof event.data.status === "string" ? (
                    <Badge
                      tone={
                        event.data.status === "failed" ||
                        event.data.status === "error"
                          ? "warning"
                          : "neutral"
                      }
                    >
                      {event.data.status}
                    </Badge>
                  ) : null}
                  {event.data.expected !== undefined ? (
                    <p>
                      <strong>Expected</strong>
                      <span>
                        {String(event.data.expected) || "An empty value"}
                      </span>
                    </p>
                  ) : null}
                  {event.data.actual !== undefined ? (
                    <p>
                      <strong>Observed</strong>
                      <span>
                        {String(event.data.actual) || "An empty value"}
                      </span>
                    </p>
                  ) : null}
                  <details>
                    <summary>Inspect raw event data</summary>
                    <pre className="compiler-json">
                      {JSON.stringify(event.data, null, 2)}
                    </pre>
                  </details>
                </div>
              ) : null}
            </>
          ) : (
            <p>No events were retained for this replay.</p>
          )}
        </div>
      </div>
      <div className="compiler-checks">
        {replay.execution.checks.map((check) => (
          <details key={check.id}>
            <summary>
              <span className={`compiler-result-dot ${check.status}`} />
              <span>{check.label}</span>
              <Badge>{check.status}</Badge>
            </summary>
            <div>
              <p>
                <strong>Expected:</strong> {check.expected}
              </p>
              <p>
                <strong>Observed:</strong> {check.actual}
              </p>
            </div>
          </details>
        ))}
      </div>
      {replay.execution.error ? (
        <Notice tone="error">{replay.execution.error}</Notice>
      ) : null}
      {expectsOutcome || replay.outcomeVerification === "verified" ? (
        <Notice
          tone={replay.outcomeVerification === "verified" ? "info" : "warning"}
          title={
            replay.outcomeVerification === "verified"
              ? "Protected outcome verified"
              : "Business completion is unverified"
          }
        >
          {replay.outcomeVerification === "verified"
            ? `Authority: ${replay.protectedOutcome?.authority ?? "recorded protected observer"}`
            : "This contract expects a protected business outcome. No configured observer established that the intended transaction was stored."}
        </Notice>
      ) : (
        <p className="small muted">
          Checks task state in this browser session. Build and evidence limits
          are available below.
        </p>
      )}
      <details className="compiler-disclosure">
        <summary>
          Inspect build isolation, outcome & limitations{" "}
          <ChevronRight size={16} />
        </summary>
        <dl className="simple-facts">
          <div>
            <dt>Source revision</dt>
            <dd className="mono break-anywhere">{replay.build.revision}</dd>
          </div>
          <div>
            <dt>Bundle</dt>
            <dd className="mono break-anywhere">{replay.build.bundleDigest}</dd>
          </div>
          <div>
            <dt>Worker</dt>
            <dd>
              {replay.build.isolation.runtime} ·{" "}
              {replay.build.isolation.context}
            </dd>
          </div>
          <div>
            <dt>Build isolation</dt>
            <dd>
              Network {replay.build.isolation.network} · host mounts{" "}
              {String(replay.build.isolation.hostMounts)} · root filesystem
              read-only {String(replay.build.isolation.readOnlyRoot)}
            </dd>
          </div>
        </dl>
        {replay.protectedOutcome ? (
          <pre className="compiler-code">
            {JSON.stringify(replay.protectedOutcome, null, 2)}
          </pre>
        ) : null}
        {replay.execution.limitations.map((item) => (
          <p key={item} className="small muted">
            {item}
          </p>
        ))}
      </details>
      <details className="compiler-disclosure">
        <summary>
          Inspect the served application <ArrowUpRight size={16} />
        </summary>
        <a
          className="text-link"
          href={replay.build.previewUrl}
          target="_blank"
          rel="noreferrer"
        >
          Open exact build <ArrowUpRight size={15} />
        </a>
        <iframe
          sandbox="allow-scripts allow-same-origin"
          className="compiler-preview"
          src={replay.build.previewUrl}
          title="Exact repository build used for this replay"
        />
      </details>
    </div>
  );
}
function ActualATPanel({
  captures,
  originalDigest,
  repairedDigests,
  busy,
  attach,
}: {
  captures: ActualATCapture[];
  originalDigest: string;
  repairedDigests: string[];
  busy: boolean;
  attach: (body: unknown) => Promise<void>;
}) {
  const selectorId = useId();
  const [captureId, setCaptureId] = useState("");
  const [stepIndex, setStepIndex] = useState<number | null>(null);
  const [content, setContent] = useState("");
  const [attested, setAttested] = useState(false);
  const [error, setError] = useState("");
  const capture =
    captures.find((item) => item.id === captureId) ?? captures.at(-1);
  const step =
    capture?.receipt.steps[stepIndex ?? -1] ??
    capture?.receipt.steps.find((item) => item.spoken.trim()) ??
    capture?.receipt.steps[0];
  const sourceLabel = (digest: string) =>
    digest === originalDigest
      ? "Original"
      : repairedDigests.includes(digest)
        ? "Repaired"
        : "Unclassified source";
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      JSON.parse(content);
      const digest = Array.from(
        new Uint8Array(
          await crypto.subtle.digest(
            "SHA-256",
            new TextEncoder().encode(content),
          ),
        ),
        (byte) => byte.toString(16).padStart(2, "0"),
      ).join("");
      await attach({ content, sha256: digest, attestedActual: true });
    } catch (failure) {
      setError(
        failure instanceof SyntaxError
          ? "Choose an actual screen-reader receipt containing valid JSON."
          : (failure as Error).message,
      );
    }
  }
  return (
    <details
      id="repository-at-evidence"
      className="compiler-disclosure repository-at-evidence"
    >
      <summary>
        <span>
          <Keyboard size={16} /> Actual screen-reader capture{" "}
          {captures.length ? `(${captures.length})` : "· none attached"}
        </span>
        <ChevronRight size={16} />
      </summary>
      {capture && step ? (
        <>
          <div className="compiler-evidence-heading">
            <div>
              <p className="eyebrow">
                ACTUAL AT AUTOMATION · {capture.participantCount} PARTICIPANTS
              </p>
              <h3>
                {capture.receipt.screenReader} · {capture.receipt.browser}
              </h3>
            </div>
            <Badge>{sourceLabel(capture.receipt.sourceDigest)} capture</Badge>
          </div>
          <p className="small muted">
            This is a separate screen-reader/browser run. Its timeline is not
            synchronized to the Chromium execution above.{" "}
            {capture.receipt.sourceDigest === originalDigest
              ? "This original-source capture does not establish repaired-source behavior."
              : "This capture covers only the recorded steps on the identified source."}{" "}
            Participant benefit remains unverified.
          </p>
          <p className="small muted">
            <strong>Capture protocol:</strong>{" "}
            {capture.receipt.protocol ??
              "Not declared in this receipt; inspect the recorded actions."}
          </p>
          {capture.receipt.taskOutcome ? (
            <Notice title="Runner-observed task result">
              {capture.receipt.taskOutcome}. This observation is not a protected
              business-outcome verification.
            </Notice>
          ) : null}
          {captures.length > 1 ? (
            <div className="repository-replay-select">
              <label htmlFor={selectorId}>Screen-reader capture</label>
              <select
                id={selectorId}
                value={capture.id}
                onChange={(event) => {
                  setCaptureId(event.target.value);
                  setStepIndex(null);
                }}
              >
                {captures.map((item) => (
                  <option key={item.id} value={item.id}>
                    {sourceLabel(item.receipt.sourceDigest)} ·{" "}
                    {item.receipt.screenReader} · {time(item.createdAt)} ·{" "}
                    {short(item.receipt.sourceDigest)}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <div className="repository-at-timeline">
            <ol aria-label="Actual screen-reader capture steps">
              {capture.receipt.steps.map((item, index) => (
                <li key={`${item.at}-${index}`}>
                  <button
                    onClick={() => setStepIndex(index)}
                    aria-pressed={step === item}
                    className={step === item ? "selected" : ""}
                  >
                    <span className="mono">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <span>
                      <small>{new Date(item.at).toLocaleTimeString()}</small>
                      <strong>{item.action}</strong>
                    </span>
                    <ChevronRight size={14} />
                  </button>
                </li>
              ))}
            </ol>
            <div className="repository-at-step">
              <p className="eyebrow">ACTUAL CAPTURED SPEECH</p>
              <h3>{step.action}</h3>
              <blockquote>
                {step.spoken.trim()
                  ? step.spoken
                  : "No speech captured in this step"}
              </blockquote>
              {step.focus ? (
                <div className="repository-at-focus">
                  <strong>Observed focus</strong>
                  <p>
                    {step.focus.label ||
                      step.focus.text ||
                      "No focus label captured"}
                  </p>
                  <small className="mono">{step.focus.tag}</small>
                </div>
              ) : null}
              {step.actualTitle ? (
                <div className="repository-at-focus">
                  <strong>Observed UI title</strong>
                  <p>{step.actualTitle}</p>
                </div>
              ) : null}
              {!step.spoken.trim() ? (
                <p className="small muted">
                  An empty speech segment is a capture observation; it is not by
                  itself an accessibility failure.
                </p>
              ) : null}
            </div>
          </div>
          {capture.screenshotUrl ? (
            <img
              className="repository-at-screenshot"
              src={capture.screenshotUrl}
              alt="Actual retained screenshot from this separate assistive-technology capture"
            />
          ) : null}
          <details className="compiler-disclosure">
            <summary>
              Inspect environment, provenance & compatibility{" "}
              <Fingerprint size={16} />
            </summary>
            <dl className="simple-facts">
              <div>
                <dt>Environment</dt>
                <dd>
                  {capture.receipt.platform} · {capture.receipt.browser}{" "}
                  {capture.receipt.browserVersion ?? ""}
                </dd>
              </div>
              <div>
                <dt>Capture tooling</dt>
                <dd>{capture.receipt.guidepupVersion}</dd>
              </div>
              {capture.receipt.compatibility ? (
                <div>
                  <dt>Compatibility</dt>
                  <dd>{capture.receipt.compatibility}</dd>
                </div>
              ) : null}
              <div>
                <dt>Exact source</dt>
                <dd className="mono break-anywhere">
                  {capture.receipt.sourceDigest}
                </dd>
              </div>
              <div>
                <dt>Build</dt>
                <dd className="mono break-anywhere">
                  {capture.receipt.buildId}
                </dd>
              </div>
              <div>
                <dt>AT session</dt>
                <dd className="mono break-anywhere">
                  {capture.receipt.sessionId}
                </dd>
              </div>
              <div>
                <dt>Import provenance</dt>
                <dd>
                  Actual-execution attested: {String(capture.importAttested)} ·
                  Independently authenticated execution:{" "}
                  {String(capture.executionAuthenticated)}
                </dd>
              </div>
              <div>
                <dt>Outcome scope</dt>
                <dd>
                  Human participant: {String(capture.receipt.humanParticipant)}{" "}
                  · Independent review:{" "}
                  {String(capture.receipt.independentlyReviewed)} · Protected
                  business outcome verified:{" "}
                  {String(capture.receipt.backendOutcomeVerified)}
                </dd>
              </div>
              <div>
                <dt>Receipt digest</dt>
                <dd className="mono break-anywhere">{capture.digest}</dd>
              </div>
            </dl>
            {capture.receipt.limitations.map((item) => (
              <p className="small muted" key={item}>
                {item}
              </p>
            ))}
            <a className="text-link" href={capture.artifactUrl} download>
              Inspect the raw AT receipt <ArrowUpRight size={15} />
            </a>
          </details>
        </>
      ) : (
        <p>
          No actual screen-reader receipt is attached to this source journey.
          Browser focus events are not screen-reader speech.
        </p>
      )}
      <details className="compiler-disclosure">
        <summary>
          Attach an actual screen-reader receipt <ArrowRight size={15} />
        </summary>
        <form className="repository-at-import" onSubmit={submit}>
          <JsonInput
            label="Actual screen-reader receipt"
            value={content}
            onChange={setContent}
            disabled={busy}
            onError={setError}
            maxBytes={250_000}
          />
          <label className="checkbox-label">
            <input
              type="checkbox"
              required
              checked={attested}
              onChange={(event) => setAttested(event.target.checked)}
              disabled={busy}
            />
            <span>
              I attest that this receipt records an actual screen-reader
              execution on the stated source and build. It is automated
              evidence, not a participant study.
            </span>
          </label>
          {error ? <Notice tone="error">{error}</Notice> : null}
          <button
            className="button button-secondary"
            disabled={busy || !attested || !content}
          >
            Attach the bound receipt <ArrowRight size={15} />
          </button>
        </form>
      </details>
    </details>
  );
}
export function RepositoryJourneyWorkspace() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [bootstrap, setBootstrap] = useState<RepositoryJourneyBootstrap | null>(
    null,
  );
  const [journey, setJourney] = useState<RepositoryJourney | null>(null);
  const [view, setView] = useState<View>("observe");
  const [loading, setLoading] = useState(true);
  const [requestBusy, setRequestBusy] = useState(false);
  const [error, setError] = useState("");
  const [label, setLabel] = useState("");
  const [task, setTask] = useState("");
  const [snapshotJson, setSnapshotJson] = useState("");
  const [contractJson, setContractJson] = useState("");
  const [permission, setPermission] = useState(false);
  const [draftMode, setDraftMode] = useState<"observed" | "live">("observed");
  const [maintainer, setMaintainer] = useState("");
  const [reviewer, setReviewer] = useState("");
  const [reviewProvenance, setReviewProvenance] = useState<
    "automated-development" | "operator-attested"
  >("automated-development");
  const [acknowledge, setAcknowledge] = useState(false);
  const [variant, setVariant] = useState<"original" | "candidate">("original");
  const [replayId, setReplayId] = useState("");
  const [revisionJson, setRevisionJson] = useState("");
  const [revisionLabel, setRevisionLabel] = useState("");
  const [dropAssertions, setDropAssertions] = useState<string[]>([]);
  const [revisionNotes, setRevisionNotes] = useState("");
  const busy =
    requestBusy || Boolean(journey && activeStates.has(journey.status));
  const replay =
    journey?.replays.find((item) => item.id === replayId) ??
    journey?.replays.at(-1);
  const repair = journey?.repairs.at(-1);
  const expectsProtectedOutcome =
    (
      journey?.contract ??
      journey?.draft?.body ??
      journey?.proposedContract
    )?.assertions.some((assertion) => assertion.kind === "outcome") ?? false;
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setJourney(null);
    void Promise.all([
      api<RepositoryJourneyBootstrap>(`${repositoryBase}/bootstrap`),
      id
        ? api<RepositoryJourney>(endpoint(id), { signal: controller.signal })
        : Promise.resolve(null),
    ])
      .then(([next, session]) => {
        if (active) {
          setBootstrap(next);
          setJourney(session);
        }
      })
      .catch((failure) => {
        if (active) setError(failure.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [id]);
  useEffect(() => {
    if (!journey || !activeStates.has(journey.status)) return;
    const controller = new AbortController();
    const timer = setInterval(() => {
      void api<RepositoryJourney>(endpoint(journey.id), {
        signal: controller.signal,
      })
        .then((next) => {
          if (!controller.signal.aborted) setJourney(next);
        })
        .catch((failure) => {
          if (!controller.signal.aborted) setError(failure.message);
        });
    }, 1800);
    return () => {
      clearInterval(timer);
      controller.abort();
    };
  }, [journey?.id, journey?.status]);
  useEffect(() => {
    setAcknowledge(false);
  }, [journey?.draft?.digest]);
  useEffect(() => {
    setReplayId("");
  }, [journey?.replays.length]);
  async function act(action: string, body: unknown = {}) {
    if (!journey) return;
    setRequestBusy(true);
    setError("");
    try {
      setJourney(
        await post<RepositoryJourney>(endpoint(journey.id, action), body),
      );
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setRequestBusy(false);
    }
  }
  async function create(event: FormEvent) {
    event.preventDefault();
    if (!permission) return;
    setRequestBusy(true);
    setError("");
    try {
      const snapshot = JSON.parse(snapshotJson) as PublicRepositorySnapshot;
      const contract = JSON.parse(contractJson) as TemporalContractBody;
      const next = await post<RepositoryJourney>(repositoryBase, {
        label: label.trim(),
        task: task.trim(),
        snapshot,
        contract,
        sourcePermission: "public-source-development",
      });
      navigate(`/compiler/repositories/${next.id}`);
    } catch (failure) {
      setError(
        failure instanceof SyntaxError
          ? "Both the source manifest and the typed contract must contain valid JSON."
          : (failure as Error).message,
      );
    } finally {
      setRequestBusy(false);
    }
  }
  async function review(event: FormEvent) {
    event.preventDefault();
    if (journey?.draft && acknowledge)
      await act("review", {
        expectedDigest: journey.draft.digest,
        maintainer: maintainer.trim(),
        interactionReviewer: reviewer.trim(),
        reviewProvenance,
        acknowledgeInferred: true,
      });
  }
  async function reviseDraft(event: FormEvent) {
    event.preventDefault();
    if (!journey?.draft) return;
    await act("revise", {
      expectedDigest: journey.draft.digest,
      dropAssertionIds: dropAssertions,
      notes: revisionNotes.trim(),
    });
    setDropAssertions([]);
    setRevisionNotes("");
  }
  async function exportEvidence() {
    if (!journey) return;
    try {
      download(
        await api<unknown>(endpoint(journey.id, "export")),
        `passage-repository-${journey.id}.json`,
      );
    } catch (failure) {
      setError((failure as Error).message);
    }
  }
  async function revision(event: FormEvent) {
    event.preventDefault();
    try {
      const snapshot = JSON.parse(revisionJson) as PublicRepositorySnapshot;
      await act("revision", { label: revisionLabel.trim(), snapshot });
    } catch {
      setError("The revision manifest must contain valid JSON.");
    }
  }
  if (loading)
    return (
      <div className="page compiler-loading" role="status">
        <GitBranch size={34} />
        <h1>Checking the repository adapter…</h1>
        <p>Reading worker qualification and stored source manifests.</p>
      </div>
    );
  if (!bootstrap)
    return (
      <div className="page narrow">
        <PageHead title="The repository adapter is unavailable." />
        <Notice tone="error">
          {error || "The local service could not be reached."}
        </Notice>
        <Link className="button button-secondary" to="/compiler/new">
          Open authored journeys <ArrowRight size={16} />
        </Link>
      </div>
    );
  return (
    <div className="page compiler-page repository-page">
      <Link className="breadcrumb" to="/compiler/new">
        Journey compiler <ChevronRight size={14} /> Public source adapter
      </Link>
      {!id ? (
        <>
          <PageHead
            eyebrow="A BOUNDED REACT SOURCE ADAPTER"
            title="Bring the source. Keep the scope clear."
          >
            <p>
              Import an immutable public source manifest and a typed interaction
              contract. The qualified worker builds the bounded source snapshot;
              no repository script runs on the host.
            </p>
          </PageHead>
          <div className="repository-worker-status">
            <ShieldCheck size={24} />
            <div>
              <p className="eyebrow">
                DISPOSABLE WORKER · {bootstrap.worker.status}
              </p>
              <h2>
                {bootstrap.worker.status === "ready"
                  ? "The isolated build adapter is ready."
                  : "Execution is blocked until the worker qualifies."}
              </h2>
              <p>
                {bootstrap.worker.reason ??
                  `${bootstrap.worker.runtime?.context ?? "Qualified runtime"} · ${bootstrap.worker.runtime?.image ?? "pinned image"}`}
              </p>
              <small>Last checked {time(bootstrap.worker.checkedAt)}</small>
            </div>
          </div>
          <div className="compiler-setup repository-import">
            <form className="panel compiler-setup-form" onSubmit={create}>
              <label>
                Source snapshot label
                <input
                  value={label}
                  onChange={(event) => setLabel(event.target.value)}
                  maxLength={160}
                  required
                  disabled={busy}
                  placeholder="Repository and revision being evaluated"
                />
              </label>
              <label>
                The task to preserve
                <textarea
                  value={task}
                  onChange={(event) => setTask(event.target.value)}
                  rows={2}
                  required
                  maxLength={2000}
                  disabled={busy}
                />
              </label>
              <JsonInput
                label="Public source manifest"
                value={snapshotJson}
                onChange={setSnapshotJson}
                disabled={busy}
                onError={setError}
              />
              <JsonInput
                label="Typed journey contract"
                maxBytes={100_000}
                value={contractJson}
                onChange={setContractJson}
                disabled={busy}
                onError={setError}
              />
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  required
                  checked={permission}
                  onChange={(event) => setPermission(event.target.checked)}
                  disabled={busy}
                />
                <span>
                  I have permission to use this public source snapshot for
                  development. I understand that its source and captured
                  evidence are sent to the configured provider only when I
                  choose live drafting or repair.
                </span>
              </label>
              {error ? <Notice tone="error">{error}</Notice> : null}
              <button
                className="button button-large"
                disabled={
                  busy || !permission || bootstrap.worker.status !== "ready"
                }
              >
                {busy
                  ? "Importing the immutable snapshot…"
                  : "Create source journey"}
                <ArrowRight size={17} />
              </button>
            </form>
            <aside className="compiler-setup-scope repository-import-scope">
              <p className="eyebrow">EXPLICIT INPUTS, VISIBLE LIMITS</p>
              <h2>A manifest is a snapshot of source.</h2>
              <article>
                <h3>Source identity</h3>
                <p>
                  The manifest contains the public repository URL, immutable
                  revision, file content and hashes, entry point, and permitted
                  module bindings. The server checks manifest integrity before
                  building. Uploaded bytes are operator supplied. A separate
                  local Git inspection can bind files to local blobs and the
                  configured remote; public upstream commit membership remains
                  unauthenticated.
                </p>
              </article>
              <article>
                <h3>Reviewed interaction intent</h3>
                <p>
                  The typed contract supplies bounded semantic actions and
                  assertions. Capture shows the actual attempt; observed and
                  inferred obligations remain subject to operator review.
                </p>
              </article>
              <article>
                <h3>Completion needs its own evidence</h3>
                <p>
                  Browser checks alone cannot prove a stored business
                  transaction. Protected outcome verification is shown only when
                  a configured observer actually establishes it.
                </p>
              </article>
              {bootstrap.limitations.map((item) => (
                <p className="small muted" key={item}>
                  {item}
                </p>
              ))}
            </aside>
          </div>
          {bootstrap.sessions.length ? (
            <section className="repository-session-library">
              <p className="eyebrow">STORED PUBLIC SOURCE JOURNEYS</p>
              <h2>Continue with the exact evidence.</h2>
              <div>
                {bootstrap.sessions.map((item) => (
                  <Link
                    className="panel"
                    key={item.id}
                    to={`/compiler/repositories/${item.id}`}
                  >
                    <div>
                      <Badge>{item.status}</Badge>
                      <GitBranch size={20} />
                    </div>
                    <h3>{item.label}</h3>
                    <p>{item.task}</p>
                    <span className="mono small">
                      {short(item.snapshot.revision)} ·{" "}
                      {short(item.snapshot.sourceDigest)}
                    </span>
                    <span className="text-link">
                      Inspect journey <ArrowRight size={16} />
                    </span>
                  </Link>
                ))}
              </div>
            </section>
          ) : null}
        </>
      ) : journey ? (
        <>
          <div className="compiler-session-head">
            <div>
              <p className="eyebrow">
                PUBLIC SOURCE JOURNEY · IMMUTABLE SNAPSHOT
              </p>
              <h1>{journey.task}</h1>
              <p>
                {journey.label} <span>·</span>{" "}
                {short(journey.snapshot.revision)}
              </p>
            </div>
            <Badge>
              {journey.review ? "Reviewed contract" : "Review pending"}
            </Badge>
          </div>
          {expectsProtectedOutcome ? (
            <Notice
              tone={
                journey.outcomeVerification === "verified" ? "info" : "warning"
              }
              title={
                journey.outcomeVerification === "verified"
                  ? "Protected outcome evidence is available"
                  : "Business completion remains unverified"
              }
            >
              This contract expects a protected business outcome. Browser
              interaction checks alone cannot establish that outcome. Separately
              bound assistive-technology captures retain their own scope;
              participant benefit and independent accessibility acceptance
              remain unverified.
            </Notice>
          ) : (
            <details
              style={{
                margin: "0 0 18px",
                color: "var(--muted)",
                fontSize: 12,
              }}
            >
              <summary
                style={{
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <ShieldCheck size={15} />
                <span>Checks task state in this browser session</span>
                <ChevronRight size={14} />
              </summary>
              <div style={{ padding: "12px 0 0", maxWidth: 850 }}>
                <p>
                  No protected business-outcome assertion is part of this
                  contract. The recorded browser checks establish only the
                  requested interaction and task state in this session.
                </p>
                <p style={{ marginTop: 8 }}>
                  Separately bound assistive-technology captures retain their
                  own source, environment, and outcome scope. Participant
                  benefit and independent accessibility acceptance remain
                  unverified.
                </p>
                {bootstrap.limitations.map((item) => (
                  <p key={item} style={{ marginTop: 8 }}>
                    {item}
                  </p>
                ))}
              </div>
            </details>
          )}
          <div className="compiler-workspace repository-workspace">
            <aside className="compiler-sidebar">
              <nav aria-label="Public source journey stages">
                {(
                  [
                    {
                      key: "observe",
                      label: "Build & observe",
                      icon: Keyboard,
                    },
                    {
                      key: "contract",
                      label: "Review the contract",
                      icon: Braces,
                    },
                    {
                      key: "repair",
                      label: "Repair the source",
                      icon: FileCode2,
                    },
                    {
                      key: "verify",
                      label: "Check & export",
                      icon: ShieldCheck,
                    },
                  ] as const
                ).map((item, index) => (
                  <button
                    key={item.key}
                    className={view === item.key ? "active" : ""}
                    aria-current={view === item.key ? "step" : undefined}
                    onClick={() => setView(item.key)}
                  >
                    <item.icon size={19} />
                    <span>
                      <small>0{index + 1}</small>
                      <strong>{item.label}</strong>
                    </span>
                    <ChevronRight size={14} />
                  </button>
                ))}
              </nav>
              <details className="compiler-session-identity">
                <summary>
                  <Fingerprint size={15} />
                  Snapshot identity
                </summary>
                <dl className="simple-facts">
                  <div>
                    <dt>Repository</dt>
                    <dd className="mono break-anywhere">
                      {journey.snapshot.repositoryUrl}
                    </dd>
                  </div>
                  <div>
                    <dt>Revision</dt>
                    <dd className="mono break-anywhere">
                      {journey.snapshot.revision}
                    </dd>
                  </div>
                  <div>
                    <dt>Source digest</dt>
                    <dd className="mono break-anywhere">
                      {journey.snapshot.sourceDigest}
                    </dd>
                  </div>
                  <div>
                    <dt>Contract</dt>
                    <dd className="mono break-anywhere">
                      {journey.contract?.digest ?? "Not frozen"}
                    </dd>
                  </div>
                  <div>
                    <dt>Source provenance</dt>
                    <dd>
                      {journey.sourceProvenance?.kind === "git-blob-inspection"
                        ? "Local Git blobs inspected"
                        : "Operator-provided manifest · upstream identity unverified"}
                    </dd>
                  </div>
                  {journey.sourceProvenance?.correction ? (
                    <div>
                      <dt>Provenance correction</dt>
                      <dd>{journey.sourceProvenance.correction}</dd>
                    </div>
                  ) : null}
                  {journey.sourceProvenance?.detail ? (
                    <div>
                      <dt>Provenance detail</dt>
                      <dd>{journey.sourceProvenance.detail}</dd>
                    </div>
                  ) : null}
                </dl>
              </details>
              <div className="compiler-at-note">
                <LockKeyhole size={16} />
                <strong>Public-source development</strong>
                {journey.assistiveCaptures?.length ? (
                  <button
                    className="text-link"
                    onClick={() => {
                      setView("observe");
                      requestAnimationFrame(() => {
                        const panel = document.getElementById(
                          "repository-at-evidence",
                        ) as HTMLDetailsElement | null;
                        if (panel) {
                          panel.open = true;
                          panel.scrollIntoView({ block: "start" });
                        }
                      });
                    }}
                  >
                    Inspect actual AT capture <ArrowRight size={14} />
                  </button>
                ) : null}
                <p>
                  Browser replay itself does not capture screen-reader speech.
                  Bound assistive-technology recordings retain their own source
                  and outcome scope.
                </p>
              </div>
            </aside>
            <section
              className="panel compiler-main"
              aria-label="Public source journey workspace"
            >
              {error || journey.error ? (
                <Notice tone="error" title={journey.error?.code}>
                  {error || journey.error?.message}
                </Notice>
              ) : null}
              {busy ? (
                <div className="compiler-operation" role="status">
                  <span className="compiler-pulse" />
                  <p>
                    {journey.status === "ready"
                      ? "Saving the requested operation…"
                      : `${journey.status.charAt(0).toUpperCase()}${journey.status.slice(1)} the actual source journey…`}
                    <small>
                      Recorded results appear when the worker finishes.
                    </small>
                  </p>
                  <button
                    className="text-link"
                    disabled={requestBusy}
                    onClick={() => void act("cancel")}
                  >
                    Cancel
                  </button>
                </div>
              ) : null}
              {view === "observe" ? (
                <>
                  <div className="compiler-section-head">
                    <div>
                      <p className="eyebrow">01 / BUILD & OBSERVE</p>
                      <h2>Reproduce on the exact source.</h2>
                      <p>
                        Build the supplied manifest in the qualified disposable
                        worker, then execute the proposed bounded journey to
                        retain actual actions and events.
                      </p>
                    </div>
                    <GitBranch size={27} />
                  </div>
                  <div className="compiler-control-row">
                    <button
                      className="button button-secondary"
                      disabled={busy || bootstrap.worker.status !== "ready"}
                      onClick={() => void act("build")}
                    >
                      <FileCode2 size={16} />
                      {journey.build
                        ? "Rebuild this snapshot"
                        : "Build the source snapshot"}
                    </button>
                    <button
                      className="button"
                      disabled={busy || !journey.build}
                      onClick={() => void act("capture")}
                    >
                      <Play size={16} />
                      Capture the original journey
                    </button>
                  </div>
                  {journey.build ? (
                    <p className="small muted">
                      Build <code>{short(journey.build.id)}</code> · Bundle{" "}
                      <code>{short(journey.build.bundleDigest)}</code> ·{" "}
                      {journey.build.isolation.runtime}
                    </p>
                  ) : (
                    <div className="compiler-empty">
                      <GitBranch size={32} />
                      <h3>This source has not been built yet.</h3>
                      <p>
                        The manifest will be checked before any isolated build
                        starts.
                      </p>
                    </div>
                  )}
                  {replay ? (
                    <ReplayEvidence
                      key={replay.id}
                      replay={replay}
                      expectsOutcome={expectsProtectedOutcome}
                    />
                  ) : null}
                  <ActualATPanel
                    captures={journey.assistiveCaptures ?? []}
                    originalDigest={journey.snapshot.sourceDigest}
                    repairedDigests={journey.repairs.flatMap((attempt) =>
                      attempt.status === "accepted"
                        ? journey.replays
                            .filter(
                              (execution) =>
                                execution.id === attempt.replayId &&
                                execution.contractDigest ===
                                  attempt.contractDigest &&
                                execution.execution.passed,
                            )
                            .map((execution) => execution.sourceDigest)
                        : [],
                    )}
                    busy={busy}
                    attach={(body) => act("assistive-evidence", body)}
                  />
                  <details className="compiler-disclosure">
                    <summary>
                      Inspect permitted source files <ChevronRight size={16} />
                    </summary>
                    {journey.snapshot.files.map((file) => (
                      <details
                        key={file.path}
                        className="repository-source-file"
                      >
                        <summary>
                          <FileCode2 size={14} />
                          <code>{file.path}</code>
                          <span className="mono small">
                            {short(file.sha256)}
                          </span>
                        </summary>
                        <pre className="compiler-code">{file.content}</pre>
                      </details>
                    ))}
                  </details>
                </>
              ) : view === "contract" ? (
                <>
                  <div className="compiler-section-head">
                    <div>
                      <p className="eyebrow">02 / REVIEW THE JOURNEY</p>
                      <h2>Make the requirements explicit.</h2>
                      <p>
                        A supplied contract is a proposal. Captured evidence
                        grounds the draft, and inferred obligations need the
                        reviewers’ judgment.
                      </p>
                    </div>
                    <Braces size={27} />
                  </div>
                  <div className="compiler-control-row">
                    <label>
                      Drafting method
                      <select
                        value={draftMode}
                        onChange={(event) =>
                          setDraftMode(
                            event.target.value as "observed" | "live",
                          )
                        }
                        disabled={busy}
                      >
                        <option value="observed">
                          Observed · deterministic assisted authoring
                        </option>
                        <option
                          value="live"
                          disabled={!bootstrap.provider.enabled}
                        >
                          Live · {providerName(bootstrap.provider.provider)}
                        </option>
                      </select>
                    </label>
                    <button
                      className="button button-secondary"
                      disabled={busy || !journey.replays.length}
                      onClick={() => void act("draft", { mode: draftMode })}
                    >
                      <Sparkles size={16} />
                      {journey.draft
                        ? "Revise requirements"
                        : "Compile a draft"}
                    </button>
                  </div>
                  {journey.draft ? (
                    <>
                      <div className="compiler-draft-head">
                        <div>
                          <Badge>
                            {journey.draft.method === "live"
                              ? "Model-authored draft"
                              : String(journey.draft.method) ===
                                  "operator-revision"
                                ? "Explicitly corrected draft"
                                : "Observed assisted draft"}
                          </Badge>
                          <p>{journey.draft.summary}</p>
                        </div>
                        <code className="small">
                          {short(journey.draft.digest)}
                        </code>
                      </div>
                      <div className="compiler-obligations">
                        {journey.draft.obligations.map((item, index) => (
                          <article key={item.id}>
                            <div className="compiler-obligation-top">
                              <span className="compiler-number">
                                {String(index + 1).padStart(2, "0")}
                              </span>
                              <Badge
                                tone={
                                  item.origin === "inferred"
                                    ? "warning"
                                    : "neutral"
                                }
                              >
                                {item.origin === "inferred"
                                  ? "Inferred · review required"
                                  : "Grounded in observed evidence"}
                              </Badge>
                            </div>
                            <h3>{item.text}</h3>
                            <div className="compiler-evidence-refs">
                              {item.evidenceRefs.map((ref) => (
                                <button
                                  key={ref}
                                  onClick={() => setView("observe")}
                                >
                                  <Fingerprint size={12} />
                                  {ref}
                                </button>
                              ))}
                            </div>
                          </article>
                        ))}
                      </div>
                      {journey.draft.ambiguities.length ? (
                        <div className="compiler-ambiguities">
                          <h3>Questions for the reviewers</h3>
                          <ul>
                            {journey.draft.ambiguities.map((item) => (
                              <li key={item}>{item}</li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                      {journey.draft.body.assertions.some(
                        (assertion) =>
                          !journey.proposedContract.assertions.some(
                            (base) => base.id === assertion.id,
                          ),
                      ) ? (
                        <details className="compiler-disclosure repository-correct-draft">
                          <summary>
                            Correct proposed additions before approval{" "}
                            <Braces size={16} />
                          </summary>
                          <p>
                            Original supplied requirements remain protected.
                            Remove a model-added requirement only when its
                            expected behavior is wrong for this task; the reason
                            is retained in a new draft version.
                          </p>
                          <form onSubmit={reviseDraft}>
                            {journey.draft.body.assertions
                              .filter(
                                (assertion) =>
                                  !journey.proposedContract.assertions.some(
                                    (base) => base.id === assertion.id,
                                  ),
                              )
                              .map((assertion) => (
                                <label
                                  className="checkbox-label"
                                  key={assertion.id}
                                >
                                  <input
                                    type="checkbox"
                                    checked={dropAssertions.includes(
                                      assertion.id,
                                    )}
                                    onChange={(event) =>
                                      setDropAssertions((previous) =>
                                        event.target.checked
                                          ? [...previous, assertion.id]
                                          : previous.filter(
                                              (value) => value !== assertion.id,
                                            ),
                                      )
                                    }
                                    disabled={busy}
                                  />
                                  <span>
                                    <strong>
                                      Remove this proposed requirement
                                    </strong>
                                    <span>{assertion.label}</span>
                                    <small className="mono">
                                      {assertion.id}
                                    </small>
                                  </span>
                                </label>
                              ))}
                            <label>
                              Reason for the correction
                              <textarea
                                value={revisionNotes}
                                onChange={(event) =>
                                  setRevisionNotes(event.target.value)
                                }
                                required
                                minLength={10}
                                maxLength={3000}
                                rows={3}
                                disabled={busy}
                                placeholder="Explain why the selected additions do not match the intended task."
                              />
                            </label>
                            <button
                              className="button button-secondary"
                              disabled={
                                busy ||
                                !dropAssertions.length ||
                                revisionNotes.trim().length < 10
                              }
                            >
                              Save a corrected draft <ArrowRight size={15} />
                            </button>
                          </form>
                        </details>
                      ) : null}
                      {journey.review && journey.contract ? (
                        <div className="compiler-frozen">
                          <LockKeyhole size={24} />
                          <div>
                            <p className="eyebrow">FROZEN REVIEWED CONTRACT</p>
                            <h3>Approved for this source journey.</h3>
                            <p>
                              Task intent review: {journey.review.maintainer}
                              <br />
                              Interaction review:{" "}
                              {journey.review.interactionReviewer}
                            </p>
                            <p className="small muted">
                              {String(journey.review.evidenceClass) ===
                              "automated-development-review"
                                ? "Automated development review · human and independent review not established."
                                : "Operator-attested · independent review not established."}
                            </p>
                            <code className="break-anywhere">
                              {journey.contract.digest}
                            </code>
                          </div>
                        </div>
                      ) : (
                        <form
                          className="compiler-review-form"
                          onSubmit={review}
                        >
                          <p className="eyebrow">EXPLICIT REVIEW PROVENANCE</p>
                          <h3>Review intent and interaction separately.</h3>
                          <p className="small muted">
                            Identify the review process. Automated review does
                            not establish human review; neither option
                            establishes independent accessibility acceptance.
                            Correct missing or incorrect behavior before
                            approval.
                          </p>
                          <label>
                            Review provenance
                            <select
                              value={reviewProvenance}
                              onChange={(event) =>
                                setReviewProvenance(
                                  event.target.value as typeof reviewProvenance,
                                )
                              }
                              disabled={busy}
                            >
                              <option value="automated-development">
                                Automated development review
                              </option>
                              <option value="operator-attested">
                                Operator-attested review
                              </option>
                            </select>
                          </label>
                          <div className="compiler-form-grid">
                            <label>
                              Task intent reviewer
                              <input
                                value={maintainer}
                                onChange={(event) =>
                                  setMaintainer(event.target.value)
                                }
                                required
                                maxLength={120}
                                disabled={busy}
                              />
                            </label>
                            <label>
                              Interaction reviewer
                              <input
                                value={reviewer}
                                onChange={(event) =>
                                  setReviewer(event.target.value)
                                }
                                required
                                maxLength={120}
                                disabled={busy}
                              />
                            </label>
                          </div>
                          <label className="checkbox-label">
                            <input
                              type="checkbox"
                              checked={acknowledge}
                              onChange={(event) =>
                                setAcknowledge(event.target.checked)
                              }
                              required
                              disabled={busy}
                            />
                            <span>
                              I reviewed the evidence, inferred requirements,
                              ambiguities, and outcome scope. Freeze this exact
                              draft for repair and subsequent checks.
                            </span>
                          </label>
                          <button
                            className="button"
                            disabled={
                              busy ||
                              !acknowledge ||
                              !maintainer.trim() ||
                              !reviewer.trim()
                            }
                          >
                            <LockKeyhole size={16} />
                            Approve & freeze contract
                          </button>
                        </form>
                      )}
                      <details className="compiler-disclosure">
                        <summary>
                          Inspect exact typed contract & provenance{" "}
                          <ChevronRight size={16} />
                        </summary>
                        <pre className="compiler-code">
                          {JSON.stringify(journey.draft.body, null, 2)}
                        </pre>
                        {journey.draft.receipt ? (
                          <pre className="compiler-code">
                            {JSON.stringify(journey.draft.receipt, null, 2)}
                          </pre>
                        ) : (
                          <p className="small muted">
                            No model inference was used for this observed draft.
                          </p>
                        )}
                      </details>
                    </>
                  ) : (
                    <div className="compiler-empty">
                      <Braces size={33} />
                      <h3>Capture an actual attempt first.</h3>
                      <p>
                        The observed trace will distinguish evidence from
                        requirements that still need review.
                      </p>
                    </div>
                  )}
                </>
              ) : view === "repair" ? (
                <>
                  <div className="compiler-section-head">
                    <div>
                      <p className="eyebrow">03 / LOCATE & REPAIR</p>
                      <h2>A source patch with evidence.</h2>
                      <p>
                        The model receives the bounded snapshot and reviewed
                        contract. Verified source references and retained
                        attempts make the change reviewable.
                      </p>
                    </div>
                    <FileCode2 size={27} />
                  </div>
                  <div className="compiler-live-action">
                    <div>
                      <Badge>Paid live inference</Badge>
                      <strong>
                        {providerName(bootstrap.provider.provider)} ·{" "}
                        {bootstrap.provider.model}
                      </strong>
                      <p className="small muted">{bootstrap.provider.reason}</p>
                    </div>
                    <button
                      className="button"
                      disabled={
                        busy || !journey.review || !bootstrap.provider.enabled
                      }
                      onClick={() => void act("repair", { mode: "live" })}
                    >
                      <Sparkles size={16} />
                      Repair the scoped source
                    </button>
                  </div>
                  {!journey.review ? (
                    <Notice>
                      Approve the exact contract before starting a repair.
                    </Notice>
                  ) : null}
                  {repair ? (
                    <>
                      <div className="compiler-evidence-heading">
                        <h3>
                          {repair.patches.length
                            ? `${repair.patches.length} source ${repair.patches.length === 1 ? "file" : "files"} changed`
                            : repair.status === "error"
                              ? "No source patch produced"
                              : "Source inspection in progress"}
                        </h3>
                        <Badge
                          tone={
                            repair.status === "rejected" ||
                            repair.status === "error"
                              ? "warning"
                              : "neutral"
                          }
                        >
                          {repair.status}
                        </Badge>
                      </div>
                      {repair.summary ? (
                        <details
                          className="compiler-disclosure"
                          style={{ marginTop: 0 }}
                        >
                          <summary>
                            Repair summary <ChevronRight size={16} />
                          </summary>
                          <p style={{ whiteSpace: "pre-line" }}>
                            {repair.summary}
                          </p>
                        </details>
                      ) : null}
                      {repair.inspection ? (
                        <details
                          className="compiler-disclosure"
                          style={{ marginTop: 0 }}
                        >
                          <summary>
                            <span>
                              {repair.inspection.method ===
                              "deterministic-single-file"
                                ? "Only permitted file · selected by the controller (no model call)"
                                : "Source files selected by the model"}
                            </span>
                            <Fingerprint size={16} />
                          </summary>
                          {repair.inspection.purpose ? (
                            <p>{repair.inspection.purpose}</p>
                          ) : null}
                          <dl className="simple-facts">
                            {repair.inspection.files.map((file) => (
                              <div key={file.path}>
                                <dt className="mono break-anywhere">
                                  {file.path}
                                </dt>
                                <dd>
                                  <code className="break-anywhere">
                                    {file.sourceDigest}
                                  </code>
                                  <br />
                                  <small>
                                    {file.bytes.toLocaleString()} bytes
                                  </small>
                                </dd>
                              </div>
                            ))}
                          </dl>
                        </details>
                      ) : null}
                      {repair.error ? (
                        <Notice tone="error">{repair.error}</Notice>
                      ) : null}
                      <div className="compiler-source-locations">
                        {repair.locations.map((location, index) => (
                          <article key={`${location.path}-${index}`}>
                            <div>
                              <FileCode2 size={15} />
                              <strong className="mono break-anywhere">
                                {location.path}:{location.startLine}–
                                {location.endLine}
                              </strong>
                              <Badge>
                                {location.verified
                                  ? "Source reference checked"
                                  : "Unverified location"}
                              </Badge>
                            </div>
                            <h3>{location.symbol}</h3>
                            <p>{location.reason}</p>
                            <p className="mono small break-anywhere">
                              {location.evidenceRefs.join(" · ")}
                            </p>
                          </article>
                        ))}
                      </div>
                      {repair.patches.map((patch) => (
                        <details
                          className="compiler-disclosure"
                          key={patch.path}
                          open
                        >
                          <summary>
                            <span>
                              Patch · <code>{patch.path}</code>
                            </span>
                            <ChevronRight size={15} />
                          </summary>
                          <p className="small">
                            {short(patch.beforeDigest)} →{" "}
                            {short(patch.afterDigest)}
                          </p>
                          <pre className="compiler-code">{patch.diff}</pre>
                        </details>
                      ))}
                      <details className="compiler-disclosure">
                        <summary>
                          Inspect actual provider receipts{" "}
                          <Fingerprint size={16} />
                        </summary>
                        {repair.receipts.map((receipt, index) => (
                          <ReceiptSummary
                            key={`${receipt.requestId}-${index}`}
                            receipt={receipt}
                          />
                        ))}
                        <details className="compiler-disclosure">
                          <summary>
                            Raw provider receipts <ChevronRight size={14} />
                          </summary>
                          <pre className="compiler-code">
                            {JSON.stringify(repair.receipts, null, 2)}
                          </pre>
                        </details>
                        <p className="small muted">
                          {journey.repairs.length} retained attempts. Contract{" "}
                          <code>{short(repair.contractDigest)}</code>.
                        </p>
                      </details>
                    </>
                  ) : (
                    <div className="compiler-empty">
                      <FileCode2 size={33} />
                      <h3>No repair is claimed yet.</h3>
                      <p>
                        Actual model output, source localization, and patch
                        results appear after a live attempt.
                      </p>
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div className="compiler-section-head">
                    <div>
                      <p className="eyebrow">04 / CHECK THE SAME PROMISE</p>
                      <h2>Keep expectations fixed.</h2>
                      <p>
                        Recheck the original or candidate source against the
                        reviewed contract. A later manifest uses that same
                        contract unless the task is explicitly revised and
                        reviewed.
                      </p>
                    </div>
                    <ShieldCheck size={27} />
                  </div>
                  <div className="compiler-control-row">
                    <label>
                      Source under test
                      <select
                        value={variant}
                        onChange={(event) =>
                          setVariant(
                            event.target.value as "original" | "candidate",
                          )
                        }
                        disabled={busy}
                      >
                        <option value="original">
                          Original immutable snapshot
                        </option>
                        <option
                          value="candidate"
                          disabled={
                            !journey.repairs.some((item) => item.patches.length)
                          }
                        >
                          Latest model candidate
                        </option>
                      </select>
                    </label>
                    <button
                      className="button"
                      disabled={busy || !journey.review}
                      onClick={() => void act("verify", { variant })}
                    >
                      <Play size={16} />
                      Run the frozen contract
                    </button>
                  </div>
                  {journey.replays.length ? (
                    <label className="repository-replay-select">
                      Stored execution
                      <select
                        value={replay?.id ?? ""}
                        onChange={(event) => setReplayId(event.target.value)}
                      >
                        {journey.replays.map((item) => (
                          <option value={item.id} key={item.id}>
                            {item.label} · {item.execution.status} ·{" "}
                            {short(item.sourceDigest)}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                  {replay ? (
                    <ReplayEvidence
                      key={replay.id}
                      replay={replay}
                      expectsOutcome={expectsProtectedOutcome}
                    />
                  ) : (
                    <div className="compiler-empty">
                      <ShieldCheck size={32} />
                      <h3>The actual result will be retained here.</h3>
                      <p>
                        Both passing and failing executions keep their source
                        and contract identities.
                      </p>
                    </div>
                  )}
                  <div className="compiler-export">
                    <div>
                      <p className="eyebrow">REVIEWABLE, PORTABLE EVIDENCE</p>
                      <h3>Keep the contract and its source history.</h3>
                      <p>
                        Export the immutable source manifest, reviewed contract,
                        patch attempts, and observed replays as JSON.
                      </p>
                    </div>
                    <div className="compiler-export-actions">
                      <button
                        className="button button-secondary"
                        onClick={() => void exportEvidence()}
                        disabled={busy}
                      >
                        <Download size={16} />
                        Evidence JSON
                      </button>
                      {journey.review ? (
                        <a
                          className="button"
                          href={`/v1${endpoint(journey.id, "guard.zip")}`}
                          download
                        >
                          <Download size={16} />
                          Runnable guard
                        </a>
                      ) : (
                        <button className="button" disabled>
                          <Download size={16} />
                          Runnable guard
                        </button>
                      )}
                    </div>
                  </div>
                  <details className="compiler-disclosure">
                    <summary>
                      Check a later immutable source manifest{" "}
                      <ChevronRight size={16} />
                    </summary>
                    <form
                      className="repository-revision-form"
                      onSubmit={revision}
                    >
                      <label>
                        Revision label
                        <input
                          value={revisionLabel}
                          onChange={(event) =>
                            setRevisionLabel(event.target.value)
                          }
                          maxLength={160}
                          required
                          disabled={busy}
                        />
                      </label>
                      <JsonInput
                        label="Later public source manifest"
                        value={revisionJson}
                        onChange={setRevisionJson}
                        disabled={busy}
                        onError={setError}
                      />
                      <button
                        className="button button-secondary"
                        disabled={
                          busy ||
                          !journey.review ||
                          !revisionJson ||
                          !revisionLabel.trim()
                        }
                      >
                        <Play size={16} />
                        Check the later revision
                      </button>
                    </form>
                  </details>
                </>
              )}
            </section>
          </div>
          <div className="compiler-bottom-scope">
            <LockKeyhole size={15} />
            <p>{bootstrap.limitations.join(" ")}</p>
            <Link to="/compiler/repositories">
              Import another snapshot <ArrowRight size={14} />
            </Link>
          </div>
        </>
      ) : (
        <>
          <PageHead title="This source journey could not be opened." />
          <Notice tone="error">
            {error || "The source journey was not found."}
          </Notice>
          <Link to="/compiler/repositories" className="button button-secondary">
            Return to source adapter <ArrowRight size={15} />
          </Link>
        </>
      )}
    </div>
  );
}
