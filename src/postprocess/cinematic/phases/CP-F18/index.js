import { CONTRACT_VERSION } from "../../contracts/phaseManifest.js";
import { COC_OWNER } from "./cocContract.js";
import { installPhysicalCoc } from "./installPhysicalCoc.js";

export { COC_RESOURCES, COC_ENCODINGS, COC_FLAGS, COC_SAMPLE_STATUS } from "./cocContract.js";
export { createCocOptics, sensorCocRadiusMm, projectCocRadius } from "./cocOptics.js";
export { createCocRenderPlan } from "./cocRenderPlan.js";
export { resolveCocSettings } from "./cocSettings.js";
export { classifyCocSample, tileInfluenceReaches } from "./cocClassification.js";
export { installPhysicalCoc } from "./installPhysicalCoc.js";

export default Object.freeze({ id: COC_OWNER, contractVersion: CONTRACT_VERSION, status: "implemented", install: installPhysicalCoc });
