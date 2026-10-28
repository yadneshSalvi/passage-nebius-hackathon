import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { api } from "./api";
import type { LiveProvider, ProviderUsageData } from "../shared/types";
import { Notice } from "./ui";
import { providerName, providerPurpose } from "./providerLabels";

const amount = (value: number | null | undefined, digits = 4) =>
  value == null ? "Unknown" : `$${value.toFixed(digits)}`;
export function ProviderUsage({ provider }: { provider?: LiveProvider }) {
  const [usage, setUsage] = useState<ProviderUsageData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    if (!provider) return;
    setLoading(true);
    setError("");
    try {
      setUsage(await api<ProviderUsageData>("/provider/usage"));
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setLoading(false);
    }
  }, [provider]);
  useEffect(() => {
    setUsage(null);
    void load();
  }, [load]);
  const current = provider ? (usage?.providers?.[provider] ?? null) : null;
  return (
    <div className="provider-usage" aria-busy={loading}>
      <div className="section-heading">
        <h3>Active route usage & budget</h3>
        <button
          className="icon-button"
          aria-label="Refresh provider usage"
          disabled={loading || !provider}
          onClick={() => void load()}
        >
          <RefreshCw size={15} />
        </button>
      </div>
      {error ? (
        <Notice tone="error">Usage could not be refreshed. {error}</Notice>
      ) : null}
      {current ? (
        <>
          <dl className="simple-facts">
            <div>
              <dt>Ledger</dt>
              <dd>
                {providerName(provider)} · {providerPurpose(provider)}
              </dd>
            </div>
            <div>
              <dt>Local USD budget</dt>
              <dd>
                {current.budgetUsd == null
                  ? "No dollar cap · paid usage applies"
                  : amount(current.budgetUsd, 2)}
              </dd>
            </div>
            <div>
              <dt>Committed estimate</dt>
              <dd>
                {current.committedUsd == null
                  ? "Unknown · not free"
                  : amount(current.committedUsd)}
              </dd>
            </div>
            {current.committedUsd == null &&
            current.knownEstimatedUsd != null ? (
              <div>
                <dt>Known estimated cost</dt>
                <dd>{amount(current.knownEstimatedUsd)}</dd>
              </div>
            ) : null}
            <div>
              <dt>Recorded calls</dt>
              <dd>
                {current.calls ?? usage?.entries?.length ?? "Unavailable"}
              </dd>
            </div>
            {current.inputTokens !== undefined ||
            current.outputTokens !== undefined ? (
              <div>
                <dt>Input / output tokens</dt>
                <dd>
                  {current.inputTokens?.toLocaleString() ?? "Unknown"} /{" "}
                  {current.outputTokens?.toLocaleString() ?? "Unknown"}
                </dd>
              </div>
            ) : null}
            {current.unknownCostCalls ? (
              <div>
                <dt>Calls with unestimated cost</dt>
                <dd>{current.unknownCostCalls}</dd>
              </div>
            ) : null}
            {current.unknownUsageCalls ? (
              <div>
                <dt>Calls without token totals</dt>
                <dd>{current.unknownUsageCalls}</dd>
              </div>
            ) : null}
          </dl>
          <p className="small muted">
            Local estimates include reservations and uncertain calls. Unknown
            costs are never treated as free. Provider billing is authoritative;
            each provider has a separate ledger.
          </p>
          {usage?.providers ? (
            <details className="provider-ledgers">
              <summary>Inspect the other provider ledgers</summary>
              <div
                className="table-scroll"
                tabIndex={0}
                role="region"
                aria-label="Provider usage ledgers"
              >
                <table>
                  <thead>
                    <tr>
                      <th>Provider</th>
                      <th>Budget</th>
                      <th>Committed</th>
                      <th>Calls</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(usage.providers).map(([name, ledger]) => (
                      <tr key={name}>
                        <td>
                          {providerName(name)}
                          {name === provider ? " · active" : ""}
                          <small>{providerPurpose(name)}</small>
                        </td>
                        <td>
                          {ledger.budgetUsd == null
                            ? "No dollar cap"
                            : amount(ledger.budgetUsd, 2)}
                        </td>
                        <td>{amount(ledger.committedUsd)}</td>
                        <td>{ledger.calls ?? "Unknown"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="small muted">
                A blank or unknown price is not a free allowance. Nebius
                submission accounting stays separate from development routes.
              </p>
            </details>
          ) : null}
        </>
      ) : (
        <p className="small muted" role="status">
          {!provider
            ? "Loading the model connection…"
            : loading
              ? "Loading the active provider ledger…"
              : "Provider usage is unavailable. Refresh to try again."}
        </p>
      )}
    </div>
  );
}
