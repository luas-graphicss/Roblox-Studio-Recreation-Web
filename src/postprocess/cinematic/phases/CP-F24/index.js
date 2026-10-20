import { CONTRACT_VERSION } from "../../contracts/phaseManifest.js";
import { installVignette } from "./installVignette.js";
import { VIGNETTE_OWNER, VIGNETTE_VOLUME_RESOURCE } from "./vignetteContract.js";

export { createVignetteFusion } from "./vignetteFusion.js";
export { resolveVignetteSettings } from "./vignetteSettings.js";
export { evaluateVignetteFactor, applyVignetteToColor } from "./vignetteMath.js";
export * from "./vignetteContract.js";

export function createVignettePhase({ resolvedSettingsResource = null } = {}) {
  if (resolvedSettingsResource !== null && resolvedSettingsResource !== VIGNETTE_VOLUME_RESOURCE) throw new TypeError("CP-F24 supports the explicit CP-F02.resolvedSettings binding or null");
  return Object.freeze({ id: VIGNETTE_OWNER, contractVersion: CONTRACT_VERSION, status: "implemented", install: (services) => installVignette(services, resolvedSettingsResource) });
}

export default createVignettePhase();
