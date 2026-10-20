import { CONTRACT_VERSION } from "../../contracts/phaseManifest.js";
import { installDiaphragmDof } from "./installDiaphragmDof.js";
export { DIAPHRAGM_RESOURCES, DIAPHRAGM_PROFILE, COC_ENCODING, SURFACE_ENCODING } from "./diaphragmContract.js";
export { resolveDiaphragmSettings, resolveDiaphragmBindings } from "./diaphragmSettings.js";
export { createDiaphragmKernel } from "./diaphragmAperture.js";
export { createDiaphragmPlan } from "./diaphragmBudget.js";
export default Object.freeze({ id: "CP-F19", contractVersion: CONTRACT_VERSION, status: "implemented", install: installDiaphragmDof });
