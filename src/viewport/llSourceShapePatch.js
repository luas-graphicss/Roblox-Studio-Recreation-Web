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
  SHAPED_LIGHT_COUNT_UNIFORM,
  SHAPE_CENTER_VIEW_UNIFORM,
  SHAPE_HALF_AXIS_VIEW_UNIFORM,
  SHAPE_RADIUS_UNIFORM,
  SOURCE_SHAPE_FLAG_ID,
  SOURCE_SHAPE_PATCH_ID,
  SOURCE_SHAPE_PHASE_ID,
} from "../lighting/llSourceShapeContract.js";
import {
  POINT_LIGHT_INFO_ANCHOR,
  SHADING_NORMAL_PUBLISH_GLSL,
  SOURCE_SHAPE_FRAGMENT_CHUNK_NAME,
  SOURCE_SHAPE_PARS_CHUNK_NAME,
  SPOT_LIGHT_INFO_ANCHOR,
  injectShadingNormalPublish,
  injectSourceShapeIntoLightsPars,
  preludeDeclaresEveryUniform,
} from "../lighting/llSourceShapeGlsl.js";
import { LL_MAX_SHAPED_LIGHTS, hasSourceShape } from "../lighting/llSourceShapeCore.js";
import {
  readSourceShapeProperties,
  selectShapedLights,
  shapedLightBudgetForTier,
  writeViewSpaceTable,
} from "../lighting/llShapedLightTableCore.js";

export const PHASE_ID = SOURCE_SHAPE_PHASE_ID;
export const SOURCE_SHAPE_ANCHOR = POINT_LIGHT_INFO_ANCHOR;
export const SOURCE_SHAPE_PATCH_ORDER = 40;


export const SHADING_NORMAL_ANCHOR_TEXT = "geometryClearcoatNormal";


registerLocalLightFlag({
  id: SOURCE_SHAPE_FLAG_ID,
  phase: PHASE_ID,
  description:
    "source shape UE: sphere / capsule of SourceRadius + SoftSourceRadius + SourceLength reshapes the DIFFUSE direction of point and spot lights",
  defaultsByTier: { fraco: false, medio: true, forte: true },
});


export function registerLocalLightSourceShapePhase(options) {
  const settings = options && typeof options === "object" ? options : {};
  const registry = settings.registry;
  if (!registry || typeof registry.registerShaderPatch !== "function") {
    throw new Error("LL-F4: a local-light patch registry is required");
  }
  const logger = settings.logger && typeof settings.logger.warn === "function" ? settings.logger : null;


  const centerViewArray = new Float32Array(LL_MAX_SHAPED_LIGHTS * 3);
  const halfAxisViewArray = new Float32Array(LL_MAX_SHAPED_LIGHTS * 3);
  const radiusArray = new Float32Array(LL_MAX_SHAPED_LIGHTS);

  registry.registerUniform(SHAPED_LIGHT_COUNT_UNIFORM, 0);
  registry.registerUniform(SHAPE_CENTER_VIEW_UNIFORM, centerViewArray);
  registry.registerUniform(SHAPE_HALF_AXIS_VIEW_UNIFORM, halfAxisViewArray);
  registry.registerUniform(SHAPE_RADIUS_UNIFORM, radiusArray);



  llQa.setTextureUnits(PHASE_ID, 0);


  const collectedLights = [];

  const candidateRows = [];

  let appliedShaderCount = 0;
  let shadingNormalPublished = false;
  let shapedLightCount = 0;
  let skippedByBudgetCount = 0;
  let lastSelectionSignature = "";
  let lastViewMatrixSource = "none";
  let lastRefusal = "";

  function recordRefusal(reason) {
    lastRefusal = reason;
    llQa.addError("LL-F4: " + reason, { phase: PHASE_ID, patch: SOURCE_SHAPE_PATCH_ID });
    if (logger) logger.warn("[Luzes locais] LL-F4 recusou: " + reason);
  }





  function isPhaseActive(context) {
    const frame = context && typeof context === "object" ? context : {};
    if (!isLocalLightTechnology(frame.technology)) return false;
    if (isLocalLightBaselineFrozen(frame.tier)) return false;
    return isLocalLightFlagActive(SOURCE_SHAPE_FLAG_ID, frame.tier);
  }

  registry.registerShaderPatch({
    id: SOURCE_SHAPE_PATCH_ID,
    phase: PHASE_ID,
    anchor: SOURCE_SHAPE_ANCHOR,
    order: SOURCE_SHAPE_PATCH_ORDER,


    isActive: (context) => isPhaseActive(context),
    apply: (context) => {

      const pointAnchor = context.checkAnchor(SOURCE_SHAPE_PARS_CHUNK_NAME, POINT_LIGHT_INFO_ANCHOR);
      if (!pointAnchor.found) {
        recordRefusal(pointAnchor.reason);
        return false;
      }
      const spotAnchor = context.checkAnchor(SOURCE_SHAPE_PARS_CHUNK_NAME, SPOT_LIGHT_INFO_ANCHOR);
      if (!spotAnchor.found) {
        recordRefusal(spotAnchor.reason);
        return false;
      }
      const normalAnchor = context.checkAnchor(SOURCE_SHAPE_FRAGMENT_CHUNK_NAME, SHADING_NORMAL_ANCHOR_TEXT);
      if (!normalAnchor.found) {
        recordRefusal(normalAnchor.reason);
        return false;
      }
      if (!preludeDeclaresEveryUniform()) {
        recordRefusal("prelude does not declare every uniform of the contract");
        return false;
      }


      let parsRefusal = "";
      const parsApplied = context.patchChunk("fragment", SOURCE_SHAPE_PARS_CHUNK_NAME, (chunkSource) => {
        const injection = injectSourceShapeIntoLightsPars(chunkSource);
        if (!injection.replaced) {

          if (injection.reason !== "already-injected") parsRefusal = injection.reason;
          return chunkSource;
        }
        return injection.source;
      });
      if (!parsApplied && parsRefusal) {
        recordRefusal(parsRefusal);
        return false;
      }


      let normalRefusal = "";
      const normalApplied = context.patchChunk("fragment", SOURCE_SHAPE_FRAGMENT_CHUNK_NAME, (chunkSource) => {
        const injection = injectShadingNormalPublish(chunkSource);
        if (!injection.replaced) {
          if (injection.reason !== "already-injected") normalRefusal = injection.reason;
          return chunkSource;
        }
        return injection.source;
      });
      const normalReady = normalApplied || context.contains("fragment", SHADING_NORMAL_PUBLISH_GLSL);
      if (!normalReady) {


        shadingNormalPublished = false;
        registry.setUniformValue(SHAPED_LIGHT_COUNT_UNIFORM, 0);
        recordRefusal(normalRefusal || "shading normal not published: phase kept at count 0");
        return parsApplied;
      }

      shadingNormalPublished = true;
      lastRefusal = "";
      if (parsApplied || normalApplied) appliedShaderCount++;
      return parsApplied || normalApplied;
    },
  });


  function readFreshWorldMatrixElements(light) {
    if (!light || !light.matrixWorld) return null;


    if (typeof light.updateWorldMatrix === "function") light.updateWorldMatrix(true, false);
    return light.matrixWorld.elements;
  }


  function readViewMatrixElements(camera) {
    if (!camera || !camera.matrixWorldInverse) return null;


    if (camera.parent === null && camera.matrixWorldAutoUpdate !== false && typeof camera.updateMatrixWorld === "function") {
      camera.updateMatrixWorld();
      lastViewMatrixSource = "camera-updated";
    } else {
      lastViewMatrixSource = "camera-parented";
    }
    return camera.matrixWorldInverse.elements;
  }

  const phase = {
    phaseId: PHASE_ID,
    flagId: SOURCE_SHAPE_FLAG_ID,
    patchId: SOURCE_SHAPE_PATCH_ID,
    anchor: SOURCE_SHAPE_ANCHOR,
    uniformNames: Object.freeze([
      SHAPED_LIGHT_COUNT_UNIFORM,
      SHAPE_CENTER_VIEW_UNIFORM,
      SHAPE_HALF_AXIS_VIEW_UNIFORM,
      SHAPE_RADIUS_UNIFORM,
    ]),
    maxShapedLights: LL_MAX_SHAPED_LIGHTS,


    setFlag(value) {
      return setLocalLightFlagOverride(SOURCE_SHAPE_FLAG_ID, value);
    },

    isActive(context) {
      return isPhaseActive(context);
    },


    beginFrame() {
      collectedLights.length = 0;
      return this;
    },


    collectShapedLight(light, authored, context, id) {
      if (!light || !isPhaseActive(context)) return false;

      if (!hasSourceShape(readSourceShapeProperties(authored))) return false;
      collectedLights.push({
        id: String(id || light.uuid || collectedLights.length),
        authored: authored,
        light: light,
      });
      return true;
    },


    syncViewSpaceTable(camera, context) {
      const frame = context && typeof context === "object" ? context : {};
      const budget = shapedLightBudgetForTier(frame.tier);


      if (!isPhaseActive(frame) || !shadingNormalPublished || budget === 0 || collectedLights.length === 0) {
        shapedLightCount = 0;
        skippedByBudgetCount = 0;
        lastSelectionSignature = "";
        registry.setUniformValue(SHAPED_LIGHT_COUNT_UNIFORM, 0);
        return {
          count: 0,
          skipped: 0,
          budget: budget,
          reason: !isPhaseActive(frame)
            ? "phase-off"
            : !shadingNormalPublished
              ? "shading-normal-missing"
              : budget === 0
                ? "tier-budget-zero"
                : "no-shaped-light",
        };
      }

      const viewMatrixElements = readViewMatrixElements(camera);
      if (!viewMatrixElements) {
        shapedLightCount = 0;
        registry.setUniformValue(SHAPED_LIGHT_COUNT_UNIFORM, 0);
        return { count: 0, skipped: collectedLights.length, budget: budget, reason: "no-camera" };
      }

      candidateRows.length = 0;
      for (let index = 0; index !== collectedLights.length; index++) {
        const collected = collectedLights[index];
        candidateRows.push({
          id: collected.id,
          authored: collected.authored,
          matrixWorldElements: readFreshWorldMatrixElements(collected.light),
        });
      }

      const selection = selectShapedLights(candidateRows, budget);
      shapedLightCount = writeViewSpaceTable({
        selected: selection.selected,
        cameraMatrixWorldInverseElements: viewMatrixElements,
        centerViewArray: centerViewArray,
        halfAxisViewArray: halfAxisViewArray,
        radiusArray: radiusArray,
      });
      skippedByBudgetCount = selection.skippedCount;
      lastSelectionSignature = selection.signature;
      registry.setUniformValue(SHAPED_LIGHT_COUNT_UNIFORM, shapedLightCount);
      return { count: shapedLightCount, skipped: skippedByBudgetCount, budget: budget, reason: "" };
    },


    table() {
      const rows = [];
      for (let index = 0; index !== shapedLightCount; index++) {
        const slot = index * 3;
        rows.push({
          centerView: [centerViewArray[slot], centerViewArray[slot + 1], centerViewArray[slot + 2]],
          halfAxisView: [halfAxisViewArray[slot], halfAxisViewArray[slot + 1], halfAxisViewArray[slot + 2]],
          radius: radiusArray[index],
        });
      }
      return rows;
    },

    appliedCount() {
      return appliedShaderCount;
    },

    shapedCount() {
      return shapedLightCount;
    },

    resetCounters() {
      appliedShaderCount = 0;
      shapedLightCount = 0;
      skippedByBudgetCount = 0;
      return { patchedShaders: 0, shapedLights: 0 };
    },


    status(context) {
      const frame = context && typeof context === "object" ? context : {};
      const flagDecision = resolveLocalLightFlag(SOURCE_SHAPE_FLAG_ID, { tier: frame.tier });
      const baselineFrozen = isLocalLightBaselineFrozen(frame.tier);
      const technologyAllowed = isLocalLightTechnology(frame.technology);
      const parsAnchor = registry.checkAnchor(SOURCE_SHAPE_PARS_CHUNK_NAME, POINT_LIGHT_INFO_ANCHOR);
      const normalAnchor = registry.checkAnchor(SOURCE_SHAPE_FRAGMENT_CHUNK_NAME, SHADING_NORMAL_ANCHOR_TEXT);
      const status = {
        phase: PHASE_ID,
        flag: SOURCE_SHAPE_FLAG_ID,
        tier: frame.tier || null,
        technologyAllowed,
        flagOn: flagDecision.active,
        flagToken: flagDecision.token,
        flagSource: flagDecision.source,
        baselineFrozen,
        active: isPhaseActive(frame),
        chunks: [SOURCE_SHAPE_PARS_CHUNK_NAME, SOURCE_SHAPE_FRAGMENT_CHUNK_NAME],
        anchor: parsAnchor.found ? "ok" : parsAnchor.reason,
        shadingNormalAnchor: normalAnchor.found ? "ok" : normalAnchor.reason,
        shadingNormalPublished,
        patchedShaders: appliedShaderCount,
        budget: shapedLightBudgetForTier(frame.tier),
        shapedLights: shapedLightCount,
        skippedByBudget: skippedByBudgetCount,
        selection: lastSelectionSignature,
        viewMatrixSource: lastViewMatrixSource,
        refusal: lastRefusal,
        pending: !technologyAllowed
          ? "Technology outside ShadowMap / Future keeps the legacy point light byte for byte"
          : baselineFrozen
            ? "LlBaseline is freezing the legacy path: release it for the phase to enter"
            : "Distance attenuation is still measured at the CENTRE of the capsule (declared residual of the bench); SoftSourceRadius affects the diffuse only",
      };
      llQa.setPhase(PHASE_ID, {
        flagOn: flagDecision.active,
        technologyAllowed,
        baselineFrozen,
        patchedShaders: appliedShaderCount,
        shapedLights: shapedLightCount,
        skippedByBudget: skippedByBudgetCount,
        budget: status.budget,
        anchorOk: parsAnchor.found,
        shadingNormalOk: normalAnchor.found && shadingNormalPublished,
        viewMatrixSource: lastViewMatrixSource,
        refusal: lastRefusal,
      });
      return status;
    },
  };

  llQa.setPhase(PHASE_ID, {
    registered: true,
    flag: SOURCE_SHAPE_FLAG_ID,
    patch: SOURCE_SHAPE_PATCH_ID,
    anchor: SOURCE_SHAPE_ANCHOR,
    chunks: [SOURCE_SHAPE_PARS_CHUNK_NAME, SOURCE_SHAPE_FRAGMENT_CHUNK_NAME],
    uniforms: phase.uniformNames,
    maxShapedLights: LL_MAX_SHAPED_LIGHTS,
    textureUnits: 0,
  });

  return phase;
}
