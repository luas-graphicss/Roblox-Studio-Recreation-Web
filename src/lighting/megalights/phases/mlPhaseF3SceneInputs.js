import { registerPass } from "../mlPassGraph.js";
import { registerFlag, isFlagActive } from "../runtime/megaLightsFlagRegistry.js";
import { createSceneInputsPass } from "../mlSceneInputsGlue.js";
import { SCENE_INPUT_ATTACHMENTS } from "../mlSceneInputsCore.js";


import * as pipelineContract from "../mlPipelineContract.js";

export const PHASE_ID = "ML-F3";
export const SCENE_INPUTS_PASS_NAME = "sceneInputs";
export const SCENE_INPUTS_FLAG_ID = "MegaLightsSceneInputs";
export const TEXTURE_UNIT_KEY = "ML-F3:sceneInputs";

export async function installPhase(installContext) {
  const context = installContext || {};
  const telemetry = context.mlQa;
  const bench = context.bench || null;
  const renderer = bench ? bench.renderer : null;

  registerFlag({
    id: SCENE_INPUTS_FLAG_ID,
    phase: PHASE_ID,
    description: "fills the four G-buffer attachments and builds the min/max depth pyramid",


    defaultsByTier: { fraco: false, medio: true, forte: true },
  });

  const missingDependencies = [];
  if (!renderer) missingDependencies.push("bench.renderer");
  if (!context.THREE) missingDependencies.push("THREE");
  if (!context.gBuffer) missingDependencies.push("gBuffer");
  if (missingDependencies.length > 0) {
    const reason = "install context is missing " + missingDependencies.join(", ");
    if (telemetry) {
      telemetry.error(reason, PHASE_ID + ".installPhase");
      telemetry.phase(PHASE_ID, { implemented: false, reason });
    }
    return { implemented: false, reason };
  }

  const sceneInputsPass = createSceneInputsPass({
    THREE: context.THREE,
    renderer,
    gBuffer: context.gBuffer,
    telemetry,
  });

  registerPass(SCENE_INPUTS_PASS_NAME, {
    owner: PHASE_ID,
    isEnabled(frameContext) {
      return isFlagActive(SCENE_INPUTS_FLAG_ID, (frameContext && frameContext.tier) || "medio");
    },
    execute(frameContext) {
      return sceneInputsPass.execute(frameContext);
    },
  });

  const reservedTextureUnits = pipelineContract.MGL_TEXTURE_UNITS_RESERVED || {};
  const declaredTextureUnits = Number(reservedTextureUnits[TEXTURE_UNIT_KEY]) || 3;
  telemetry.textureUnit(TEXTURE_UNIT_KEY, declaredTextureUnits);

  telemetry.phase(PHASE_ID, {
    implemented: true,
    title: "Scene inputs / G-buffer",
    block: "A",
    ownsPass: SCENE_INPUTS_PASS_NAME,
    flag: SCENE_INPUTS_FLAG_ID,
    attachments: SCENE_INPUT_ATTACHMENTS.map((attachment) => attachment.name),


    textureUnitsDeclared: declaredTextureUnits,
    textureUnitsUsedInLitShader: 0,
    registersGlslPatch: false,
    note: "pass registered; flag OFF on the weak tier means no extra draw at all",
  });


  if (typeof window !== "undefined" && window.__mlLab) {
    window.__mlLab.sceneInputs = sceneInputsPass;
  }


  return { implemented: true, sceneInputs: sceneInputsPass };
}
