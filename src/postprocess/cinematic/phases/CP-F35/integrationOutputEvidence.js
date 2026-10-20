import {
  hasEvidenceStamp,
  hasPixelMeasurement,
  isDenseEvidenceArray,
  isEvidenceText,
  matchesEvidenceStamp,
} from "./integrationEvidenceShape.js";

const measurementFields = [
  "width",
  "height",
  "channels",
  "domain",
  "pixelCount",
  "sampleCount",
  "minimum",
  "maximum",
  "mean",
  "nonzeroSamples",
  "fingerprint",
  "fingerprintAlgorithm",
];

export function inspectIntegrationOutput(run) {
  if (!hasPixelMeasurement(run.output))
    return ["Final output has no complete finite pixel measurement"];
  if (
    !hasEvidenceStamp(run.outputResource) ||
    !isEvidenceText(run.outputResource.name)
  )
    return ["Final output resource identity and frame stamp are missing"];
  if (!isDenseEvidenceArray(run.executions, 1))
    return ["Final output is not bound to an actual executed producer"];
  const matched = run.executions.some(
    (execution) =>
      execution?.status === "executed" &&
      matchesEvidenceStamp(run.outputResource, execution) &&
      Array.isArray(execution.writes) &&
      execution.writes.some(
        (resource) =>
          resource?.name === run.outputResource.name &&
          resource.status === "readback-observed" &&
          resource.pixelProof === true &&
          matchesEvidenceStamp(resource, execution) &&
          hasPixelMeasurement(resource.measurement) &&
          measurementFields.every((field) =>
            Object.is(resource.measurement[field], run.output[field]),
          ),
      ),
  );
  return matched
    ? []
    : ["Final output does not match its recorded producer readback"];
}
