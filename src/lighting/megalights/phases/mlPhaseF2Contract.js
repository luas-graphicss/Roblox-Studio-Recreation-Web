import { describeContract } from "../mlPipelineContract.js";
import { validateContract } from "../mlContractCheck.js";
import { mlQa } from "../runtime/megaLightsTelemetry.js";

export const PHASE_ID = "ML-F2";

export function installPhase() {
  const validation = validateContract();


  validation.problems.forEach((problem) => {
    mlQa.error("contract: " + problem, PHASE_ID + " validateContract");
  });


  mlQa.textureUnit(PHASE_ID, 0);

  mlQa.phase(PHASE_ID, {
    implemented: true,
    title: "Pipeline contract",
    block: "A",
    ownsPass: null,
    injectsGlsl: false,
    textureUnits: 0,
    contract: describeContract(),
    contractValid: validation.ok,
    contractProblems: validation.problems,
    contractCounts: validation.counts,
  });

  return { implemented: true, contractValid: validation.ok, problems: validation.problems };
}
