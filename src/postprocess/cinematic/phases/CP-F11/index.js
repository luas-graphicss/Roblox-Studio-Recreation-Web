import { CONTRACT_VERSION } from "../../contracts/phaseManifest.js";
import { installFilmicTonemapper } from "./installFilmicTonemapper.js";

export function createFilmicTonemapperPhase({ replacement = null } = {}) {
  return Object.freeze({
    id: "CP-F11",
    contractVersion: CONTRACT_VERSION,
    status: "implemented",
    install: (services) => installFilmicTonemapper(services, replacement)
  });
}

export default createFilmicTonemapperPhase();
