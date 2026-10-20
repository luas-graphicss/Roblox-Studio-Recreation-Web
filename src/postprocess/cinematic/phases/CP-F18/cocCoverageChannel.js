import { requireChoice } from "./cocValidation.js";

export function resolveCocCoverageChannel(coverage) {
  requireChoice(coverage.encoding, "coverage.encoding", ["coverage-unorm", "coverage-alpha-unorm", "view-normal-encoded"]);
  const isNormalCoverage = coverage.encoding === "view-normal-encoded";
  const coverageChannel = isNormalCoverage
    ? coverage.validityComponent ?? coverage.component
    : coverage.component ?? coverage.validityComponent;
  if (isNormalCoverage && coverageChannel !== "a") throw new Error("Normal coverage must explicitly use alpha");
  return requireChoice(coverageChannel, "coverage component", ["r", "a"]);
}
