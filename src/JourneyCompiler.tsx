import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import {
  ArrowRight,
  ArrowUpRight,
  Braces,
  Check,
  ChevronRight,
  CircleAlert,
  Download,
  ExternalLink,
  FileCode2,
  Fingerprint,
  GitBranch,
  Keyboard,
  LockKeyhole,
  Play,
  RefreshCw,
  Route,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import type { BootstrapData, ModelReceipt } from "../shared/types";
import type {
  RepositoryJourney,
  RepositoryJourneyBootstrap,
  RepositoryReplay,
} from "../shared/repository-journey";
import type {
  CompilerBootstrap,
  CompilerCapture,
  CompilerDraft,
  CompilerPreservationCheck,
  CompilerSchedule,
  CompilerSession,
  CompilerTraceEvent,
  CompilerVariant,
} from "../shared/compiler";
import { compilerApi } from "./compiler-api";
import { useStore } from "./App";
import { ReceiptSummary } from "./repair";
import { api, download } from "./api";
import { Badge, Notice, PageHead, short, time } from "./ui";
import { providerName, runOriginLabel } from "./providerLabels";

type FeaturedRepair = {
  journey: RepositoryJourney;
  replay: RepositoryReplay;
  receipt: ModelReceipt;
};

export function FeaturedSourceRepair() {
  const [featured, setFeatured] = useState<FeaturedRepair | null>(null);
  const { loading, error } = useStore();
  useEffect(() => {
    if (loading || error) return;
    let active = true;
    void api<RepositoryJourneyBootstrap>("/compiler/repositories/bootstrap")
      .then((bootstrap) => {
        for (const journey of bootstrap.sessions) {
          if (
            !journey.contract ||
            !journey.review ||
            journey.sourceProvenance?.kind !== "git-blob-inspection"
          )
            continue;
          const repair = [...journey.repairs]
            .reverse()
            .find(
              (attempt) =>
                attempt.status === "accepted" &&
                attempt.contractDigest === journey.contract?.digest &&
                attempt.patches.length > 0 &&
                attempt.receipts.some(
                  (receipt) => receipt.live && receipt.provider === "nebius",
                ),
            );
          const receipt = repair?.receipts.find(
            (item) => item.live && item.provider === "nebius",
          );
          const replay = journey.replays.find(
            (item) =>
              item.id === repair?.replayId &&
              item.execution.passed &&
              item.contractDigest === journey.contract?.digest &&
              item.sourceDigest !== journey.snapshot.sourceDigest,
          );
          if (receipt && replay) {
            if (active) setFeatured({ journey, replay, receipt });
            break;
          }
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [loading, error]);
  if (!featured) return null;
  const { journey, replay, receipt } = featured;
  const repository =
    new URL(journey.snapshot.repositoryUrl).pathname
      .split("/")
      .filter(Boolean)
      .at(-1) ?? "React source";
  const project =
    repository.toLowerCase() === "todomvc" ? "TodoMVC" : repository;
  const keyboardEditCase = [
    "keyboard-entry",
    "cancel-preserves",
    "save-works",
  ].every(
    (id) =>
      journey.contract?.assertions.some((assertion) => assertion.id === id) &&
      replay.execution.checks.some(
        (check) => check.id === id && check.status === "passed",
      ),
  );
  const automated =
    journey.review?.evidenceClass === "automated-development-review";
  const servedModel = receipt.servedModel ?? receipt.model;
  const compactModel = servedModel.toLowerCase().includes("nemotron-3-ultra")
    ? "NVIDIA Nemotron 3 Ultra"
    : servedModel;
  return (
    <section
      className="home-featured-source"
      aria-label="Featured independently authored source repair"
    >
      <div className="home-featured-source-main">
        <p className="eyebrow">FEATURED · INDEPENDENTLY AUTHORED SOURCE</p>
        <Link
          to={`/compiler/repositories/${journey.id}`}
          className="home-featured-source-link"
        >
          <strong>
            {project}
            {keyboardEditCase
              ? ": keyboard edit, cancel & save"
              : ": recorded source repair"}
          </strong>
          <ArrowUpRight size={20} />
        </Link>
        <p className="home-featured-source-meta">
          Nebius / {compactModel} ·{" "}
          {
            replay.execution.checks.filter((check) => check.status === "passed")
              .length
          }
          /{replay.execution.checks.length} reviewed interaction checks ·{" "}
          {automated
            ? "Automated development review"
            : "Operator-attested review"}
        </p>
      </div>
      <details className="home-featured-source-details">
        <summary>
          Source, model & review scope <ChevronRight size={14} />
        </summary>
        <div>
          <p>
            <strong>Actual served model:</strong>{" "}
            <code>{receipt.servedModel ?? receipt.model}</code>
          </p>
          <p>
            <strong>Source:</strong> {journey.snapshot.repositoryUrl} · revision{" "}
            <code>{short(journey.snapshot.revision)}</code> · repaired source{" "}
            <code>{short(replay.sourceDigest)}</code>. Local Git blobs were
            inspected; the configured remote does not authenticate public
            upstream commit membership.
          </p>
          <p>
            <strong>Review:</strong>{" "}
            {automated
              ? "Automated development intent and interaction review"
              : "Operator-attested intent and interaction review"}
            ; independent accessibility review and participant benefit remain
            unverified. These checks cover task state in the recorded browser
            session.
          </p>
          <Link
            className="text-link"
            to={`/compiler/repositories/${journey.id}`}
          >
            Inspect the source repair & retained attempts{" "}
            <ArrowRight size={15} />
          </Link>
        </div>
      </details>
    </section>
  );
}

export function FirstJourney({
  data,
  loading,
}: {
  data: BootstrapData | null;
  loading: boolean;
}) {
  const [view, setView] = useState<"try" | "recorded">("try");
  const [frameRevision, setFrameRevision] = useState(0);
  const entry = useRef<HTMLAnchorElement>(null);
  const [story, setStory] = useState<CompilerBootstrap["story"]>(null);
  const [recordedSessionId, setRecordedSessionId] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void compilerApi
      .bootstrap()
      .then(async (result) => {
        if (active) setRecordedSessionId(result.recordedSessionId);
        return result.story ?? compilerApi.story();
      })
      .then((result) => {
        if (active) setStory(result);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);
  const fixture =
    data?.fixtures.find((item) => item.id === story?.fixtureId) ??
    data?.fixtures[0];
  const original = data?.runs.find(
    (run) => run.fixtureId === fixture?.id && run.baseline?.previewUrl,
  )?.baseline;
  const previewUrl = story?.originalPreviewUrl || original?.previewUrl;
  const recordedRun = data?.runs.find(
    (run) =>
      (!story?.recordedRunId || run.id === story.recordedRunId) &&
      run.fixtureId === fixture?.id &&
      run.candidates.some(
        (candidate) =>
          candidate.verification?.passed && candidate.verification.outcome,
      ),
  );
  const recorded = recordedRun?.candidates.find(
    (candidate) =>
      candidate.verification?.passed && candidate.verification.outcome,
  );
  const result = recorded?.verification;
  return (
    <section className="story-canvas" aria-labelledby="first-task-title">
      <div className="story-canvas-head">
        <span className="small-overline">
          <Route size={15} /> ONE TASK. A REAL BROWSER.
        </span>
        <Badge>Authored sample · fictional data</Badge>
      </div>
      <div className="story-layout">
        <div className="story-task">
          <p className="eyebrow">THE TASK</p>
          <h2 id="first-task-title">
            {fixture?.task ?? "Load a journey to try the task."}
          </h2>
          <p>{fixture?.organization ?? "The local journey library"}</p>
          <div className="story-stage-label">
            <span>01</span>
            <strong>Try the blocked action</strong>
          </div>
          <p className="story-instruction">
            <Keyboard size={19} /> Use Tab and Enter in the application. Can you
            reach the control and complete the task?
          </p>
          <div className="story-barrier">
            <span className="eyebrow">SEEDED BARRIER</span>
            <p>
              {fixture?.barrier ??
                (loading
                  ? "Loading the original application…"
                  : "Connect the local service to load the application.")}
            </p>
          </div>
          <div className="story-actions">
            {previewUrl ? (
              <a
                ref={entry}
                className="button button-secondary"
                href="#first-journey-app"
                onClick={(event) => {
                  event.preventDefault();
                  setView("try");
                  document.getElementById("first-journey-app")?.focus();
                }}
              >
                Try the keyboard <ArrowRight size={16} />
              </a>
            ) : null}
            <button
              className="text-link"
              disabled={!result}
              onClick={() => setView("recorded")}
            >
              Historical {result?.checks.length ?? 9}-check repair{" "}
              <ArrowUpRight size={16} />
            </button>
          </div>
          {recordedSessionId ? (
            <Link className="text-link small" to={`/compiler/${recordedSessionId}`}>
              Reviewed appointment repair <ArrowUpRight size={15} />
            </Link>
          ) : null}
          {!result && !loading ? (
            <p className="small muted">
              A recorded repair will appear here after a stored run has verified
              the exact outcome.
            </p>
          ) : null}
          <Link
            className="button button-large story-compile-link"
            to={
              fixture ? `/compiler/new?fixture=${fixture.id}` : "/compiler/new"
            }
          >
            Repair a journey <Sparkles size={18} />
          </Link>
          <p className="small muted">
            Record evidence, review the contract, then run a source repair.
          </p>
        </div>
        <div className="story-application">
          <div className="story-view-tabs" aria-label="Journey evidence view">
            <button
              aria-pressed={view === "try"}
              className={view === "try" ? "active" : ""}
              onClick={() => setView("try")}
            >
              Original application
            </button>
            <button
              aria-pressed={view === "recorded"}
              className={view === "recorded" ? "active" : ""}
              disabled={!result}
              onClick={() => setView("recorded")}
            >
              Historical {result?.checks.length ?? 9}-check repair{" "}
              {result ? <span className="dot" /> : null}
            </button>
          </div>
          {view === "try" ? (
            <>
              <div className="story-app-toolbar">
                <span>
                  <span className="dot" /> {fixture?.name ?? "Application"}
                </span>
                <button
                  className="icon-button"
                  title="Reload the original application"
                  aria-label="Reload the original application"
                  disabled={!previewUrl}
                  onClick={() => setFrameRevision((value) => value + 1)}
                >
                  <RefreshCw size={15} />
                </button>
              </div>
              {previewUrl ? (
                <iframe
                  key={frameRevision}
                  id="first-journey-app"
                  tabIndex={0}
                  title={`Try the original ${fixture?.name ?? "journey"} with a keyboard`}
                  src={previewUrl}
                  className="story-iframe"
                />
              ) : (
                <div className="story-app-empty">
                  <Keyboard size={34} />
                  <h3>
                    {loading
                      ? "Loading the real application…"
                      : "Original application is not ready yet."}
                  </h3>
                  <p>
                    Passage displays the actual compiled application here when
                    the local service has a prepared build.
                  </p>
                  <Link className="text-link" to="/compiler/new">
                    Open the compiler <ArrowRight size={16} />
                  </Link>
                </div>
              )}
              <div className="story-app-footnote">
                <LockKeyhole size={14} /> Fictional data. This trial does not
                record a participant session.
              </div>
            </>
          ) : result && recordedRun && recorded ? (
            <div className="story-recorded">
              <div className="story-result-eyebrow">
                <Fingerprint size={16} /> HISTORICAL CHECK RESULT ·{" "}
                {time(result.completedAt)}
              </div>
              <h3>Historical booking result</h3>
              <p>
                {result.outcome
                  ? `${result.outcome.service} · ${result.outcome.date}`
                  : "No business outcome was stored."}
              </p>
              {result.screenshotUrl ? (
                <img
                  className="story-result-image"
                  src={result.screenshotUrl}
                  alt="Actual screenshot retained from this verification run"
                />
              ) : null}
              <div className="story-result-facts">
                <span>
                  {
                    result.checks.filter((check) => check.status === "passed")
                      .length
                  }
                  /{result.checks.length} historical checks passed
                </span>
                <span>{runOriginLabel(recordedRun)}</span>
              </div>
              <p className="small muted">
                This stored result covers the original {result.checks.length}
                -check verifier. The newer cancellation and modal-boundary
                requirements were outside that acceptance scope. It is not a
                live replay or participant finding.
              </p>
              <details className="story-inspector">
                <summary>
                  Inspect result identity <ChevronRight size={15} />
                </summary>
                <dl className="simple-facts">
                  <div>
                    <dt>Source</dt>
                    <dd className="mono">{short(result.sourceDigest)}</dd>
                  </div>
                  <div>
                    <dt>Build</dt>
                    <dd className="mono">{short(result.buildId)}</dd>
                  </div>
                  <div>
                    <dt>Stored outcome</dt>
                    <dd className="mono">{short(result.outcome?.id)}</dd>
                  </div>
                  <div>
                    <dt>Scope</dt>
                    <dd>
                      {result.browser} ·{" "}
                      {result.verifierVersion ?? "recorded verifier"}
                    </dd>
                  </div>
                </dl>
                <Link className="text-link" to={`/evidence/${recordedRun.id}`}>
                  Open full evidence <ArrowUpRight size={15} />
                </Link>
              </details>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

const activeStatuses = new Set([
  "capturing",
  "drafting",
  "repairing",
  "verifying",
]);
const operationLabels: Record<string, string> = {
  capturing: "Recording actual browser actions and application events…",
  drafting: "Compiling the captured evidence into reviewable requirements…",
  repairing: "Inspecting the permitted source and generating a repair…",
  verifying: "Running the frozen contract in an independent browser…",
};
type CompilerView = "journey" | "contract" | "repair" | "guard";
type SessionAction = (
  operation: () => Promise<CompilerSession>,
  nextView?: CompilerView,
) => Promise<void>;

function EvidenceRefs({
  refs,
  onSelect,
}: {
  refs: string[];
  onSelect: (ref: string) => void;
}) {
  return (
    <div className="compiler-evidence-refs">
      {refs.length ? (
        refs.map((ref) => (
          <button
            key={ref}
            type="button"
            onClick={() => onSelect(ref)}
            title={`Inspect evidence ${ref}`}
          >
            <Fingerprint size={12} />
            {ref}
          </button>
        ))
      ) : (
        <span className="small muted">
          No direct trace reference · review the inference
        </span>
      )}
    </div>
  );
}
function CheckResults({ capture }: { capture: CompilerCapture }) {
  return (
    <div className="compiler-checks">
      {capture.checks.map((check) => (
        <details key={check.id}>
          <summary>
            <span className={`compiler-result-dot ${check.status}`} />
            <span>{check.label}</span>
            <Badge
              tone={
                check.status === "failed" || check.status === "error"
                  ? "warning"
                  : "neutral"
              }
            >
              {check.status}
            </Badge>
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
  );
}
function TraceEventDetail({ event }: { event: CompilerTraceEvent }) {
  let detail: Record<string, unknown> | null = null;
  try {
    const parsed: unknown = JSON.parse(event.detail);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
      detail = parsed as Record<string, unknown>;
  } catch {
    /* Plain captured detail remains readable below. */
  }
  if (!detail) return <p>{event.detail}</p>;
  const expected = detail.expected;
  const actual = detail.actual;
  return (
    <div className="compiler-readable-event">
      {typeof detail.status === "string" ? (
        <Badge
          tone={
            detail.status === "failed" || detail.status === "error"
              ? "warning"
              : "neutral"
          }
        >
          {detail.status}
        </Badge>
      ) : null}
      {expected !== undefined ? (
        <p>
          <strong>Expected</strong>
          <span>{String(expected) || "An empty value"}</span>
        </p>
      ) : null}
      {actual !== undefined ? (
        <p>
          <strong>Observed</strong>
          <span>{String(actual) || "An empty value"}</span>
        </p>
      ) : null}
      {typeof detail.error === "string" ? <p>{detail.error}</p> : null}
      <details>
        <summary>Inspect raw event data</summary>
        <pre className="compiler-json">{JSON.stringify(detail, null, 2)}</pre>
      </details>
    </div>
  );
}
function TraceInspector({
  capture,
  selectedRef,
  onSelect,
}: {
  capture: CompilerCapture;
  selectedRef: string;
  onSelect: (ref: string) => void;
}) {
  const traceList = useRef<HTMLOListElement>(null);
  const event =
    capture.trace.find((item) => item.id === selectedRef) ??
    capture.trace.find(
      (item) =>
        /"status"\s*:\s*"(?:failed|error)"/.test(item.detail) ||
        /^(?:Blocked|Error):/i.test(item.label),
    ) ??
    capture.trace.find((item) =>
      capture.counterexample?.events.some((failure) => failure.id === item.id),
    ) ??
    capture.trace.find((item) => item.kind === "assertion") ??
    capture.trace[0];
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
  }, [event?.id]);
  return (
    <div className="compiler-trace-inspector">
      <ol
        ref={traceList}
        className="compiler-trace"
        aria-label="Recorded browser and application events"
      >
        {capture.trace.map((item) => (
          <li key={item.id}>
            <button
              id={`evidence-${item.id}`}
              type="button"
              aria-pressed={event?.id === item.id}
              className={event?.id === item.id ? "selected" : ""}
              onClick={() => onSelect(item.id)}
            >
              <span className="mono">
                {String(item.sequence).padStart(2, "0")}
              </span>
              <span>
                <small>
                  {item.kind} · {item.atMs}ms
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
            <p className="eyebrow">{event.kind} · OBSERVED EVENT</p>
            <h3>{event.label}</h3>
            <TraceEventDetail event={event} />
            <dl className="simple-facts">
              <div>
                <dt>Trace authority</dt>
                <dd>
                  {"provenance" in event && event.provenance
                    ? String(event.provenance).replaceAll("-", " ")
                    : "Legacy capture · provenance not recorded"}
                </dd>
              </div>
              <div>
                <dt>Evidence reference</dt>
                <dd className="mono">{event.id}</dd>
              </div>
              <div>
                <dt>Elapsed</dt>
                <dd>{event.atMs}ms</dd>
              </div>
              {event.binding ? (
                <div>
                  <dt>Binding</dt>
                  <dd className="mono">{event.binding}</dd>
                </div>
              ) : null}
              {event.correlationId ? (
                <div>
                  <dt>Correlation</dt>
                  <dd className="mono">{event.correlationId}</dd>
                </div>
              ) : null}
            </dl>
          </>
        ) : (
          <p>No trace events were retained for this execution.</p>
        )}
      </div>
    </div>
  );
}
function CapturePanel({
  session,
  bootstrap,
  busy,
  act,
  selectedRef,
  onSelect,
}: {
  session: CompilerSession;
  bootstrap: CompilerBootstrap;
  busy: boolean;
  act: SessionAction;
  selectedRef: string;
  onSelect: (ref: string) => void;
}) {
  const [variant, setVariant] = useState<"original" | "reference">("original");
  const [schedule, setSchedule] = useState<CompilerSchedule>("baseline");
  const [captureId, setCaptureId] = useState("");
  const previousCaptureCount = useRef(session.captures.length);
  useEffect(() => {
    if (previousCaptureCount.current !== session.captures.length) {
      previousCaptureCount.current = session.captures.length;
      setCaptureId("");
      onSelect("");
    }
  }, [session.captures.length, onSelect]);
  const capture =
    session.captures.find((item) =>
      item.trace.some((event) => event.id === selectedRef),
    ) ??
    session.captures.find((item) => item.id === captureId) ??
    session.captures.at(-1);
  return (
    <>
      <div className="compiler-section-head">
        <div>
          <p className="eyebrow">01 / OBSERVE</p>
          <h2>Where does the journey break?</h2>
          <p>
            Record a bounded keyboard attempt in the actual application.
            Actions, focus and application events become the evidence for
            review.
          </p>
        </div>
        <Keyboard size={28} />
      </div>
      <div className="compiler-control-row">
        <label>
          Application source
          <select
            value={variant}
            disabled={busy}
            onChange={(event) =>
              setVariant(event.target.value as "original" | "reference")
            }
          >
            <option value="original">Original · seeded barrier</option>
            <option value="reference">Handcrafted reference · no model</option>
          </select>
        </label>
        <label>
          Event schedule
          <select
            value={schedule}
            disabled={busy}
            onChange={(event) =>
              setSchedule(event.target.value as CompilerSchedule)
            }
          >
            {bootstrap.schedules.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <button
          className="button"
          disabled={busy}
          onClick={() =>
            void act(() => compilerApi.capture(session.id, variant, schedule))
          }
        >
          <Play size={16} />
          Record attempt
        </button>
      </div>
      <p className="small muted">
        {bootstrap.schedules.find((item) => item.id === schedule)?.description}{" "}
        Automated browser observation · no participant recording.
      </p>
      {capture ? (
        <>
          <div className="compiler-evidence-heading">
            <div>
              <p className="eyebrow">RECORDED EVIDENCE</p>
              <h3>
                {capture.variant} ·{" "}
                {bootstrap.schedules.find(
                  (item) => item.id === capture.scheduleId,
                )?.label ?? capture.scheduleId}
              </h3>
            </div>
            <label className="compiler-capture-select">
              <span className="sr-only">Select a capture</span>
              <select
                value={capture.id}
                onChange={(event) => {
                  setCaptureId(event.target.value);
                  onSelect("");
                }}
              >
                {session.captures.map((item, index) => (
                  <option key={item.id} value={item.id}>
                    Attempt {index + 1} · {item.variant} · {item.status}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <TraceInspector
            capture={capture}
            selectedRef={selectedRef}
            onSelect={onSelect}
          />
          {capture.counterexample ? (
            <div className="compiler-counterexample">
              <CircleAlert size={20} />
              <div>
                <p className="eyebrow">
                  {capture.counterexample.acceptedRemovals
                    ? "LOCALLY REDUCED COUNTEREXAMPLE"
                    : "BOUNDED COUNTEREXAMPLE"}
                </p>
                <h3>{capture.counterexample.minimizedSteps ? `${capture.counterexample.minimizedSteps.length} actions reproduce this failure` : "Recorded task failure"}</h3>
                <details><summary>Recorded action sequence</summary><p>{capture.counterexample.summary}</p></details>
                <small>
                  {capture.counterexample.attempts} replay attempts
                  {capture.counterexample.acceptedRemovals !== undefined ? ` · ${capture.counterexample.acceptedRemovals} actions removed` : " · recorded execution"}
                  {capture.counterexample.historyCount ? ` · ${capture.counterexample.historyCount} reduction records retained in the export` : ""}
                  {capture.counterexample.search?.inconclusiveReplays ? ` · ${capture.counterexample.search.inconclusiveReplays} inconclusive replays` : ""}
                </small>
                {capture.counterexample.search ? <p className="small muted">{capture.counterexample.search.limitation}</p> : null}
                {capture.execution.failureSignature ? (
                  <button
                    className="button button-secondary compiler-reduce-button"
                    disabled={busy}
                    onClick={() =>
                      void act(() => compilerApi.reduce(session.id, capture.id))
                    }
                  >
                    Reduce this failure <ArrowRight size={14} />
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}
          <details className="compiler-disclosure">
            <summary>
              Inspect checks, outcome, and exact build{" "}
              <ChevronRight size={16} />
            </summary>
            <CheckResults capture={capture} />
            <dl className="simple-facts">
              <div>
                <dt>Source digest</dt>
                <dd className="mono break-anywhere">{capture.sourceDigest}</dd>
              </div>
              <div>
                <dt>Build</dt>
                <dd className="mono">{capture.buildId}</dd>
              </div>
              <div>
                <dt>Capture</dt>
                <dd className="mono">{capture.id}</dd>
              </div>
              <div>
                <dt>Stored outcome</dt>
                <dd>
                  {capture.outcome ? (
                    <pre className="compiler-json">
                      {JSON.stringify(capture.outcome, null, 2)}
                    </pre>
                  ) : (
                    "No outcome stored."
                  )}
                </dd>
              </div>
            </dl>
            {capture.limitations.map((item) => (
              <p key={item} className="small muted">
                {item}
              </p>
            ))}
          </details>
          <details className="compiler-disclosure">
            <summary>
              Open the actual compiled application <ExternalLink size={16} />
            </summary>
            <a
              className="text-link"
              href={`/v1/compiler/sessions/${encodeURIComponent(session.id)}/previews/${encodeURIComponent(capture.id)}`}
              target="_blank"
              rel="noreferrer"
            >
              Open application in a separate tab <ArrowUpRight size={15} />
            </a>
            <iframe
              title={`Captured ${capture.variant} application`}
              src={`/v1/compiler/sessions/${encodeURIComponent(session.id)}/previews/${encodeURIComponent(capture.id)}`}
              className="compiler-preview"
            />
          </details>
        </>
      ) : (
        <div className="compiler-empty">
          <Route size={35} />
          <h3>The evidence starts with an attempt.</h3>
          <p>
            Run the original application to retain the actual blocked actions
            and its source identity.
          </p>
        </div>
      )}
    </>
  );
}
function ContractPanel({
  session,
  bootstrap,
  busy,
  act,
  onSelect,
}: {
  session: CompilerSession;
  bootstrap: CompilerBootstrap;
  busy: boolean;
  act: SessionAction;
  onSelect: (ref: string) => void;
}) {
  const [mode, setMode] = useState<"observed" | "live">("observed");
  const [maintainer, setMaintainer] = useState("");
  const [reviewer, setReviewer] = useState("");
  const [reviewProvenance, setReviewProvenance] = useState<
    "automated-development" | "operator-attested"
  >("automated-development");
  const [acknowledge, setAcknowledge] = useState(false);
  const draft = session.draft;
  useEffect(() => {
    setAcknowledge(false);
  }, [draft?.digest]);
  async function review(event: FormEvent) {
    event.preventDefault();
    if (draft && acknowledge)
      await act(
        () =>
          compilerApi.review(
            session.id,
            draft.digest,
            maintainer.trim(),
            reviewer.trim(),
            reviewProvenance,
          ),
        "repair",
      );
  }
  return (
    <>
      <div className="compiler-section-head">
        <div>
          <p className="eyebrow">02 / COMPILE & REVIEW</p>
          <h2>A promise about the task.</h2>
          <p>
            Observed behavior supplies evidence. Inferred requirements need a
            person’s judgment before they become acceptance criteria.
          </p>
        </div>
        <Braces size={28} />
      </div>
      <div className="compiler-control-row">
        <label>
          Drafting method
          <select
            disabled={busy}
            value={mode}
            onChange={(event) =>
              setMode(event.target.value as "observed" | "live")
            }
          >
            <option value="observed">
              Observed · deterministic assisted authoring
            </option>
            <option value="live" disabled={!bootstrap.provider.enabled}>
              Live · {providerName(bootstrap.provider.provider)}
            </option>
          </select>
        </label>
        <button
          className="button button-secondary"
          disabled={
            busy ||
            !session.captures.length ||
            (mode === "live" && !bootstrap.provider.enabled)
          }
          onClick={() => void act(() => compilerApi.draft(session.id, mode))}
        >
          <Sparkles size={16} />
          {draft ? "Revise requirements" : "Compile a draft"}
        </button>
      </div>
      {session.review ? (
        <Notice title="Review is frozen for this version">
          Existing results remain bound to{" "}
          <code>{short(session.review.contractDigest)}</code>. Revising creates
          a new draft and requires a new review; prior evidence keeps its
          original digest.
        </Notice>
      ) : null}
      {draft ? (
        <>
          <div className="compiler-draft-head">
            <div>
              <Badge>
                Draft {draft.version} ·{" "}
                {draft.method === "live"
                  ? "model-authored"
                  : "observed assistance"}
              </Badge>
              <p>{draft.summary}</p>
            </div>
            <span className="mono small">{short(draft.digest)}</span>
          </div>
          <div className="compiler-obligations">
            {draft.obligations.map((item, index) => (
              <article key={item.id}>
                <div className="compiler-obligation-top">
                  <span className="compiler-number">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <Badge
                    tone={item.origin === "inferred" ? "warning" : "neutral"}
                  >
                    {item.origin === "observed"
                      ? "Grounded in observed evidence"
                      : "Inferred · review required"}
                  </Badge>
                </div>
                <h3>{item.text}</h3>
                <EvidenceRefs refs={item.evidenceRefs} onSelect={onSelect} />
                <details>
                  <summary className="small muted">Assertion bindings</summary>
                  <p className="mono small">
                    {item.assertionIds.join(", ") ||
                      "No executable assertion linked"}
                  </p>
                </details>
              </article>
            ))}
          </div>
          {draft.ambiguities.length ? (
            <div className="compiler-ambiguities">
              <h3>Questions for the reviewers</h3>
              <ul>
                {draft.ambiguities.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {session.review ? (
            <div className="compiler-frozen">
              <LockKeyhole size={24} />
              <div>
                <p className="eyebrow">
                  FROZEN CONTRACT · {time(session.review.approvedAt)}
                </p>
                <h3>Approved for this bounded repair.</h3>
                <p>
                  Task intent review: {session.review.maintainer}
                  <br />
                  Interaction review: {session.review.interactionReviewer}
                </p>
                <p className="small muted">
                  {String(session.review.evidenceClass) ===
                  "automated-development-review"
                    ? "Automated development review. Human and independent review have not been established."
                    : "Operator-attested review. Independent review has not been established."}
                </p>
                <code className="break-anywhere">
                  {session.review.contractDigest}
                </code>
              </div>
            </div>
          ) : (
            <form className="compiler-review-form" onSubmit={review}>
              <p className="eyebrow">EXPLICIT REVIEW PROVENANCE</p>
              <h3>Confirm both intent and interaction.</h3>
              <p className="small muted">
                Identify the review process and who or what reviewed each
                concern. Automated development review does not establish human
                review. Neither option establishes independent accessibility
                acceptance.
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
                    required
                    value={maintainer}
                    onChange={(event) => setMaintainer(event.target.value)}
                    placeholder="Name or review reference"
                    maxLength={120}
                    disabled={busy}
                  />
                </label>
                <label>
                  Interaction reviewer
                  <input
                    required
                    value={reviewer}
                    onChange={(event) => setReviewer(event.target.value)}
                    placeholder="Name or review reference"
                    maxLength={120}
                    disabled={busy}
                  />
                </label>
              </div>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={acknowledge}
                  onChange={(event) => setAcknowledge(event.target.checked)}
                  disabled={busy}
                  required
                />
                <span>
                  I reviewed the observed and inferred requirements,
                  ambiguities, and intended stored outcome. Freeze this exact
                  draft for the repair.
                </span>
              </label>
              <button
                className="button"
                disabled={
                  busy || !acknowledge || !maintainer.trim() || !reviewer.trim()
                }
              >
                <LockKeyhole size={16} />
                Approve & freeze contract
              </button>
            </form>
          )}
          <details className="compiler-disclosure">
            <summary>
              Inspect the executable contract & provenance{" "}
              <ChevronRight size={16} />
            </summary>
            <pre className="compiler-code">
              {JSON.stringify(draft.contractsBySchedule, null, 2)}
            </pre>
            {draft.receipt ? (
              <Receipt receipt={draft.receipt} />
            ) : (
              <p className="small muted">
                Deterministic assisted draft. No model inference was used.
              </p>
            )}
          </details>
        </>
      ) : (
        <div className="compiler-empty">
          <Braces size={35} />
          <h3>
            {session.captures.length
              ? "The trace is ready to compile."
              : "Capture an attempt first."}
          </h3>
          <p>
            A draft distinguishes actual observations from requirements that
            still need review.
          </p>
        </div>
      )}
    </>
  );
}
function Receipt({
  receipt,
}: {
  receipt: NonNullable<CompilerDraft["receipt"]>;
}) {
  return <ReceiptSummary receipt={receipt} />;
}

function PreservationResults({ checks }: { checks: CompilerPreservationCheck[] }) {
  return checks.map((check) => (
    <details className="compiler-disclosure" key={check.id}>
      <summary>
        <span>
          {check.reason === "automatic-acceptance"
            ? "Automatic preservation gate"
            : check.reason === "revision-check"
              ? "Revision preservation check"
              : "Later preservation check"}
          {" · "}{time(check.completedAt)}
        </span>
        <Badge tone={check.passed ? "neutral" : "warning"}>{check.status}</Badge>
      </summary>
      <p className="small muted">
        {check.runs.filter(run => run.passed).length}/{check.runs.length} recorded runs passed.
        {" "}Separate browser checks for pointer booking and native Tab access to Close,
        in ordinary and combined stress scenarios. These do not expand the frozen contract.
      </p>
      {check.reason === "later-check" ? (
        <p className="small muted">This later check preserves the repair’s original acceptance record.</p>
      ) : null}
      {check.runs.map((run) => (
        <section key={run.id} aria-label={`${run.scenarioId} ${run.kind} preservation result`}>
          <div className="compiler-evidence-heading">
            <strong>{run.scenarioId} · {run.kind.replaceAll("-", " ")}</strong>
            <Badge tone={run.passed ? "neutral" : "warning"}>{run.status}</Badge>
          </div>
          <div className="compiler-checks">
            {run.checks.map((assertion) => (
              <details key={assertion.id}>
                <summary>
                  <span className={`compiler-result-dot ${assertion.status}`} />
                  <span>{assertion.label}</span>
                  <Badge tone={assertion.status === "passed" ? "neutral" : "warning"}>{assertion.status}</Badge>
                </summary>
                <div>
                  <p><strong>Expected:</strong> {assertion.expected}</p>
                  <p><strong>Observed:</strong> {assertion.actual}</p>
                </div>
              </details>
            ))}
          </div>
        </section>
      ))}
      {check.sourceObservation ? (
        <details className="compiler-disclosure">
          <summary>Source-bound failure observation <Fingerprint size={15} /></summary>
          <p style={{ whiteSpace: "pre-line" }}>{check.sourceObservation.details}</p>
          <p className="small muted">{check.sourceObservation.observer} · {check.sourceObservation.provenance === "automated-development" ? "Automated development observation" : "Operator attestation"} · Not independently reviewed</p>
        </details>
      ) : null}
      <details className="compiler-disclosure">
        <summary>Inspect preservation source & report identity <Fingerprint size={15} /></summary>
        <dl className="simple-facts">
          <div><dt>Source</dt><dd className="mono break-anywhere">{check.sourceDigest}</dd></div>
          <div><dt>Contract</dt><dd className="mono break-anywhere">{check.contractDigest}</dd></div>
          <div><dt>Report</dt><dd className="mono break-anywhere">{check.reportDigest}</dd></div>
          <div><dt>Verifier</dt><dd className="mono break-anywhere">{check.verifierVersion}</dd></div>
          <div><dt>Record</dt><dd className="mono break-anywhere">{check.id}</dd></div>
        </dl>
        <p className="small muted">Detailed controller traces, actual stored outcomes and cleanup evidence are retained in the evidence export. No participant or screen-reader qualification is implied.</p>
      </details>
    </details>
  ));
}

function RepairPreservation({ session, busy, act }: { session: CompilerSession; busy: boolean; act: SessionAction }) {
  const [selectedId, setSelectedId] = useState("");
  const repairs = session.repairs.filter(item => item.patches.length === 1);
  const repair = repairs.find(item => item.id === selectedId) ?? repairs.at(-1);
  if (!repair) return null;
  const frozen = session.verifications.filter(item => repair.verificationIds.includes(item.id));
  const currentContract = repair.contractDigest === session.review?.contractDigest;
  return (
    <section className="compiler-verification" aria-label="Frozen suite and separate preservation results">
      <div className="compiler-evidence-heading">
        <div><p className="eyebrow">TWO DISTINCT CHECKS</p><h3>Keyboard suite & preservation</h3></div>
      </div>
      <div className="compiler-control-row">
        <label>Retained source patch
          <select value={repair.id} disabled={busy} onChange={event => setSelectedId(event.target.value)}>
            {repairs.map(item => <option key={item.id} value={item.id}>Attempt {session.repairs.indexOf(item) + 1} · {item.status} · {short(item.patches[0].afterDigest)}</option>)}
          </select>
        </label>
        <button className="button button-secondary" disabled={busy || !currentContract} onClick={() => void act(() => compilerApi.preservation(session.id, repair.id))}>
          <Play size={15} /> Check pointer and Close
        </button>
      </div>
      <p className="small muted">No model inference. New repairs and revisions require both the frozen suite and these separate preservation checks.</p>
      <dl className="simple-facts">
        <div><dt>Original acceptance scope</dt><dd>{repair.acceptancePolicy === "frozen-suite-and-preservation-v1" ? "Frozen suite + automatic preservation gate" : "Frozen suite only · historical record"}</dd></div>
        <div><dt>Frozen keyboard suite</dt><dd>{frozen.length ? `${frozen.filter(item => item.status === "passed").length}/${frozen.length} recorded schedules passed` : "No completed verification recorded"}</dd></div>
      </dl>
      {!currentContract ? <p className="small muted">This patch belongs to a prior contract. Its evidence remains available; a new check requires the current reviewed contract.</p> : null}
      {repair.preservationChecks?.length ? <PreservationResults checks={repair.preservationChecks} /> : <p className="small muted">No separate pointer and Close result is recorded for this source.</p>}
    </section>
  );
}

function RepairPanel({
  session,
  bootstrap,
  busy,
  act,
  onSelect,
}: {
  session: CompilerSession;
  bootstrap: CompilerBootstrap;
  busy: boolean;
  act: SessionAction;
  onSelect: (ref: string) => void;
}) {
  const repair = session.repairs.at(-1);
  const observedSource = [...session.repairs].reverse().find(item => item.patches.length)?.patches[0].afterDigest;
  const [observation, setObservation] = useState("");
  const [observer, setObserver] = useState("");
  const [observationProvenance, setObservationProvenance] = useState<"automated-development" | "operator-attested">("operator-attested");
  useEffect(() => { setObservation(""); }, [observedSource]);
  return (
    <>
      <div className="compiler-section-head">
        <div>
          <p className="eyebrow">03 / REPAIR THE SOURCE</p>
          <h2>Find the broken transition.</h2>
          <p>
            The model inspects the scoped source, cites the captured evidence,
            and proposes a patch. The frozen contract stays outside its changes.
          </p>
        </div>
        <FileCode2 size={28} />
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
          disabled={busy || !session.review || !bootstrap.provider.enabled || Boolean(observation.trim() && (observation.trim().length < 8 || observer.trim().length < 2))}
          onClick={() => void act(() => compilerApi.repair(session.id,
            observation.trim() && observedSource ? { sourceDigest: observedSource, details: observation.trim(), observer: observer.trim(), provenance: observationProvenance } : undefined))}
        >
          <Sparkles size={17} />
          {repair ? "Try another source repair" : "Repair with the live model"}
        </button>
      </div>
      {observedSource ? (
        <details className="compiler-disclosure">
          <summary>Report another observed behavior <ChevronRight size={16} /></summary>
          <p className="small muted">Optional feedback about the current source. This records a supplied observation with its source identity; it does not change the frozen checks or establish independent verification.</p>
          <label className="field">What happened?
            <textarea value={observation} maxLength={5000} rows={4} disabled={busy}
              onChange={event => setObservation(event.target.value)} placeholder="Describe the actions, expected behavior and actual result you observed." />
          </label>
          <label className="field">Observer
            <input value={observer} maxLength={120} disabled={busy} onChange={event => setObserver(event.target.value)} />
          </label>
          <label className="field">Observation provenance
            <select value={observationProvenance} disabled={busy} onChange={event => setObservationProvenance(event.target.value as "automated-development" | "operator-attested")}>
              <option value="operator-attested">Operator attestation</option>
              <option value="automated-development">Automated development observation</option>
            </select>
          </label>
          <p className="small mono break-anywhere">Source {observedSource}</p>
        </details>
      ) : null}
      {!session.review ? (
        <Notice title="Review the contract first">
          The task intent and interaction reviews freeze the intended behavior
          before a repair starts.
        </Notice>
      ) : null}
      <RepairPreservation session={session} busy={busy} act={act} />
      {repair ? (
        <>
          <div className="compiler-evidence-heading">
            <div>
              <p className="eyebrow">ACTUAL REPAIR ATTEMPT</p>
              <h3>
                {repair.patches.length
                  ? `${repair.patches.length} source ${repair.patches.length === 1 ? "file" : "files"} changed`
                  : repair.status === "error"
                    ? "No source patch produced"
                    : "Source inspection in progress"}
              </h3>
            </div>
            <Badge
              tone={
                repair.status === "rejected" || repair.status === "error"
                  ? "warning"
                  : "neutral"
              }
            >
              {repair.status}
            </Badge>
          </div>
          {repair.summary ? (
            <details className="compiler-disclosure" style={{ marginTop: 0 }}>
              <summary>
                Repair summary <ChevronRight size={16} />
              </summary>
              <p style={{ whiteSpace: "pre-line" }}>{repair.summary}</p>
            </details>
          ) : null}
          {repair.additionalObservation ? (
            <details className="compiler-disclosure" style={{ marginTop: 0 }}>
              <summary>Additional supplied observation <ChevronRight size={16} /></summary>
              <p style={{ whiteSpace: "pre-line" }}>{repair.additionalObservation.details}</p>
              <p className="small muted">{repair.additionalObservation.observer} · {repair.additionalObservation.provenance === "automated-development" ? "Automated development observation" : "Operator attestation"} · Not independently verified</p>
              <code className="break-anywhere">{repair.additionalObservation.sourceDigest}</code>
            </details>
          ) : null}
          {repair.inspection ? (
            <details className="compiler-disclosure" style={{ marginTop: 0 }}>
              <summary>
                <span>
                  {repair.inspection.method === "deterministic-single-file"
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
                    <dt className="mono break-anywhere">{file.path}</dt>
                    <dd>
                      <code className="break-anywhere">
                        {file.sourceDigest}
                      </code>
                      <br />
                      <small>{file.bytes.toLocaleString()} bytes</small>
                    </dd>
                  </div>
                ))}
              </dl>
            </details>
          ) : null}
          {repair.error ? <Notice tone="error">{repair.error}</Notice> : null}
          <div className="compiler-source-locations">
            {repair.locations.map((location, index) => (
              <article key={`${location.path}-${index}`}>
                <div>
                  <FileCode2 size={17} />
                  <strong className="mono break-anywhere">
                    {location.path}:{location.startLine}–{location.endLine}
                  </strong>
                  <Badge>
                    {location.verified
                      ? "Source reference checked"
                      : "Unverified location"}
                  </Badge>
                </div>
                <h3>{location.symbol}</h3>
                <p>{location.reason}</p>
                {location.evidenceRefs.length ? <EvidenceRefs
                  refs={location.evidenceRefs}
                  onSelect={onSelect}
                /> : null}
                {location.reportedObservationRefs?.map(ref => {
                  const observation = session.repairs.flatMap(item => [item.additionalObservation, ...(item.preservationChecks ?? []).map(check => check.sourceObservation)]).find(item => item?.id === ref)
                    ?? session.revisions.map(item => item.preservationCheck?.sourceObservation).find(item => item?.id === ref);
                  return <details key={ref} className="small">
                    <summary>Source observation · {observation?.observer ?? short(ref)}</summary>
                    {observation ? <>
                      <p style={{ whiteSpace: "pre-line" }}>{observation.details}</p>
                      <p>{observation.provenance === "automated-development" ? "Automated development observation" : "Operator attestation"} · Not independently reviewed</p>
                      <p className="mono break-anywhere">Source {observation.sourceDigest}</p>
                    </> : <p>The referenced observation is not available in this session.</p>}
                    <code className="break-anywhere">{ref}</code>
                  </details>;
                })}
              </article>
            ))}
          </div>
          {repair.patches.map((patch) => (
            <details key={patch.path} className="compiler-disclosure" open>
              <summary>
                <span>
                  Source patch · <code>{patch.path}</code>
                </span>
                <ChevronRight size={16} />
              </summary>
              <div className="compiler-patch-identity">
                <span>
                  Before <code>{short(patch.beforeDigest)}</code>
                </span>
                <ArrowRight size={13} />
                <span>
                  After <code>{short(patch.afterDigest)}</code>
                </span>
              </div>
              <pre className="compiler-code compiler-diff">{patch.diff}</pre>
              <details>
                <summary className="small muted">
                  Inspect resulting source
                </summary>
                <pre className="compiler-code">{patch.source}</pre>
              </details>
            </details>
          ))}
          <details className="compiler-disclosure">
            <summary>
              Inspect model receipts & attempt history <Fingerprint size={16} />
            </summary>
            {repair.receipts.map((receipt, index) => (
              <Receipt
                key={`${receipt.requestId}-${index}`}
                receipt={receipt}
              />
            ))}
            <p className="small muted">
              {session.repairs.length} retained repair attempt
              {session.repairs.length === 1 ? "" : "s"}. Failed attempts remain
              in the export.
            </p>
            <p className="small mono break-anywhere">
              Contract {repair.contractDigest}
            </p>
          </details>
        </>
      ) : (
        <div className="compiler-empty">
          <FileCode2 size={35} />
          <h3>A source change, grounded in the journey.</h3>
          <p>
            Live repair evidence will show the inspected locations, proposed
            diff, actual provider receipts, and verification result.
          </p>
        </div>
      )}
    </>
  );
}
function GuardPanel({
  session,
  bootstrap,
  busy,
  act,
  onError,
}: {
  session: CompilerSession;
  bootstrap: CompilerBootstrap;
  busy: boolean;
  act: SessionAction;
  onError: (message: string) => void;
}) {
  const [variant, setVariant] = useState<CompilerVariant>(
    session.repairs.some((item) => item.patches.length)
      ? "candidate"
      : "original",
  );
  const [schedule, setSchedule] = useState<CompilerSchedule>("cancel-pending");
  const [revisionLabel, setRevisionLabel] = useState("");
  const [classification, setClassification] = useState<
    "harmless-refactor" | "declared-regression" | "external-revision"
  >("declared-regression");
  const [revisionSource, setRevisionSource] = useState("");
  const [fileName, setFileName] = useState("");
  const [exportBusy, setExportBusy] = useState(false);
  const [selected, setSelected] = useState("");
  const [traceEvent, setTraceEvent] = useState("");
  useEffect(() => {
    setSelected("");
    setTraceEvent("");
  }, [session.verifications.length]);
  const result =
    session.verifications.find((item) => item.id === selected) ??
    session.verifications.at(-1);
  const acceptedRepair = session.repairs.filter(item => item.status === "accepted" && item.contractDigest === session.review?.contractDigest).at(-1);
  const guardRequiresPreservation = acceptedRepair?.acceptancePolicy === "frozen-suite-and-preservation-v1" || Boolean(acceptedRepair?.preservationChecks?.length);
  async function exportEvidence() {
    setExportBusy(true);
    try {
      const bundle = await compilerApi.export(session.id);
      download(bundle, `passage-journey-${session.id}.json`);
    } catch (error) {
      onError((error as Error).message);
    } finally {
      setExportBusy(false);
    }
  }
  async function revision(event: FormEvent) {
    event.preventDefault();
    await act(() =>
      compilerApi.revision(
        session.id,
        revisionLabel.trim(),
        classification,
        revisionSource,
      ),
    );
  }
  return (
    <>
      <div className="compiler-section-head">
        <div>
          <p className="eyebrow">04 / CHALLENGE & KEEP THE GUARD</p>
          <h2>Does the promise survive?</h2>
          <p>
            Execute the reviewed contract against the chosen source and event
            schedule. A failed challenge is retained as evidence.
          </p>
        </div>
        <ShieldCheck size={28} />
      </div>
      <div className="compiler-control-row">
        <label>
          Source under test
          <select
            value={variant}
            disabled={busy}
            onChange={(event) =>
              setVariant(event.target.value as CompilerVariant)
            }
          >
            <option value="original">Original application</option>
            <option value="reference">Handcrafted reference</option>
            <option
              value="candidate"
              disabled={!session.repairs.some((item) => item.patches.length)}
            >
              Latest model candidate
            </option>
          </select>
        </label>
        <label>
          Challenge
          <select
            value={schedule}
            disabled={busy}
            onChange={(event) =>
              setSchedule(event.target.value as CompilerSchedule)
            }
          >
            {bootstrap.schedules.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <button
          className="button"
          disabled={busy || !session.review}
          onClick={() =>
            void act(() => compilerApi.verify(session.id, variant, schedule))
          }
        >
          <Play size={16} />
          Run the frozen contract
        </button>
      </div>
      <p className="small muted">
        {bootstrap.schedules.find((item) => item.id === schedule)?.description}
      </p>
      <details className="compiler-disclosure">
        <summary>
          Explore an event schedule <Sparkles size={16} />
        </summary>
        <p>
          <strong>
            Paid live probe · {providerName(bootstrap.provider.provider)}
          </strong>
          <br />
          <code className="break-anywhere">{bootstrap.provider.model}</code>
        </p>
        <p>
          The model proposes a bounded order or subset of this reviewed
          schedule’s existing action IDs. The controller validates dependencies
          and required actions, then executes the frozen contract against the
          selected source. This is an actual public probe; it does not establish
          exhaustive exploration or a sealed test result.
        </p>
        <button
          className="button button-secondary"
          disabled={busy || !session.review || !bootstrap.provider.enabled}
          onClick={() =>
            void act(() => compilerApi.explore(session.id, variant, schedule))
          }
        >
          <Sparkles size={16} />
          Explore an event schedule
        </button>
        {!bootstrap.provider.enabled ? (
          <p className="small muted" style={{ marginTop: 10 }}>
            {bootstrap.provider.reason}
          </p>
        ) : null}
      </details>
      {!session.review ? (
        <Notice title="A reviewed contract is required">
          Approve a draft before using it to judge a source revision.
        </Notice>
      ) : null}
      {result ? (
        <div className="compiler-verification">
          <div className="compiler-evidence-heading">
            <div>
              <p className="eyebrow">RECORDED CHALLENGE RESULT</p>
              <h3>
                {result.variant} · {result.status}
              </h3>
            </div>
            <label className="compiler-capture-select">
              <span className="sr-only">Select verification result</span>
              <select
                value={result.id}
                onChange={(event) => setSelected(event.target.value)}
              >
                {session.verifications.map((item, index) => (
                  <option key={item.id} value={item.id}>
                    Check {index + 1} · {item.variant} · {item.scheduleId} ·{" "}
                    {item.status}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="small muted">
            Contract <code>{short(result.contractDigest)}</code> · Source{" "}
            <code>{short(result.sourceDigest)}</code>
            {session.review?.draftDigest === session.draft?.digest &&
            result.contractDigest ===
              session.draft?.contractsBySchedule[result.scheduleId]?.digest
              ? " · Current reviewed version"
              : " · Prior contract version"}
          </p>
          {result.scheduleProposal ? (
            <details className="compiler-disclosure">
              <summary>
                Schedule proposal · {result.scheduleProposal.label}
                <Fingerprint size={16} />
              </summary>
              <p>
                Proposed sequence in the approved action vocabulary. The checks
                and trace below report the actual public execution, including
                actions that could not finish. This is bounded exploration, not
                an exhaustive or sealed evaluation.
              </p>
              <ol style={{ paddingLeft: 20, margin: "12px 0" }}>
                {result.scheduleProposal.steps.map((step, index) => {
                  const observedLabel = result.execution.trace.find(
                    (event) =>
                      event.actionId === step &&
                      event.kind === "action" &&
                      event.provenance !== "page-instrumentation",
                  )?.label;
                  const reviewedContract =
                    session.draft?.contractsBySchedule[result.scheduleId];
                  const reviewedLabel =
                    reviewedContract?.digest === result.contractDigest
                      ? reviewedContract.actions.find(
                          (action) => action.id === step,
                        )?.label
                      : undefined;
                  return (
                    <li key={`${step}-${index}`} style={{ marginBottom: 8 }}>
                      {observedLabel ?? reviewedLabel ?? step}{" "}
                      <code className="small break-anywhere">({step})</code>
                    </li>
                  );
                })}
              </ol>
              <p className="small mono break-anywhere">
                Proposal {result.scheduleProposal.id}
              </p>
              {result.scheduleProposal.receipt ? (
                <Receipt receipt={result.scheduleProposal.receipt} />
              ) : (
                <p className="small muted">
                  No model receipt is attached to this proposal.
                </p>
              )}
            </details>
          ) : null}
          {result.counterexample ? (
            <div className="compiler-counterexample">
              <CircleAlert size={20} />
              <div>
                <p className="eyebrow">
                  {result.counterexample.acceptedRemovals
                    ? "LOCALLY REDUCED COUNTEREXAMPLE"
                    : "OBSERVED COUNTEREXAMPLE"}
                </p>
                <h3>{result.counterexample.minimizedSteps ? `${result.counterexample.minimizedSteps.length} actions reproduce this failure` : "Recorded task failure"}</h3>
                <details><summary>Recorded action sequence</summary><p>{result.counterexample.summary}</p></details>
                <span className="small muted">
                  {result.counterexample.attempts} replay attempts
                  {result.counterexample.acceptedRemovals !== undefined ? ` · ${result.counterexample.acceptedRemovals} actions removed` : ""}
                  {result.counterexample.historyCount ? ` · ${result.counterexample.historyCount} reduction records retained in the export` : ""}
                  {result.counterexample.search?.inconclusiveReplays ? ` · ${result.counterexample.search.inconclusiveReplays} inconclusive replays` : ""}
                </span>
                {result.counterexample.search ? <p className="small muted">{result.counterexample.search.limitation}</p> : null}
                {result.execution.failureSignature ? (
                  <button
                    className="button button-secondary compiler-reduce-button"
                    disabled={busy}
                    onClick={() =>
                      void act(() => compilerApi.reduce(session.id, result.id))
                    }
                  >
                    Reduce this failure <ArrowRight size={14} />
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}
          <CheckResults capture={result} />
          <details className="compiler-disclosure">
            <summary>
              Inspect the actual trace & outcome <ChevronRight size={16} />
            </summary>
            <TraceInspector
              capture={result}
              selectedRef={traceEvent}
              onSelect={setTraceEvent}
            />
            <pre className="compiler-code">
              {JSON.stringify(result.outcome, null, 2)}
            </pre>
            {result.limitations.map((item) => (
              <p className="small muted" key={item}>
                {item}
              </p>
            ))}
          </details>
        </div>
      ) : (
        <div className="compiler-empty compact">
          <ShieldCheck size={31} />
          <h3>The next challenge is yours.</h3>
          <p>
            Cancel while a request is pending, test the modal boundary, or
            repeat the baseline.
          </p>
        </div>
      )}
      <div className="compiler-export">
        <div>
          <p className="eyebrow">A REPAIR SHOULD LEAVE SOMETHING USEFUL</p>
          <h3>Take the evidence and the guard.</h3>
          <p>
            Export the reviewed contract, source bindings, and retained results.
            The runnable package checks the same promise outside this studio.
          </p>
          <p className="small muted">
            {guardRequiresPreservation
              ? "This guard requires both the frozen schedules and the separate pointer/Close preservation checks, with separate results."
              : "This guard retains the historical frozen-suite-only scope; it does not imply an automatic preservation gate."}
          </p>
        </div>
        <div className="compiler-export-actions">
          <button
            className="button button-secondary"
            disabled={!session.review || exportBusy}
            onClick={() => void exportEvidence()}
          >
            <Download size={16} />
            {exportBusy ? "Preparing evidence…" : "Evidence JSON"}
          </button>
          {session.review ? (
            <a
              className="button"
              href={compilerApi.guardUrl(session.id)}
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
      <details className="compiler-disclosure compiler-revision">
        <summary>
          <span>Check a later source revision</span>
          <RefreshCw size={16} />
        </summary>
        <p>
          Upload a revision within this application’s permitted component scope.
          The existing reviewed contract supplies the expectations; a changed
          task needs a newly reviewed draft. New revision checks require both
          the frozen suite and the pointer/Close preservation checks.
        </p>
        <form onSubmit={revision}>
          <div className="compiler-form-grid">
            <label>
              Revision label
              <input
                value={revisionLabel}
                onChange={(event) => setRevisionLabel(event.target.value)}
                required
                maxLength={160}
                placeholder="For example, date picker refactor"
                disabled={busy}
              />
            </label>
            <label>
              Your declared classification
              <select
                value={classification}
                onChange={(event) =>
                  setClassification(event.target.value as typeof classification)
                }
                disabled={busy}
              >
                <option value="declared-regression">Declared regression</option>
                <option value="harmless-refactor">
                  Declared harmless refactor
                </option>
                <option value="external-revision">Other source revision</option>
              </select>
            </label>
          </div>
          <label className="compiler-file">
            Scoped JSX source
            <input
              type="file"
              accept=".jsx,.tsx,.js,.txt"
              disabled={busy || !session.review}
              onChange={async (event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                if (file.size > 24_000) {
                  onError("Choose a source file smaller than 24 KB.");
                  return;
                }
                try {
                  setRevisionSource(await file.text());
                  setFileName(file.name);
                } catch {
                  onError("The source file could not be read.");
                }
              }}
            />
          </label>
          {fileName ? (
            <p className="small muted">
              {fileName} · {revisionSource.length.toLocaleString()} characters ·
              content is sent only when you run this check.
            </p>
          ) : null}
          <button
            className="button button-secondary"
            disabled={
              busy ||
              !session.review ||
              !revisionLabel.trim() ||
              !revisionSource
            }
          >
            <Play size={15} />
            Check this revision
          </button>
        </form>
      </details>
      {session.revisions.length ? (
        <div className="compiler-revision-history">
          <h3>Later revision evidence</h3>
          {session.revisions.map((item) => (
            <article key={item.id}>
              <div>
                <strong>{item.label}</strong>
                <Badge tone={item.passed ? "neutral" : "warning"}>
                  {item.passed
                    ? "Recorded checks passed"
                    : "Recorded checks did not pass"}
                </Badge>
              </div>
              <p className="small muted">
                {item.classification} · Source{" "}
                <code>{short(item.sourceDigest)}</code> · Contract{" "}
                <code>{short(item.contractDigest)}</code>
              </p>
              <p className="small muted">
                {item.acceptancePolicy === "frozen-suite-and-preservation-v1" ? "Acceptance requires frozen suite + preservation checks." : "Historical frozen-suite-only acceptance scope."}
                {" "}Frozen suite: {item.verificationIds.filter(id => session.verifications.some(result => result.id === id && result.status === "passed")).length}/{item.verificationIds.length} recorded schedules passed.
              </p>
              {item.preservationCheck ? <PreservationResults checks={[item.preservationCheck]} /> : null}
            </article>
          ))}
        </div>
      ) : null}
    </>
  );
}

export function JourneyCompiler() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { refresh } = useStore();
  const [bootstrap, setBootstrap] = useState<CompilerBootstrap | null>(null);
  const [session, setSession] = useState<CompilerSession | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [requestBusy, setRequestBusy] = useState(false);
  const [view, setView] = useState<CompilerView>("journey");
  const [selectedRef, setSelectedRef] = useState("");
  const [fixtureId, setFixtureId] = useState(params.get("fixture") ?? "");
  const [task, setTask] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const isNew = !id || id === "new";
  const busy =
    requestBusy || Boolean(session && activeStatuses.has(session.status));
  const fixture =
    bootstrap?.fixtures.find(
      (item) => item.id === (session?.fixtureId ?? fixtureId),
    ) ?? bootstrap?.fixtures[0];
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    setSession(null);
    setView("journey");
    const controller = new AbortController();
    void Promise.all([
      compilerApi.bootstrap(),
      isNew
        ? Promise.resolve(null)
        : compilerApi.session(id!, controller.signal),
    ])
      .then(([next, saved]) => {
        if (active) {
          setBootstrap(next);
          setSession(saved);
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
  }, [id, isNew]);
  useEffect(() => {
    if (!session || !activeStatuses.has(session.status)) return;
    const controller = new AbortController();
    const timer = setInterval(() => {
      void compilerApi
        .session(session.id, controller.signal)
        .then((next) => {
          if (!controller.signal.aborted) setSession(next);
        })
        .catch((failure) => {
          if (!controller.signal.aborted) setError(failure.message);
        });
    }, 1500);
    return () => {
      clearInterval(timer);
      controller.abort();
    };
  }, [session?.id, session?.status]);
  const act: SessionAction = async (operation, nextView) => {
    setRequestBusy(true);
    setError("");
    try {
      const next = await operation();
      setSession(next);
      if (nextView) setView(nextView);
      void refresh();
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setRequestBusy(false);
    }
  };
  function selectEvidence(ref: string) {
    setSelectedRef(ref);
    setView("journey");
    requestAnimationFrame(() =>
      document
        .getElementById(`evidence-${ref}`)
        ?.scrollIntoView({ block: "nearest" }),
    );
  }
  async function create(event: FormEvent) {
    event.preventDefault();
    if (!fixture || !consent) return;
    setRequestBusy(true);
    setError("");
    try {
      const next = await compilerApi.create(
        fixture.id,
        (task ?? fixture.task).trim(),
      );
      navigate(`/compiler/${next.id}`);
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setRequestBusy(false);
    }
  }
  if (loading)
    return (
      <div className="page compiler-loading" role="status">
        <Route size={35} />
        <h1>Opening the journey compiler…</h1>
        <p>Loading supported applications and stored evidence.</p>
      </div>
    );
  if (!bootstrap)
    return (
      <div className="page narrow">
        <PageHead title="The compiler is waiting for its service." />
        <Notice tone="error">
          {error || "The local compiler API is unavailable."}
        </Notice>
        <Link className="button button-secondary" to="/">
          Return to Passage <ArrowRight size={16} />
        </Link>
      </div>
    );
  return (
    <div className="page compiler-page">
      <Link className="breadcrumb" to="/">
        Passage <ChevronRight size={14} /> Journey compiler
      </Link>
      {isNew ? (
        <>
          <PageHead
            eyebrow="TURN A BLOCKED TASK INTO A LASTING PROMISE"
            title="Repair a journey."
          >
            <p>
              Start with one supported application and a clear task. Capture an
              attempt, review the expectations, then repair and challenge the
              source.
            </p>
          </PageHead>
          <div className="compiler-setup">
            <form className="panel compiler-setup-form" onSubmit={create}>
              <p className="eyebrow">01 / APPLICATION & INTENT</p>
              <label>
                Supported application
                <select
                  disabled={busy}
                  value={fixture?.id ?? ""}
                  onChange={(event) => {
                    setFixtureId(event.target.value);
                    setTask(null);
                  }}
                >
                  {bootstrap.fixtures.map((item) => (
                    <option value={item.id} key={item.id}>
                      {item.name} · {item.organization}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                What should someone be able to do?
                <textarea
                  required
                  value={task ?? fixture?.task ?? ""}
                  onChange={(event) => setTask(event.target.value)}
                  rows={3}
                  maxLength={2000}
                  disabled={busy}
                />
              </label>
              <div className="story-barrier">
                <span className="eyebrow">KNOWN SEEDED BARRIER</span>
                <p>{fixture?.barrier}</p>
              </div>
              <label className="checkbox-label">
                <input
                  required
                  type="checkbox"
                  checked={consent}
                  disabled={busy}
                  onChange={(event) => setConsent(event.target.checked)}
                />
                <span>
                  I agree to capture this fictional application’s browser
                  actions, focus, and task events. Evidence is retained locally.
                  Source and evidence are sent to the configured provider only
                  when I choose live drafting or repair.
                </span>
              </label>
              <p className="small muted">
                This is an automated browser session. It does not record a
                participant, screen-reader speech, audio, or video.
              </p>
              {error ? <Notice tone="error">{error}</Notice> : null}
              <button
                className="button button-large"
                disabled={busy || !fixture || !consent}
              >
                {busy
                  ? "Creating the evidence workspace…"
                  : "Open the journey workspace"}
                <ArrowRight size={18} />
              </button>
            </form>
            <aside className="compiler-setup-scope">
              <p className="eyebrow">SUPPORTED EXECUTION SCOPE</p>
              <h2>Know what this run can establish.</h2>
              {bootstrap.adapters.map((adapter) => (
                <article key={adapter.id}>
                  <div>
                    <Badge
                      tone={adapter.status === "ready" ? "neutral" : "warning"}
                    >
                      {adapter.status}
                    </Badge>
                    <h3>{adapter.name}</h3>
                  </div>
                  <p>{adapter.scope}</p>
                  <p className="small muted">{adapter.detail}</p>
                </article>
              ))}
              <Link
                className="repository-adapter-entry"
                to="/compiler/repositories"
              >
                <GitBranch size={20} />
                <span>
                  <strong>Bring a public source manifest</strong>
                  <small>
                    Inspect the qualified worker and bounded React adapter.
                  </small>
                </span>
                <ArrowUpRight size={16} />
              </Link>
              <div className="compiler-setup-identity">
                <Fingerprint size={19} />
                <span>
                  Exact source identity and evidence remain attached to every
                  attempt.
                </span>
              </div>
              {bootstrap.sessions.length ? (
                <details className="compiler-disclosure">
                  <summary>
                    Continue a stored compiler session{" "}
                    <ChevronRight size={15} />
                  </summary>
                  <div className="compiler-saved-sessions">
                    {bootstrap.sessions.slice(0, 8).map((item) => (
                      <Link key={item.id} to={`/compiler/${item.id}`}>
                        <span>
                          {item.task}
                          <small>
                            {time(item.updatedAt)} · {item.status}
                          </small>
                        </span>
                        <ArrowRight size={16} />
                      </Link>
                    ))}
                  </div>
                </details>
              ) : null}
            </aside>
          </div>
        </>
      ) : session ? (
        <>
          <div className="compiler-session-head">
            <div>
              <p className="eyebrow">
                JOURNEY COMPILER ·{" "}
                {session.scope === "authored-fixture"
                  ? "AUTHORED APPLICATION"
                  : "EXTERNAL REACT ADAPTER"}
              </p>
              <h1>{session.task}</h1>
              <p>
                {fixture?.organization} <span>·</span> {fixture?.name}{" "}
                <span>·</span> Fictional task data
              </p>
            </div>
            <Badge>
              {session.review ? "Reviewed contract" : "Contract review pending"}
            </Badge>
          </div>
          <div className="compiler-story-strip">
            <div>
              <span className="compiler-number">01</span>
              <p>
                <small>THE BLOCKED ACTION</small>
                <strong>{fixture?.barrier}</strong>
              </p>
            </div>
            <div>
              <span className="compiler-number">02</span>
              <p>
                <small>THE CURRENT EVIDENCE</small>
                <strong>
                  {session.verifications.at(-1)
                    ? `${session.verifications.at(-1)!.variant} · ${session.verifications.at(-1)!.status}`
                    : session.captures.length
                      ? `${session.captures.length} recorded attempt${session.captures.length === 1 ? "" : "s"}`
                      : "Awaiting the first attempt"}
                </strong>
              </p>
            </div>
            <div>
              <span className="compiler-number">03</span>
              <p>
                <small>THE NEXT PROMISE</small>
                <strong>
                  {session.review
                    ? "Same contract. A fresh challenge."
                    : session.draft
                      ? "Review the inferred requirements."
                      : "Compile the observed journey."}
                </strong>
              </p>
            </div>
          </div>
          <div className="compiler-workspace">
            <aside className="compiler-sidebar">
              <nav aria-label="Journey compiler stages">
                {(
                  [
                    {
                      key: "journey",
                      label: "Observe the journey",
                      detail: `${session.captures.length} captured attempts`,
                      icon: Keyboard,
                    },
                    {
                      key: "contract",
                      label: "Review the contract",
                      detail: session.review
                        ? `Frozen version ${session.draft?.version}`
                        : session.draft
                          ? "Draft ready for review"
                          : "Awaiting evidence",
                      icon: Braces,
                    },
                    {
                      key: "repair",
                      label: "Repair the source",
                      detail: `${session.repairs.length} retained attempts`,
                      icon: FileCode2,
                    },
                    {
                      key: "guard",
                      label: "Challenge & keep",
                      detail: `${session.verifications.length} recorded checks`,
                      icon: ShieldCheck,
                    },
                  ] as const
                ).map((item, index) => (
                  <button
                    key={item.key}
                    aria-current={view === item.key ? "step" : undefined}
                    className={view === item.key ? "active" : ""}
                    onClick={() => setView(item.key)}
                  >
                    <item.icon size={19} />
                    <span>
                      <small>0{index + 1}</small>
                      <strong>{item.label}</strong>
                      <em>{item.detail}</em>
                    </span>
                    <ChevronRight size={14} />
                  </button>
                ))}
              </nav>
              <details className="compiler-session-identity">
                <summary>
                  <Fingerprint size={15} />
                  Session identity
                </summary>
                <dl className="simple-facts">
                  <div>
                    <dt>Session</dt>
                    <dd className="mono break-anywhere">{session.id}</dd>
                  </div>
                  <div>
                    <dt>Fixture</dt>
                    <dd className="mono">{session.fixtureId}</dd>
                  </div>
                  <div>
                    <dt>Created</dt>
                    <dd>{time(session.createdAt)}</dd>
                  </div>
                  <div>
                    <dt>Contract</dt>
                    <dd className="mono break-anywhere">
                      {session.review?.contractDigest ?? "Not frozen"}
                    </dd>
                  </div>
                </dl>
              </details>
              <div className="compiler-at-note">
                <Keyboard size={17} />
                <strong>Assistive evidence</strong>
                <span>
                  {session.assistiveEvidence.status.replaceAll("-", " ")}
                </span>
                <p>{session.assistiveEvidence.note}</p>
                <small>
                  {session.assistiveEvidence.participantCount} recorded
                  participants · {session.assistiveEvidence.evidenceClass}
                </small>
              </div>
            </aside>
            <section
              className="panel compiler-main"
              aria-label="Compiler workspace"
            >
              {error || session.error ? (
                <Notice tone="error" title={session.error?.code}>
                  {error || session.error?.message}
                </Notice>
              ) : null}
              {busy ? (
                <div className="compiler-operation" role="status">
                  <span className="compiler-pulse" />
                  <p>
                    {operationLabels[session.status] ??
                      "Saving the requested operation…"}
                    <small>
                      The actual result will appear here when the worker
                      finishes.
                    </small>
                  </p>
                  <button
                    className="text-link"
                    disabled={requestBusy}
                    onClick={() =>
                      void act(() => compilerApi.cancel(session.id))
                    }
                  >
                    Cancel
                  </button>
                </div>
              ) : null}
              {view === "journey" ? (
                <CapturePanel
                  session={session}
                  bootstrap={bootstrap}
                  busy={busy}
                  act={act}
                  selectedRef={selectedRef}
                  onSelect={setSelectedRef}
                />
              ) : view === "contract" ? (
                <ContractPanel
                  session={session}
                  bootstrap={bootstrap}
                  busy={busy}
                  act={act}
                  onSelect={selectEvidence}
                />
              ) : view === "repair" ? (
                <RepairPanel
                  session={session}
                  bootstrap={bootstrap}
                  busy={busy}
                  act={act}
                  onSelect={selectEvidence}
                />
              ) : (
                <GuardPanel
                  session={session}
                  bootstrap={bootstrap}
                  busy={busy}
                  act={act}
                  onError={setError}
                />
              )}
            </section>
          </div>
          <div className="compiler-bottom-scope">
            <LockKeyhole size={16} />
            <p>{bootstrap.limitations.join(" ")}</p>
            <Link to="/compiler/new">
              New journey <ArrowRight size={14} />
            </Link>
          </div>
        </>
      ) : (
        <>
          <PageHead title="This compiler session could not be opened." />
          <Notice tone="error">{error || "The session was not found."}</Notice>
          <Link className="button button-secondary" to="/compiler/new">
            Start a new journey <ArrowRight size={16} />
          </Link>
        </>
      )}
    </div>
  );
}
