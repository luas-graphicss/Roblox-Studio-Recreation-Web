import { registerPass } from "../mlPassGraph.js";
import { registerFlag, isFlagActive } from "../runtime/megaLightsFlagRegistry.js";
import { mlQa } from "../runtime/megaLightsTelemetry.js";
import { createVisibleLightListPass, VISIBLE_LIGHT_LIST_RESIDUES } from "../mlVisibleLightListGlue.js";
import {
  VISIBLE_LIGHT_LIST_GATES,
  VISIBLE_LIGHT_LIST_PASS_NAME,
  VISIBLE_LIGHT_LIST_REFUSAL_CODE,
} from "../mlVisibleLightListCore.js";
import { VISIBLE_LIGHT_LIST_GLSL_CONSUMER } from "../mlVisibleLightListGlsl.js";


import * as pipelineContract from "../mlPipelineContract.js";

export const PHASE_ID = "ML-F9";
export const VISIBLE_LIGHT_LIST_FLAG_ID = "MegaLightsVisibleLightList";
export const TEXTURE_UNIT_KEY = "ML-F9:visibleLightList";

export async function installPhase(installContext) {
  const context = installContext || {};
  const telemetry = context.mlQa || mlQa;
  const bench = context.bench || null;

  registerFlag({
    id: VISIBLE_LIGHT_LIST_FLAG_ID,
    phase: PHASE_ID,
    description: "builds the per tile list of contributing lights and guides the sampling with it",

    defaultsByTier: { fraco: false, medio: true, forte: true },
  });

  const visibleLightListPass = createVisibleLightListPass({
    THREE: context.THREE || null,
    renderer: bench ? bench.renderer : null,
    lightRig: context.lightRig || null,
    telemetry,
  });

  registerPass(VISIBLE_LIGHT_LIST_PASS_NAME, {
    owner: PHASE_ID,
    isEnabled(frameContext) {
      return isFlagActive(VISIBLE_LIGHT_LIST_FLAG_ID, (frameContext && frameContext.tier) || "medio");
    },
    execute(frameContext) {
      return visibleLightListPass.execute(frameContext);
    },
  });

  const reservedTextureUnits = pipelineContract.MGL_TEXTURE_UNITS_RESERVED || {};
  const declaredTextureUnits = Number(reservedTextureUnits[TEXTURE_UNIT_KEY]) || 1;
  telemetry.textureUnit(TEXTURE_UNIT_KEY, declaredTextureUnits);

  telemetry.phase(PHASE_ID, {
    implemented: true,
    title: "Visible light list",
    block: "C",
    ownsPass: VISIBLE_LIGHT_LIST_PASS_NAME,
    flag: VISIBLE_LIGHT_LIST_FLAG_ID,
    guidingTileSize: pipelineContract.MGL_GUIDING_TILE_SIZE,
    maxGuidedLightsPerTile: pipelineContract.MGL_MAX_VISIBLE_LIGHTS_PER_TILE,
    refuses: VISIBLE_LIGHT_LIST_REFUSAL_CODE,
    gates: VISIBLE_LIGHT_LIST_GATES,
    residues: VISIBLE_LIGHT_LIST_RESIDUES,
    textureUnitsDeclared: declaredTextureUnits,
    registersGlslPatch: false,
    glslConsumer: VISIBLE_LIGHT_LIST_GLSL_CONSUMER,
    note: "pass registered; the list of frame N is the list frame N + 1 reads",
  });



  if (typeof window !== "undefined" && window.__mlLab) {
    window.__mlLab.visibleLightList = visibleLightListPass;
  }


  return { implemented: true, visibleLightList: visibleLightListPass };
}
