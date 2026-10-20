import { CONTRACT_VERSION } from "../../contracts/phaseManifest.js";
import { installReferenceGate } from "./referenceGate.js";

export { createReferenceManifest } from "./referenceManifest.js";
export { validateReferenceManifest } from "./referenceValidator.js";
export { verifyReferenceBundle, readReferenceSession } from "./referenceSession.js";
export { REFERENCE_SESSION_SETTING, REFERENCE_CLAIM_SETTING, REFERENCE_STATE_RESOURCE } from "./referenceConstants.js";

export default Object.freeze({
  id: "CP-F01",
  contractVersion: CONTRACT_VERSION,
  status: "implemented",
  acceptanceStatus: "blocked",
  implementationScope: "Reference inventory, integrity verification and fail-closed prepare gate; not UE5.9 parity",
  install: installReferenceGate
});
