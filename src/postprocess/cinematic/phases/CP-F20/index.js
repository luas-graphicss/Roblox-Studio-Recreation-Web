import { CONTRACT_VERSION } from "../../contracts/phaseManifest.js";
import { DOF_TEMPORAL_OWNER } from "./dofTemporalContract.js";
import { installDofTemporal } from "./installDofTemporal.js";
export { resolveDofTemporalSettings } from "./dofTemporalSettings.js";
export { resolveDofBindings } from "./dofInputBindings.js";
export { createDofCapturePlan } from "./dofCapturePlan.js";
export { DOF_TEMPORAL_RESOURCES, DOF_INPUT_ENCODINGS, DOF_REJECTION_REASONS } from "./dofTemporalContract.js";
export default Object.freeze({ id: DOF_TEMPORAL_OWNER, contractVersion: CONTRACT_VERSION, status: "implemented", install: installDofTemporal });
