export const IES_BRIGHTNESS_REASONS = Object.freeze({
  OK: "ok",
  PROPERTY_OFF: "propertyOff",
  NO_PROFILE: "noProfile",
  INVALID_PROFILE: "invalidProfile",
  NO_PHOTOMETRY: "zeroPhotometry",
});

export const IES_BRIGHTNESS_SCALE_DEFAULT = 1;
export const IES_BRIGHTNESS_SCALE_MIN = 0;
export const IES_BRIGHTNESS_SCALE_MAX = 100;

function clampScale(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return IES_BRIGHTNESS_SCALE_DEFAULT;
  if (parsed < IES_BRIGHTNESS_SCALE_MIN) return IES_BRIGHTNESS_SCALE_MIN;
  if (parsed > IES_BRIGHTNESS_SCALE_MAX) return IES_BRIGHTNESS_SCALE_MAX;
  return parsed;
}

function disabledResult(reason, scale) {
  return Object.freeze({ enabled: false, candela: 0, peakCandela: 0, scale, reason });
}


export function iesPeakCandela(profile) {
  if (!profile || typeof profile !== "object" || profile.ok === false) return 0;
  const peak = Number(profile.maxCandela);
  return Number.isFinite(peak) && peak > 0 ? peak : 0;
}


export function resolveIesBrightness(input) {
  const request = input && typeof input === "object" ? input : {};
  const scale = clampScale(request.scale === undefined ? IES_BRIGHTNESS_SCALE_DEFAULT : request.scale);
  if (request.useIesBrightness !== true) return disabledResult(IES_BRIGHTNESS_REASONS.PROPERTY_OFF, scale);
  const profile = request.profile;
  if (!profile || typeof profile !== "object") return disabledResult(IES_BRIGHTNESS_REASONS.NO_PROFILE, scale);
  if (profile.ok === false) return disabledResult(IES_BRIGHTNESS_REASONS.INVALID_PROFILE, scale);
  const peakCandela = iesPeakCandela(profile);
  if (peakCandela <= 0) return disabledResult(IES_BRIGHTNESS_REASONS.NO_PHOTOMETRY, scale);
  return Object.freeze({
    enabled: true,
    candela: peakCandela * scale,
    peakCandela,
    scale,
    reason: IES_BRIGHTNESS_REASONS.OK,
  });
}
