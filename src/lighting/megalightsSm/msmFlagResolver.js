export const MSM_FLAG_PROPERTY_NAME = "MegaLightsSM";


export const MSM_FLAG_TOKEN = Object.freeze({
  AUTO: "auto",
  ON: "on",
  OFF: "off",
});


export const MSM_GPU_PROFILE = Object.freeze({
  WEAK: "weak",
  STRONG: "strong",
  UNKNOWN: "unknown",
});


export const MSM_FLAG_SOURCE = Object.freeze({
  EXPLICIT_TOKEN: "explicit-token",
  GPU_PROFILE: "gpu-profile",
  INCOMPLETE_TELEMETRY: "incomplete-gpu-telemetry",
  UNKNOWN_TOKEN: "unknown-token",
});

const ON_ALIASES = Object.freeze(["on", "true", "1", "yes", "ligado"]);
const OFF_ALIASES = Object.freeze(["off", "false", "0", "no", "desligado"]);
const AUTO_ALIASES = Object.freeze(["auto", "default", "padrao"]);

function readFlagText(value) {
  if (typeof value === "string") return value.trim().toLowerCase();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}


export function normalizeMsmFlagToken(value) {
  if (typeof value === "boolean") return value ? MSM_FLAG_TOKEN.ON : MSM_FLAG_TOKEN.OFF;
  if (value === undefined || value === null) return MSM_FLAG_TOKEN.AUTO;

  const text = readFlagText(value);
  if (!text) return MSM_FLAG_TOKEN.AUTO;
  if (ON_ALIASES.indexOf(text) !== -1) return MSM_FLAG_TOKEN.ON;
  if (OFF_ALIASES.indexOf(text) !== -1) return MSM_FLAG_TOKEN.OFF;
  if (AUTO_ALIASES.indexOf(text) !== -1) return MSM_FLAG_TOKEN.AUTO;
  return "";
}


export function describeMsmGpuProfile(weakGpu) {
  if (weakGpu === true) {
    return { profile: MSM_GPU_PROFILE.WEAK, reason: "gpuBudget.weak = true" };
  }
  if (weakGpu === false) {
    return { profile: MSM_GPU_PROFILE.STRONG, reason: "gpuBudget.weak = false" };
  }
  return {
    profile: MSM_GPU_PROFILE.UNKNOWN,
    reason: "gpuBudget.weak is not an explicit boolean - GPU profile unknown",
  };
}
















export function resolveMsmFlag(input) {
  const source = input && typeof input === "object" ? input : {};
  const raw = source.flag;
  const token = normalizeMsmFlagToken(raw);
  const gpu = describeMsmGpuProfile(source.weakGpu);

  const decision = {
    property: MSM_FLAG_PROPERTY_NAME,
    raw,
    token,
    gpuProfile: gpu.profile,
  };

  if (!token) {
    return {
      ...decision,
      active: false,
      source: MSM_FLAG_SOURCE.UNKNOWN_TOKEN,
      reason:
        MSM_FLAG_PROPERTY_NAME +
        ' = "' +
        String(raw) +
        '" is not one of on / off / auto - refused instead of guessed, the MSM stays off',
    };
  }

  if (token === MSM_FLAG_TOKEN.ON) {
    return {
      ...decision,
      active: true,
      source: MSM_FLAG_SOURCE.EXPLICIT_TOKEN,
      reason: MSM_FLAG_PROPERTY_NAME + " forced ON by the user - the GPU profile default is bypassed",
    };
  }

  if (token === MSM_FLAG_TOKEN.OFF) {
    return {
      ...decision,
      active: false,
      source: MSM_FLAG_SOURCE.EXPLICIT_TOKEN,
      reason: MSM_FLAG_PROPERTY_NAME + " forced OFF by the user - image of today, byte for byte",
    };
  }

  if (gpu.profile === MSM_GPU_PROFILE.WEAK) {
    return {
      ...decision,
      active: true,
      source: MSM_FLAG_SOURCE.GPU_PROFILE,
      reason: "AUTO on a weak GPU - the MSM is born on the machine that has no local light system today",
    };
  }

  if (gpu.profile === MSM_GPU_PROFILE.STRONG) {
    return {
      ...decision,
      active: false,
      source: MSM_FLAG_SOURCE.GPU_PROFILE,
      reason: "AUTO on a strong GPU - the original MegaLights rules there and stays byte for byte",
    };
  }

  return {
    ...decision,
    active: false,
    source: MSM_FLAG_SOURCE.INCOMPLETE_TELEMETRY,
    reason: "AUTO with " + gpu.reason + " - never guessed upwards, the MSM stays off",
  };
}


export function isMsmFlagActiveFor(flag, weakGpu) {
  const token = normalizeMsmFlagToken(flag);
  if (token === MSM_FLAG_TOKEN.ON) return true;
  if (token !== MSM_FLAG_TOKEN.AUTO) return false;
  return weakGpu === true;
}


export function isMsmFlagActive(input) {
  const source = input && typeof input === "object" ? input : {};
  return isMsmFlagActiveFor(source.flag, source.weakGpu);
}
