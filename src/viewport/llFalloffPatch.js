import {
  registerLocalLightFlag,
  isLocalLightFlagActive,
  resolveLocalLightFlag,
  setLocalLightFlagOverride,
} from "../lighting/llFeatureFlags.js";
import { isLocalLightBaselineFrozen } from "../lighting/llBaselineFreezeFlag.js";
import { llQa } from "../lighting/llTelemetry.js";
import { FALLOFF_BLEND_UNIFORM, LIGHTS_CHUNK_NAME, rewriteLightsChunk } from "../lighting/llFalloffShader.js";
import {
  FALLOFF_MODE,
  legacyThreeFalloff,
  resolveSceneFalloffDecision,
  sampleFalloffCurve,
  saturate,
} from "../lighting/llFalloffCore.js";

export const PHASE_ID = "LL-F2";
export const FALLOFF_FLAG_ID = "UEFalloff";
export const FALLOFF_PATCH_ID = "ll-f2-falloff";
export const FALLOFF_ANCHOR = "getDistanceAttenuation";
export const FALLOFF_PATCH_ORDER = 20;

const DEFAULT_CURVE_RADIUS = 12;
const DEFAULT_CURVE_SAMPLES = 8;


registerLocalLightFlag({
  id: FALLOFF_FLAG_ID,
  phase: PHASE_ID,
  description: "falloff UE: saturate(1-(d/R)^4)^2 / (d^2+1) in place of the 1/d^2 of three",
  defaultsByTier: { fraco: false, medio: true, forte: true },
});


export function registerLocalLightFalloffPhase(options) {
  const settings = options && typeof options === "object" ? options : {};
  const registry = settings.registry;
  if (!registry || typeof registry.registerShaderPatch !== "function") {
    throw new Error("LL-F2: a local-light patch registry is required");
  }
  const readLightOverrides =
    typeof settings.getLightFalloffOverrides === "function" ? settings.getLightFalloffOverrides : () => [];


  registry.registerUniform(FALLOFF_BLEND_UNIFORM, 1);

  let appliedShaderCount = 0;

  function lightFalloffOverrides() {
    const overrides = readLightOverrides();
    return Array.isArray(overrides) ? overrides : [];
  }


  function sceneFalloffDecision(tier) {
    const phaseFlagOn = isLocalLightFlagActive(FALLOFF_FLAG_ID, tier);
    return resolveSceneFalloffDecision(lightFalloffOverrides(), phaseFlagOn);
  }

  registry.registerShaderPatch({
    id: FALLOFF_PATCH_ID,
    phase: PHASE_ID,
    anchor: FALLOFF_ANCHOR,
    order: FALLOFF_PATCH_ORDER,


    isActive: (context) =>
      !isLocalLightBaselineFrozen(context && context.tier) && sceneFalloffDecision(context && context.tier).on,
    apply: (context) => {
      const applied = context.patchChunk("fragment", LIGHTS_CHUNK_NAME, (chunkSource) => rewriteLightsChunk(chunkSource));
      if (applied) appliedShaderCount++;
      return applied;
    },
  });

  const phase = {
    phaseId: PHASE_ID,
    flagId: FALLOFF_FLAG_ID,
    patchId: FALLOFF_PATCH_ID,
    anchor: FALLOFF_ANCHOR,
    uniformName: FALLOFF_BLEND_UNIFORM,

    blend() {
      const slot = registry.getUniformSlot(FALLOFF_BLEND_UNIFORM);
      return slot ? slot.value : 0;
    },


    setBlend(value) {
      const amount = saturate(Number(value));
      registry.setUniformValue(FALLOFF_BLEND_UNIFORM, amount);
      llQa.setPhase(PHASE_ID, { blend: amount });
      return { uniform: FALLOFF_BLEND_UNIFORM, blend: amount, recompiled: false };
    },


    setFlag(value) {
      return setLocalLightFlagOverride(FALLOFF_FLAG_ID, value);
    },

    appliedCount() {
      return appliedShaderCount;
    },

    resetAppliedCount() {
      appliedShaderCount = 0;
      return appliedShaderCount;
    },

    status(tier) {
      const flagDecision = resolveLocalLightFlag(FALLOFF_FLAG_ID, { tier });
      const baselineFrozen = isLocalLightBaselineFrozen(tier);
      const decision = resolveSceneFalloffDecision(lightFalloffOverrides(), flagDecision.active);
      const anchor = registry.checkAnchor(LIGHTS_CHUNK_NAME, FALLOFF_ANCHOR);
      const status = {
        phase: PHASE_ID,
        flag: FALLOFF_FLAG_ID,
        tier: tier || null,
        flagOn: flagDecision.active,
        flagToken: flagDecision.token,
        flagSource: flagDecision.source,
        baselineFrozen,
        sceneDecision: !baselineFrozen && decision.on,
        blend: this.blend(),
        uniform: FALLOFF_BLEND_UNIFORM,
        anchor: anchor.found ? "ok" : anchor.reason,
        patchedShaders: appliedShaderCount,
        unrealLights: decision.unrealLights,
        legacyLights: decision.legacyLights,
        mixed: decision.mixed,
        overruledLights: decision.overruledLights,
        pending: baselineFrozen
          ? "LlBaseline is freezing the legacy path: release it for the phase to enter"
          : decision.mixed
            ? "getDistanceAttenuation is one per shader: in LL-F2 the per-light veto is reported, not applied (per-light channel arrives with LL-F20)"
            : "",
      };
      llQa.setPhase(PHASE_ID, {
        flagOn: flagDecision.active,
        baselineFrozen,
        blend: status.blend,
        patchedShaders: appliedShaderCount,
        mixed: decision.mixed,
        anchorOk: anchor.found,
      });
      return status;
    },


    curve(options) {
      const settings = options || {};
      const radius = settings.attenuationRadius > 0 ? settings.attenuationRadius : DEFAULT_CURVE_RADIUS;
      const sampleCount = settings.sampleCount > 0 ? settings.sampleCount : DEFAULT_CURVE_SAMPLES;
      return sampleFalloffCurve({ attenuationRadius: radius, sampleCount, mode: FALLOFF_MODE.UNREAL }).map((sample) => ({
        d: Number(sample.distance.toFixed(3)),
        ue: Number(sample.value.toFixed(6)),
        three: Number(legacyThreeFalloff(sample.distance, radius).toFixed(6)),
      }));
    },
  };

  llQa.setPhase(PHASE_ID, {
    registered: true,
    flag: FALLOFF_FLAG_ID,
    patch: FALLOFF_PATCH_ID,
    anchor: FALLOFF_ANCHOR,
    uniform: FALLOFF_BLEND_UNIFORM,
    chunk: LIGHTS_CHUNK_NAME,
  });

  return phase;
}
