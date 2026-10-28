import {
  ArrowRight,
  Check,
  Circle,
  CircleAlert,
  LoaderCircle,
  X,
} from "lucide-react";
import { Link } from "react-router-dom";
import type { ReactNode } from "react";
import type {
  CheckStatus,
  FixtureDefinition,
  RepairRun,
  RunStatus,
  VerificationResult,
} from "../shared/types";

export const busyStatuses: RunStatus[] = [
  "queued",
  "preparing",
  "reproducing",
  "generating",
  "verifying",
];
export const statusLabel: Record<RunStatus, string> = {
  queued: "Waiting for the local worker",
  preparing: "Preparing application",
  reproducing: "Reproducing barrier",
  contract_review: "Ready for contract review",
  generating: "Generating repair",
  verifying: "Checking the repair",
  ready: "Automated checks passed",
  candidate_rejected: "Candidate needs work",
  environment_error: "Environment interrupted",
  cancelled: "Run cancelled",
};
export const familyLabel: Record<string, string> = {
  "date-picker": "Date selection",
  combobox: "Combobox choice",
  "modal-wizard": "Multi-step dialog",
  "async-validation": "Async validation",
};
export const time = (value: string) =>
  new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
export const short = (value?: string | null) =>
  value ? value.slice(0, 10) : "Not available";
export const candidateFor = (run: RepairRun) =>
  run.candidates.find((c) => c.id === run.activeCandidateId) ??
  run.candidates.at(-1);
export function Mark({ className = "" }: { className?: string }) {
  return (
    <svg
      className={`brand-mark ${className}`}
      width="30"
      height="34"
      viewBox="0 0 30 34"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M4 30V12a8 8 0 0 1 16 0v9a5 5 0 0 0 10 0M12 34V12a1 1 0 0 1 2 0v10a11 11 0 0 0 16 10"
        stroke="currentColor"
        strokeWidth="3.5"
      />
    </svg>
  );
}
export function ArrowLink({
  to,
  children,
  className = "",
}: {
  to: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Link to={to} className={`text-link ${className}`}>
      {children}
      <ArrowRight size={17} />
    </Link>
  );
}
export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "success" | "warning" | "error";
}) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}
export function Status({ status }: { status: CheckStatus | RunStatus }) {
  const pass = status === "passed" || status === "ready";
  const fail =
    status === "failed" ||
    status === "candidate_rejected" ||
    status === "environment_error";
  const busy = busyStatuses.includes(status as RunStatus);
  return (
    <span className={`status ${pass ? "positive" : fail ? "negative" : ""}`}>
      {pass ? (
        <Check size={15} />
      ) : fail ? (
        <CircleAlert size={15} />
      ) : busy ? (
        <LoaderCircle className="spin" size={15} />
      ) : (
        <Circle size={12} />
      )}
      {status in statusLabel
        ? statusLabel[status as RunStatus]
        : status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

export function RunStatusDisplay({ run }: { run: RepairRun }) {
  if (run.status === "ready" && run.challenges.some((item) => !item.passed))
    return (
      <span className="status caution-status">
        <CircleAlert size={15} />
        Candidate passed · challenge did not pass
      </span>
    );
  return <Status status={run.status} />;
}

export function Notice({
  children,
  tone = "info",
  title,
}: {
  children: ReactNode;
  tone?: "info" | "error" | "warning";
  title?: string;
}) {
  return (
    <div
      className={`notice notice-${tone}`}
      role={tone === "error" ? "alert" : undefined}
    >
      <CircleAlert size={18} />
      <div>
        {title ? <strong>{title}</strong> : null}
        <div>{children}</div>
      </div>
    </div>
  );
}
export function Empty({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-path">
        <Mark />
      </div>
      <h2>{title}</h2>
      <p>{children}</p>
      {action}
    </div>
  );
}
export function PageHead({
  eyebrow,
  title,
  children,
  action,
  headingLevel = 1,
}: {
  eyebrow?: string;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  headingLevel?: 1 | 2;
}) {
  return (
    <div className="page-head">
      <div>
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <>
          {headingLevel === 2 ? (
            <h2 className="page-title">{title}</h2>
          ) : (
            <h1 className="page-title">{title}</h1>
          )}
        </>
        {children ? <div className="page-description">{children}</div> : null}
      </div>
      {action ? <div className="page-head-action">{action}</div> : null}
    </div>
  );
}
export function CheckList({
  result,
}: {
  result: VerificationResult | null | undefined;
}) {
  if (!result)
    return (
      <p className="muted small">
        Checks will appear after the browser run finishes.
      </p>
    );
  return (
    <div className="check-list">
      {result.checks.map((check) => (
        <details key={check.id} className="check-row">
          <summary>
            <span
              className={`check-icon ${check.status === "passed" ? "positive" : "negative"}`}
            >
              {check.status === "passed" ? (
                <Check size={16} />
              ) : (
                <X size={16} />
              )}
            </span>
            <span>
              {check.label}
              <small>
                {check.evidenceType === "backend"
                  ? "Backend invariant"
                  : "Browser observation"}
              </small>
            </span>
            <span className="check-outcome">{check.status}</span>
          </summary>
          <div className="check-detail">
            <p>
              <strong>Expected:</strong> {check.expected}
            </p>
            <p>
              <strong>Observed:</strong> {check.actual}
            </p>
            <span className="mono small">{check.durationMs}ms</span>
          </div>
        </details>
      ))}
    </div>
  );
}
export function FixtureArt({
  fixture,
  compact = false,
}: {
  fixture: FixtureDefinition;
  compact?: boolean;
}) {
  return (
    <div
      className={`fixture-art ${compact ? "compact" : ""}`}
      style={
        { "--fixture-color": fixture.color || "#DCE7D4" } as React.CSSProperties
      }
      aria-hidden="true"
    >
      <div className="mini-browser">
        <div className="mini-top">
          <span />
          <span />
          <span />
          <div />
        </div>
        <div className="mini-body">
          <div className="mini-nav" />
          <div className="mini-title" />
          {fixture.family === "date-picker" ? (
            <div className="mini-calendar">
              <div className="mini-calendar-top" />
              <div className="mini-days">
                {Array.from({ length: 21 }, (_, i) => (
                  <i
                    key={i}
                    className={
                      i === 10 ? "selected" : i === 11 ? "blocked" : ""
                    }
                  />
                ))}
              </div>
            </div>
          ) : fixture.family === "combobox" ? (
            <div className="mini-options">
              <i />
              <b />
              <i />
              <i />
            </div>
          ) : fixture.family === "modal-wizard" ? (
            <div className="mini-dialog">
              <div />
              <i />
              <i />
              <b />
            </div>
          ) : (
            <div className="mini-form">
              <i />
              <i />
              <div />
              <b />
            </div>
          )}
          <div className="mini-bottom" />
        </div>
      </div>
      <div className="fixture-key">
        {fixture.family === "date-picker"
          ? "↵"
          : fixture.family === "combobox"
            ? "↓"
            : fixture.family === "modal-wizard"
              ? "esc"
              : "tab"}
      </div>
    </div>
  );
}
