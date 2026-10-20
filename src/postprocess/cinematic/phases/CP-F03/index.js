import { CONTRACT_VERSION } from "../../contracts/phaseManifest.js";
import { CAMERA_PHASE_ID } from "./cameraIdentifiers.js";
import { installPhysicalCamera } from "./installPhysicalCamera.js";

export default Object.freeze({ id: CAMERA_PHASE_ID, contractVersion: CONTRACT_VERSION, status: "implemented", install: installPhysicalCamera });
