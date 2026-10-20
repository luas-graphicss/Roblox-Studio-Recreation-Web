export const PIPELINE_STAGES = Object.freeze([
  "prepare", "beforeDof", "dof", "afterDof", "temporal", "afterTemporal",
  "motionBlur", "afterMotionBlur", "metering", "localExposure", "beforeBloom",
  "bloom", "lensFlare", "lensDirt", "lensWarp", "grading", "toneMapping",
  "filmFinish", "output", "afterOutput", "capture", "debug"
]);

export function getStageIndex(stage) {
  const index = PIPELINE_STAGES.indexOf(stage);
  if (index === -1) throw new Error(`Unknown pipeline stage: ${stage}`);
  return index;
}
