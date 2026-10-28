export interface ActualATReceipt {
  schema: "passage.actual-at.v1"; buildId: string; sourceDigest: string; sessionId: string;
  startedAt: string; completedAt: string; provenance: "automated-actual-screen-reader";
  screenReader: string; guidepupVersion: string; browser: string; browserVersion?: string; platform: string; compatibility?: string;
  humanParticipant: false; independentlyReviewed: false; backendOutcomeVerified: false;
  protocol?: string; taskOutcome?: string;
  steps: { action: string; at: string; spoken: string; focus?: { tag: string; label: string | null; text: string }; actualTitle?: string }[];
  spokenPhraseLog: string[]; status: "captured" | "failed"; limitations: string[];
}
export interface ActualATCapture {
  id: string; createdAt: string; digest: string; receipt: ActualATReceipt;
  artifactUrl: string; evidenceClass: "actual-at-automation"; importAttested: true; executionAuthenticated: false;
  participantCount: 0; screenshotUrl?: string;
}
