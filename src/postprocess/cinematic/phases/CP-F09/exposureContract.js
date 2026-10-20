export const EXPOSURE_PHASE_ID = "CP-F09";
export const EXPOSURE_SETTINGS_KEY = "CP-F09.settings";
export const EXPOSURE_BINDING_KEY = "CP-F09.binding";
export const EXPOSURE_RESOURCES = Object.freeze({
  adaptation: "CP-F09.adaptation",
  nextPreExposure: "CP-F09.nextPreExposure",
  color: "CP-F09.color",
  status: "CP-F09.status"
});
export const EXPOSURE_HISTORY_NAME = "CP-F09.adaptationHistory";
export const EXPOSURE_STATE_ENCODING = "cp-f09-ev100-state-v1";
export const EXPOSURE_METERING_ENCODING = "ev100-scene-referred";
export const EXPOSURE_STATE_LAYOUT = Object.freeze({
  width: 6,
  height: 1,
  format: "r32f",
  actualEv100Texel: 0,
  targetEv100Texel: 1,
  exposureMultiplierTexel: 2,
  compensationStopsTexel: 3,
  validityTexel: 4,
  sourceEv100Texel: 5
});
export const MAX_COMPENSATION_CURVE_POINTS = 32;
export const EXPOSURE_ENGINEERING_PROFILE = "continuous-linear-exponential-v1";
