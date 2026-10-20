import { CONTRACT_VERSION } from "../../contracts/phaseManifest.js";
import { normalizeLocalExposureBindings } from "./localExposureInputs.js";
import { installLocalExposure } from "./installLocalExposure.js";

export function createLocalExposurePhase(options = {}) {
  const bindings = normalizeLocalExposureBindings(options);
  return Object.freeze({
    id: "CP-F10",
    contractVersion: CONTRACT_VERSION,
    status: "implemented",
    install: (services) => installLocalExposure(services, bindings)
  });
}

export default createLocalExposurePhase();
