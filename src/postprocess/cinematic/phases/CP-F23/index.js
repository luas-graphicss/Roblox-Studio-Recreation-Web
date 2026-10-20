import { CONTRACT_VERSION } from "../../contracts/phaseManifest.js";
import { CHROMATIC_OWNER, CHROMATIC_CAMERA_RESOURCE } from "./chromaticContract.js";
import { installChromaticAberration } from "./installChromaticAberration.js";

export * from "./chromaticContract.js";
export { resolveChromaticSettings } from "./chromaticSettings.js";
export {
  resolveChromaticGeometry,
  chromaticRadialWeight,
  chromaticSampleCoordinates,
} from "./chromaticGeometry.js";

export function createChromaticAberrationPhase(options = {}) {
  if (!options || Object.getPrototypeOf(options) !== Object.prototype)
    throw new TypeError("CP-F23 bindings must be a plain object");
  for (const key of Object.keys(options))
    if (!["sourceResource", "cameraResource"].includes(key))
      throw new TypeError(`Unknown CP-F23 binding: ${key}`);
  const { sourceResource = "$color", cameraResource = null } = options;
  if (
    typeof sourceResource !== "string" ||
    !sourceResource ||
    sourceResource.startsWith(`${CHROMATIC_OWNER}.`)
  )
    throw new TypeError("CP-F23 requires a non-self source binding");
  if (cameraResource !== null && cameraResource !== CHROMATIC_CAMERA_RESOURCE)
    throw new TypeError("CP-F23 camera binding must be CP-F03.camera or null");
  const bindings = Object.freeze({ sourceResource, cameraResource });
  return Object.freeze({
    id: CHROMATIC_OWNER,
    contractVersion: CONTRACT_VERSION,
    status: "implemented",
    install: (services) => installChromaticAberration(services, bindings),
  });
}

export default createChromaticAberrationPhase();
