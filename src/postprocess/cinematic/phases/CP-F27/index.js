import { CONTRACT_VERSION } from "../../contracts/phaseManifest.js";
import { installLightingBridge } from "./installLightingBridge.js";

export { createBridgeAdapters } from "./bridgeAdapters.js";
export { createBridgeConfiguration, attachBridgeConfiguration, describeBridgeProfile } from "./bridgeProfile.js";
export { dispatchBridgeControls } from "./bridgeControlRouting.js";
export { bridgeStageResources, BRIDGE_CONFIGURATION, BRIDGE_ENABLED, BRIDGE_BOUNDARY, BRIDGE_COMPOSITION_POLICY } from "./bridgeContract.js";
export { compositeBridgeSample } from "./compositeSample.js";

export default Object.freeze({ id: "CP-F27", contractVersion: CONTRACT_VERSION, status: "implemented", install: installLightingBridge });
