import { CONTRACT_VERSION } from "../../contracts/phaseManifest.js";
import { installCertificationGate } from "./certificationRuntime.js";

export { createCertificationSession, readCertificationSession } from "./certificationSession.js";
export { compareExactCaptures } from "./compareExactCaptures.js";
export { createCertificationRequirements } from "./certificationRequirements.js";
export { CERTIFICATION_SESSION_SETTING, CERTIFICATION_CLAIM_SETTING, CERTIFICATION_BINDING_SETTING, CERTIFICATION_STATE_RESOURCE } from "./certificationContract.js";

export default Object.freeze({ id: "CP-F36", contractVersion: CONTRACT_VERSION, status: "implemented", acceptanceStatus: "blocked", implementationScope: "Two-stage fail-closed certification machinery; not verified UE5.9 parity", install: installCertificationGate });
