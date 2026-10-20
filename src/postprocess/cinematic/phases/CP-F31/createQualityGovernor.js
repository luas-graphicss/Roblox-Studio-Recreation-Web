import { ADAPTIVE_PROFILES, qualityProfile } from "./qualityProfiles.js";
import { resolveQualitySettings } from "./qualitySettings.js";
import { integer } from "./qualityContract.js";

export function createQualityGovernor(options) {
  const settings = resolveQualitySettings(options);
  let profileId = settings.profile;
  let samples = [];
  let warmup = settings.warmupSamples;
  let cooldown = 0;
  let pressure = 0;
  let recovery = 0;
  let lastFrameId = -1;
  let generation = null;
  let scopeKey = null;
  let accepted = 0;
  let rejected = 0;
  let transitions = 0;
  let frozen = false;
  let reason = "awaiting-qualified-gpu-samples";
  const clearWindow = () => { samples = []; pressure = 0; recovery = 0; };
  const snapshot = () => Object.freeze({ profileId, accepted, rejected, transitions, warmupRemaining: warmup,
    cooldownRemaining: cooldown, pendingSamples: samples.length, pressureWindows: pressure, recoveryWindows: recovery, frozen, reason });
  return Object.freeze({
    snapshot,
    bind({ configurationKey, generation: nextGeneration, freeze: nextFrozen = false }) {
      integer(nextGeneration, "generation");
      if (generation !== nextGeneration || scopeKey !== configurationKey) {
        if (generation !== nextGeneration) lastFrameId = -1;
        generation = nextGeneration;
        scopeKey = configurationKey;
        warmup = settings.warmupSamples;
        clearWindow();
      }
      if (frozen !== nextFrozen) clearWindow();
      frozen = nextFrozen;
    },
    observe(sample) {
      if (!settings.adaptive || frozen) { clearWindow(); reason = frozen ? "frozen-capture-or-reference" : "manual"; return snapshot(); }
      const valid = sample && sample.source === "gpu-timer-query" && sample.visible === true && sample.disjoint === false &&
        sample.headless === false && sample.paused === false && sample.productionEligible === true &&
        sample.generation === generation && sample.configurationKey === scopeKey &&
        Number.isSafeInteger(sample.frameId) && sample.frameId > lastFrameId &&
        typeof sample.gpuMilliseconds === "number" && Number.isFinite(sample.gpuMilliseconds) && sample.gpuMilliseconds >= 0 && sample.gpuMilliseconds <= 10000;
      if (!valid) { rejected += 1; clearWindow(); reason = "unqualified-or-stale-timing"; return snapshot(); }
      if (lastFrameId >= 0 && sample.frameId - lastFrameId > settings.maximumFrameGap) clearWindow();
      lastFrameId = sample.frameId;
      accepted += 1;
      if (warmup > 0) { warmup -= 1; reason = "warmup"; return snapshot(); }
      if (cooldown > 0) { cooldown -= 1; reason = "cooldown"; return snapshot(); }
      samples.push(sample.gpuMilliseconds);
      if (samples.length < settings.windowSamples) { reason = "collecting"; return snapshot(); }
      const sorted = [...samples].sort((left, right) => left - right);
      const p95 = sorted[Math.ceil(sorted.length * 0.95) - 1];
      samples = [];
      const target = settings.targetGpuMs ?? qualityProfile(profileId).targetGpuMs;
      if (p95 > target * settings.downRatio) { pressure += 1; recovery = 0; }
      else if (p95 < target * settings.upRatio) { recovery += 1; pressure = 0; }
      else { pressure = 0; recovery = 0; }
      let next = ADAPTIVE_PROFILES.indexOf(profileId);
      if (pressure >= settings.pressureWindows) next = Math.max(ADAPTIVE_PROFILES.indexOf(settings.minimumProfile), next - 1);
      if (recovery >= settings.recoveryWindows) next = Math.min(ADAPTIVE_PROFILES.indexOf(settings.profile), next + 1);
      const selected = ADAPTIVE_PROFILES[next];
      reason = "stable";
      if (selected && selected !== profileId) {
        profileId = selected;
        transitions += 1;
        cooldown = settings.cooldownSamples;
        clearWindow();
        reason = "profile-transition-at-next-frame-boundary";
      }
      return snapshot();
    }
  });
}
