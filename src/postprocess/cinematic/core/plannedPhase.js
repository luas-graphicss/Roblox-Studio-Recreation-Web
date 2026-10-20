import { CONTRACT_VERSION, getPhaseDefinition } from "../contracts/phaseManifest.js";

export function createPlannedPhase(phaseId) {
  getPhaseDefinition(phaseId);
  return Object.freeze({
    id: phaseId,
    contractVersion: CONTRACT_VERSION,
    status: "planned",
    install() {
      throw new Error(`${phaseId} has no implementation; planned modules cannot install passes`);
    }
  });
}
