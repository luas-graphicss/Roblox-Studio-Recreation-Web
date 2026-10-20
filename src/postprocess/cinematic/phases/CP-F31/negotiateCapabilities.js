import { freeze, integer, record } from "./qualityContract.js";

export function negotiateCapabilities(capabilities, hostFeatures = {}, phaseIds = []) {
  record(capabilities, "capabilities");
  record(hostFeatures, "hostFeatures");
  for (const [name, value] of Object.entries(hostFeatures)) {
    if (!["motionVectors", "linearDepth", "spatialUpscale"].includes(name) || typeof value !== "boolean")
      throw new TypeError(`Unknown or invalid host feature: ${name}`);
  }
  const blockers = [];
  if (capabilities.webgl2 !== true) blockers.push("WebGL2 was not explicitly verified");
  if (capabilities.floatColorBuffer !== true) blockers.push("FP16 rendering was not verified; no implicit RGBA8 fallback");
  const maximum = capabilities.maxTextureSize;
  integer(maximum, "maxTextureSize", 1, 65536);
  if (!Array.isArray(phaseIds) || phaseIds.some((id) => typeof id !== "string")) throw new TypeError("phaseIds must be strings");
  const motion = hostFeatures.motionVectors === true && hostFeatures.linearDepth === true;
  const temporal = phaseIds.includes("CP-F21") && motion;
  return freeze({ supported: blockers.length === 0, blockers, maxTextureSize: maximum,
    floatColorBuffer: capabilities.floatColorBuffer === true, webgl2: capabilities.webgl2 === true,
    timerQuery: capabilities.timerQuery === true, hdrDisplayVerified: capabilities.hdrDisplayVerified === true,
    temporal, temporalDof: phaseIds.includes("CP-F20") && motion,
    motionBlur: phaseIds.includes("CP-F22") && motion,
    upscaling: temporal ? "CP-F21" : hostFeatures.spatialUpscale === true ? "explicit-host-spatial" : null,
    missingInputs: [!hostFeatures.motionVectors && "motionVectors", !hostFeatures.linearDepth && "linearDepth"].filter(Boolean),
    installedPhases: [...new Set(phaseIds)].sort() });
}
