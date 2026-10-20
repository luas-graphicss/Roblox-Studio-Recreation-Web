import {
  registerLocalLightFlag,
  isLocalLightFlagActive,
  resolveLocalLightFlag,
  setLocalLightFlagOverride,
} from "../lighting/llFeatureFlags.js";
import { isLocalLightBaselineFrozen } from "../lighting/llBaselineFreezeFlag.js";
import { isLocalLightTechnology } from "../lighting/llTechnologyGate.js";
import { llQa } from "../lighting/llTelemetry.js";
import {
  SPOT_CONE_FLAG_ID,
  SPOT_CONE_MIX_UNIFORM,
  SPOT_CONE_PATCH_ID,
  SPOT_CONE_PHASE_ID,
} from "../lighting/llSpotConeContract.js";
import { SPOT_CONE_CHUNK_NAME, injectSpotConeAttenuation } from "../lighting/llSpotConeGlsl.js";
import {
  legacySpotConeAttenuationAtAngle,
  resolveSpotCone,
  sampleSpotConeCurve,
  saturate,
  spotConeGateHalfAngleDeg,
} from "../lighting/llSpotConeCore.js";

export const PHASE_ID = SPOT_CONE_PHASE_ID;
export const SPOT_CONE_ANCHOR = "getSpotAttenuation";
export const SPOT_CONE_PATCH_ORDER = 25;


const DEGREES_TO_RADIANS = Math.PI / 180;
const DEFAULT_CURVE_SAMPLES = 8;


registerLocalLightFlag({
  id: SPOT_CONE_FLAG_ID,
  phase: PHASE_ID,
  description:
    "spot cone UE: t = saturate((cosTheta - cosOuter) / (cosInner - cosOuter)), cone = t * t, in place of the smoothstep of three",
  defaultsByTier: { fraco: false, medio: true, forte: true },
});


export function registerLocalLightSpotConePhase(options) {
  const settings = options && typeof options === "object" ? options : {};
  const registry = settings.registry;
  if (!registry || typeof registry.registerShaderPatch !== "function") {
    throw new Error("LL-F5: a local-light patch registry is required");
  }


  registry.registerUniform(SPOT_CONE_MIX_UNIFORM, 1);


  llQa.setTextureUnits(PHASE_ID, 0);

  let appliedShaderCount = 0;
  let resolvedConeCount = 0;
  let lastRefusal = "";


  function isPhaseActive(context) {
    const frame = context && typeof context === "object" ? context : {};
    if (!isLocalLightTechnology(frame.technology)) return false;
    if (isLocalLightBaselineFrozen(frame.tier)) return false;
    return isLocalLightFlagActive(SPOT_CONE_FLAG_ID, frame.tier);
  }

  registry.registerShaderPatch({
    id: SPOT_CONE_PATCH_ID,
    phase: PHASE_ID,
    anchor: SPOT_CONE_ANCHOR,
    order: SPOT_CONE_PATCH_ORDER,


    isActive: (context) => isPhaseActive(context),
    apply: (context) => {
      const applied = context.patchChunk("fragment", SPOT_CONE_CHUNK_NAME, (chunkSource) => {
        const injection = injectSpotConeAttenuation(chunkSource);
        if (!injection.replaced) {


          if (injection.reason !== "already-injected") lastRefusal = injection.reason;
          return chunkSource;
        }
        lastRefusal = "";
        return injection.source;
      });
      if (applied) appliedShaderCount++;
      return applied;
    },
  });

  const phase = {
    phaseId: PHASE_ID,
    flagId: SPOT_CONE_FLAG_ID,
    patchId: SPOT_CONE_PATCH_ID,
    anchor: SPOT_CONE_ANCHOR,
    uniformName: SPOT_CONE_MIX_UNIFORM,


    mix() {
      const slot = registry.getUniformSlot(SPOT_CONE_MIX_UNIFORM);
      return slot ? slot.value : 0;
    },

    setMix(value) {
      const amount = saturate(Number(value));
      registry.setUniformValue(SPOT_CONE_MIX_UNIFORM, amount);
      llQa.setPhase(PHASE_ID, { mix: amount });
      return { uniform: SPOT_CONE_MIX_UNIFORM, mix: amount, recompiled: false };
    },


    setFlag(value) {
      return setLocalLightFlagOverride(SPOT_CONE_FLAG_ID, value);
    },

    isActive(context) {
      return isPhaseActive(context);
    },


    applyResolvedConeToLight(light, authored, context) {
      if (!light || !isPhaseActive(context)) return null;
      const cone = resolveSpotCone(authored);
      light.angle = cone.outerHalfAngleDeg * DEGREES_TO_RADIANS;
      light.penumbra = cone.threePenumbra;
      resolvedConeCount++;
      return cone;
    },


    gateHalfAngleDeg(authored) {
      return spotConeGateHalfAngleDeg(resolveSpotCone(authored));
    },

    appliedCount() {
      return appliedShaderCount;
    },

    resolvedCount() {
      return resolvedConeCount;
    },

    resetCounters() {
      appliedShaderCount = 0;
      resolvedConeCount = 0;
      return { patchedShaders: 0, resolvedCones: 0 };
    },


    status(context) {
      const frame = context && typeof context === "object" ? context : {};
      const flagDecision = resolveLocalLightFlag(SPOT_CONE_FLAG_ID, { tier: frame.tier });
      const baselineFrozen = isLocalLightBaselineFrozen(frame.tier);
      const technologyAllowed = isLocalLightTechnology(frame.technology);
      const anchor = registry.checkAnchor(SPOT_CONE_CHUNK_NAME, SPOT_CONE_ANCHOR);
      const status = {
        phase: PHASE_ID,
        flag: SPOT_CONE_FLAG_ID,
        tier: frame.tier || null,
        technologyAllowed,
        flagOn: flagDecision.active,
        flagToken: flagDecision.token,
        flagSource: flagDecision.source,
        baselineFrozen,
        active: isPhaseActive(frame),
        mix: this.mix(),
        uniform: SPOT_CONE_MIX_UNIFORM,
        chunk: SPOT_CONE_CHUNK_NAME,
        anchor: anchor.found ? "ok" : anchor.reason,
        patchedShaders: appliedShaderCount,
        resolvedCones: resolvedConeCount,
        refusal: lastRefusal,
        pending: !technologyAllowed
          ? "Technology outside ShadowMap / Future keeps the legacy cone byte for byte"
          : baselineFrozen
            ? "LlBaseline is freezing the legacy path: release it for the phase to enter"
            : "InnerConeAngle / OuterConeAngle per light arrive with the LL-F22 public API; until then the resolved cone comes from Roblox Angle",
      };
      llQa.setPhase(PHASE_ID, {
        flagOn: flagDecision.active,
        technologyAllowed,
        baselineFrozen,
        mix: status.mix,
        patchedShaders: appliedShaderCount,
        resolvedCones: resolvedConeCount,
        anchorOk: anchor.found,
        refusal: lastRefusal,
      });
      return status;
    },


    curve(options) {
      const settings = options || {};
      const cone = resolveSpotCone({
        coneAngleDeg: settings.coneAngleDeg,
        innerConeAngleDeg: settings.innerConeAngleDeg,
        outerConeAngleDeg: settings.outerConeAngleDeg,
        legacyPenumbra: settings.legacyPenumbra,
      });
      const sampleCount = settings.sampleCount > 0 ? settings.sampleCount : DEFAULT_CURVE_SAMPLES;
      return sampleSpotConeCurve(cone, sampleCount).map((sample) => ({
        deg: Number(sample.angleFromAxisDeg.toFixed(3)),
        ue: Number(sample.attenuation.toFixed(6)),
        three: Number(
          legacySpotConeAttenuationAtAngle(
            sample.angleFromAxisDeg,
            cone.outerHalfAngleDeg,
            cone.threePenumbra,
          ).toFixed(6),
        ),
      }));
    },
  };

  llQa.setPhase(PHASE_ID, {
    registered: true,
    flag: SPOT_CONE_FLAG_ID,
    patch: SPOT_CONE_PATCH_ID,
    anchor: SPOT_CONE_ANCHOR,
    uniform: SPOT_CONE_MIX_UNIFORM,
    chunk: SPOT_CONE_CHUNK_NAME,
    textureUnits: 0,
  });

  return phase;
}
