import { CONTRACT_VERSION } from "../../contracts/phaseManifest.js";
import { QA_OWNER } from "./qaContract.js";
import { installIntegrationAudit } from "./installIntegrationAudit.js";

export {
  QA_OWNER,
  QA_RESOURCE,
  QA_SETTINGS_KEY,
  QA_SCHEMA_VERSION,
} from "./qaContract.js";
export { createExecutionRecorder } from "./executionRecorder.js";
export { evaluateIntegrationMatrix } from "./integrationMatrix.js";
export { measurePixelBuffer, comparePixelBuffers } from "./pixelMetrics.js";
export { buildPerformanceReport } from "./performanceReport.js";

export default Object.freeze({
  id: QA_OWNER,
  contractVersion: CONTRACT_VERSION,
  status: "implemented",
  install: installIntegrationAudit,
});
