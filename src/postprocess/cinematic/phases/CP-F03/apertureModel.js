import { finiteNumber } from "./cameraValidation.js";

export function resolveAperture({ apertureFNumber, minApertureFNumber, bladeCount = 7, bladeCurvature = 0, bladeRotationDegrees = 0 }, focalLengthMm) {
  finiteNumber(apertureFNumber, "apertureFNumber", 0.1, 128);
  finiteNumber(minApertureFNumber, "minApertureFNumber", 0.1, 128);
  finiteNumber(bladeCount, "bladeCount", 3, 32);
  if (!Number.isInteger(bladeCount)) throw new TypeError("bladeCount must be an integer");
  finiteNumber(bladeCurvature, "bladeCurvature", 0, 1);
  finiteNumber(bladeRotationDegrees, "bladeRotationDegrees", -3600, 3600);
  finiteNumber(focalLengthMm, "focalLengthMm", 0.1, 10000);
  const fNumber = Math.max(apertureFNumber, minApertureFNumber);
  return Object.freeze({
    requestedFNumber: apertureFNumber,
    fNumber,
    minFNumber: minApertureFNumber,
    limitedByLens: fNumber !== apertureFNumber,
    pupilDiameterMm: focalLengthMm / fNumber,
    bladeCount,
    bladeCurvature,
    bladeRotationDegrees,
    diaphragmRenderer: "CP-F19"
  });
}
