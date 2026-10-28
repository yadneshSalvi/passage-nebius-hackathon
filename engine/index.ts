import { FixtureHost } from "./host.js";
import { verifyFixture, type VerificationRequest } from "./verifier.js";
export {
  fixtureDefinitions,
  scenarioDefinitions,
  effectiveScenario,
  createContract,
  getFixture,
  getOriginalSource,
  getReferenceSource,
  digest,
} from "./catalog.js";
export { validateCandidateSource } from "./safety.js";
export type { FixtureBuild } from "./host.js";
export class FixtureEngine extends FixtureHost {
  verify(request: VerificationRequest) {
    return verifyFixture(this, request);
  }
}
