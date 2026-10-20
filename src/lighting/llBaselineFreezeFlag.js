import { isLocalLightFlagActive, registerLocalLightFlag, setLocalLightFlagOverride } from "./llFeatureFlags.js";

export const LL_BASELINE_FREEZE_FLAG_ID = "LlBaseline";
export const LL_BASELINE_PHASE_ID = "LL-F1";


registerLocalLightFlag({
  id: LL_BASELINE_FREEZE_FLAG_ID,
  phase: LL_BASELINE_PHASE_ID,
  description:
    "master freeze: while ON no local-light patch enters the shader, so the legacy image can be captured byte for byte",
  defaultsByTier: { fraco: false, medio: false, forte: false },
});


export function isLocalLightBaselineFrozen(tier) {
  return isLocalLightFlagActive(LL_BASELINE_FREEZE_FLAG_ID, tier);
}


export function setLocalLightBaselineFreeze(value) {
  return setLocalLightFlagOverride(LL_BASELINE_FREEZE_FLAG_ID, value);
}
