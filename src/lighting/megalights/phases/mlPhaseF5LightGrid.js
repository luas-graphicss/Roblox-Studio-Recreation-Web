import { registerPass } from "../mlPassGraph.js";
import { registerFlag, isFlagActive } from "../runtime/megaLightsFlagRegistry.js";
import { createLightGridPass, LIGHT_GRID_PASS_NAME } from "../mlLightGridGlue.js";
import { describeLightGridGeometry } from "../mlLightGridCore.js";


import * as pipelineContract from "../mlPipelineContract.js";

export const PHASE_ID = "ML-F5";
export const LIGHT_GRID_FLAG_ID = "MegaLightsLightGrid";
export const TEXTURE_UNIT_KEY = "ML-F5:lightGrid";


function hierarchicalDepthSourceFromSceneInputs() {
  if (typeof window === "undefined" || !window.__mlLab) return null;
  const sceneInputs = window.__mlLab.sceneInputs;
  if (!sceneInputs || typeof sceneInputs.readHierarchicalDepthLevel !== "function") return null;
  return {
    levelSizes() {
      const handle = typeof sceneInputs.handle === "function" ? sceneInputs.handle() : null;
      const pyramid = handle && handle.hierarchicalDepth;
      if (!pyramid || typeof pyramid.levelSize !== "function") return [];
      const sizes = [];
      for (let levelIndex = 0; levelIndex < (pyramid.levelCount || 0); levelIndex++) {
        sizes.push(pyramid.levelSize(levelIndex));
      }
      return sizes;
    },
    readLevel(levelIndex) {
      return sceneInputs.readHierarchicalDepthLevel(levelIndex);
    },
  };
}

export function installPhase(installContext) {
  const context = installContext || {};
  const telemetry = context.mlQa;
  const bench = context.bench || null;

  registerFlag({
    id: LIGHT_GRID_FLAG_ID,
    phase: PHASE_ID,
    description: "builds the two-pass froxel light grid with packed lists and HZB cell culling",


    defaultsByTier: { fraco: false, medio: true, forte: true },
  });

  if (!context.THREE) {
    const reason = "install context is missing THREE";
    if (telemetry) {
      telemetry.error(reason, PHASE_ID + ".installPhase");
      telemetry.phase(PHASE_ID, { implemented: false, reason });
    }
    return { implemented: false, reason };
  }

  const lightGridPass = createLightGridPass({
    THREE: context.THREE,
    renderer: bench ? bench.renderer : null,
    scene: bench ? bench.scene : null,
    hierarchicalDepth: hierarchicalDepthSourceFromSceneInputs(),
    telemetry,
  });

  registerPass(LIGHT_GRID_PASS_NAME, {
    owner: PHASE_ID,
    isEnabled(frameContext) {
      return isFlagActive(LIGHT_GRID_FLAG_ID, (frameContext && frameContext.tier) || "medio");
    },
    execute(frameContext) {
      return lightGridPass.execute(frameContext);
    },
  });

  const reservedTextureUnits = pipelineContract.MGL_TEXTURE_UNITS_RESERVED || {};
  const declaredTextureUnits = Number(reservedTextureUnits[TEXTURE_UNIT_KEY]) || 1;
  if (telemetry) telemetry.textureUnit(TEXTURE_UNIT_KEY, declaredTextureUnits);

  const geometry = describeLightGridGeometry();
  if (telemetry) {
    telemetry.phase(PHASE_ID, {
      implemented: true,
      title: "Light grid",
      block: "B",
      ownsPass: LIGHT_GRID_PASS_NAME,
      flag: LIGHT_GRID_FLAG_ID,
      cellCount: geometry.cellCount,
      coarseCellCount: geometry.coarseCellCount,

      textureUnitsDeclared: declaredTextureUnits,
      registersGlslPatch: false,
      engineClusterSource: geometry.engineClusterSource.file,
      note: "pass registered; the grid is built only while the flag is on",
    });
  }


  if (typeof window !== "undefined" && window.__mlLab) {
    window.__mlLab.lightGrid = lightGridPass;
  }

  return { implemented: true, lightGrid: lightGridPass };
}
