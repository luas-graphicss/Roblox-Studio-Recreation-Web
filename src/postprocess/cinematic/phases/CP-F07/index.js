import { CONTRACT_VERSION } from "../../contracts/phaseManifest.js";
import { TEMPORAL_PHASE_ID } from "./temporalContract.js";
import { installTemporalHistory } from "./installTemporalHistory.js";

export default Object.freeze({ id: TEMPORAL_PHASE_ID, contractVersion: CONTRACT_VERSION, status: "implemented", install: installTemporalHistory });
