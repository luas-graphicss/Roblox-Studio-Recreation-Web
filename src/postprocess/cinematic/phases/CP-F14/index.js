import { CONTRACT_VERSION } from "../../contracts/phaseManifest.js";
import { BLOOM_OWNER } from "./bloomSettings.js";
import { installStandardBloom } from "./installStandardBloom.js";

export default Object.freeze({
  id: BLOOM_OWNER,
  contractVersion: CONTRACT_VERSION,
  status: "implemented",
  install: installStandardBloom
});
