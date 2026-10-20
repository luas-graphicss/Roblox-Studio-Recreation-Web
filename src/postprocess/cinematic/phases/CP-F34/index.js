import { ADAPTER_OWNER, ADAPTER_VERSION } from "./adapterContract.js";
import { installFutureAdapter } from "./installFutureAdapter.js";

export { createCinematicPostProcess } from "./createCinematicPostProcess.js";
export { createFuturePostFxAdapter } from "./createFuturePostFxAdapter.js";
export { createPipelineRuntime } from "./createPipelineRuntime.js";
export { createManagedPipelineRuntime } from "./createManagedPipelineRuntime.js";
export { resolveAdapterRoute } from "./promotionPolicy.js";
export { DEFAULT_OWNERSHIP, ADAPTER_VERSION } from "./adapterContract.js";

export default Object.freeze({ id: ADAPTER_OWNER, contractVersion: ADAPTER_VERSION, status: "implemented", install: installFutureAdapter });
