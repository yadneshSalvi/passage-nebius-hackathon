import type {
  CompilerBootstrap,
  CompilerSchedule,
  CompilerSession,
  CompilerVariant,
  SourceObservation,
} from "../shared/compiler";
import { api, post } from "./api";

export const compilerApi = {
  bootstrap: () => api<CompilerBootstrap>("/compiler/bootstrap"),
  story: () => api<CompilerBootstrap["story"]>("/compiler/story"),
  session: (id: string, signal?: AbortSignal) =>
    api<CompilerSession>(`/compiler/sessions/${encodeURIComponent(id)}`, {
      signal,
    }),
  create: (fixtureId: string, task: string) =>
    post<CompilerSession>("/compiler/sessions", {
      fixtureId,
      task,
      captureConsent: true,
    }),
  capture: (
    id: string,
    variant: "original" | "reference",
    scheduleId: CompilerSchedule,
  ) =>
    post<CompilerSession>(
      `/compiler/sessions/${encodeURIComponent(id)}/capture`,
      { variant, scheduleId },
    ),
  draft: (id: string, mode: "observed" | "live") =>
    post<CompilerSession>(
      `/compiler/sessions/${encodeURIComponent(id)}/draft`,
      { mode },
    ),
  review: (
    id: string,
    expectedDigest: string,
    maintainer: string,
    interactionReviewer: string,
    reviewProvenance: "automated-development" | "operator-attested",
  ) =>
    post<CompilerSession>(
      `/compiler/sessions/${encodeURIComponent(id)}/review`,
      {
        expectedDigest,
        maintainer,
        interactionReviewer,
        reviewProvenance,
        acknowledgeInferred: true,
      },
    ),
  verify: (
    id: string,
    variant: CompilerVariant,
    scheduleId: CompilerSchedule,
  ) =>
    post<CompilerSession>(
      `/compiler/sessions/${encodeURIComponent(id)}/verify`,
      { variant, scheduleId },
    ),
  explore: (
    id: string,
    variant: CompilerVariant,
    scheduleId: CompilerSchedule,
  ) =>
    post<CompilerSession>(
      `/compiler/sessions/${encodeURIComponent(id)}/explore`,
      { variant, scheduleId, mode: "live" },
    ),
  repair: (id: string, additionalObservation?: SourceObservation) =>
    post<CompilerSession>(
      `/compiler/sessions/${encodeURIComponent(id)}/repair`,
      { mode: "live", ...(additionalObservation ? { additionalObservation } : {}) },
    ),
  preservation: (id: string, repairId: string) =>
    post<CompilerSession>(`/compiler/sessions/${encodeURIComponent(id)}/preservation`, { repairId }),
  reduce: (id: string, captureId: string) =>
    post<CompilerSession>(
      `/compiler/sessions/${encodeURIComponent(id)}/reduce`,
      { captureId },
    ),
  cancel: (id: string) =>
    post<CompilerSession>(
      `/compiler/sessions/${encodeURIComponent(id)}/cancel`,
    ),
  revision: (
    id: string,
    label: string,
    classification:
      | "harmless-refactor"
      | "declared-regression"
      | "external-revision",
    source: string,
  ) =>
    post<CompilerSession>(
      `/compiler/sessions/${encodeURIComponent(id)}/revisions`,
      { label, classification, source },
    ),
  export: (id: string) =>
    api<unknown>(`/compiler/sessions/${encodeURIComponent(id)}/export`),
  guardUrl: (id: string) =>
    `/v1/compiler/sessions/${encodeURIComponent(id)}/guard.zip`,
};
