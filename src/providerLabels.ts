import type { ModelReceipt, RepairRun } from "../shared/types";

export function providerName(provider?: string | null): string {
  if (provider === "nebius") return "Nebius";
  if (provider === "fireworks") return "Fireworks";
  if (provider === "together") return "Together";
  if (provider === "offline-fixture") return "Offline reference";
  return provider || "the configured provider";
}
export function isDevelopmentRoute(provider?: string | null): boolean {
  return provider === "fireworks" || provider === "together";
}
export function providerPurpose(provider?: string | null): string {
  if (provider === "nebius") return "Submission route";
  if (isDevelopmentRoute(provider)) return "Paid development route";
  return "Configured live route";
}
export function liveReceiptFor(run: RepairRun): ModelReceipt | undefined {
  const candidate =
    run.candidates.find((value) => value.id === run.activeCandidateId) ??
    run.candidates.at(-1);
  return candidate?.receipt.live ? candidate.receipt : undefined;
}
export function runOriginLabel(run: RepairRun): string {
  const candidate =
    run.candidates.find((value) => value.id === run.activeCandidateId) ??
    run.candidates.at(-1);
  const receipt = liveReceiptFor(run);
  if (receipt) return `Live · ${providerName(receipt.provider)}`;
  if (candidate) return "Handcrafted reference mode";
  return run.mode === "live"
    ? "Live mode · no candidate receipt"
    : "Handcrafted reference mode";
}
