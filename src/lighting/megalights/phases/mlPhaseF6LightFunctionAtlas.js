import { registerPass } from "../mlPassGraph.js";
import { registerFlag, isFlagActive } from "../runtime/megaLightsFlagRegistry.js";
import { mlQa } from "../runtime/megaLightsTelemetry.js";
import { createLightFunctionAtlasPass } from "../mlLightFunctionAtlasGlue.js";
import { LIGHT_FUNCTION_CONTENT_SLOT_CAPACITY, describeAtlasGeometry } from "../mlLightFunctionAtlasCore.js";


import * as pipelineContract from "../mlPipelineContract.js";

export const PHASE_ID = "ML-F6";
export const LIGHT_FUNCTION_ATLAS_PASS_NAME = "lightFunctionAtlas";
export const LIGHT_FUNCTION_ATLAS_FLAG_ID = "MegaLightsLightFunctionAtlas";
export const TEXTURE_UNIT_KEY = "ML-F6:lightFunctionAtlas";


export const CONTENT_SLOT_BUDGET_BY_TIER = Object.freeze({
  fraco: 16,
  medio: LIGHT_FUNCTION_CONTENT_SLOT_CAPACITY,
  forte: LIGHT_FUNCTION_CONTENT_SLOT_CAPACITY,
});

export async function installPhase(installContext) {
  const context = installContext || {};
  const telemetry = context.mlQa || mlQa;

  registerFlag({
    id: LIGHT_FUNCTION_ATLAS_FLAG_ID,
    phase: PHASE_ID,
    description: "packs IES profiles, cookies and rect textures into one atlas sampled with a single texture unit",


    defaultsByTier: { fraco: false, medio: true, forte: true },
  });

  if (!context.THREE) {
    const reason = "install context is missing THREE";
    telemetry.error(reason, PHASE_ID + ".installPhase");
    telemetry.phase(PHASE_ID, { implemented: false, reason });
    return { implemented: false, reason };
  }

  const lightFunctionAtlasPass = createLightFunctionAtlasPass({
    THREE: context.THREE,
    telemetry,
    contentSlotBudgetByTier: CONTENT_SLOT_BUDGET_BY_TIER,
  });

  registerPass(LIGHT_FUNCTION_ATLAS_PASS_NAME, {
    owner: PHASE_ID,
    isEnabled(frameContext) {
      return isFlagActive(LIGHT_FUNCTION_ATLAS_FLAG_ID, (frameContext && frameContext.tier) || "medio");
    },
    execute(frameContext) {
      return lightFunctionAtlasPass.execute(frameContext);
    },
  });

  const reservedTextureUnits = pipelineContract.MGL_TEXTURE_UNITS_RESERVED || {};
  const declaredTextureUnits = Number(reservedTextureUnits[TEXTURE_UNIT_KEY]) || 1;
  telemetry.textureUnit(TEXTURE_UNIT_KEY, declaredTextureUnits);

  const geometry = describeAtlasGeometry();
  telemetry.phase(PHASE_ID, {
    implemented: true,
    title: "Light function atlas",
    block: "B",
    ownsPass: LIGHT_FUNCTION_ATLAS_PASS_NAME,
    flag: LIGHT_FUNCTION_ATLAS_FLAG_ID,
    atlasSize: geometry.atlasSize,
    contentSlotCapacity: geometry.contentSlotCapacity,
    safeMipLevelCount: geometry.safeMipLevelCount,

    textureUnitsDeclared: declaredTextureUnits,
    textureUnitsUsedInLitShader: 0,
    registersGlslPatch: false,
    renderPassesPerFrame: 0,
    note: "pass registered; consumers ML-F7 and ML-F18 include the fetch when their patch order comes up",
  });


  if (typeof window !== "undefined" && window.__mlLab) {
    window.__mlLab.lightFunctionAtlas = lightFunctionAtlasPass;
  }

  return { implemented: true, lightFunctionAtlas: lightFunctionAtlasPass };
}
