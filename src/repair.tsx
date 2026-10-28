import { useCallback, useEffect, useRef, useState } from "react";
import {
  Link,
  NavLink,
  Navigate,
  Outlet,
  useNavigate,
  useOutletContext,
  useParams,
} from "react-router-dom";
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Braces,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  CircleAlert,
  Clock3,
  Code2,
  ExternalLink,
  FileCheck2,
  FileDiff,
  Flag,
  GitBranch,
  Keyboard,
  Layers3,
  LoaderCircle,
  Play,
  RefreshCw,
  Route,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Square,
  Terminal,
  UserRound,
  X,
} from "lucide-react";
import type {
  Candidate,
  ContractAssertion,
  EvidenceManifest,
  FixtureDefinition,
  HumanObservation,
  InteractionContract,
  ModelReceipt,
  Observation,
  RepairRun,
  RunMode,
  Scenario,
  VerificationResult,
} from "../shared/types";
import { useStore } from "./App";
import {
  isDevelopmentRoute,
  providerName,
  providerPurpose,
  runOriginLabel,
} from "./providerLabels";
import { AssistiveEvidence } from "./AssistiveEvidence";
import { api, download, post, put } from "./api";
import {
  ArrowLink,
  Badge,
  CheckList,
  Empty,
  Notice,
  PageHead,
  RunStatusDisplay,
  Status,
  busyStatuses,
  candidateFor,
  familyLabel,
  short,
  statusLabel,
  time,
} from "./ui";

type RunContext = {
  run: RepairRun;
  fixture?: FixtureDefinition;
  action: (path: string, body?: unknown) => Promise<RepairRun | null>;
  pending: boolean;
  reload: () => Promise<void>;
};
function useRunResource(id?: string) {
  const { data, updateRun } = useStore();
  const [run, setRun] = useState<RepairRun | null>(
    () => data?.runs.find((item) => item.id === id) ?? null,
  );
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const reload = useCallback(async () => {
    if (!id) return;
    try {
      const next = await api<RepairRun>(`/repairs/${encodeURIComponent(id)}`);
      setRun(next);
      updateRun(next);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id, updateRun]);
  useEffect(() => {
    void reload();
    const interval = setInterval(() => void reload(), 2500);
    return () => clearInterval(interval);
  }, [reload]);
  async function action(path: string, body: unknown = {}) {
    setPending(true);
    setError("");
    try {
      const next = await post<RepairRun>(`/repairs/${id}/${path}`, body);
      setRun(next);
      updateRun(next);
      return next;
    } catch (e) {
      setError((e as Error).message);
      return null;
    } finally {
      setPending(false);
    }
  }
  return { run: run?.id === id ? run : null, error, pending, action, reload };
}
export function RepairLayout({
  journeyRedirect = false,
}: {
  journeyRedirect?: boolean;
}) {
  const { id } = useParams();
  const { data } = useStore();
  const journey = data?.journeys.find((item) => item.id === id);
  const resource = useRunResource(
    journeyRedirect ? (journey?.activeRunId ?? undefined) : id,
  );
  const { run, pending, error, action, reload } = resource;
  const navigate = useNavigate();
  if (journeyRedirect && journey?.activeRunId)
    return <Navigate replace to={`/repairs/${journey.activeRunId}`} />;
  if (!run)
    return (
      <div className="page">
        <Empty
          title={
            error
              ? "This repair could not be loaded."
              : "Opening the investigation…"
          }
          action={
            <button
              className="button button-secondary"
              onClick={() => void reload()}
            >
              Retry connection <RefreshCw size={16} />
            </button>
          }
        >
          {error ||
            "Retrieving the saved journey, source revisions, and browser evidence."}
        </Empty>
      </div>
    );
  const fixture = data?.fixtures.find((item) => item.id === run.fixtureId);
  const busy = busyStatuses.includes(run.status);
  return (
    <div className="repair-page">
      <div className="repair-heading">
        <div>
          <Link className="breadcrumb" to="/repairs">
            <ArrowLeft size={14} /> All repairs <span>/</span>{" "}
            {fixture?.organization ?? "Authored application"}
          </Link>
          <h1>{fixture?.name ?? "Journey investigation"}</h1>
          <p>{run.contract.task}</p>
        </div>
        <div className="repair-heading-actions">
          <Badge>{runOriginLabel(run)}</Badge>
          <span className="mono small">{short(run.id)}</span>
          {busy ? (
            <button
              className="button button-secondary button-small"
              disabled={pending || run.cancellationRequested}
              onClick={() => void action("cancel")}
            >
              <Square size={13} />
              {run.cancellationRequested ? "Cancelling…" : "Cancel run"}
            </button>
          ) : null}
        </div>
      </div>
      <nav className="workbench-nav" aria-label="Repair workflow">
        <NavLink end to={`/repairs/${run.id}`}>
          <Route size={16} />
          Journey & application
        </NavLink>
        <NavLink to={`/repairs/${run.id}/contract`}>
          <FileCheck2 size={16} />
          Interaction contract
          <span className="version-tag">v{run.contract.version}</span>
        </NavLink>
        <NavLink to={`/repairs/${run.id}/challenges`}>
          <SlidersHorizontal size={16} />
          Challenges<span className="nav-count">{run.challenges.length}</span>
        </NavLink>
        <NavLink to={`/repairs/${run.id}/review`}>
          <FileDiff size={16} />
          Review change
        </NavLink>
        <Link to={`/evidence/${run.id}`} className="evidence-nav">
          Evidence report
          <ArrowUpRight size={15} />
        </Link>
      </nav>
      {error ? (
        <div className="repair-banner">
          <Notice tone="error" title="Connection interrupted">
            {error} Your last saved state remains below.{" "}
            <button className="inline-button" onClick={() => void reload()}>
              Reconnect
            </button>
          </Notice>
        </div>
      ) : null}
      {run.isStale ? (
        <div className="repair-banner">
          <Notice
            tone="warning"
            title="This evidence belongs to an earlier contract."
          >
            The journey contract changed after this run started. Begin a new run
            to verify the updated requirements.{" "}
            <button
              className="inline-button"
              disabled={pending}
              onClick={async () => {
                const next = await action("retry", { mode: run.mode });
                if (next) navigate(`/repairs/${next.id}`);
              }}
            >
              Start a fresh run
            </button>
          </Notice>
        </div>
      ) : null}
      {run.error ? (
        <div className="repair-banner">
          <Notice tone="error" title="The run needs attention">
            {run.error.message}{" "}
            {run.error.retryable ? (
              <button
                className="inline-button"
                disabled={pending}
                onClick={async () => {
                  const next = await action("retry", { mode: run.mode });
                  if (next) navigate(`/repairs/${next.id}`);
                }}
              >
                Retry in a new run
              </button>
            ) : null}
          </Notice>
        </div>
      ) : null}
      <div className="sr-only" aria-live="polite">
        {run.status === "ready" && run.challenges.some((item) => !item.passed)
          ? "Candidate checks passed. One or more challenges did not pass."
          : statusLabel[run.status]}
      </div>
      <Outlet
        context={{ run, fixture, pending, action, reload } satisfies RunContext}
      />
    </div>
  );
}
function Receipt({ candidate }: { candidate: Candidate }) {
  return (
    <ReceiptSummary
      receipt={candidate.receipt}
      createdAt={candidate.createdAt}
    />
  );
}
export function ReceiptSummary({
  receipt,
  createdAt,
}: {
  receipt: ModelReceipt;
  createdAt?: string;
}) {
  return (
    <dl className="simple-facts receipt">
      <div>
        <dt>Origin</dt>
        <dd>
          {receipt.live
            ? `Actual ${providerName(receipt.provider)} inference call`
            : "Handcrafted reference patch · no model call"}
        </dd>
      </div>
      {receipt.live ? (
        <div>
          <dt>Route scope</dt>
          <dd>{providerPurpose(receipt.provider)}</dd>
        </div>
      ) : null}
      <div>
        <dt>Model</dt>
        <dd className="mono">{receipt.model}</dd>
      </div>
      {receipt.live ? (
        <div>
          <dt>Served model</dt>
          <dd className="mono">
            {receipt.servedModel ?? "Not recorded in this receipt"}
          </dd>
        </div>
      ) : null}
      {receipt.outputProtocol ? (
        <div>
          <dt>Output protocol</dt>
          <dd>
            {receipt.outputProtocol === "single-source"
              ? "Single source file"
              : "Structured JSON"}
          </dd>
        </div>
      ) : null}
      <div>
        <dt>Request</dt>
        <dd className="mono">
          {receipt.requestId ?? "Not applicable / not supplied"}
        </dd>
      </div>
      <div>
        <dt>Input / output</dt>
        <dd>
          {receipt.inputTokens ?? "—"} / {receipt.outputTokens ?? "—"} tokens
        </dd>
      </div>
      <div>
        <dt>Duration</dt>
        <dd>{(receipt.durationMs / 1000).toFixed(1)} seconds</dd>
      </div>
      {receipt.live && Number.isFinite(receipt.temperature) ? (
        <div>
          <dt>Recorded sampling</dt>
          <dd>
            Temperature {receipt.temperature}
            {receipt.generation?.topP !== undefined
              ? ` · top_p ${receipt.generation.topP}`
              : ""}
          </dd>
        </div>
      ) : null}
      {receipt.baseUrl ? (
        <div>
          <dt>Recorded endpoint</dt>
          <dd className="mono break-anywhere">{receipt.baseUrl}</dd>
        </div>
      ) : null}
      {receipt.generationProfileFingerprint ? (
        <div>
          <dt>Profile fingerprint</dt>
          <dd className="mono break-anywhere">
            {receipt.generationProfileFingerprint}
          </dd>
        </div>
      ) : null}
      {receipt.generation ? (
        <>
          <div>
            <dt>Response allowance</dt>
            <dd>
              {receipt.generation.maxOutputTokens.toLocaleString()} tokens ·{" "}
              {receipt.generation.timeoutMs / 1000}s timeout
            </dd>
          </div>
          <div>
            <dt>Reasoning setting</dt>
            <dd>
              {receipt.generation.reasoningEffort ??
                (receipt.generation.thinkingEnabled === true
                  ? "Enabled"
                  : receipt.generation.thinkingEnabled === false
                    ? "Disabled"
                    : "Not recorded")}
            </dd>
          </div>
          {receipt.generation.forceNonemptyContent !== undefined ? (
            <div>
              <dt>Force nonempty request</dt>
              <dd>
                {receipt.generation.forceNonemptyContent
                  ? "Enabled"
                  : "Disabled"}
              </dd>
            </div>
          ) : null}
          {receipt.generation.responseFormat ? (
            <div>
              <dt>Output framing</dt>
              <dd>
                {receipt.generation.responseFormat === "prompt_schema"
                  ? "Schema in prompt · strict local validation"
                  : "Provider JSON object format"}
              </dd>
            </div>
          ) : null}
        </>
      ) : null}
      <div>
        <dt>{createdAt ? "Created" : "Completed"}</dt>
        <dd>{time(createdAt ?? receipt.completedAt)}</dd>
      </div>
    </dl>
  );
}
function GenerationControls({
  run,
  pending,
  action,
}: Pick<RunContext, "run" | "pending" | "action">) {
  const { data } = useStore();
  const navigate = useNavigate();
  const [mode, setMode] = useState<RunMode>(
    data?.settings.defaultMode ?? "offline",
  );
  const candidate = candidateFor(run);
  const allowed =
    !run.isStale &&
    ["contract_review", "candidate_rejected"].includes(run.status);
  const liveAvailable = Boolean(
    data?.provider.configured && data.provider.enabled,
  );
  const stageDescriptions: Record<string, string> = {
    queued: "The run is saved and waiting for the local worker.",
    preparing: "The local worker is preparing the application build.",
    reproducing: "The browser is recording the original keyboard journey.",
    generating:
      run.mode === "live"
        ? `${providerName(data?.provider.provider)} is generating a source candidate with ${data?.provider.model ?? "the configured model"}.`
        : "The handcrafted reference candidate is being prepared.",
    verifying:
      "The candidate is being checked against the interaction contract.",
  };
  return (
    <div className="generation-controls">
      {allowed ? (
        <>
          <label htmlFor="repair-mode" className="field-label">
            Repair source
          </label>
          <select
            id="repair-mode"
            value={mode}
            onChange={(e) => setMode(e.target.value as RunMode)}
          >
            <option value="offline">
              Offline · handcrafted reference patch
            </option>
            <option value="live" disabled={!liveAvailable}>
              Live · {providerName(data?.provider.provider)}
              {!liveAvailable ? " (unavailable)" : ""}
            </option>
          </select>
          <p className="small muted">
            {mode === "offline"
              ? "Apply an authored reference repair, then run the independent verifier. No model is called."
              : liveAvailable
                ? `Send this scoped source and browser evidence to ${providerName(data?.provider.provider)} using ${data?.provider.model ?? "the configured model"}. This paid live call saves an actual inference receipt.${isDevelopmentRoute(data?.provider.provider) ? " Development route; Nebius remains the submission route." : ""}`
                : "Live generation is unavailable. Select the labeled offline reference patch, or inspect the connection in Settings."}
          </p>
          <button
            className="button full-width"
            disabled={pending || (mode === "live" && !liveAvailable)}
            onClick={() => void action("generate", { mode })}
          >
            <Sparkles size={16} />
            {pending
              ? "Starting…"
              : run.status === "candidate_rejected"
                ? "Generate another candidate"
                : "Generate repair"}
          </button>
        </>
      ) : busyStatuses.includes(run.status) ? (
        <div className="run-working-copy small muted">
          <p>{stageDescriptions[run.status]}</p>
          {run.baseline ? (
            <p>
              Completed baseline evidence stays available while this stage runs.
            </p>
          ) : null}
        </div>
      ) : candidate ? (
        <Link
          className="button full-width"
          to={`/repairs/${run.id}/challenges`}
        >
          Challenge this repair <ArrowRight size={17} />
        </Link>
      ) : (
        <div className="small muted">
          {run.status === "cancelled" ? (
            <>
              <p>
                Completed artifacts remain available. A fresh attempt uses a new
                run.
              </p>
              <button
                className="button button-secondary full-width"
                disabled={pending}
                onClick={async () => {
                  const next = await action("retry", { mode: run.mode });
                  if (next) navigate(`/repairs/${next.id}`);
                }}
              >
                <RefreshCw size={15} />
                Retry in a new run
              </button>
            </>
          ) : (
            "The baseline must finish before repair generation is available."
          )}
        </div>
      )}
    </div>
  );
}
export function Workbench() {
  const { run, fixture, pending, action } = useOutletContext<RunContext>();
  const candidate = candidateFor(run);
  const [view, setView] = useState<"baseline" | "candidate">(() =>
    candidate?.status === "accepted" ? "candidate" : "baseline",
  );
  const revisionChoice = useRef({
    runId: run.id,
    explicit: false,
    accepted: false,
  });
  const [selected, setSelected] = useState<number | null>(null);
  const [mobileTab, setMobileTab] = useState("application");
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const inspectorToggle = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!inspectorOpen) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setInspectorOpen(false);
        inspectorToggle.current?.focus();
      }
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [inspectorOpen]);
  useEffect(() => {
    if (revisionChoice.current.runId !== run.id) {
      revisionChoice.current = {
        runId: run.id,
        explicit: false,
        accepted: false,
      };
      setView("baseline");
      setSelected(null);
    }
    if (candidate?.status === "accepted" && !revisionChoice.current.accepted) {
      revisionChoice.current.accepted = true;
      if (!revisionChoice.current.explicit) {
        setView("candidate");
        setSelected(null);
      }
    }
  }, [run.id, candidate?.id, candidate?.status]);
  function chooseView(next: "baseline" | "candidate") {
    revisionChoice.current.explicit = true;
    setView(next);
    setSelected(null);
  }
  const result = view === "candidate" ? candidate?.verification : run.baseline;
  const preview =
    view === "candidate" ? candidate?.previewUrl : run.baseline?.previewUrl;
  const observations = result?.observations ?? [];
  const observation =
    observations.find((item) => item.sequence === selected) ??
    observations.find(
      (item) => item.kind === "assertion" && item.label.startsWith("Failed ·"),
    ) ??
    observations.find(
      (item) => item.kind === "action" && /\bblocked\b/i.test(item.label),
    ) ??
    observations.find((item) => item.kind === "business") ??
    observations.at(-1);
  const observationIsFailure = Boolean(
    observation &&
      ((observation.kind === "assertion" &&
        observation.label.startsWith("Failed ·")) ||
        (observation.kind === "action" &&
          /\bblocked\b/i.test(observation.label))),
  );
  return (
    <>
      <div className="workbench-status">
        <RunStatusDisplay run={run} />
        <span>
          {run.status === "queued"
            ? "Local runs execute in sequence. This run starts when the current worker is free."
            : (run.events.at(-1)?.message ??
              "Waiting for the first persisted event.")}
        </span>
        <span className="last-saved">Saved {time(run.updatedAt)}</span>
      </div>
      <div className="mobile-workbench-tabs" aria-label="Workbench view">
        {[
          ["task", "Task"],
          ["application", "Application"],
          ["evidence", "Evidence"],
        ].map(([value, label]) => (
          <button
            key={value}
            className={mobileTab === value ? "active" : ""}
            aria-pressed={mobileTab === value}
            onClick={() => setMobileTab(value)}
          >
            {label}
          </button>
        ))}
      </div>
      <div
        className={`workbench-grid mobile-show-${mobileTab} ${inspectorOpen ? "inspector-open" : ""}`}
      >
        <aside className="journey-rail" aria-label="Journey steps">
          <div className="pane-heading">
            <span className="eyebrow">THE JOURNEY</span>
            <Keyboard size={17} />
          </div>
          <h2>A task worth finishing.</h2>
          <p>{run.contract.task}</p>
          <div className="journey-source">
            {familyLabel[fixture?.family ?? "date-picker"]}
            <span>Keyboard · English</span>
          </div>
          <div className="rail-heading">
            <h3>Recorded steps</h3>
            <span className="mono">{observations.length}</span>
          </div>
          <div
            className="timeline-scroll"
            tabIndex={0}
            role="region"
            aria-label="Recorded journey events"
          >
            {observations.length ? (
              <ol className="event-path">
                {observations.map((item) => (
                  <li
                    key={item.sequence}
                    className={`${item.sequence === observation?.sequence ? "active" : ""} ${item.kind === "assertion" && item.label.startsWith("Failed ·") ? "assertion-event" : item.kind === "assertion" ? "success-event" : ""}`}
                  >
                    <button
                      onClick={() => {
                        revisionChoice.current.explicit = true;
                        setSelected(item.sequence);
                        setInspectorOpen(true);
                        setMobileTab("evidence");
                      }}
                    >
                      <span className="event-node">
                        {item.kind === "business" ||
                        (item.kind === "assertion" &&
                          item.label.startsWith("Passed ·")) ? (
                          <Check size={12} />
                        ) : item.kind === "assertion" ? (
                          <CircleAlert size={12} />
                        ) : (
                          item.sequence
                        )}
                      </span>
                      <span>
                        <strong>{item.label}</strong>
                        <small>
                          {item.evidenceType === "backend"
                            ? "Backend outcome"
                            : item.kind === "focus"
                              ? "Focus observation"
                              : "Browser observation"}
                        </small>
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
            ) : (
              <div className="rail-placeholder">
                <CircleDashedIcon />
                <p>
                  Actual browser steps will appear as the baseline finishes.
                </p>
              </div>
            )}
          </div>
          <Link className="rail-contract" to={`/repairs/${run.id}/contract`}>
            <FileCheck2 size={18} />
            <span>
              Interaction contract
              <small>
                {run.contract.assertions.filter((a) => a.enabled).length} active
                assertions · version {run.contract.version}
              </small>
            </span>
            <ChevronRight size={16} />
          </Link>
        </aside>
        <section className="application-pane" aria-label="Application preview">
          <div className="preview-toolbar">
            <div
              className="segmented-control"
              aria-label="Application revision"
            >
              <button
                aria-pressed={view === "baseline"}
                className={view === "baseline" ? "active" : ""}
                onClick={() => chooseView("baseline")}
              >
                Before repair
              </button>
              <button
                aria-pressed={view === "candidate"}
                disabled={!candidate}
                className={view === "candidate" ? "active" : ""}
                onClick={() => chooseView("candidate")}
              >
                After repair
              </button>
            </div>
            <button
              ref={inspectorToggle}
              className="icon-button inspector-toggle"
              aria-label="Toggle evidence inspector"
              aria-expanded={inspectorOpen}
              onClick={() => setInspectorOpen((v) => !v)}
            >
              <Layers3 size={19} />
            </button>
            {preview ? (
              <a
                href={preview}
                target="_blank"
                rel="noreferrer"
                className="open-preview"
              >
                Open app <ExternalLink size={14} />
              </a>
            ) : null}
          </div>
          <div className="preview-address">
            <span className="dot" />
            <span>
              {view === "baseline"
                ? "Original source"
                : `Candidate ${candidate?.revision ?? 1}`}{" "}
              · {fixture?.organization ?? "Authored sample"}
            </span>
            <span className="mono">
              {short(
                result?.sourceDigest ??
                  (view === "candidate" ? candidate?.digest : undefined),
              )}
            </span>
          </div>
          <div className="preview-frame-wrap">
            {preview ? (
              <iframe
                title={`${view === "baseline" ? "Original" : "Repaired"} ${fixture?.name ?? "sample application"}`}
                src={preview}
                sandbox="allow-scripts allow-forms allow-same-origin"
                className="application-frame"
              />
            ) : (
              <div className="preview-empty">
                <div className="preview-empty-graphic">
                  <Route size={44} />
                </div>
                <h2>
                  {run.status === "queued"
                    ? "Your place in the queue is saved."
                    : busyStatuses.includes(run.status)
                      ? "Making the barrier observable."
                      : "No application preview yet."}
                </h2>
                <p>
                  {run.status === "queued"
                    ? "This local environment runs one verification job at a time. Your run will begin when the worker is free."
                    : busyStatuses.includes(run.status)
                      ? "The local worker is building the actual application and recording a keyboard run. Evidence appears when each stage finishes."
                      : "This run has no completed build to display."}
                </p>
                {busyStatuses.includes(run.status) ? (
                  <RunStatusDisplay run={run} />
                ) : null}
              </div>
            )}
          </div>
          <div className="preview-disclosure">
            <Keyboard size={15} />
            <span>
              Interactive application · use the ordinary tab for your actual
              assistive technology.
            </span>
          </div>
          <div
            className="run-log"
            tabIndex={0}
            role="region"
            aria-label="Persisted run activity"
          >
            <div className="pane-heading">
              <h3>
                <Terminal size={15} />
                Run activity
              </h3>
              <span className="small muted">Persisted events</span>
            </div>
            <ol>
              {run.events.slice(-4).map((event) => (
                <li key={event.id}>
                  <span className="event-log-dot" />
                  <time>
                    {new Date(event.at).toLocaleTimeString(undefined, {
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                    })}
                  </time>
                  <span>{event.message}</span>
                </li>
              ))}
            </ol>
          </div>
        </section>
        <aside className="evidence-inspector" aria-label="Evidence inspector">
          <div className="pane-heading">
            <span className="eyebrow">EVIDENCE INSPECTOR</span>
            <button
              className="icon-button inspector-close"
              aria-label="Close evidence inspector"
              onClick={() => {
                setInspectorOpen(false);
                inspectorToggle.current?.focus();
              }}
            >
              <X size={18} />
            </button>
            <ShieldCheck className="inspector-shield" size={18} />
          </div>
          <div
            className="inspector-scroll"
            tabIndex={0}
            role="region"
            aria-label="Recorded observation and independent checks"
          >
            <div className="evidence-revision">
              <strong>
                {view === "baseline"
                  ? "Original evidence"
                  : "Candidate evidence"}
              </strong>
              <span>
                {view === "baseline"
                  ? "Recorded before the source repair"
                  : `Revision ${candidate?.revision ?? 1} · recorded after the repair`}
              </span>
              <div
                className="evidence-revision-actions"
                aria-label="Evidence revision"
              >
                <button
                  aria-pressed={view === "baseline"}
                  onClick={() => chooseView("baseline")}
                >
                  Original
                </button>
                <button
                  aria-pressed={view === "candidate"}
                  disabled={!candidate}
                  onClick={() => chooseView("candidate")}
                >
                  Candidate
                </button>
              </div>
            </div>
            {observation ? (
              <div className="observation-detail">
                <Badge tone={observationIsFailure ? "warning" : "neutral"}>
                  {observation.evidenceType === "backend"
                    ? "Backend evidence"
                    : "Browser observation"}
                </Badge>
                <h2>{observation.label}</h2>
                <p>{observation.detail}</p>
                {observation.focus ? (
                  <div className="focus-observation">
                    <span className="eyebrow">OBSERVED FOCUS</span>
                    <code>{observation.focus}</code>
                  </div>
                ) : null}
                {observation.source ? (
                  <p className="source-reference">
                    <Code2 size={14} />
                    <span>{observation.source}</span>
                  </p>
                ) : null}
              </div>
            ) : (
              <div className="observation-detail">
                <h2>Let the evidence lead.</h2>
                <p>
                  Select a recorded step to inspect what happened, where focus
                  moved, and why the transition matters.
                </p>
              </div>
            )}
            <div className="inspector-section">
              <div className="section-heading">
                <h3>
                  {view === "baseline" ? "Original checks" : "Candidate checks"}
                </h3>
                <span className="mono small">
                  {result?.checks.filter((c) => c.status === "passed").length ??
                    0}
                  /{result?.checks.length ?? "—"}
                </span>
              </div>
              <CheckList result={result} />
            </div>
            <div className="human-pending">
              <UserRound size={19} />
              <div>
                <strong>Human validation pending</strong>
                <p>
                  Keyboard checks are automated. Actual screen-reader experience
                  has not been established.
                </p>
              </div>
            </div>
          </div>
          <GenerationControls run={run} pending={pending} action={action} />
        </aside>
      </div>
    </>
  );
}
function CircleDashedIcon() {
  return <LoaderCircle size={23} />;
}

export function ContractEditor() {
  const context = useOutletContext<RunContext>();
  return (
    <ContractForm
      key={`${context.run.contract.id}-${context.run.contract.version}`}
      {...context}
    />
  );
}
function ContractForm({ run, reload }: RunContext) {
  const { refresh } = useStore();
  const [task, setTask] = useState(run.contract.task);
  const [reviewer, setReviewer] = useState(run.contract.reviewer);
  const [assertions, setAssertions] = useState<ContractAssertion[]>(
    run.contract.assertions,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState<number | null>(null);
  const dirty =
    task !== run.contract.task ||
    reviewer !== run.contract.reviewer ||
    JSON.stringify(assertions) !== JSON.stringify(run.contract.assertions);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const updated = await put<InteractionContract>(
        `/contracts/${run.contract.id}`,
        { expectedVersion: run.contract.version, task, reviewer, assertions },
      );
      setSaved(updated.version);
      await Promise.all([reload(), refresh()]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="repair-subpage">
      <PageHead
        headingLevel={2}
        eyebrow="DEFINE WHAT SUCCESS MEANS"
        title="The interaction contract."
      >
        <p>
          A repair has to preserve the task, not simply silence a check.
          <br />
          Review the requirements before generating a candidate.
        </p>
      </PageHead>
      <div className="contract-grid">
        <form className="panel contract-form" onSubmit={submit}>
          <div className="section-heading">
            <h2>Outcome & reviewer</h2>
            <Badge>Version {run.contract.version}</Badge>
          </div>
          <label className="field-label" htmlFor="task">
            The person should be able to…
          </label>
          <textarea
            id="task"
            rows={3}
            value={task}
            onChange={(e) => setTask(e.target.value)}
            required
          />
          <label className="field-label" htmlFor="reviewer">
            Reviewer / operator
          </label>
          <input
            id="reviewer"
            value={reviewer}
            onChange={(e) => setReviewer(e.target.value)}
            required
            maxLength={160}
          />
          <p className="small muted">
            A reviewer label records provenance. It does not imply independent
            specialist approval.
          </p>
          <div className="section-heading assertion-heading">
            <h2>Executable assertions</h2>
            <span className="small muted">
              {assertions.filter((a) => a.enabled).length} enabled
            </span>
          </div>
          {assertions.map((assertion) => (
            <div className="assertion-editor" key={assertion.id}>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={assertion.enabled}
                  disabled={assertion.required}
                  onChange={(e) =>
                    setAssertions((items) =>
                      items.map((a) =>
                        a.id === assertion.id
                          ? { ...a, enabled: e.target.checked }
                          : a,
                      ),
                    )
                  }
                />
                <span>
                  <strong>{assertion.label}</strong>
                  <small>{assertion.description}</small>
                </span>
              </label>
              <div className="assertion-provenance">
                <span>
                  {assertion.evidenceType === "backend"
                    ? "Backend invariant"
                    : "Browser observation"}
                </span>
                <span>
                  {assertion.required ? "Required · protected" : "Optional"}
                </span>
              </div>
              <div className="small muted source-text">
                Source: {assertion.source}
              </div>
            </div>
          ))}
          {error ? <Notice tone="error">{error}</Notice> : null}
          {saved ? (
            <Notice>
              Contract version {saved} saved. This run preserves version{" "}
              {run.contract.version}. Start a fresh run above to evaluate the
              updated requirements.
            </Notice>
          ) : null}
          <Notice tone="warning">
            Saving a changed contract creates a new version and marks prior runs
            stale. Required business checks stay protected.
          </Notice>
          <button
            className="button"
            disabled={busy || !dirty || run.isStale || Boolean(saved)}
          >
            {busy ? "Saving contract…" : "Save a new contract version"}
            <ArrowRight size={17} />
          </button>
        </form>
        <aside>
          <section className="panel contract-aside">
            <div className="section-heading">
              <Route size={21} />
              <h2>Permitted transitions</h2>
            </div>
            <ol className="transition-list">
              {run.contract.transitions.map((transition, index) => (
                <li key={index}>
                  <span className="mono">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <div>
                    <strong>{transition.from.replaceAll("_", " ")}</strong>
                    <small>{transition.action.replaceAll("_", " ")}</small>
                    <div className="transition-to">
                      <ArrowDownToLine size={14} />
                      {transition.to.replaceAll("_", " ")}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          </section>
          <section className="panel contract-aside">
            <h2>The independent outcome</h2>
            <p className="mono small">{run.contract.outcomeOracle}</p>
            <h3>Supported combinations</h3>
            <ul className="plain-list">
              {run.contract.supportedCombinations.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            <h3>Still needs a person</h3>
            <ul className="plain-list">
              {run.contract.humanChecks.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
        </aside>
      </div>
    </div>
  );
}

export function ChallengeStudio() {
  const { run, action, pending } = useOutletContext<RunContext>();
  const { data } = useStore();
  const candidate = candidateFor(run);
  const [scenarioId, setScenarioId] = useState("");
  const scenario =
    data?.scenarios.find((s) => s.id === scenarioId) ?? data?.scenarios[0];
  const [selected, setSelected] = useState<string | null>(null);
  const result =
    run.challenges.find((item) => item.id === selected) ??
    run.challenges.at(-1);
  const canRun =
    candidate?.status === "accepted" &&
    !run.isStale &&
    !busyStatuses.includes(run.status);
  return (
    <div className="repair-subpage">
      <PageHead
        headingLevel={2}
        eyebrow="A REPAIR SHOULD TRAVEL"
        title="Change the conditions."
      >
        <p>
          Challenge the same source revision with a fresh interaction scenario.
          <br />
          The original baseline stays intact. Every result keeps its seed.
        </p>
      </PageHead>
      <div className="challenge-grid">
        <section className="panel challenge-config">
          <h2>Choose a meaningful variation</h2>
          <p className="muted">
            These are controlled authored scenarios, not a claim of unseen
            production coverage.
          </p>
          <div className="scenario-list">
            {data?.scenarios.map((item) => (
              <label
                className={`scenario-option ${scenario?.id === item.id ? "selected" : ""}`}
                key={item.id}
              >
                <input
                  name="scenario"
                  type="radio"
                  checked={scenario?.id === item.id}
                  onChange={() => setScenarioId(item.id)}
                />
                <span>
                  <strong>{item.name}</strong>
                  <small>{item.description}</small>
                </span>
              </label>
            ))}
          </div>
          {scenario ? (
            <dl className="simple-facts scenario-facts">
              <div>
                <dt>Locale</dt>
                <dd>{scenario.locale === "de" ? "German" : "English"}</dd>
              </div>
              <div>
                <dt>Late validation</dt>
                <dd>
                  {scenario.delayedValidationMs
                    ? `${scenario.delayedValidationMs}ms`
                    : "No added delay"}
                </dd>
              </div>
              <div>
                <dt>First slot unavailable</dt>
                <dd>{scenario.unavailableFirst ? "Yes" : "No"}</dd>
              </div>
              <div>
                <dt>Long labels</dt>
                <dd>{scenario.longLabels ? "Yes" : "No"}</dd>
              </div>
              <div>
                <dt>Reproducible seed</dt>
                <dd className="mono">{scenario.seed}</dd>
              </div>
            </dl>
          ) : null}
          <div className="revision-binding">
            <GitBranch size={16} />
            <span>
              Bound to candidate <code>{short(candidate?.digest)}</code>
            </span>
          </div>
          <button
            className="button full-width"
            disabled={!canRun || pending || !scenario}
            onClick={() =>
              scenario &&
              candidate &&
              void action("challenges", {
                scenarioId: scenario.id,
                candidateDigest: candidate.digest,
              })
            }
          >
            <Play size={16} />
            {pending || run.status === "verifying"
              ? "Checking the variation…"
              : "Run this challenge"}
          </button>
          {!candidate ? (
            <p className="small muted">
              Generate and verify a candidate before running a challenge.
            </p>
          ) : candidate.status === "accepted" &&
            (pending || busyStatuses.includes(run.status)) ? (
            <p className="small muted" role="status">
              The challenge is running against this accepted candidate.
              Completed evidence stays available.
            </p>
          ) : run.isStale ? (
            <p className="small muted">
              The contract changed. Start a fresh run before challenging this
              repair.
            </p>
          ) : !canRun ? (
            <p className="small muted">
              The candidate must finish verification before a challenge can
              start.
            </p>
          ) : null}
        </section>
        <div>
          <section className="panel challenge-results">
            <div className="section-heading">
              <h2>Challenge record</h2>
              <Badge>{run.challenges.length} completed</Badge>
            </div>
            {run.challenges.length ? (
              <div
                className="table-scroll"
                tabIndex={0}
                role="region"
                aria-label="Challenge results table"
              >
                <table>
                  <thead>
                    <tr>
                      <th>Scenario</th>
                      <th>Seed</th>
                      <th>Result</th>
                      <th>
                        <span className="sr-only">Inspect</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {run.challenges.map((item) => (
                      <tr
                        key={item.id}
                        className={item.id === result?.id ? "selected" : ""}
                      >
                        <td>
                          <strong>{item.scenario.name}</strong>
                          <small>{time(item.completedAt)}</small>
                        </td>
                        <td className="mono">{item.scenario.seed}</td>
                        <td>
                          <Status status={item.status} />
                        </td>
                        <td>
                          <button
                            className="icon-button"
                            aria-label={`Inspect ${item.scenario.name} result`}
                            onClick={() => setSelected(item.id)}
                          >
                            <ArrowUpRight size={17} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="challenge-empty">
                <SlidersHorizontal size={32} />
                <h3>The next condition is yours.</h3>
                <p>
                  No challenge has finished for this run yet. Select a scenario
                  to test the actual candidate.
                </p>
              </div>
            )}
          </section>
          {result ? (
            <section className="panel selected-challenge">
              <div className="section-heading">
                <h2>{result.scenario.name}</h2>
                <Status status={result.status} />
              </div>
              <p className="small muted">
                {result.browser} {result.browserVersion} ·{" "}
                {(result.durationMs / 1000).toFixed(1)}s · source{" "}
                <code>{short(result.sourceDigest)}</code>
              </p>
              <p className="small muted">
                Verifier:{" "}
                <code>
                  {result.verifierVersion ?? "Historical · unversioned"}
                </code>
              </p>
              <CheckList result={result} />
              {result.outcome ? <Outcome result={result} /> : null}
              <a
                className="text-link"
                href={result.previewUrl}
                target="_blank"
                rel="noreferrer"
              >
                Open this challenge application <ExternalLink size={15} />
              </a>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}
function Outcome({ result }: { result: VerificationResult }) {
  if (!result.outcome) return null;
  return (
    <div className="outcome-block">
      <div className="section-heading">
        <CheckCircle2 size={18} />
        <h3>Persisted task outcome</h3>
      </div>
      <dl className="simple-facts">
        <div>
          <dt>Service</dt>
          <dd>{result.outcome.service}</dd>
        </div>
        <div>
          <dt>Date</dt>
          <dd>{result.outcome.date}</dd>
        </div>
        <div>
          <dt>Record</dt>
          <dd className="mono">{short(result.outcome.id)}</dd>
        </div>
        <div>
          <dt>Source digest</dt>
          <dd className="mono">{short(result.outcome.sourceDigest)}</dd>
        </div>
      </dl>
    </div>
  );
}
function Diff({ patch }: { patch: string }) {
  return (
    <div
      className="diff-view"
      role="region"
      aria-label="Unified source diff"
      tabIndex={0}
    >
      <pre>
        {patch.split("\n").map((line, index) => (
          <div
            key={index}
            className={
              line.startsWith("+") && !line.startsWith("+++")
                ? "diff-add"
                : line.startsWith("-") && !line.startsWith("---")
                  ? "diff-remove"
                  : line.startsWith("@@")
                    ? "diff-hunk"
                    : ""
            }
          >
            <span className="diff-line-number" aria-hidden="true">
              {index + 1}
            </span>
            <code>{line || " "}</code>
          </div>
        ))}
      </pre>
    </div>
  );
}
async function exportManifest(run: RepairRun) {
  const manifest = await api<EvidenceManifest>(`/repairs/${run.id}/export`);
  download(manifest, `passage-${run.id}-evidence.json`);
}
async function exportBundle(run: RepairRun) {
  const response = await fetch(`/v1/repairs/${run.id}/bundle`);
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(
      body?.error?.message ??
        "The portable bundle could not be prepared. Please retry when the repair is ready.",
    );
  }
  download(
    await response.blob(),
    `passage-${run.id}-bundle.zip`,
    "application/zip",
  );
}
async function exportPatch(run: RepairRun) {
  const response = await fetch(`/v1/repairs/${run.id}/patch`);
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(
      body?.error?.message ??
        "The patch is not available. Complete the repair first.",
    );
  }
  download(await response.text(), `passage-${run.id}.patch`, "text/x-diff");
}
export function Review() {
  const { run, fixture, reload } = useOutletContext<RunContext>();
  const active = candidateFor(run);
  const [candidateId, setCandidateId] = useState("");
  const candidate = run.candidates.find((c) => c.id === candidateId) ?? active;
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState(false);
  const [exportKind, setExportKind] = useState<"patch" | "manifest" | "bundle">(
    "bundle",
  );
  const [exportSuccess, setExportSuccess] = useState("");
  const [prInfo, setPrInfo] = useState(false);
  async function doExport(kind: "patch" | "manifest" | "bundle") {
    setExporting(true);
    setExportKind(kind);
    setError("");
    setExportSuccess("");
    try {
      await (kind === "patch"
        ? exportPatch(run)
        : kind === "bundle"
          ? exportBundle(run)
          : exportManifest(run));
      setExportSuccess(
        kind === "patch"
          ? "Patch export prepared. Your browser has started the download."
          : kind === "bundle"
            ? "Portable repair bundle prepared. Your browser has started the ZIP download."
            : "Evidence manifest prepared. Your browser has started the download.",
      );
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setExporting(false);
    }
  }
  return (
    <div className="repair-subpage">
      <PageHead
        headingLevel={2}
        eyebrow="A CHANGE YOU CAN STAND BEHIND"
        title="Review the way forward."
        action={
          <button
            className="button"
            disabled={!active || run.isStale || exporting}
            onClick={() => void doExport("bundle")}
            aria-busy={exporting && exportKind === "bundle"}
          >
            {exporting && exportKind === "bundle" ? (
              <LoaderCircle className="spin" size={17} />
            ) : (
              <ArrowDownToLine size={17} />
            )}
            {exporting && exportKind === "bundle"
              ? "Preparing bundle…"
              : "Download repair bundle"}
          </button>
        }
      >
        <p>
          Inspect what changed, what was checked, and what still needs a person.
        </p>
      </PageHead>
      {!candidate ? (
        <Empty
          title="A source change belongs here."
          action={
            <Link className="button" to={`/repairs/${run.id}`}>
              Return to the workbench <ArrowRight size={17} />
            </Link>
          }
        >
          Review the baseline and interaction contract, then generate a
          candidate repair.
        </Empty>
      ) : (
        <>
          <div className="review-summary">
            <div>
              <span className="eyebrow">
                {candidate.status === "accepted"
                  ? "AUTOMATED OUTCOME"
                  : "CANDIDATE OUTCOME"}
              </span>
              <h2>
                {candidate.verification?.passed
                  ? "The checked journey can finish."
                  : candidate.status === "rejected"
                    ? "This candidate did not pass."
                    : "The candidate is being checked."}
              </h2>
              <p>{candidate.summary}</p>
            </div>
            <div className="review-status">
              <Status
                status={candidate.verification?.status ?? "inconclusive"}
              />
              <span>Human validation pending</span>
              <code>{short(candidate.digest)}</code>
            </div>
          </div>
          {run.challenges.some((result) => !result.passed) ? (
            <Notice tone="warning" title="A challenge needs attention">
              {run.challenges.filter((result) => !result.passed).length} of{" "}
              {run.challenges.length} completed challenges did not pass. Inspect
              the scenario results before adopting this repair.
            </Notice>
          ) : null}
          {error ? <Notice tone="error">{error}</Notice> : null}
          {exporting ? (
            <div className="export-progress" role="status">
              <LoaderCircle className="spin" size={17} />
              <span>
                Preparing the{" "}
                {exportKind === "bundle"
                  ? "portable repair bundle"
                  : exportKind === "patch"
                    ? "source patch"
                    : "evidence manifest"}{" "}
                for download…
              </span>
            </div>
          ) : null}
          {exportSuccess ? (
            <div className="export-success" role="status">
              <CheckCircle2 size={17} />
              <span>{exportSuccess}</span>
            </div>
          ) : null}
          <div className="review-grid">
            <div>
              <section className="panel diff-panel">
                <div className="diff-toolbar">
                  <h2>
                    <Code2 size={17} />
                    Source change
                  </h2>
                  <label>
                    <span className="sr-only">Candidate revision</span>
                    <select
                      value={candidate.id}
                      onChange={(e) => setCandidateId(e.target.value)}
                    >
                      {run.candidates.map((item) => (
                        <option key={item.id} value={item.id}>
                          Revision {item.revision} · {item.status}
                          {item.id === active?.id ? " · active" : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="diff-file">
                  <FileDiff size={15} />
                  <span>{candidate.sourceFile}</span>
                  <code>{short(candidate.digest)}</code>
                </div>
                <Diff patch={candidate.patch} />
              </section>
              {candidate.id !== active?.id ? (
                <Notice tone="warning">
                  You are inspecting a historical candidate. Downloaded patches
                  and bundles use the active candidate and its current evidence.
                </Notice>
              ) : null}
              <AssistiveEvidence
                key={candidate.id}
                run={run}
                candidate={candidate}
              />
            </div>
            <aside>
              <section className="panel review-checks">
                <h2>Independent verification</h2>
                <CheckList result={candidate.verification} />
                {candidate.verification ? (
                  <Outcome result={candidate.verification} />
                ) : null}
                <ArrowLink to={`/repairs/${run.id}/challenges`}>
                  Challenge this revision
                </ArrowLink>
              </section>
              <section className="panel receipt-panel">
                <h2>Generation receipt</h2>
                <Receipt candidate={candidate} />
              </section>
              <section className="panel export-panel">
                <h2>Take the evidence with you.</h2>
                <p>
                  The portable ZIP keeps the source patch, run record, and
                  verification artifacts together. You can also download
                  individual files.
                </p>
                <button
                  className="button button-secondary full-width"
                  disabled={exporting || run.isStale}
                  onClick={() => void doExport("patch")}
                >
                  <ArrowDownToLine size={16} />
                  Active source patch
                </button>
                <button
                  className="button button-secondary full-width"
                  disabled={exporting || run.isStale}
                  onClick={() => void doExport("manifest")}
                >
                  <ArrowDownToLine size={16} />
                  Evidence manifest
                </button>
                <button
                  className="button button-plain full-width"
                  onClick={() => setPrInfo((value) => !value)}
                >
                  <GitBranch size={16} />
                  Draft pull request <Badge>Unavailable locally</Badge>
                </button>
                {prInfo ? (
                  <Notice>
                    Repository publication is not connected in this edition.
                    Download the reviewed patch and apply it in your repository.
                    No pull request has been created.
                  </Notice>
                ) : null}
              </section>
            </aside>
          </div>
        </>
      )}
    </div>
  );
}

export function EvidenceReport() {
  const { id } = useParams();
  const { data } = useStore();
  const { run, error, reload } = useRunResource(id);
  const [exportError, setExportError] = useState("");
  const [exporting, setExporting] = useState(false);
  const [exportKind, setExportKind] = useState<"bundle" | "manifest">("bundle");
  const [exportSuccess, setExportSuccess] = useState("");
  const candidate = run ? candidateFor(run) : null;
  const fixture = data?.fixtures.find((item) => item.id === run?.fixtureId);
  const after = candidate?.verification;
  async function doExport(kind: "bundle" | "manifest" = "bundle") {
    if (!run) return;
    setExporting(true);
    setExportKind(kind);
    setExportError("");
    setExportSuccess("");
    try {
      await (kind === "bundle" ? exportBundle(run) : exportManifest(run));
      setExportSuccess(
        kind === "bundle"
          ? "Portable repair bundle prepared. Your browser has started the ZIP download."
          : "Evidence manifest prepared. Your browser has started the download.",
      );
      await reload();
    } catch (e) {
      setExportError((e as Error).message);
    } finally {
      setExporting(false);
    }
  }
  if (!run)
    return (
      <div className="page">
        <Empty
          title={
            error
              ? "The report could not be opened."
              : "Opening the evidence record…"
          }
          action={
            <button className="button" onClick={() => void reload()}>
              Retry <RefreshCw size={16} />
            </button>
          }
        >
          {error || "Loading the saved run and its independent observations."}
        </Empty>
      </div>
    );
  const beforePassed =
    run.baseline?.checks.filter((c) => c.status === "passed").length ?? 0;
  const afterPassed =
    after?.checks.filter((c) => c.status === "passed").length ?? 0;
  const limitations = [
    ...new Set([
      ...(run.baseline?.limitations ?? []),
      ...(after?.limitations ?? []),
      "Automated keyboard observations do not establish actual screen-reader usability.",
      "Human impact and independently reviewed assistive-technology trials remain pending.",
    ]),
  ];
  return (
    <div className="page evidence-report">
      <Link className="breadcrumb" to={`/repairs/${run.id}`}>
        <ArrowLeft size={14} /> Back to the repair
      </Link>
      <div className="report-heading">
        <div>
          <p className="eyebrow">PASSAGE / EVIDENCE RECORD</p>
          <h1>
            A way through.
            <br />
            <em>And a record of why.</em>
          </h1>
          <p>
            {fixture?.name} · {run.contract.task}
          </p>
        </div>
        <div>
          <Badge>
            {candidate?.receipt.live
              ? `Live · ${providerName(candidate.receipt.provider)}`
              : "Handcrafted reference mode"}
          </Badge>
          <p className="mono small">
            {short(run.id)} / {time(run.createdAt)}
          </p>
          <button
            className="button"
            disabled={exporting || run.isStale || !candidate}
            onClick={() => void doExport("bundle")}
            aria-busy={exporting && exportKind === "bundle"}
          >
            {exporting && exportKind === "bundle" ? (
              <LoaderCircle className="spin" size={17} />
            ) : (
              <ArrowDownToLine size={17} />
            )}
            {exporting && exportKind === "bundle"
              ? "Preparing bundle…"
              : "Download repair bundle"}
          </button>
          <button
            className="report-manifest-link"
            disabled={exporting || run.isStale}
            onClick={() => void doExport("manifest")}
          >
            {exporting && exportKind === "manifest"
              ? "Preparing manifest…"
              : "Download manifest only"}
            <ArrowDownToLine size={14} />
          </button>
        </div>
      </div>
      {error || exportError ? (
        <Notice tone="error">{exportError || error}</Notice>
      ) : null}
      {exporting ? (
        <div className="export-progress" role="status">
          <LoaderCircle className="spin" size={17} />
          <span>
            Preparing the{" "}
            {exportKind === "bundle"
              ? "portable repair bundle"
              : "evidence manifest"}{" "}
            for download…
          </span>
        </div>
      ) : null}
      {exportSuccess ? (
        <div className="export-success" role="status">
          <CheckCircle2 size={17} />
          <span>{exportSuccess}</span>
        </div>
      ) : null}
      {run.isStale ? (
        <Notice tone="warning">
          This run uses a previous contract version. Its evidence is historical
          and cannot establish the current requirements.
        </Notice>
      ) : null}
      <div className="report-outcome">
        <div>
          <span className="eyebrow">THE RECORDED OUTCOME</span>
          <h2>
            {after?.passed
              ? "The automated task finished."
              : run.baseline
                ? "The barrier was recorded."
                : "The task has not finished verification."}
          </h2>
          <p>
            {after?.passed
              ? "The candidate passed the enabled interaction and business checks in the declared browser scenario."
              : "No accepted candidate outcome has been established for this run."}
          </p>
        </div>
        <div className="report-human">
          <UserRound size={23} />
          <strong>
            {run.humanObservations.length
              ? `${run.humanObservations.length} operator observation${run.humanObservations.length === 1 ? "" : "s"}`
              : "Human validation pending"}
          </strong>
          <p>
            {run.humanObservations.length
              ? "Not independently reviewed."
              : "No participant outcome is claimed."}
          </p>
        </div>
      </div>
      <div className="before-after">
        <section className="panel">
          <div className="section-heading">
            <span className="eyebrow">01 / ORIGINAL JOURNEY</span>
            {run.baseline ? <Status status={run.baseline.status} /> : null}
          </div>
          <h2>
            {run.baseline
              ? `${beforePassed} of ${run.baseline.checks.length} checks passed`
              : "Not yet recorded"}
          </h2>
          <div className="evidence-check-track" aria-hidden="true">
            {run.baseline?.checks.map((check) => (
              <i
                key={check.id}
                className={check.status === "passed" ? "passed" : "failed"}
              />
            ))}
          </div>
          <CheckList result={run.baseline} />
          {run.baseline?.previewUrl ? (
            <a
              className="text-link"
              href={run.baseline.previewUrl}
              target="_blank"
              rel="noreferrer"
            >
              Open original application <ExternalLink size={15} />
            </a>
          ) : null}
        </section>
        <section className="panel">
          <div className="section-heading">
            <span className="eyebrow">02 / CANDIDATE JOURNEY</span>
            {after ? <Status status={after.status} /> : null}
          </div>
          <h2>
            {after
              ? `${afterPassed} of ${after.checks.length} checks passed`
              : "Not yet verified"}
          </h2>
          <div className="evidence-check-track" aria-hidden="true">
            {after?.checks.map((check) => (
              <i
                key={check.id}
                className={check.status === "passed" ? "passed" : "failed"}
              />
            ))}
          </div>
          <CheckList result={after} />
          {after ? <Outcome result={after} /> : null}
          {candidate?.previewUrl ? (
            <a
              className="text-link"
              href={candidate.previewUrl}
              target="_blank"
              rel="noreferrer"
            >
              Open repaired application <ExternalLink size={15} />
            </a>
          ) : null}
        </section>
      </div>
      <section className="panel report-challenges">
        <div className="section-heading">
          <h2>How the repair traveled.</h2>
          <ArrowLink to={`/repairs/${run.id}/challenges`}>
            Open challenge studio
          </ArrowLink>
        </div>
        <p>
          {run.challenges.filter((c) => c.passed).length} of{" "}
          {run.challenges.length} completed challenge scenarios passed. No
          untested condition is counted.
        </p>
        {run.challenges.length ? (
          <div
            className="table-scroll"
            tabIndex={0}
            role="region"
            aria-label="Challenge results table"
          >
            <table>
              <thead>
                <tr>
                  <th>Scenario</th>
                  <th>Seed</th>
                  <th>Source</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {run.challenges.map((result) => (
                  <tr key={result.id}>
                    <td>{result.scenario.name}</td>
                    <td className="mono">{result.scenario.seed}</td>
                    <td className="mono">{short(result.sourceDigest)}</td>
                    <td>
                      <Status status={result.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">No variation challenge has been completed.</p>
        )}
      </section>
      <div className="report-bottom-grid">
        <section className="panel">
          <h2>Know the limits.</h2>
          <ul className="limitation-list">
            {limitations.map((item) => (
              <li key={item}>
                <CircleAlert size={17} />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </section>
        <section className="panel">
          <h2>Bound to this revision.</h2>
          <dl className="simple-facts">
            <div>
              <dt>Original source</dt>
              <dd className="mono">{short(run.baseline?.sourceDigest)}</dd>
            </div>
            <div>
              <dt>Candidate</dt>
              <dd className="mono">{short(candidate?.digest)}</dd>
            </div>
            <div>
              <dt>Contract</dt>
              <dd className="mono">
                v{run.contract.version} · {short(run.contract.digest)}
              </dd>
            </div>
            <div>
              <dt>Browser</dt>
              <dd>
                {after?.browser ?? run.baseline?.browser ?? "Not recorded"}{" "}
                {after?.browserVersion ?? run.baseline?.browserVersion}
              </dd>
            </div>
            <div>
              <dt>Candidate verifier</dt>
              <dd className="mono">
                {after?.verifierVersion ??
                  (after ? "Historical · unversioned" : "Not yet verified")}
              </dd>
            </div>
            <div>
              <dt>Original verifier</dt>
              <dd className="mono">
                {run.baseline?.verifierVersion ??
                  (run.baseline
                    ? "Historical · unversioned"
                    : "Not yet verified")}
              </dd>
            </div>
            <div>
              <dt>Recorded</dt>
              <dd>{time(run.updatedAt)}</dd>
            </div>
          </dl>
          {candidate ? (
            <details className="receipt-disclosure">
              <summary>
                Inspect the generation receipt <ChevronDown size={16} />
              </summary>
              <Receipt candidate={candidate} />
            </details>
          ) : null}
          <ArrowLink to={`/repairs/${run.id}/review`}>
            Review the source change
          </ArrowLink>
        </section>
      </div>
      <div className="report-final">
        <ShieldCheck size={22} />
        <p>
          This record describes one scoped journey, the conditions checked, and
          the evidence available.
          <br />
          It is not a universal accessibility or compliance certification.
        </p>
      </div>
    </div>
  );
}
