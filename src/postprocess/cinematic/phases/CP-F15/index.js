import { CONTRACT_VERSION } from "../../contracts/phaseManifest.js";
import { installConvolutionBloom } from "./installConvolutionBloom.js";

export default Object.freeze({ id: "CP-F15", contractVersion: CONTRACT_VERSION, status: "implemented", install: installConvolutionBloom });
