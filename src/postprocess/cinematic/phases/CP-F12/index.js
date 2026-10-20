import { CONTRACT_VERSION } from "../../contracts/phaseManifest.js";
import { installGradingPass } from "./installGradingPass.js";

export { compileGrading, applySceneGrade, gradeStoredColor } from "./gradingCore.js";
export { normalizeGradingSettings, DEFAULT_GRADING_SETTINGS, GRADING_SETTINGS_KEY, GRADING_LAYERS_KEY } from "./gradingSettings.js";
export { resolveGradingLayers } from "./gradingBlend.js";

export default Object.freeze({ id: "CP-F12", contractVersion: CONTRACT_VERSION, status: "implemented", install: installGradingPass });
