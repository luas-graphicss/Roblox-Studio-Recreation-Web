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
  AREA_LIGHT_AXIS_UNIFORM,
  AREA_LIGHT_BEGIN_FUNCTION,
  AREA_LIGHT_SHAPE_UNIFORM,
  injectAreaLightStateIntoLightLoops,
  injectAreaSpecularIntoPhysicalChunk,
} from "../lighting/llAreaSpecShader.js";
import {
  MAX_AREA_LIGHTS,
  createAreaLightBuffer,
  readMatrixAxisY,
  transformDirectionByMatrix,
  writeAreaLightAxis,
  writeAreaLightShape,
} from "../lighting/llLocalLightTableCore.js";


import { localLightsInRenderOrder } from "../lighting/llLocalLightWalkCache.js";


import { createLocalLightOrderBuffer } from "../lighting/llLocalLightOrderBuffer.js";
import {
  NEUTRAL_GATE_INVALIDATION,
  createAreaLightTableNeutralGate,
} from "../lighting/llAreaLightTableNeutralGate.js";

export const PHASE_ID = "LL-F6";


export const AREA_SPECULAR_FLAG_ID = "UEAreaSpecular";


export const AREA_SPECULAR_BRDF_PATCH_ID = "ll-f6-area-spec-brdf";
export const AREA_SPECULAR_STATE_PATCH_ID = "ll-f6-area-spec-state";

export const AREA_SPECULAR_BRDF_PATCH_ORDER = 60;
export const AREA_SPECULAR_STATE_PATCH_ORDER = 61;

const PHYSICAL_PARS_CHUNK_NAME = "lights_physical_pars_fragment";
const LIGHT_LOOP_CHUNK_NAME = "lights_fragment_begin";


export const RE_DIRECT_PHYSICAL_ANCHOR = "void RE_Direct_Physical(";


export const POINT_LIGHT_INFO_ANCHOR = "getPointLightInfo(";


registerLocalLightFlag({
  id: AREA_SPECULAR_FLAG_ID,
  phase: PHASE_ID,
  description:
    "area specular: Karis representative point for the sphere (SourceRadius) and the capsule (SourceLength) on the GGX paths",
  defaultsByTier: { fraco: false, medio: true, forte: true },
});


export function registerLocalLightAreaSpecularPhase(options) {
  const settings = options && typeof options === "object" ? options : {};
  const registry = settings.registry;
  if (!registry || typeof registry.registerShaderPatch !== "function") {
    throw new Error("LL-F6: a local-light patch registry is required");
  }
  const logger = settings.logger && typeof settings.logger.warn === "function" ? settings.logger : null;


  const shapeUniformSlot = registry.registerUniform(AREA_LIGHT_SHAPE_UNIFORM, createAreaLightBuffer(0));
  const axisUniformSlot = registry.registerUniform(AREA_LIGHT_AXIS_UNIFORM, createAreaLightBuffer(0));


  llQa.setTextureUnits(PHASE_ID, 0);


  const shapeByLight = new Map();


  const orderedLightBuffer = createLocalLightOrderBuffer();


  const neutralTableGate = createAreaLightTableNeutralGate();

  let appliedShaderCount = 0;
  let declarationsPublished = false;
  let localLightCount = 0;
  let areaLightCount = 0;
  let overBudget = false;
  let lastViewMatrixSource = "none";
  let lastRefusal = "";

  function recordRefusal(reason) {
    lastRefusal = reason;
    llQa.addError("LL-F6: " + reason, { phase: PHASE_ID, patch: AREA_SPECULAR_BRDF_PATCH_ID });
    if (logger) logger.warn("[Luzes locais] LL-F6 recusou: " + reason);
  }


  function isPhaseActive(context) {
    const frame = context && typeof context === "object" ? context : {};
    if (!isLocalLightTechnology(frame.technology)) return false;
    if (isLocalLightBaselineFrozen(frame.tier)) return false;
    return isLocalLightFlagActive(AREA_SPECULAR_FLAG_ID, frame.tier);
  }


  registry.registerShaderPatch({
    id: AREA_SPECULAR_BRDF_PATCH_ID,
    phase: PHASE_ID,
    anchor: RE_DIRECT_PHYSICAL_ANCHOR,
    order: AREA_SPECULAR_BRDF_PATCH_ORDER,


    isActive: (context) => isPhaseActive(context),
    apply: (context) => {
      const brdfAnchor = context.checkAnchor(PHYSICAL_PARS_CHUNK_NAME, RE_DIRECT_PHYSICAL_ANCHOR);
      if (!brdfAnchor.found) {


        declarationsPublished = false;
        return false;
      }

      let injected = false;
      const applied = context.patchChunk("fragment", PHYSICAL_PARS_CHUNK_NAME, (chunkSource) => {
        const rewritten = injectAreaSpecularIntoPhysicalChunk(chunkSource);


        if (rewritten === null) return chunkSource;
        injected = true;
        return rewritten;
      });

      declarationsPublished = applied || context.contains("fragment", AREA_LIGHT_BEGIN_FUNCTION);
      if (!declarationsPublished) {
        recordRefusal("RE_Direct_Physical did not accept the area specular reroute");
        return false;
      }
      if (injected) appliedShaderCount++;
      lastRefusal = "";
      return applied;
    },
  });


  registry.registerShaderPatch({
    id: AREA_SPECULAR_STATE_PATCH_ID,
    phase: PHASE_ID,
    anchor: POINT_LIGHT_INFO_ANCHOR,
    order: AREA_SPECULAR_STATE_PATCH_ORDER,
    isActive: (context) => isPhaseActive(context),
    apply: (context) => {


      if (!context.contains("fragment", AREA_LIGHT_BEGIN_FUNCTION)) return false;
      const loopAnchor = context.checkAnchor(LIGHT_LOOP_CHUNK_NAME, POINT_LIGHT_INFO_ANCHOR);
      if (!loopAnchor.found) {
        recordRefusal(loopAnchor.reason);
        return false;
      }
      return context.patchChunk("fragment", LIGHT_LOOP_CHUNK_NAME, (chunkSource) => {
        const rewritten = injectAreaLightStateIntoLightLoops(chunkSource);
        return rewritten === null ? chunkSource : rewritten;
      });
    },
  });


  function readViewMatrixElements(camera) {
    if (!camera || !camera.matrixWorldInverse) return null;


    if (
      camera.parent === null &&
      camera.matrixWorldAutoUpdate !== false &&
      typeof camera.updateMatrixWorld === "function"
    ) {
      camera.updateMatrixWorld();
      lastViewMatrixSource = "camera-updated";
    } else {
      lastViewMatrixSource = "camera-parented";
    }
    return camera.matrixWorldInverse.elements;
  }


  function resizeTables(lightCount) {
    if (shapeUniformSlot.value.length === lightCount * 4) return;
    registry.setUniformValue(AREA_LIGHT_SHAPE_UNIFORM, createAreaLightBuffer(lightCount));
    registry.setUniformValue(AREA_LIGHT_AXIS_UNIFORM, createAreaLightBuffer(lightCount));


    neutralTableGate.invalidate(NEUTRAL_GATE_INVALIDATION.TABLES_RESIZED);
  }

  const phase = {
    phaseId: PHASE_ID,
    flagId: AREA_SPECULAR_FLAG_ID,
    patchId: AREA_SPECULAR_BRDF_PATCH_ID,
    statePatchId: AREA_SPECULAR_STATE_PATCH_ID,
    anchor: RE_DIRECT_PHYSICAL_ANCHOR,
    uniformNames: Object.freeze([AREA_LIGHT_SHAPE_UNIFORM, AREA_LIGHT_AXIS_UNIFORM]),
    maxAreaLights: MAX_AREA_LIGHTS,


    setFlag(value) {
      return setLocalLightFlagOverride(AREA_SPECULAR_FLAG_ID, value);
    },

    isActive(context) {
      return isPhaseActive(context);
    },


    beginFrame() {
      shapeByLight.clear();
      return this;
    },


    collectAreaLight(light, authored, context) {
      if (!light || !isPhaseActive(context)) return false;
      const source = authored && typeof authored === "object" ? authored : {};
      const sourceRadius = Math.max(Number(source.SourceRadius) || 0, 0);
      const sourceLength = Math.max(Number(source.SourceLength) || 0, 0);


      if (sourceRadius <= 0 && sourceLength <= 0) return false;
      const specularScale = Number.isFinite(Number(source.SpecularScale)) ? Number(source.SpecularScale) : 1;
      shapeByLight.set(light, {
        sourceRadius,
        halfSourceLength: sourceLength / 2,
        specularScale,
        enabled: true,
      });
      return true;
    },














    syncAreaLightTable(scene, camera, context) {
      const frame = context && typeof context === "object" ? context : {};

      if (!scene) {
        localLightCount = 0;
        areaLightCount = 0;
        overBudget = false;
        resizeTables(0);
        return { localLights: 0, areaLights: 0, overBudget: false, reason: "no-scene" };
      }


      const collected = localLightsInRenderOrder(scene);
      const ordered = orderedLightBuffer.fill(collected.pointLights, collected.spotLights);

      localLightCount = ordered.length;


      resizeTables(localLightCount);

      overBudget = localLightCount > MAX_AREA_LIGHTS;
      const phaseActive = isPhaseActive(frame);
      const viewMatrixElements = readViewMatrixElements(camera);
      const shapeTable = shapeUniformSlot.value;
      const axisTable = axisUniformSlot.value;


      const publishShapes =
        phaseActive && !overBudget && declarationsPublished && viewMatrixElements !== null && localLightCount > 0;

      areaLightCount = 0;


      const skippedNeutralWrite = !publishShapes && neutralTableGate.trySkipNeutralWrite(localLightCount);

      if (!skippedNeutralWrite) {
        for (let slotIndex = 0; slotIndex !== localLightCount; slotIndex++) {
          const light = ordered[slotIndex];
          const shape = publishShapes ? shapeByLight.get(light) : null;
          if (!shape) {
            writeAreaLightShape(shapeTable, slotIndex, {
              sourceRadius: 0,
              halfSourceLength: 0,
              specularScale: 1,
              enabled: false,
            });
            writeAreaLightAxis(axisTable, slotIndex, [0, 1, 0]);
            continue;
          }
          areaLightCount++;
          writeAreaLightShape(shapeTable, slotIndex, shape);


          if (typeof light.updateWorldMatrix === "function") light.updateWorldMatrix(true, false);
          const worldAxis = readMatrixAxisY(light.matrixWorld.elements);
          writeAreaLightAxis(axisTable, slotIndex, transformDirectionByMatrix(worldAxis, viewMatrixElements));
        }


        if (areaLightCount === 0) neutralTableGate.markNeutralPublished(localLightCount);
        else neutralTableGate.invalidate(NEUTRAL_GATE_INVALIDATION.SHAPED_SLOTS_PUBLISHED);
      }

      const reason = publishShapes
        ? ""
        : !phaseActive
          ? "phase-off"
          : overBudget
            ? "over-budget"
            : !declarationsPublished
              ? "declarations-missing"
              : viewMatrixElements === null
                ? "no-camera"
                : "no-local-light";

      llQa.setPhase(PHASE_ID, {
        localLights: localLightCount,
        areaLights: areaLightCount,
        maxAreaLights: MAX_AREA_LIGHTS,
        overBudget,
        declarationsPublished,
        viewMatrixSource: lastViewMatrixSource,
        reason,
        neutralWriteSkipped: skippedNeutralWrite,
      });

      return { localLights: localLightCount, areaLights: areaLightCount, overBudget, reason };
    },


    table() {
      const rows = [];
      const shapeTable = shapeUniformSlot.value;
      const axisTable = axisUniformSlot.value;
      for (let slotIndex = 0; slotIndex !== localLightCount; slotIndex++) {
        const offset = slotIndex * 4;
        rows.push({
          sourceRadius: shapeTable[offset],
          halfSourceLength: shapeTable[offset + 1],
          specularScale: shapeTable[offset + 2],
          enabled: shapeTable[offset + 3] > 0.5,
          axisView: [axisTable[offset], axisTable[offset + 1], axisTable[offset + 2]],
        });
      }
      return rows;
    },

    appliedCount() {
      return appliedShaderCount;
    },

    areaCount() {
      return areaLightCount;
    },

    resetCounters() {
      appliedShaderCount = 0;
      areaLightCount = 0;
      return { patchedShaders: 0, areaLights: 0 };
    },


    status(context) {
      const frame = context && typeof context === "object" ? context : {};
      const flagDecision = resolveLocalLightFlag(AREA_SPECULAR_FLAG_ID, { tier: frame.tier });
      const baselineFrozen = isLocalLightBaselineFrozen(frame.tier);
      const technologyAllowed = isLocalLightTechnology(frame.technology);
      const brdfAnchor = registry.checkAnchor(PHYSICAL_PARS_CHUNK_NAME, RE_DIRECT_PHYSICAL_ANCHOR);
      const loopAnchor = registry.checkAnchor(LIGHT_LOOP_CHUNK_NAME, POINT_LIGHT_INFO_ANCHOR);
      return {
        phase: PHASE_ID,
        flag: AREA_SPECULAR_FLAG_ID,
        tier: frame.tier || null,
        technologyAllowed,
        flagOn: flagDecision.active,
        flagToken: flagDecision.token,
        flagSource: flagDecision.source,
        baselineFrozen,
        active: isPhaseActive(frame),
        chunks: [PHYSICAL_PARS_CHUNK_NAME, LIGHT_LOOP_CHUNK_NAME],
        anchor: brdfAnchor.found ? "ok" : brdfAnchor.reason,
        lightLoopAnchor: loopAnchor.found ? "ok" : loopAnchor.reason,
        declarationsPublished,
        patchedShaders: appliedShaderCount,
        localLights: localLightCount,
        areaLights: areaLightCount,
        maxAreaLights: MAX_AREA_LIGHTS,
        overBudget,
        viewMatrixSource: lastViewMatrixSource,
        refusal: lastRefusal,
        pending: !technologyAllowed
          ? "Technology outside ShadowMap / Future keeps the legacy punctual highlight byte for byte"
          : baselineFrozen
            ? "LlBaseline is freezing the legacy path: release it for the phase to enter"
            : "The Phong pools keep the legacy specular (no BRDF_GGX to reshape): material parity is LL-F8. The sphere lands 9-12% below the reference integration, a declared error of the published normalization.",
      };
    },
  };

  llQa.setPhase(PHASE_ID, {
    registered: true,
    flag: AREA_SPECULAR_FLAG_ID,
    patch: AREA_SPECULAR_BRDF_PATCH_ID,
    statePatch: AREA_SPECULAR_STATE_PATCH_ID,
    anchor: RE_DIRECT_PHYSICAL_ANCHOR,
    chunks: [PHYSICAL_PARS_CHUNK_NAME, LIGHT_LOOP_CHUNK_NAME],
    uniforms: phase.uniformNames,
    maxAreaLights: MAX_AREA_LIGHTS,
    textureUnits: 0,
  });

  return phase;
}
