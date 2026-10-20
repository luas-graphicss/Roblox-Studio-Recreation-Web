import { installDisplayOutput } from "./installDisplayOutput.js";

export { installDisplayOutput };
export { OUTPUT_SETTINGS_KEY, OUTPUT_COLOR, OUTPUT_LINEAR_COLOR, OUTPUT_STATE } from "./outputContract.js";
export { resolveOutputSettings } from "./outputSettings.js";
export { resolveOutputPlan } from "./outputCapabilities.js";
export { describeOutputCapture } from "./outputMetadata.js";
export { createOutputPresenter } from "./outputPresenter.js";
export default Object.freeze({ id: "CP-F28", contractVersion: "1.0.0", status: "implemented", install: installDisplayOutput });
