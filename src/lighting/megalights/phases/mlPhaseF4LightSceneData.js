import * as pipelineContract from "../mlPipelineContract.js";
import { registerFlag, isFlagActive } from "../runtime/megaLightsFlagRegistry.js";
import { registerPass } from "../mlPassGraph.js";
import { createLightSceneDataPass } from "../mlLightSceneGlue.js";

export const PHASE_ID = "ML-F4";
export const LIGHT_SCENE_DATA_PASS_NAME = "lightSceneData";
export const LIGHT_SCENE_DATA_FLAG_ID = "MegaLightsLightSceneData";

export const TEXTURE_UNIT_KEY = "ML-F4:packedLights";
export const TEXTURE_UNIT_COUNT = 1;

const DEFAULT_TIER = "medio";

function missingDependenciesOf(installContext) {
  const missing = [];
  if (!installContext || typeof installContext !== "object") return ["installContext"];
  if (!installContext.THREE) missing.push("THREE");
  if (!installContext.bench) missing.push("bench");
  return missing;
}


export async function installPhase(installContext) {
  const missingDependencies = missingDependenciesOf(installContext);
  if (missingDependencies.length > 0) {
    return {
      implemented: false,
      phase: PHASE_ID,
      reason: "missing install context: " + missingDependencies.join(", "),
    };
  }

  const telemetry = installContext.mlQa || null;

  registerFlag({
    id: LIGHT_SCENE_DATA_FLAG_ID,
    phase: PHASE_ID,
    description: "ML-F4: packs every local light into an rgba32f data texture (4 texels per light).",


    defaultsByTier: { fraco: false, medio: true, forte: true },
  });

  const pass = createLightSceneDataPass({
    THREE: installContext.THREE,
    bench: installContext.bench,
    lightRig: installContext.lightRig || null,
    telemetry,
  });

  registerPass(LIGHT_SCENE_DATA_PASS_NAME, {
    owner: PHASE_ID,
    isEnabled(frameContext) {
      const tier = (frameContext && frameContext.tier) || DEFAULT_TIER;
      return isFlagActive(LIGHT_SCENE_DATA_FLAG_ID, tier);
    },
    execute(frameContext) {
      return pass.execute(frameContext);
    },
  });

  if (telemetry && typeof telemetry.textureUnit === "function") {
    telemetry.textureUnit(TEXTURE_UNIT_KEY, TEXTURE_UNIT_COUNT);
  }
  if (telemetry && typeof telemetry.phase === "function") {
    telemetry.phase(PHASE_ID, {
      pass: LIGHT_SCENE_DATA_PASS_NAME,
      flag: LIGHT_SCENE_DATA_FLAG_ID,
      installed: true,
      texelsPerLight: pipelineContract.MGL_LIGHT_TEXELS_PER_LIGHT,
      buffer: "packedLights rgba32f",
      glslPatches: 0,
    });
  }


  if (typeof window !== "undefined") {
    window.__mlLightSceneData = pass;
    if (window.__mlLab) window.__mlLab.lightSceneData = pass;
  }


  return {
    implemented: true,
    phase: PHASE_ID,
    pass: LIGHT_SCENE_DATA_PASS_NAME,
    flag: LIGHT_SCENE_DATA_FLAG_ID,
    textureUnits: TEXTURE_UNIT_COUNT,
    inspect() {
      return pass.inspect();
    },
  };
}
