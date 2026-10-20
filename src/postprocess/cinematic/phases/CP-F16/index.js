import { CONTRACT_VERSION } from "../../contracts/phaseManifest.js";
import { installLensFlare } from "./installLensFlare.js";

export { resolveLensFlareSettings, DEFAULT_LENS_FLARE_SETTINGS } from "./lensFlareSettings.js";
export { resolveBokehShape, resolveBokehLayers } from "./bokehShape.js";
export { LENS_FLARE_RESOURCES, LENS_FLARE_PROFILE } from "./lensFlareContract.js";
export default Object.freeze({ id: "CP-F16", contractVersion: CONTRACT_VERSION, status: "implemented", install: installLensFlare });
