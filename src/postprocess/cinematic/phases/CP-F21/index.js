import { CONTRACT_VERSION } from "../../contracts/phaseManifest.js";
import { installTemporalReconstruction } from "./installTemporalReconstruction.js";

export { resolveTemporalSettings, getTemporalRenderSize } from "./temporalSettings.js";
export { createTemporalRasterState, withTemporalCameraProjection } from "./temporalRasterState.js";
export { TEMPORAL_RECONSTRUCTION_RESOURCES } from "./temporalBindings.js";

export default Object.freeze({
  id: "CP-F21",
  contractVersion: CONTRACT_VERSION,
  status: "implemented",
  install: installTemporalReconstruction
});
