import { CONTRACT_VERSION } from "../../contracts/phaseManifest.js";
import { installRobustness } from "./installRobustness.js";
export { createRobustPipeline } from "./createRobustPipeline.js";
export { createRobustResourcePool } from "./createRobustResourcePool.js";
export { createTransientArena } from "./createTransientArena.js";
export { createWarmupQueue } from "./createWarmupQueue.js";
export { createManagedRendererAdapter } from "./createManagedRendererAdapter.js";
export { updateMaterialUniforms, updateMaterialDefines } from "./shaderStructure.js";
export default Object.freeze({
  id: "CP-F32",
  contractVersion: CONTRACT_VERSION,
  status: "implemented",
  install: installRobustness
});
