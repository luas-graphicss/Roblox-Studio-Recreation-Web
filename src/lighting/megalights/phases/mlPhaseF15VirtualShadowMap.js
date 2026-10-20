import { registerPass } from "../mlPassGraph.js";
import { registerFlag, isFlagActive } from "../runtime/megaLightsFlagRegistry.js";
import { createVirtualShadowMapPass, VIRTUAL_SHADOW_MAP_PASS_NAME } from "../mlVsmGlue.js";
import { virtualShadowMapLightLimitFor } from "../mlVsmEligibilityCore.js";
import { describeVirtualShadowMapGlsl } from "../mlVsmSampleGlsl.js";


import * as pipelineContract from "../mlPipelineContract.js";

export const PHASE_ID = "ML-F15";
export const VIRTUAL_SHADOW_MAP_FLAG_ID = "MegaLightsVirtualShadowMap";
export const TEXTURE_UNIT_KEY = "ML-F15:shadowAtlas";

function lightLimitByTier() {
  return {
    fraco: virtualShadowMapLightLimitFor("fraco"),
    medio: virtualShadowMapLightLimitFor("medio"),
    forte: virtualShadowMapLightLimitFor("forte"),
  };
}

export function installPhase(installContext) {
  const context = installContext || {};
  const telemetry = context.mlQa;
  const bench = context.bench || null;

  registerFlag({
    id: VIRTUAL_SHADOW_MAP_FLAG_ID,
    phase: PHASE_ID,
    description: "draws scene depth into the engine shadow atlas and answers visibility from those pages",


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

  const virtualShadowMapPass = createVirtualShadowMapPass({
    THREE: context.THREE,
    renderer: bench ? bench.renderer : null,
    scene: bench ? bench.scene : null,
    camera: bench ? bench.camera : null,
    telemetry,
  });

  registerPass(VIRTUAL_SHADOW_MAP_PASS_NAME, {
    owner: PHASE_ID,
    isEnabled(frameContext) {
      return isFlagActive(VIRTUAL_SHADOW_MAP_FLAG_ID, (frameContext && frameContext.tier) || "medio");
    },
    execute(frameContext) {
      return virtualShadowMapPass.execute(frameContext);
    },
  });

  const reservedTextureUnits = pipelineContract.MGL_TEXTURE_UNITS_RESERVED || {};
  const declaredTextureUnits = Number(reservedTextureUnits[TEXTURE_UNIT_KEY]) || 1;
  if (telemetry) telemetry.textureUnit(TEXTURE_UNIT_KEY, declaredTextureUnits);

  const shaderDescription = describeVirtualShadowMapGlsl();
  if (telemetry) {
    telemetry.phase(PHASE_ID, {
      implemented: true,
      title: "Virtual shadow map path",
      block: "D",
      ownsPass: VIRTUAL_SHADOW_MAP_PASS_NAME,
      flag: VIRTUAL_SHADOW_MAP_FLAG_ID,

      virtualShadowMapLightLimitByTier: lightLimitByTier(),

      textureUnitsDeclared: declaredTextureUnits,
      reusesEngineCore: "engine-src/lighting/shadowAtlasCore.js",
      registersGlslPatch: false,
      glslFunctionNames: shaderDescription.functionNames,
      glslUsesScreenDerivatives: shaderDescription.usesScreenDerivatives,
      note: "pass registered; pages are allocated and drawn only while the flag is on",
    });
  }


  if (typeof window !== "undefined" && window.__mlLab) {
    window.__mlLab.virtualShadowMap = virtualShadowMapPass;
  }

  return { implemented: true, virtualShadowMap: virtualShadowMapPass };
}
