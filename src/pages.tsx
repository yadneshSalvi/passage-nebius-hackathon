import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  Braces,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleDashed,
  Code2,
  ExternalLink,
  FileCheck2,
  Fingerprint,
  GitBranch,
  Keyboard,
  Layers3,
  LockKeyhole,
  Plus,
  Radio,
  Route,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
} from "lucide-react";
import type {
  AppSettings,
  BootstrapData,
  Journey,
  RepairRun,
} from "../shared/types";
import { useStore } from "./App";
import { ProviderUsage } from "./ProviderUsage";
import { post, put } from "./api";
import {
  isDevelopmentRoute,
  providerName,
  providerPurpose,
  runOriginLabel,
} from "./providerLabels";
import {
  ArrowLink,
  Badge,
  Empty,
  FixtureArt,
  Notice,
  PageHead,
  RunStatusDisplay,
  Status,
  candidateFor,
  familyLabel,
  short,
  time,
} from "./ui";

export function Welcome() {
  const { data, repository, loading } = useStore();
  const fixture = data?.fixtures[0];
  const latest = data?.runs.find((run) => run.baseline);
  const observed = latest?.baseline?.observations.slice(0, 3) ?? [];
  return (
    <div className="welcome">
      <section className="hero">
        <div className="hero-copy">
          <div className="eyebrow hero-eyebrow">
            <span className="tiny-path" /> ACCESSIBILITY, AT THE SOURCE
          </div>
          <h1>
            Every journey
            <br />
            deserves a<br />
            <em>way through.</em>
          </h1>
          <p className="hero-description">
            Turn the moment someone gets stuck into a lasting source repair.
            Follow the journey. Fix the barrier. Prove the way is clear.
          </p>
          <div className="hero-actions">
            <Link
              to={
                fixture
                  ? `/journeys/new?fixture=${fixture.id}`
                  : "/journeys/new"
              }
              className="button button-large"
            >
              Try a blocked journey <ArrowRight size={19} />
            </Link>
            <Link className="hero-secondary" to="/journeys">
              Explore journeys <ArrowUpRight size={17} />
            </Link>
          </div>
          <div className="hero-footnote">
            <Keyboard size={16} />
            <span>Keyboard-first. Evidence-led. Human review always.</span>
          </div>
        </div>
        <div className="hero-visual">
          <div className="visual-topline">
            <span className="small-overline">A JOURNEY, NOT JUST AN ISSUE</span>
            <span className="sample-label">Authored sample</span>
          </div>
          <div className="journey-illustration">
            <div className="illustration-label">
              <span className="dot" />
              {fixture?.organization ?? "A fictional appointment service"}
              <span className="mono">01</span>
            </div>
            <h2>{fixture?.task ?? "Confirm an available appointment"}</h2>
            <div className="journey-path-visual">
              <svg viewBox="0 0 440 190" fill="none" aria-hidden="true">
                <path
                  className="path-base"
                  d="M28 31H160Q190 31 190 61V113Q190 143 220 143H410"
                />
                <path className="path-active" d="M28 31H160Q190 31 190 61V76" />
                <circle cx="28" cy="31" r="6" fill="#075E54" />
                <circle
                  cx="190"
                  cy="81"
                  r="9"
                  fill="#F6F4EE"
                  stroke="#A35E39"
                  strokeWidth="3"
                />
                <path
                  d="M187 78L193 84M193 78L187 84"
                  stroke="#A35E39"
                  strokeWidth="1.5"
                />
                <circle
                  cx="410"
                  cy="143"
                  r="6"
                  fill="#F6F4EE"
                  stroke="#A9B9AF"
                  strokeWidth="2"
                />
              </svg>
              <div className="path-start">
                <span>01</span>Find a service
              </div>
              <div className="path-barrier">
                <span>02 · THE BARRIER</span>
                {fixture?.barrier ??
                  "The control cannot be used with a keyboard."}
              </div>
              <div className="path-end">
                <span>03</span>Confirm the outcome
              </div>
            </div>
            <div className="illustration-bottom">
              <span>
                <Keyboard size={16} /> Keyboard journey
              </span>
              <span>
                Fictional data <LockKeyhole size={13} />
              </span>
            </div>
          </div>
          <div className="evidence-note">
            <div className="evidence-note-icon">
              <Code2 size={21} />
            </div>
            <div>
              <strong>A source change. A path forward.</strong>
              <span>Reproduce → repair → independently verify</span>
            </div>
            <ArrowUpRight size={20} />
          </div>
          <div className="visual-caption">
            The task is the measure. A passing scan is only part of the story.
          </div>
        </div>
      </section>
      <section className="principle-strip" aria-label="How Passage works">
        <div>
          <span className="principle-number">01</span>
          <div>
            <h3>Start where it breaks</h3>
            <p>A real task, a visible barrier.</p>
          </div>
        </div>
        <div>
          <span className="principle-number">02</span>
          <div>
            <h3>Repair the source</h3>
            <p>A focused, reviewable change.</p>
          </div>
        </div>
        <div>
          <span className="principle-number">03</span>
          <div>
            <h3>Challenge the result</h3>
            <p>Independent checks. Honest limits.</p>
          </div>
        </div>
      </section>
      <section className="sample-section">
        <div className="section-head">
          <div>
            <p className="eyebrow">THE JOURNEY LIBRARY</p>
            <h2>
              Small interactions.
              <br />
              <em>Meaningful consequences.</em>
            </h2>
          </div>
          <div>
            <p>
              Explore authored applications with deliberately seeded barriers.
              <br className="desktop-break" /> Each sample has a task worth
              completing.
            </p>
            <ArrowLink to="/journeys">Explore all journeys</ArrowLink>
          </div>
        </div>
        <div className="fixture-grid homepage-grid">
          {data?.fixtures.slice(0, 3).map((item, index) => (
            <Link
              key={item.id}
              className="fixture-card"
              to={`/journeys/new?fixture=${item.id}`}
            >
              <FixtureArt fixture={item} />
              <div className="fixture-card-content">
                <div className="fixture-meta">
                  <span>{familyLabel[item.family]}</span>
                  <span className="mono">0{index + 1}</span>
                </div>
                <h3>
                  {item.name}
                  <ArrowUpRight size={21} />
                </h3>
                <p>{item.description}</p>
                <div className="fixture-card-bottom">
                  <span>{item.organization}</span>
                  <span>
                    Try journey <ArrowRight size={15} />
                  </span>
                </div>
              </div>
            </Link>
          ))}
          {!data ? (
            <div className="sample-placeholder">
              {loading ? (
                <>
                  <CircleDashed size={28} />
                  <p>Loading the authored journey library…</p>
                </>
              ) : (
                <>
                  <Route size={28} />
                  <p>The sample library is waiting for the local service.</p>
                </>
              )}
            </div>
          ) : null}
        </div>
      </section>
      <section className="trust-section">
        <div className="trust-heading">
          <span className="eyebrow">PROOF YOU CAN FOLLOW</span>
          <h2>
            Access is an outcome.
            <br />
            <em>Keep the evidence close.</em>
          </h2>
        </div>
        <div className="trust-items">
          <div>
            <ShieldCheck size={24} />
            <h3>Independent by design</h3>
            <p>
              The repair cannot rewrite its own acceptance checks. Browser
              behavior and stored outcomes are checked separately.
            </p>
          </div>
          <div>
            <Fingerprint size={24} />
            <h3>Every claim has a source</h3>
            <p>
              Review exact revisions, model receipts, failed attempts, and
              challenge results. Export the evidence with the patch.
            </p>
          </div>
          <div>
            <Keyboard size={24} />
            <h3>People complete the picture</h3>
            <p>
              Automated keyboard checks do not establish a screen-reader
              experience. Human validation stays visibly pending.
            </p>
          </div>
        </div>
      </section>
      {latest ? (
        <section className="recent-note">
          <div>
            <p className="eyebrow">YOUR MOST RECENT JOURNEY</p>
            <h3>
              {data?.fixtures.find((f) => f.id === latest.fixtureId)?.name}
            </h3>
            <RunStatusDisplay run={latest} />
          </div>
          <ArrowLink to={`/repairs/${latest.id}`}>
            Continue the investigation
          </ArrowLink>
        </section>
      ) : null}
    </div>
  );
}

export function JourneyGallery() {
  const { data, loading, repository } = useStore();
  const [query, setQuery] = useState("");
  const [family, setFamily] = useState("all");
  const fixtures =
    data?.fixtures.filter(
      (item) =>
        (family === "all" || item.family === family) &&
        `${item.name} ${item.description} ${item.organization}`
          .toLowerCase()
          .includes(query.toLowerCase()),
    ) ?? [];
  return (
    <div className="page">
      <PageHead eyebrow="THE JOURNEY LIBRARY" title="Find a way through.">
        <p>
          Authored applications. Fictional data. Real browser checks.
          <br />
          Choose an interaction and trace the barrier back to its source.
        </p>
      </PageHead>
      <div className="filter-bar">
        <div className="filter-buttons" aria-label="Filter interaction family">
          {[["all", "All journeys"], ...Object.entries(familyLabel)].map(
            ([value, label]) => (
              <button
                key={value}
                aria-pressed={family === value}
                className={family === value ? "selected" : ""}
                onClick={() => setFamily(value)}
              >
                {label}
              </button>
            ),
          )}
        </div>
        <label className="search-field compact-search">
          <Search size={17} />
          <input
            aria-label="Search samples"
            placeholder="Find a journey…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      </div>
      <div className="fixture-grid">
        {fixtures.map((fixture, index) => (
          <Link
            className="fixture-card"
            to={`/journeys/new?fixture=${fixture.id}`}
            key={fixture.id}
          >
            <FixtureArt fixture={fixture} />
            <div className="fixture-card-content">
              <div className="fixture-meta">
                <span>{familyLabel[fixture.family]}</span>
                <span className="mono">
                  {String(index + 1).padStart(2, "0")}
                </span>
              </div>
              <h2>
                {fixture.name}
                <ArrowUpRight size={21} />
              </h2>
              <p>{fixture.description}</p>
              <div className="tag-row">
                {fixture.tags.slice(0, 3).map((tag) => (
                  <span key={tag}>{tag}</span>
                ))}
              </div>
              <div className="fixture-card-bottom">
                <span>{fixture.organization}</span>
                <span>
                  Start journey <ArrowRight size={15} />
                </span>
              </div>
            </div>
          </Link>
        ))}
      </div>
      {!fixtures.length ? (
        <Empty
          title={loading ? "Loading the library" : "No matching journeys"}
          action={
            <button
              className="button button-secondary"
              onClick={() => {
                setQuery("");
                setFamily("all");
              }}
            >
              Reset filters
            </button>
          }
        >
          {loading
            ? "Retrieving the sample applications from the local service."
            : "Try a different interaction family or clear your search."}
        </Empty>
      ) : null}
      <div className="library-bottom">
        <GitBranch size={24} />
        <div>
          <h3>Have a different journey in mind?</h3>
          <p>
            This local edition supports scoped authored fixtures. Inspect
            repository import scope.
          </p>
        </div>
        <button className="button button-secondary" onClick={repository}>
          Repository connections <ArrowRight size={17} />
        </button>
      </div>
    </div>
  );
}

export function NewJourney() {
  const { data, refresh } = useStore();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [fixtureId, setFixtureId] = useState(params.get("fixture") ?? "");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fixture =
    data?.fixtures.find((item) => item.id === fixtureId) ?? data?.fixtures[0];
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!fixture || !consent) return;
    setBusy(true);
    setError("");
    try {
      const result = await post<{ journey: Journey; run: RepairRun }>(
        "/journeys",
        {
          fixtureId: fixture.id,
          inputMode: "keyboard",
          locale: "en",
          captureConsent: consent,
        },
      );
      await refresh();
      navigate(`/repairs/${result.run.id}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="page setup-page">
      <Link className="breadcrumb" to="/journeys">
        Journeys <ChevronRight size={14} /> New journey
      </Link>
      <PageHead
        eyebrow="A GOOD REPAIR STARTS WITH A CLEAR TASK"
        title="What should someone be able to do?"
      />
      <div className="setup-grid">
        <form className="panel setup-form" onSubmit={submit}>
          <div className="form-section">
            <span className="step-label">01 / APPLICATION</span>
            <label htmlFor="fixture">Choose an authored sample</label>
            <select
              id="fixture"
              value={fixture?.id ?? ""}
              onChange={(e) => setFixtureId(e.target.value)}
              disabled={busy || !data}
            >
              {data?.fixtures.map((item) => (
                <option value={item.id} key={item.id}>
                  {item.name} · {familyLabel[item.family]}
                </option>
              ))}
            </select>
            {fixture ? (
              <div className="task-statement">
                <span className="eyebrow">THE TASK</span>
                <p>{fixture.task}</p>
              </div>
            ) : null}
          </div>
          <div className="form-section">
            <span className="step-label">02 / INPUT & ENVIRONMENT</span>
            <div className="input-mode">
              <Keyboard size={24} />
              <div>
                <strong>Keyboard</strong>
                <p>
                  Real browser actions ·{" "}
                  {fixture?.id === "northstar-international"
                    ? "German"
                    : "English"}{" "}
                  · Chromium
                </p>
              </div>
              <CheckCircle2 size={19} />
            </div>
            <p className="small muted">
              The automated baseline records focus, control state, and the
              persisted outcome. Actual assistive-technology output is not
              recorded.
            </p>
          </div>
          <div className="form-section">
            <span className="step-label">03 / CAPTURE SCOPE</span>
            <p>
              Only this fictional application's browser observations and task
              events are captured. Relevant source and observations are sent to{" "}
              {providerName(data?.provider.provider)} only if you explicitly
              choose paid live repair. The configured model is{" "}
              <code>{data?.provider.model ?? "loading…"}</code>.
            </p>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
                required
              />
              <span>
                I agree to capture this authored sample's interaction evidence.
              </span>
            </label>
            <p className="small muted">
              Local evidence is persisted on this computer. No participant
              recording is collected. Saved run evidence is retained locally.
              Bound assistive-session text has a separate retention and deletion
              lifecycle.
            </p>
          </div>
          {error ? <Notice tone="error">{error}</Notice> : null}
          <button
            className="button button-large full-width"
            disabled={busy || !fixture || !consent}
          >
            {busy ? "Starting the real browser run…" : "Start the journey"}
            <ArrowRight size={18} />
          </button>
          <p className="form-footnote">
            A baseline runs first. Review the contract before generating a
            repair.
          </p>
        </form>
        <aside className="setup-aside">
          {fixture ? (
            <>
              <FixtureArt fixture={fixture} />
              <Badge>{familyLabel[fixture.family]}</Badge>
              <h2>{fixture.name}</h2>
              <p>{fixture.description}</p>
              <div className="barrier-note">
                <span className="eyebrow">SEEDED BARRIER</span>
                <p>{fixture.barrier}</p>
              </div>
              <dl className="simple-facts">
                <div>
                  <dt>Application</dt>
                  <dd>{fixture.organization}</dd>
                </div>
                <div>
                  <dt>Provenance</dt>
                  <dd>Authored fixture · fictional data</dd>
                </div>
                <div>
                  <dt>Source scope</dt>
                  <dd className="mono">{fixture.sourceFile}</dd>
                </div>
              </dl>
            </>
          ) : (
            <p>Loading the available applications…</p>
          )}
        </aside>
      </div>
    </div>
  );
}

export function RunLibrary({ evidence = false }: { evidence?: boolean }) {
  const { data, loading } = useStore();
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const runs =
    data?.runs.filter(
      (run) =>
        (filter === "all" ||
          (filter === "ready"
            ? run.status === "ready"
            : filter === "needs-review"
              ? ["contract_review", "candidate_rejected"].includes(run.status)
              : run.status === filter)) &&
        `${data.fixtures.find((f) => f.id === run.fixtureId)?.name} ${run.id}`
          .toLowerCase()
          .includes(query.toLowerCase()),
    ) ?? [];
  return (
    <div className="page">
      <PageHead
        eyebrow={evidence ? "A RECORD, NOT A PROMISE" : "THE REPAIR STUDIO"}
        title={evidence ? "Evidence you can return to." : "Follow the work."}
        action={
          <Link className="button" to="/journeys/new">
            <Plus size={17} />
            New journey
          </Link>
        }
      >
        <p>
          {evidence
            ? "Exact source revisions, recorded outcomes, and the limits of every check."
            : "Reopen an investigation, inspect a candidate, or keep moving from a blocked task."}
        </p>
      </PageHead>
      <div className="filter-bar">
        <div className="filter-buttons">
          {[
            ["all", "All runs"],
            ["needs-review", "Needs review"],
            ["ready", "Candidate passed"],
            ["cancelled", "Cancelled"],
          ].map(([value, label]) => (
            <button
              key={value}
              className={filter === value ? "selected" : ""}
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="search-field compact-search">
          <Search size={17} />
          <input
            aria-label="Search runs"
            placeholder="Find a repair…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      </div>
      <div className="run-list">
        {runs.map((run) => {
          const fixture = data?.fixtures.find((f) => f.id === run.fixtureId);
          const candidate = candidateFor(run);
          return (
            <Link
              className="run-card"
              key={run.id}
              to={evidence ? `/evidence/${run.id}` : `/repairs/${run.id}`}
            >
              <div className="run-icon">
                <Route size={24} />
              </div>
              <div className="run-main">
                <div className="run-meta">
                  {familyLabel[fixture?.family ?? "date-picker"]}
                  <span>·</span>
                  {time(run.createdAt)}
                </div>
                <h2>{fixture?.name ?? "Journey repair"}</h2>
                <p>{fixture?.task}</p>
                <div className="tag-row">
                  <span>{runOriginLabel(run)}</span>
                  <span>Contract v{run.contract.version}</span>
                  {run.isStale ? (
                    <span className="negative">Stale contract</span>
                  ) : null}
                  <span>Human validation pending</span>
                </div>
              </div>
              <div className="run-right">
                <RunStatusDisplay run={run} />
                <span className="mono small">
                  {short(candidate?.digest ?? run.id)}
                </span>
                <ArrowUpRight size={19} />
              </div>
            </Link>
          );
        })}
      </div>
      {!runs.length ? (
        <Empty
          title={
            loading
              ? "Loading saved evidence"
              : evidence
                ? "The evidence starts with a journey."
                : "Your first repair begins here."
          }
          action={
            <Link className="button" to="/journeys">
              Explore the sample library <ArrowRight size={17} />
            </Link>
          }
        >
          {query || filter !== "all"
            ? "No runs match these filters. Adjust the search to see your saved work."
            : "Choose a blocked sample. Passage will record its baseline before you decide how to repair it."}
        </Empty>
      ) : null}
    </div>
  );
}

export function Settings() {
  const { data, refresh, repository } = useStore();
  const [draft, setDraft] = useState<Partial<AppSettings>>({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const settings = data ? { ...data.settings, ...draft } : null;
  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    setError("");
    try {
      await put("/settings", draft);
      await refresh();
      setDraft({});
      setMessage(
        "Preferences saved. These settings apply to your next actions.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="page settings-page">
      <PageHead
        eyebrow="YOUR WORKING ENVIRONMENT"
        title="Clarity, by preference."
      >
        <p>
          Know where the work runs, what is captured, and how Passage feels.
        </p>
      </PageHead>
      <div className="settings-grid">
        <div>
          <section className="panel settings-panel">
            <div className="section-heading">
              <Radio size={21} />
              <h2>Model connection</h2>
              <Badge
                tone={
                  data?.provider.enabled && data.provider.configured
                    ? "success"
                    : "warning"
                }
              >
                {data?.provider.enabled && data.provider.configured
                  ? "Available"
                  : "Not enabled"}
              </Badge>
            </div>
            <p>
              Live generation uses {providerName(data?.provider.provider)} with
              the exact configured model below. Each actual call preserves its
              provider and model receipt.
            </p>
            <dl className="simple-facts">
              <div>
                <dt>Model</dt>
                <dd className="mono">{data?.provider.model ?? "Loading…"}</dd>
              </div>
              <div>
                <dt>Provider</dt>
                <dd>{providerName(data?.provider.provider)}</dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd>{data?.provider.reason ?? "Checking connection…"}</dd>
              </div>
              {data?.provider.runtimeQualified !== undefined ? (
                <div>
                  <dt>Completion validation</dt>
                  <dd>
                    {data.provider.runtimeQualified
                      ? "Matching model response verified"
                      : data.provider.catalogVerified
                        ? "Catalog verified · completion pending"
                        : "Route unverified"}
                  </dd>
                </div>
              ) : null}
            </dl>
            <ProviderUsage provider={data?.provider.provider} />
            <Notice
              tone={
                isDevelopmentRoute(data?.provider.provider) ? "warning" : "info"
              }
              title={providerPurpose(data?.provider.provider)}
            >
              {isDevelopmentRoute(data?.provider.provider)
                ? `This ${providerName(data?.provider.provider)} route is for paid development inference. It does not establish Nebius submission evidence. Nebius remains the final submission route.`
                : "Nebius is the final submission inference route. Live calls use the active provider's paid usage budget."}{" "}
              Provider selection is explicit on the server; Passage does not
              silently switch providers.
            </Notice>
            <Notice>
              Offline mode applies a handcrafted reference patch. It does not
              run a model and is labeled separately throughout the evidence.
            </Notice>
          </section>
          <section className="panel settings-panel">
            <div className="section-heading">
              <GitBranch size={21} />
              <h2>Repository & execution</h2>
            </div>
            <p>
              This edition builds and checks the scoped authored React fixtures
              locally. It does not execute arbitrary repositories, deploy cloud
              workers, or create pull requests.
            </p>
            <button className="button button-secondary" onClick={repository}>
              View supported scope <ArrowRight size={16} />
            </button>
          </section>
          <section className="panel settings-panel">
            <div className="section-heading">
              <LockKeyhole size={21} />
              <h2>Evidence & privacy</h2>
            </div>
            <p>
              Fictional data and structured browser observations are stored
              locally. Human observations require consent and are recorded as
              operator observations, without independent review.
            </p>
            <p className="small muted">
              Private assistive-session text expires after the retention period
              fixed at creation and can be deleted from the review screen. Saved
              run logs and simple operator notes are retained locally. Media
              recording is unavailable. Downloaded copies and operating-system
              backups cannot be recalled.
            </p>
          </section>
        </div>
        <form className="panel preference-panel" onSubmit={save}>
          <h2>Make the studio yours.</h2>
          <p className="muted">
            Comfort and clarity, without changing the evidence.
          </p>
          {settings ? (
            <>
              <label className="toggle-row">
                <span>
                  <strong>High contrast</strong>
                  <small>Stronger boundaries and explicit surfaces.</small>
                </span>
                <input
                  type="checkbox"
                  checked={settings.highContrast}
                  onChange={(e) =>
                    setDraft({ ...draft, highContrast: e.target.checked })
                  }
                />
              </label>
              <label className="toggle-row">
                <span>
                  <strong>Reduce motion</strong>
                  <small>Your system preference is always respected.</small>
                </span>
                <input
                  type="checkbox"
                  checked={settings.reduceMotion}
                  onChange={(e) =>
                    setDraft({ ...draft, reduceMotion: e.target.checked })
                  }
                />
              </label>
              <label className="field-label" htmlFor="default-mode">
                Default repair mode
              </label>
              <select
                id="default-mode"
                value={settings.defaultMode}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    defaultMode: e.target.value as AppSettings["defaultMode"],
                  })
                }
              >
                <option value="offline">
                  Offline · handcrafted reference patch
                </option>
                <option value="live">
                  Live · {providerName(data?.provider.provider)}
                </option>
              </select>
              <label className="field-label" htmlFor="retention">
                Private capture retention (days)
              </label>
              <input
                id="retention"
                type="number"
                min="1"
                max="365"
                value={settings.retentionDays}
                onChange={(e) =>
                  setDraft({ ...draft, retentionDays: Number(e.target.value) })
                }
              />
              <p className="small muted">
                Applies to new bound assistive sessions. Their private text is
                revoked and removed on expiry. Saved run evidence and simple
                operator notes are not automatically deleted.
              </p>
              {error ? <Notice tone="error">{error}</Notice> : null}
              {message ? (
                <p className="positive" role="status">
                  <Check size={16} /> {message}
                </p>
              ) : null}
              <button
                className="button full-width"
                disabled={saving || !Object.keys(draft).length}
              >
                {saving ? "Saving preferences…" : "Save preferences"}
                <ArrowRight size={17} />
              </button>
            </>
          ) : (
            <p>Loading preferences…</p>
          )}
        </form>
      </div>
    </div>
  );
}
