import {
  isDenseEvidenceArray,
  isEvidenceRecord,
  isEvidenceText,
} from "./integrationEvidenceShape.js";
import { inspectIntegrationExecutions } from "./integrationExecutionEvidence.js";
import { inspectIntegrationOutput } from "./integrationOutputEvidence.js";

function inspectChecks(checks, label) {
  if (!isDenseEvidenceArray(checks, 1))
    return [`${label} are missing or malformed`];
  const identifiers = new Set();
  for (const check of checks) {
    if (
      !isEvidenceRecord(check) ||
      !isEvidenceText(check.id) ||
      check.passed !== true ||
      !Object.hasOwn(check, "observed") ||
      check.observed === undefined ||
      !Object.hasOwn(check, "expected") ||
      check.expected === undefined ||
      identifiers.has(check.id)
    )
      return [
        `${label} require unique named passing observations and expectations`,
      ];
    identifiers.add(check.id);
  }
  return [];
}

export function inspectIntegrationRun(run, definition) {
  if (!isEvidenceRecord(run)) return ["Measured run is malformed"];
  const issues = [];
  if (!isEvidenceText(run.runId))
    issues.push("Measured run identifier is missing");
  if (run.caseId !== definition.id)
    issues.push("Measured run belongs to another case");
  if (run.scope !== "complete-case")
    issues.push("Measured run covers only part of the case");
  if (run.status !== "passed") issues.push("Measured run did not pass");
  if (run.provenance !== "measured-gpu")
    issues.push("Measured GPU provenance is missing");
  issues.push(...inspectIntegrationOutput(run));
  if (
    !isDenseEvidenceArray(run.coveredPhases, 1) ||
    run.coveredPhases.some((phaseId) => !isEvidenceText(phaseId)) ||
    new Set(run.coveredPhases).size !== run.coveredPhases.length ||
    !definition.phases.every((phaseId) => run.coveredPhases.includes(phaseId))
  )
    issues.push("Complete unique phase coverage is missing");
  issues.push(...inspectChecks(run.checks, "Positive checks"));
  issues.push(...inspectChecks(run.negativeControls, "Negative controls"));
  if (!Array.isArray(run.mockedConsumers) || run.mockedConsumers.length !== 0)
    issues.push("Mocked or undisclosed consumers are not accepted");
  if (!Array.isArray(run.runtimeErrors) || run.runtimeErrors.length !== 0)
    issues.push("Runtime errors are present or undisclosed");
  issues.push(
    ...inspectIntegrationExecutions(run.executions, definition.phases),
  );
  return issues;
}
