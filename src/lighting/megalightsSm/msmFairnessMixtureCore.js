import { MSM_FAIRNESS_SAMPLE_SHARE } from './msmFairnessCursorCore.js';
export function msmFairnessMixtureProbability({ pickedWeight, totalWeight, pickedSlot, cursorSlot, cursorWeight }) {
  if (!(totalWeight > 0) || !(pickedWeight > 0)) return 0;
  const fairnessShare = cursorWeight > 0 ? MSM_FAIRNESS_SAMPLE_SHARE : 0;
  return (1 - fairnessShare) * pickedWeight / totalWeight + (pickedSlot === cursorSlot ? fairnessShare : 0);
}
export function buildMsmFairnessMixtureGlsl() {
  return `
float msmFairnessProposalPdf(float pickedWeight, float totalWeight, float pickedSlot, float cursorSlot, float cursorWeight) {
  float fairnessShare = cursorWeight > 0.0 ? ${MSM_FAIRNESS_SAMPLE_SHARE} : 0.0;
  return (1.0 - fairnessShare) * pickedWeight / totalWeight + (pickedSlot == cursorSlot ? fairnessShare : 0.0);
}`;
}
