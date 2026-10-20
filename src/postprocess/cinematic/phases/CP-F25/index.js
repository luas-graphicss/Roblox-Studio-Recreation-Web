import { CONTRACT_VERSION } from "../../contracts/phaseManifest.js";
import { installFilmGrain } from "./installFilmGrain.js";

export { resolveGrainSettings, FILM_GRAIN_DEFAULTS } from "./grainSettings.js";
export { prepareGrainTexture } from "./grainTextureAsset.js";
export { FILM_GRAIN_SETTINGS, FILM_GRAIN_CAPTURE, FILM_GRAIN_COLOR, FILM_GRAIN_STATE } from "./grainContract.js";

export default Object.freeze({ id: "CP-F25", contractVersion: CONTRACT_VERSION, status: "implemented", install: installFilmGrain });
