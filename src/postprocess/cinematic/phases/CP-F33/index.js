import { CONTRACT_VERSION } from "../../contracts/phaseManifest.js";
import { installAuthoring } from "./installAuthoring.js";
export { AUTHORING_API_VERSION, AUTHORING_DOCUMENT_VERSION, AUTHORING_SESSION_KEY, AUTHORING_RESOURCE } from "./authoringContract.js";
export { AuthoringValidationError } from "./authoringData.js";
export { createPostProcessDocument } from "./authoringDocument.js";
export { importPostProcessDocument, exportPostProcessDocument } from "./authoringMigrations.js";
export { createPostProcessAuthoringSession } from "./authoringSession.js";
export { createAuthoringPersistence } from "./authoringPersistence.js";
export { attachAuthoringSession } from "./attachAuthoringSession.js";
export { createLightingAuthoringBridge } from "./lightingAuthoringBridge.js";
export { createLegacyEffectAdapter } from "./legacyEffectAdapter.js";
export { sampleAuthoringCurve } from "./authoringAssets.js";
export { installAuthoring };
export function createAuthoringPhase(options = {}) {
  return Object.freeze({ id: "CP-F33", contractVersion: CONTRACT_VERSION, status: "implemented", install: services => installAuthoring(services, options) });
}
export default createAuthoringPhase();
