import { PHASE_MANIFEST } from "../../contracts/phaseManifest.js";
import {
  isDenseEvidenceArray,
  isEvidenceRecord,
  isEvidenceText,
} from "./integrationEvidenceShape.js";
import { inspectIntegrationRun } from "./integrationRunEvidence.js";

const phaseIds = (numbers) =>
  Object.freeze(
    numbers.map((number) => `CP-F${String(number).padStart(2, "0")}`),
  );
export const INTEGRATION_CASES = Object.freeze(
  [
    {
      id: "exposure-bloom",
      title: "Exposure × bloom",
      phases: phaseIds([4, 8, 9, 14]),
    },
    {
      id: "local-exposure-flare",
      title: "Local exposure × flare",
      phases: phaseIds([4, 9, 10, 16]),
    },
    {
      id: "dof-temporal-motion-translucency",
      title: "DoF × reconstruction × motion blur × translucency",
      phases: phaseIds([5, 6, 7, 18, 19, 20, 21, 22, 27]),
    },
    {
      id: "grading-lut-hdr",
      title: "Grading × LUT × HDR output",
      phases: phaseIds([4, 11, 12, 13, 28]),
    },
    {
      id: "grain-capture",
      title: "Grain × cinematic capture",
      phases: phaseIds([7, 25, 29]),
    },
    {
      id: "resize-history-preexposure",
      title: "Resize × history × pre-exposure",
      phases: phaseIds([4, 7, 32]),
    },
    {
      id: "future-classic-safe-mode",
      title: "Future × Classic × safe mode",
      phases: phaseIds([31, 32, 33, 34]),
    },
    {
      id: "quality-degradations",
      title: "Presets and explicit degradation",
      phases: phaseIds([28, 31, 33, 34]),
    },
    {
      id: "all-features",
      title: "All producers and consumers",
      phases: Object.freeze(
        PHASE_MANIFEST.filter(
          (phase) => phase.id !== "CP-F35" && phase.id !== "CP-F36",
        ).map((phase) => phase.id),
      ),
    },
  ].map((entry) => Object.freeze(entry)),
);

export function evaluateIntegrationMatrix({ phases, runs = [] }) {
  if (
    !isDenseEvidenceArray(phases) ||
    !Array.isArray(runs) ||
    phases.some(
      (phase) =>
        !isEvidenceRecord(phase) ||
        !isEvidenceText(phase.id) ||
        !isEvidenceText(phase.status),
    )
  )
    throw new TypeError(
      "Integration matrix requires phase inventory and measured runs",
    );
  const ids = new Set(phases.map((phase) => phase.id));
  if (ids.size !== phases.length)
    throw new Error("Duplicate phase inventory entry");
  const states = new Map(phases.map((phase) => [phase.id, phase.status]));
  const knownCases = new Set(
    INTEGRATION_CASES.map((definition) => definition.id),
  );
  const inputIssues = [];
  const runCounts = new Map();
  for (const [index, run] of runs.entries()) {
    if (!isEvidenceRecord(run) || !knownCases.has(run.caseId)) {
      inputIssues.push(
        `Run ${index} is malformed or refers to an unknown integration case`,
      );
      continue;
    }
    if (isEvidenceText(run.runId)) {
      const key = JSON.stringify([run.caseId, run.runId]);
      runCounts.set(key, (runCounts.get(key) ?? 0) + 1);
    }
  }
  const rows = INTEGRATION_CASES.map((definition) => {
    const blockers = definition.phases
      .filter((id) => states.get(id) !== "implemented")
      .map((id) => `${id}: ${states.get(id) ?? "missing"}`);
    const candidates = runs.filter(
      (run) => isEvidenceRecord(run) && run.caseId === definition.id,
    );
    const inspected = candidates.map((run) => {
      const issues = inspectIntegrationRun(run, definition);
      if (runCounts.get(JSON.stringify([run.caseId, run.runId])) > 1)
        issues.push("Measured run identifier is duplicated within the case");
      return { run, issues };
    });
    const failed = candidates.find((run) => run.status === "failed");
    const accepted = inspected.find(
      (candidate) => candidate.issues.length === 0,
    )?.run;
    if (!accepted && !failed)
      blockers.push(
        candidates.length
          ? "Complete producer/consumer pixel proof and negative controls are missing"
          : "No complete measured run for this case",
      );
    return {
      ...definition,
      status: failed ? "failed" : blockers.length ? "blocked" : "passed",
      blockers,
      failure: failed?.error ?? null,
      acceptedRunId: !failed && blockers.length === 0 ? accepted.runId : null,
      failureScope: failed?.scope ?? null,
      partialRunIds: candidates
        .filter((run) => run.scope !== "complete-case")
        .map((run) => run.runId ?? null),
      rejectedRuns: inspected
        .filter((candidate) => candidate.issues.length > 0)
        .map(({ run, issues }) => ({ runId: run.runId ?? null, issues })),
    };
  });
  const complete =
    inputIssues.length === 0 && rows.every((row) => row.status === "passed");
  return {
    schemaVersion: "1.0.0",
    complete,
    status: rows.some((row) => row.status === "failed")
      ? "failed"
      : complete
        ? "passed"
        : "blocked",
    rows,
    inputIssues,
    referenceVerified: false,
    promotionAuthorized: false,
  };
}
