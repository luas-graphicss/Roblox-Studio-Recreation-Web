import { PHASE_MANIFEST } from "../../contracts/phaseManifest.js";
import {
  hasEvidenceStamp,
  hasPixelMeasurement,
  isDenseEvidenceArray,
  isEvidenceCount,
  isEvidenceRecord,
  isEvidenceText,
  matchesEvidenceStamp,
} from "./integrationEvidenceShape.js";

const phaseStages = new Map(
  PHASE_MANIFEST.map(({ id, stages }) => [id, new Set(stages)]),
);

function inspectPublishedResource(resource, execution) {
  const issues = [];
  if (!isEvidenceRecord(resource)) return ["Published resource is malformed"];
  if (
    !isEvidenceText(resource.name) ||
    !resource.name.startsWith(execution.owner)
  )
    issues.push("Published resource has no phase-owned name");
  if (!matchesEvidenceStamp(resource, execution))
    issues.push("Published resource has a stale or cross-view stamp");
  if (!["gpu", "synthetic", "reference"].includes(resource.provenance))
    issues.push("Published resource provenance is missing");
  if (
    resource.preExposure != null &&
    (!Number.isFinite(resource.preExposure) || resource.preExposure <= 0)
  )
    issues.push("Published pre-exposure is invalid");
  if (resource.kind === "value") {
    if (resource.status !== "value-observed" || resource.pixelProof !== false)
      issues.push(
        `Value consumer is not ready: ${resource.status ?? "missing status"}`,
      );
    return issues;
  }
  if (resource.kind !== "texture")
    return [...issues, "Published resource kind is missing"];
  if (
    resource.status !== "readback-observed" ||
    resource.pixelProof !== true ||
    !hasPixelMeasurement(resource.measurement)
  )
    issues.push("Texture has no complete finite pixel readback");
  if (
    !isEvidenceCount(resource.width, 1) ||
    !isEvidenceCount(resource.height, 1) ||
    resource.origin !== "bottom-left" ||
    !isEvidenceText(resource.format) ||
    !isEvidenceText(resource.encoding)
  )
    issues.push("Texture metadata is incomplete");
  if (
    resource.measurement?.width !== resource.width ||
    resource.measurement?.height !== resource.height ||
    resource.measurement?.domain !== resource.encoding
  )
    issues.push("Pixel readback does not match the published extent or domain");
  return issues;
}

export function inspectIntegrationExecutions(executions, requiredPhases) {
  if (!isDenseEvidenceArray(executions, 1))
    return ["Actual execution records are missing or malformed"];
  const issues = [];
  const observedPhases = new Set();
  let measuredDraws = 0;
  for (const [index, execution] of executions.entries()) {
    const label = isEvidenceText(execution?.id)
      ? execution.id
      : `Execution ${index}`;
    const problems = [];
    if (!isEvidenceRecord(execution)) {
      issues.push(`${label}: record is malformed`);
      continue;
    }
    if (
      !isEvidenceText(execution.owner) ||
      !isEvidenceText(execution.id) ||
      !execution.id.startsWith(execution.owner) ||
      !isEvidenceText(execution.stage) ||
      !hasEvidenceStamp(execution)
    )
      problems.push("identity, stage or frame stamp is missing");
    if (!phaseStages.get(execution.owner)?.has(execution.stage))
      problems.push("stage is not assigned to the published phase");
    if (typeof execution.transformsColor !== "boolean")
      problems.push("color-transform declaration is missing");
    if (execution.status !== "executed" || execution.error)
      problems.push(
        `pass is not successfully executed: ${execution.status ?? "missing"}`,
      );
    if (!isEvidenceCount(execution.draws))
      problems.push("draw count is invalid");
    if (
      !isDenseEvidenceArray(execution.reads) ||
      execution.reads.some((name) => !isEvidenceText(name))
    )
      problems.push("declared reads are malformed");
    if (!isDenseEvidenceArray(execution.writes, 1)) {
      problems.push("published outputs are missing or malformed");
    } else {
      const names = new Set();
      let textureCount = 0;
      for (const resource of execution.writes) {
        problems.push(...inspectPublishedResource(resource, execution));
        if (isEvidenceText(resource?.name)) {
          if (names.has(resource.name))
            problems.push("published output is duplicated");
          names.add(resource.name);
        }
        if (resource?.kind === "texture") textureCount++;
      }
      if (
        (execution.draws > 0 || execution.transformsColor === true) &&
        textureCount === 0
      )
        problems.push("GPU submission has no measured texture output");
      if (execution.transformsColor === true && execution.draws === 0)
        problems.push("color transform has no GPU submission");
    }
    if (problems.length) {
      issues.push(...problems.map((problem) => `${label}: ${problem}`));
    } else {
      observedPhases.add(execution.owner);
      measuredDraws += execution.draws;
    }
  }
  for (const phaseId of requiredPhases) {
    if (!observedPhases.has(phaseId))
      issues.push(`${phaseId}: no valid executed consumer`);
  }
  if (measuredDraws === 0)
    issues.push("No successful GPU submission with measured pixels");
  return [...new Set(issues)];
}
