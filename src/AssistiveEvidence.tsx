import { useCallback, useEffect, useState } from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  Check,
  ChevronDown,
  Clock3,
  ExternalLink,
  Fingerprint,
  LockKeyhole,
  Plus,
  Trash2,
  UserRound,
} from "lucide-react";
import type { Candidate, RepairRun } from "../shared/types";
import { api, download, post } from "./api";
import { Badge, Notice, short, time } from "./ui";

type SessionMetadata = {
  participant: string;
  operator: string;
  os: string;
  browser: string;
  assistiveTechnology: string;
  inputMode: "keyboard";
  locale: "en" | "de";
  consent: true;
  consentScope: "private-study";
  clockOffsetMs?: number;
};
interface AssistiveSession {
  id: string;
  runId: string;
  candidateDigest: string;
  buildId: string;
  contractDigest: string;
  createdAt: string;
  expiresAt: string;
  importedAt: string | null;
  revokedAt: string | null;
  status:
    | "pending"
    | "imported"
    | "revoked"
    | "deletion_pending"
    | "deleted"
    | "expired";
  independentlyReviewed: false;
  backendOutcomeVerified: false;
  evidenceType: "operator-attested-assistive-session";
  metadata: SessionMetadata | null;
  result: {
    completion: "completed" | "blocked" | "stopped";
    elapsedMs: number;
    interventions: number;
    operatorAttestation: true;
  } | null;
  artifacts: {
    name: string;
    digest: string;
    mediaType: "text/plain";
    evidenceType: "operator-notes" | "speech-viewer-transcript";
    url: string;
    bytes: number;
  }[];
  limitations: string[];
}
export function AssistiveEvidence({
  run,
  candidate,
}: {
  run: RepairRun;
  candidate: Candidate;
}) {
  const [sessions, setSessions] = useState<AssistiveSession[]>([]);
  const [session, setSession] = useState<AssistiveSession | null>(null);
  const [token, setToken] = useState("");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [deleteId, setDeleteId] = useState("");
  const [form, setForm] = useState({
    participant: "",
    operator: "",
    os: "",
    browser: "",
    assistiveTechnology: "",
    locale: "en",
    consent: false,
  });
  const [artifactType, setArtifactType] = useState<
    "operator-notes" | "speech-viewer-transcript"
  >("operator-notes");
  const [content, setContent] = useState("");
  const [completion, setCompletion] = useState("completed");
  const [elapsedSeconds, setElapsedSeconds] = useState("");
  const [interventions, setInterventions] = useState("0");
  const [attested, setAttested] = useState(false);
  const canCreate =
    candidate.status === "accepted" &&
    candidate.id === run.activeCandidateId &&
    !run.isStale;
  const load = useCallback(async () => {
    try {
      const result = await api<{ sessions: AssistiveSession[] }>(
        `/assistive-sessions?runId=${encodeURIComponent(run.id)}`,
      );
      setSessions(result.sessions);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [run.id]);
  useEffect(() => {
    void load();
  }, [load]);
  async function create(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const result = await post<{
        session: AssistiveSession;
        importToken: string;
      }>("/assistive-sessions", {
        ...form,
        locale: form.locale,
        runId: run.id,
        candidateDigest: candidate.digest,
        buildId: candidate.buildId,
        contractDigest: run.contract.digest,
        inputMode: "keyboard",
        consentScope: "private-study",
      });
      setSession(result.session);
      setToken(result.importToken);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function importEvidence(event: React.FormEvent) {
    event.preventDefault();
    if (!session || !token) return;
    setBusy(true);
    setError("");
    try {
      const bytes = new TextEncoder().encode(content);
      const hash = await crypto.subtle.digest("SHA-256", bytes);
      const sha256 = [...new Uint8Array(hash)]
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
      await post(`/assistive-sessions/${session.id}/import`, {
        importToken: token,
        candidateDigest: session.candidateDigest,
        buildId: session.buildId,
        contractDigest: session.contractDigest,
        completion,
        elapsedMs: Math.round(Number(elapsedSeconds) * 1000),
        interventions: Number(interventions),
        operatorAttestation: true,
        artifacts: [
          {
            name:
              artifactType === "operator-notes"
                ? "operator-notes.txt"
                : "speech-viewer-transcript.txt",
            evidenceType: artifactType,
            content,
            sha256,
          },
        ],
      });
      setToken("");
      setSession(null);
      setOpen(false);
      setContent("");
      setAttested(false);
      setSuccess(
        "Private evidence imported and bound to this candidate, build, and contract. Independent review remains pending.",
      );
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function remove(id: string) {
    setBusy(true);
    setError("");
    try {
      const deleted = await api<AssistiveSession>(`/captures/${id}`, {
        method: "DELETE",
      });
      if (id === session?.id) {
        setSession(null);
        setToken("");
      }
      setDeleteId("");
      setSuccess(
        deleted.status === "deletion_pending"
          ? "Capture access revoked. Controlled local file deletion is still pending; the application will retry."
          : "Private capture revoked and controlled local copies removed. A content-free tombstone remains.",
      );
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function fileChange(file?: File) {
    if (!file) return;
    if (file.size > 80000) {
      setError("Choose a UTF-8 text file with at most 20,000 characters.");
      return;
    }
    try {
      const text = await file.text();
      if (text.length > 20000)
        throw new Error(
          "Text evidence must contain at most 20,000 characters.",
        );
      setContent(text);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <section className="panel assistive-evidence">
      <div className="section-heading">
        <UserRound size={22} />
        <h2>The person behind the task.</h2>
      </div>
      <p>
        Open the exact repaired build with the participant's actual assistive
        technology. Import consenting operator notes or an actual speech-viewer
        transcript into a private, revision-bound session.
      </p>
      <Notice title="Human validation is still pending">
        Imported evidence is operator-attested. It does not establish
        independent review, a verified human backend outcome, or a completed
        human study. No recording is generated.
      </Notice>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {success ? (
        <p className="capture-success positive" role="status">
          <Check size={17} />
          {success}
        </p>
      ) : null}
      <div className="capture-actions">
        <button
          className="button button-secondary"
          disabled={!canCreate || busy}
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <Plus size={15} />
          {open ? "Hide session setup" : "Create an assistive session"}
        </button>
        <a
          className="text-link"
          href={candidate.previewUrl}
          target="_blank"
          rel="noreferrer"
        >
          Open candidate <ExternalLink size={14} />
        </a>
      </div>
      {!canCreate ? (
        <p className="small muted">
          A current, accepted candidate is required to create a bound session.
        </p>
      ) : null}
      {open && !session ? (
        <form className="capture-form" onSubmit={create}>
          <div className="capture-step">
            <span>01</span>
            <div>
              <h3>Bind the actual environment</h3>
              <p>
                Use a pseudonym and exact device, browser, and
                assistive-technology versions.
              </p>
            </div>
          </div>
          <div className="field-grid">
            {[
              ["participant", "Participant pseudonym"],
              ["operator", "Operator"],
              ["os", "Operating system & version"],
              ["browser", "Browser & version"],
              ["assistiveTechnology", "Assistive technology & version"],
            ].map(([key, label]) => (
              <label key={key}>
                {label}
                <input
                  required
                  maxLength={200}
                  value={form[key as "participant"]}
                  onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                />
              </label>
            ))}
            <label>
              Session language
              <select
                value={form.locale}
                onChange={(e) => setForm({ ...form, locale: e.target.value })}
              >
                <option value="en">English</option>
                <option value="de">German</option>
              </select>
            </label>
          </div>
          <div className="capture-binding">
            <Fingerprint size={17} />
            <span>
              Candidate <code>{short(candidate.digest)}</code> · Build{" "}
              <code>{short(candidate.buildId)}</code>
              <br />
              Contract <code>{short(run.contract.digest)}</code>
            </span>
          </div>
          <label className="checkbox-label">
            <input
              type="checkbox"
              required
              checked={form.consent}
              onChange={(e) => setForm({ ...form, consent: e.target.checked })}
            />
            <span>
              The participant consents to this private study capture. I will
              remove identifying or sensitive information before importing text.
            </span>
          </label>
          <p className="small muted">
            The retention period is fixed when the session is created.
            Controlled capture copies can be deleted below. Downloads and
            operating-system backups are outside the application's control.
          </p>
          <button className="button" disabled={busy || !form.consent}>
            {busy ? "Binding session…" : "Create bound session"}
            <ArrowRight size={16} />
          </button>
        </form>
      ) : null}
      {open && session ? (
        <form className="capture-form" onSubmit={importEvidence}>
          <div className="capture-step">
            <span>02</span>
            <div>
              <h3>Import what actually happened</h3>
              <p>
                Session {short(session.id)} · Expires {time(session.expiresAt)}
              </p>
            </div>
          </div>
          <Notice>
            The one-time import token stays in this browser view. Finish the
            import before leaving or refreshing. If the token is lost, delete
            the pending session and create another.
          </Notice>
          <div className="capture-binding">
            <Fingerprint size={17} />
            <span>
              Candidate <code>{short(session.candidateDigest)}</code> · Build{" "}
              <code>{short(session.buildId)}</code>
              <br />
              Contract <code>{short(session.contractDigest)}</code>
            </span>
          </div>
          <label>
            Evidence type
            <select
              value={artifactType}
              onChange={(e) =>
                setArtifactType(e.target.value as typeof artifactType)
              }
            >
              <option value="operator-notes">Actual operator notes</option>
              <option value="speech-viewer-transcript">
                Actual speech-viewer transcript
              </option>
            </select>
          </label>
          <p className="small muted">
            {artifactType === "operator-notes"
              ? "Describe observed actions, focus, friction, and interventions. Distinguish interpretation from direct observation."
              : "Import only text captured from the participant’s real assistive technology. Do not use generated or predicted speech."}
          </p>
          <label>
            UTF-8 text file (optional)
            <input
              type="file"
              accept="text/plain,.txt"
              onChange={(e) => void fileChange(e.target.files?.[0])}
            />
          </label>
          <label>
            Actual evidence text
            <textarea
              required
              rows={7}
              maxLength={20000}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder={
                artifactType === "operator-notes"
                  ? "Enter the consenting operator’s actual observations…"
                  : "Paste the actual speech-viewer output…"
              }
            />
          </label>
          <p className="character-count">
            {content.length.toLocaleString()} / 20,000 characters · SHA-256
            computed on import
          </p>
          <div className="field-grid">
            <label>
              Task outcome
              <select
                value={completion}
                onChange={(e) => setCompletion(e.target.value)}
              >
                <option value="completed">Completed</option>
                <option value="blocked">Blocked</option>
                <option value="stopped">Stopped by participant</option>
              </select>
            </label>
            <label>
              Elapsed time (seconds)
              <input
                type="number"
                min="0"
                max="86400"
                step="0.001"
                required
                value={elapsedSeconds}
                onChange={(e) => setElapsedSeconds(e.target.value)}
              />
            </label>
            <label>
              Operator interventions
              <input
                type="number"
                min="0"
                max="1000"
                step="1"
                required
                value={interventions}
                onChange={(e) => setInterventions(e.target.value)}
              />
            </label>
          </div>
          <label className="checkbox-label">
            <input
              type="checkbox"
              required
              checked={attested}
              onChange={(e) => setAttested(e.target.checked)}
            />
            <span>
              I attest that this text comes from the actual participant session
              on the bound candidate, build, and contract, with the stated
              consent.
            </span>
          </label>
          <button
            className="button"
            disabled={busy || !attested || !content.trim()}
          >
            {busy ? "Hashing and importing…" : "Import private evidence"}
            <ArrowRight size={16} />
          </button>
        </form>
      ) : null}
      {sessions.length ? (
        <div className="capture-session-list">
          <div className="section-heading">
            <h3>Private assistive sessions</h3>
            <span className="mono small">{sessions.length}</span>
          </div>
          {sessions.map((item) => (
            <article className="capture-session" key={item.id}>
              <div className="capture-session-heading">
                <Badge
                  tone={item.status === "imported" ? "success" : "neutral"}
                >
                  {item.status}
                </Badge>
                <code>{short(item.id)}</code>
                {!["deleted", "expired"].includes(item.status) ? (
                  <button
                    className="icon-button"
                    aria-label={`Delete capture ${short(item.id)}`}
                    onClick={() => setDeleteId(item.id)}
                    disabled={busy}
                  >
                    <Trash2 size={16} />
                  </button>
                ) : null}
              </div>
              {item.metadata ? (
                <>
                  <h3>{item.metadata.assistiveTechnology}</h3>
                  <p>
                    {item.metadata.browser} · {item.metadata.os}
                  </p>
                  <p className="small muted">
                    {item.result
                      ? `${item.result.completion} · ${(item.result.elapsedMs / 1000).toFixed(1)} seconds · ${item.result.interventions} interventions`
                      : "Awaiting operator-attested evidence."}
                  </p>
                </>
              ) : (
                <p className="small muted">
                  Content-free tombstone. Metadata and captured text are
                  unavailable.
                </p>
              )}
              <div className="capture-bound-meta">
                <Fingerprint size={12} />
                {short(item.candidateDigest)}
                <span>·</span>
                <Clock3 size={12} />
                {["deleted", "expired"].includes(item.status)
                  ? `Revoked ${time(item.revokedAt ?? item.createdAt)}`
                  : `Expires ${time(item.expiresAt)}`}
              </div>
              {item.artifacts.map((artifact) => (
                <a
                  key={artifact.digest}
                  className="capture-artifact"
                  href={artifact.url}
                  download={artifact.name}
                >
                  <ArrowDownToLine size={14} />
                  <span>
                    {artifact.name}
                    <small>
                      {artifact.evidenceType} · {artifact.bytes} bytes ·{" "}
                      {short(artifact.digest)}
                    </small>
                  </span>
                  <LockKeyhole size={13} />
                </a>
              ))}
              {item.status === "imported" ? (
                <p className="capture-limit">
                  Operator-attested · Independent review pending · Human backend
                  outcome not verified
                </p>
              ) : null}
              {deleteId === item.id ? (
                <div className="capture-delete-confirm">
                  <p>
                    Revoke this capture and remove its controlled local copies?
                    Downloads and external backups cannot be recalled.
                  </p>
                  <div>
                    <button
                      type="button"
                      className="button button-danger button-small"
                      disabled={busy}
                      onClick={() => void remove(item.id)}
                    >
                      {busy ? "Deleting…" : "Delete private capture"}
                    </button>
                    <button
                      type="button"
                      className="button button-secondary button-small"
                      onClick={() => setDeleteId("")}
                    >
                      Keep capture
                    </button>
                  </div>
                </div>
              ) : null}
            </article>
          ))}
        </div>
      ) : (
        <div className="capture-empty">
          <LockKeyhole size={15} />
          <span>
            No assistive-technology sessions have been imported for this run.
          </span>
        </div>
      )}
    </section>
  );
}
