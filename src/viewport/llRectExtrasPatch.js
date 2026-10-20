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
  RECT_EXTRAS_FLAG_ID,
  RECT_EXTRAS_PATCH_ID,
  RECT_EXTRAS_PHASE_ID,
} from "../lighting/llRectExtrasContract.js";
import {
  BARN_DOOR_OPEN_SLOPE,
  BARN_DOOR_SOFT_EDGE,
  RECT_EXTRAS_MAX_PROMOTED,
  barnDoorTipSlope,
  isBarnDoorNeutral,
  rectBudgetForTier,
} from "../lighting/llRectExtrasCore.js";
import { listSourceTextureIds, resolveSourceTextureTint } from "../lighting/llRectSourceTextureCore.js";
import {
  RECT_EXTRAS_UNIFORMS,
  rewriteLightsFragmentBegin,
  rewriteLightsParsBegin,
} from "../lighting/llRectExtrasShader.js";


import { rectAreaLightsInRenderOrder } from "../lighting/llLocalLightWalkCache.js";

export const RECT_EXTRAS_PARS_CHUNK = "lights_pars_begin";
export const RECT_EXTRAS_FRAGMENT_CHUNK = "lights_fragment_begin";
export const RECT_EXTRAS_PATCH_ORDER = 70;


export const RECT_AREA_UNIFORM_ANCHOR = "uniform RectAreaLight rectAreaLights[";


export const RECT_AREA_LOOP_ANCHOR = "rectAreaLight = rectAreaLights[";

const SLOT_STRIDE = 4;


registerLocalLightFlag({
  id: RECT_EXTRAS_FLAG_ID,
  phase: RECT_EXTRAS_PHASE_ID,
  description: "rect extras: barn doors, SourceTexture tint and TwoSided over the rect lights already promoted to LTC",
  defaultsByTier: { fraco: false, medio: true, forte: true },
});


export function registerLocalLightRectExtrasPhase(options) {
  const settings = options && typeof options === "object" ? options : {};
  const registry = settings.registry;
  if (!registry || typeof registry.registerShaderPatch !== "function") {
    throw new Error("LL-F7: a local-light patch registry is required");
  }
  const logger = settings.logger && typeof settings.logger.warn === "function" ? settings.logger : null;


  const barnSlopeSlots = new Float32Array(SLOT_STRIDE * RECT_EXTRAS_MAX_PROMOTED);
  const sourceTintSlots = new Float32Array(SLOT_STRIDE * RECT_EXTRAS_MAX_PROMOTED);

  function writeNeutralSlot(slotIndex) {
    const base = slotIndex * SLOT_STRIDE;
    barnSlopeSlots[base] = BARN_DOOR_OPEN_SLOPE;
    barnSlopeSlots[base + 1] = BARN_DOOR_OPEN_SLOPE;
    barnSlopeSlots[base + 2] = BARN_DOOR_SOFT_EDGE;
    barnSlopeSlots[base + 3] = 0;
    sourceTintSlots[base] = 1;
    sourceTintSlots[base + 1] = 1;
    sourceTintSlots[base + 2] = 1;
    sourceTintSlots[base + 3] = 0;
  }

  function writeAllNeutralSlots() {
    for (let slotIndex = 0; slotIndex !== RECT_EXTRAS_MAX_PROMOTED; slotIndex++) writeNeutralSlot(slotIndex);
  }

  writeAllNeutralSlots();
  const enabledUniformSlot = registry.registerUniform(RECT_EXTRAS_UNIFORMS.enabled, 0);
  registry.registerUniform(RECT_EXTRAS_UNIFORMS.barnSlope, barnSlopeSlots);
  registry.registerUniform(RECT_EXTRAS_UNIFORMS.sourceTint, sourceTintSlots);


  llQa.setTextureUnits(RECT_EXTRAS_PHASE_ID, 0);


  const extrasByLight = new Map();

  let appliedShaderCount = 0;
  let declarationsPublished = false;
  let rectLightCount = 0;
  let doorSlotCount = 0;
  let tintSlotCount = 0;
  let lastRefusal = "";

  function recordRefusal(reason) {
    lastRefusal = reason;
    llQa.addError("LL-F7: " + reason, { phase: RECT_EXTRAS_PHASE_ID, patch: RECT_EXTRAS_PATCH_ID });
    if (logger) logger.warn("[Luzes locais] LL-F7 recusou: " + reason);
  }

  function isPhaseActive(context) {
    const frame = context && typeof context === "object" ? context : {};
    if (!isLocalLightTechnology(frame.technology)) return false;
    if (isLocalLightBaselineFrozen(frame.tier)) return false;
    return isLocalLightFlagActive(RECT_EXTRAS_FLAG_ID, frame.tier);
  }

  registry.registerShaderPatch({
    id: RECT_EXTRAS_PATCH_ID,
    phase: RECT_EXTRAS_PHASE_ID,
    anchor: RECT_AREA_UNIFORM_ANCHOR,
    order: RECT_EXTRAS_PATCH_ORDER,
    isActive: (context) => isPhaseActive(context),
    apply: (context) => {


      if (!context.contains("fragment", RECT_AREA_UNIFORM_ANCHOR)) {
        declarationsPublished = false;
        return false;
      }


      const declared = context.patchChunk("fragment", RECT_EXTRAS_PARS_CHUNK, (chunkSource) => {
        const rewritten = rewriteLightsParsBegin(chunkSource);
        return rewritten === null ? chunkSource : rewritten;
      });
      declarationsPublished = declared || context.contains("fragment", RECT_EXTRAS_UNIFORMS.barnSlope);
      if (!declarationsPublished) {
        recordRefusal("rectAreaLights[] not found in " + RECT_EXTRAS_PARS_CHUNK);
        return false;
      }

      const called = context.patchChunk("fragment", RECT_EXTRAS_FRAGMENT_CHUNK, (chunkSource) => {
        const rewritten = rewriteLightsFragmentBegin(chunkSource);
        return rewritten === null ? chunkSource : rewritten;
      });
      if (!called) {
        recordRefusal("the rect loop was not found in " + RECT_EXTRAS_FRAGMENT_CHUNK);
        return false;
      }
      appliedShaderCount++;
      lastRefusal = "";
      return true;
    },
  });

  const phase = {
    phaseId: RECT_EXTRAS_PHASE_ID,
    flagId: RECT_EXTRAS_FLAG_ID,
    patchId: RECT_EXTRAS_PATCH_ID,
    anchor: RECT_AREA_UNIFORM_ANCHOR,
    uniformNames: Object.freeze([
      RECT_EXTRAS_UNIFORMS.enabled,
      RECT_EXTRAS_UNIFORMS.barnSlope,
      RECT_EXTRAS_UNIFORMS.sourceTint,
    ]),
    maxRectSlots: RECT_EXTRAS_MAX_PROMOTED,

    setFlag(value) {
      return setLocalLightFlagOverride(RECT_EXTRAS_FLAG_ID, value);
    },

    isActive(context) {
      return isPhaseActive(context);
    },

    beginFrame() {
      extrasByLight.clear();
      return this;
    },


    collectRectLight(light, authored, context) {
      if (!light || !isPhaseActive(context)) return false;
      const source = authored && typeof authored === "object" ? authored : {};
      const barnDoorAngle = Number(source.BarnDoorAngle);
      const barnDoorLength = Number(source.BarnDoorLength);
      const doorsNeutral = isBarnDoorNeutral(barnDoorAngle, barnDoorLength);
      const tint = resolveSourceTextureTint(source.SourceTexture);
      const twoSided = source.TwoSided === true;


      if (doorsNeutral && !tint.found && !twoSided) return false;
      extrasByLight.set(light, {
        halfWidth: Math.max(Number(source.Width) || 0, 0) / 2,
        halfHeight: Math.max(Number(source.Height) || 0, 0) / 2,
        barnDoorAngle,
        barnDoorLength,
        doorsNeutral,
        tint,
        twoSided,
      });
      return true;
    },


    syncRectExtrasTable(scene, context) {
      const frame = context && typeof context === "object" ? context : {};
      const active = isPhaseActive(frame);
      registry.setUniformValue(RECT_EXTRAS_UNIFORMS.enabled, active ? 1 : 0);


      writeAllNeutralSlots();
      doorSlotCount = 0;
      tintSlotCount = 0;

      const rectLights = scene ? rectAreaLightsInRenderOrder(scene) : [];
      rectLightCount = rectLights.length;
      if (!active || !declarationsPublished || rectLightCount === 0) {
        llQa.setPhase(RECT_EXTRAS_PHASE_ID, {
          rectLights: rectLightCount,
          doorSlots: 0,
          tintSlots: 0,
          reason: !active ? "phase-off" : !declarationsPublished ? "declarations-missing" : "no-rect-light",
        });
        return { rectLights: rectLightCount, doorSlots: 0, tintSlots: 0 };
      }


      const budget = Math.min(rectBudgetForTier(frame.tier), RECT_EXTRAS_MAX_PROMOTED);
      const usableSlots = Math.min(rectLightCount, budget);
      for (let slotIndex = 0; slotIndex !== usableSlots; slotIndex++) {
        const extras = extrasByLight.get(rectLights[slotIndex]);
        if (!extras) continue;
        const base = slotIndex * SLOT_STRIDE;
        if (!extras.doorsNeutral) {
          barnSlopeSlots[base] = barnDoorTipSlope(extras.halfWidth, extras.barnDoorAngle, extras.barnDoorLength);
          barnSlopeSlots[base + 1] = barnDoorTipSlope(extras.halfHeight, extras.barnDoorAngle, extras.barnDoorLength);
          barnSlopeSlots[base + 2] = BARN_DOOR_SOFT_EDGE;
          barnSlopeSlots[base + 3] = 1;
          doorSlotCount++;
        }
        if (extras.tint.found) {
          sourceTintSlots[base] = extras.tint.linearTint[0];
          sourceTintSlots[base + 1] = extras.tint.linearTint[1];
          sourceTintSlots[base + 2] = extras.tint.linearTint[2];
          tintSlotCount++;
        }
        sourceTintSlots[base + 3] = extras.twoSided ? 1 : 0;
      }

      llQa.setPhase(RECT_EXTRAS_PHASE_ID, {
        rectLights: rectLightCount,
        budget,
        usableSlots,
        doorSlots: doorSlotCount,
        tintSlots: tintSlotCount,
        reason: "",
      });
      return { rectLights: rectLightCount, doorSlots: doorSlotCount, tintSlots: tintSlotCount };
    },


    slots() {
      return Array.from({ length: RECT_EXTRAS_MAX_PROMOTED }, (ignored, slotIndex) => {
        const base = slotIndex * SLOT_STRIDE;
        return {
          slot: slotIndex,
          tipSlopeWidth: barnSlopeSlots[base],
          tipSlopeHeight: barnSlopeSlots[base + 1],
          softEdge: barnSlopeSlots[base + 2],
          doorsClosing: barnSlopeSlots[base + 3] > 0.5,
          tint: [sourceTintSlots[base], sourceTintSlots[base + 1], sourceTintSlots[base + 2]],
          twoSided: sourceTintSlots[base + 3] > 0.5,
        };
      });
    },

    sourceTextures() {
      return listSourceTextureIds();
    },

    appliedCount() {
      return appliedShaderCount;
    },

    resetCounters() {
      appliedShaderCount = 0;
      doorSlotCount = 0;
      tintSlotCount = 0;
      return { patchedShaders: 0, doorSlots: 0, tintSlots: 0 };
    },

    status(context) {
      const frame = context && typeof context === "object" ? context : {};
      const flagDecision = resolveLocalLightFlag(RECT_EXTRAS_FLAG_ID, { tier: frame.tier });
      const baselineFrozen = isLocalLightBaselineFrozen(frame.tier);
      const technologyAllowed = isLocalLightTechnology(frame.technology);
      const parsAnchor = registry.checkAnchor(RECT_EXTRAS_PARS_CHUNK, RECT_AREA_UNIFORM_ANCHOR);
      const loopAnchor = registry.checkAnchor(RECT_EXTRAS_FRAGMENT_CHUNK, RECT_AREA_LOOP_ANCHOR);
      return {
        phase: RECT_EXTRAS_PHASE_ID,
        flag: RECT_EXTRAS_FLAG_ID,
        tier: frame.tier || null,
        technologyAllowed,
        flagOn: flagDecision.active,
        flagToken: flagDecision.token,
        flagSource: flagDecision.source,
        baselineFrozen,
        active: isPhaseActive(frame),
        chunks: [RECT_EXTRAS_PARS_CHUNK, RECT_EXTRAS_FRAGMENT_CHUNK],
        anchor: parsAnchor.found ? "ok" : parsAnchor.reason,
        loopAnchor: loopAnchor.found ? "ok" : loopAnchor.reason,
        declarationsPublished,
        patchedShaders: appliedShaderCount,
        rectLights: rectLightCount,
        budget: rectBudgetForTier(frame.tier),
        maxRectSlots: RECT_EXTRAS_MAX_PROMOTED,
        doorSlots: doorSlotCount,
        tintSlots: tintSlotCount,
        sourceTextures: listSourceTextureIds(),
        refusal: lastRefusal,
        pending: !technologyAllowed
          ? "Technology outside ShadowMap / Future keeps the legacy rect byte for byte"
          : baselineFrozen
            ? "LlBaseline is freezing the legacy path: release it for the phase to enter"
            : "three r161 has no shadow map for RectAreaLight: a rect with Shadows keeps losing its local shadow until the atlas of LL-F10. Promotion, aiming and nits belong to the area planner of the engine (IL-F25 / IL-F37), not to this phase. SourceTexture reads the built-in library; .png by Asset ID is LL-F22.",
      };
    },
  };

  llQa.setPhase(RECT_EXTRAS_PHASE_ID, {
    registered: true,
    flag: RECT_EXTRAS_FLAG_ID,
    patch: RECT_EXTRAS_PATCH_ID,
    anchor: RECT_AREA_UNIFORM_ANCHOR,
    chunks: [RECT_EXTRAS_PARS_CHUNK, RECT_EXTRAS_FRAGMENT_CHUNK],
    uniforms: phase.uniformNames,
    maxRectSlots: RECT_EXTRAS_MAX_PROMOTED,
    textureUnits: 0,
  });

  return phase;
}
