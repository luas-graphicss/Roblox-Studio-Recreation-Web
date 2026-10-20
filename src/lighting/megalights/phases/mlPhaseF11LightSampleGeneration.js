import { registerPass } from "../mlPassGraph.js";
import { registerFlag, isFlagActive } from "../runtime/megaLightsFlagRegistry.js";
import { registerPatch } from "../runtime/megaLightsPatchRegistry.js";
import { mlQa } from "../runtime/megaLightsTelemetry.js";
import { createLightSampleGenerationPass } from "../mlLightSampleGenerationGlue.js";
import {
  LIGHT_SAMPLE_GENERATION_FLAG_DEFAULTS,
  LIGHT_SAMPLE_GENERATION_FLAG_ID,
  LIGHT_SAMPLE_GENERATION_PASS_NAME,
  LIGHT_SAMPLE_GENERATION_REFUSAL_CODES,
  LIGHT_SAMPLE_GLSL_FLAG_DEFAULTS,
  LIGHT_SAMPLE_GLSL_FLAG_ID,
  candidateEvaluationCeiling,
  samplesPerPixelForTier,
} from "../mlLightSampleGenerationCore.js";
import {
  LIGHT_SAMPLE_GLSL_CONSUMER,
  LIGHT_SAMPLE_UNIFORM_NAMES,
  lightSampleGenerationGlslSource,
} from "../mlLightSampleGlsl.js";


import * as pipelineContract from "../mlPipelineContract.js";

export const PHASE_ID = "ML-F11";
export const TEXTURE_UNIT_KEY = "ML-F11:lightSamples";
export const LIGHT_SAMPLE_PATCH_ID = "ml-f11-light-sample-generation";
export const LIGHT_SAMPLE_PATCH_ANCHOR = "common";

const TIER_NAMES = Object.freeze(["fraco", "medio", "forte"]);

function samplesPerPixelByTier() {
  const samplesByTier = {};
  TIER_NAMES.forEach((tierName) => {
    samplesByTier[tierName] = samplesPerPixelForTier(tierName);
  });
  return samplesByTier;
}

function patchOrderForThisPhase() {
  const declaredOrder = Number((pipelineContract.MGL_PATCH_ORDER || {})[PHASE_ID]);


  return Number.isFinite(declaredOrder) ? declaredOrder : null;
}

export async function installPhase(installContext) {
  const context = installContext || {};
  const telemetry = context.mlQa || mlQa;

  registerFlag({
    id: LIGHT_SAMPLE_GENERATION_FLAG_ID,
    phase: PHASE_ID,
    description: "draws up to N lights per pixel with weighted reservoir sampling and feeds the guiding list",

    defaultsByTier: LIGHT_SAMPLE_GENERATION_FLAG_DEFAULTS,
  });

  registerFlag({
    id: LIGHT_SAMPLE_GLSL_FLAG_ID,
    phase: PHASE_ID,
    description: "injects the sample buffer reader into the fragment shader (consumer is ML-F18)",

    defaultsByTier: LIGHT_SAMPLE_GLSL_FLAG_DEFAULTS,
  });

  if (!context.THREE) {
    const reason = "install context is missing THREE, so the sample buffer cannot be allocated";
    telemetry.error(reason, PHASE_ID + ".installPhase");
    telemetry.phase(PHASE_ID, { implemented: false, reason });
    return { implemented: false, reason };
  }

  const lightSampleGenerationPass = createLightSampleGenerationPass({
    THREE: context.THREE,
    telemetry,
  });

  registerPass(LIGHT_SAMPLE_GENERATION_PASS_NAME, {
    owner: PHASE_ID,
    isEnabled(frameContext) {
      return isFlagActive(LIGHT_SAMPLE_GENERATION_FLAG_ID, (frameContext && frameContext.tier) || "medio");
    },
    execute(frameContext) {


      lightSampleGenerationPass.execute(frameContext);
      return frameContext;
    },
  });

  const patchOrder = patchOrderForThisPhase();
  let patchRegistered = false;
  if (patchOrder === null) {
    telemetry.error(
      "MGL_PATCH_ORDER has no slot for " + PHASE_ID + ", so no GLSL was injected",
      PHASE_ID + ".installPhase",
    );
  } else {
    registerPatch({
      id: LIGHT_SAMPLE_PATCH_ID,
      phase: PHASE_ID,
      anchor: LIGHT_SAMPLE_PATCH_ANCHOR,
      order: patchOrder,
      materialPaths: null,
      isActive(patchContext) {
        const tier = patchContext && patchContext.tier ? patchContext.tier : null;
        return isFlagActive(LIGHT_SAMPLE_GLSL_FLAG_ID, tier);
      },
      apply(patchContext) {


        return patchContext.insertBeforeChunk(
          "fragment",
          LIGHT_SAMPLE_PATCH_ANCHOR,
          lightSampleGenerationGlslSource(),
        );
      },
    });
    patchRegistered = true;
  }

  const reservedTextureUnits = pipelineContract.MGL_TEXTURE_UNITS_RESERVED || {};
  const declaredTextureUnits = Number(reservedTextureUnits[TEXTURE_UNIT_KEY]) || 1;
  telemetry.textureUnit(TEXTURE_UNIT_KEY, declaredTextureUnits);

  const inspection = lightSampleGenerationPass.inspect();
  telemetry.phase(PHASE_ID, {
    implemented: true,
    title: "Light sample generation",
    block: "C",
    ownsPass: LIGHT_SAMPLE_GENERATION_PASS_NAME,
    flag: LIGHT_SAMPLE_GENERATION_FLAG_ID,
    glslFlag: LIGHT_SAMPLE_GLSL_FLAG_ID,
    glslFlagDefault: "off on every tier until " + LIGHT_SAMPLE_GLSL_CONSUMER + " calls the reader",
    samplesPerPixelByTier: samplesPerPixelByTier(),
    maxSamplesPerPixel: pipelineContract.MGL_MAX_SAMPLES_PER_PIXEL,
    candidateEvaluationCeilingOnStrongTier: candidateEvaluationCeiling(samplesPerPixelForTier("forte")),
    hiddenLightSampleFraction: pipelineContract.MGL_HIDDEN_LIGHT_SAMPLE_FRACTION,
    refuses: LIGHT_SAMPLE_GENERATION_REFUSAL_CODES,
    registersGlslPatch: patchRegistered,
    patch: patchRegistered ? LIGHT_SAMPLE_PATCH_ID : null,
    anchor: LIGHT_SAMPLE_PATCH_ANCHOR,
    patchOrder,
    uniforms: [LIGHT_SAMPLE_UNIFORM_NAMES.sampleTexture, LIGHT_SAMPLE_UNIFORM_NAMES.samplesPerPixel],


    uniformBinding: "per frame, from frameContext.lightSamples.uniformValues",
    textureUnitsDeclared: declaredTextureUnits,
    textureUnitsUsedInLitShader: 0,
    feedsGuidingList: "frameContext.lightSampleObservations (closes the ML-F9 loop)",
    residues: inspection.residues,
    note: "pass and patch registered; the shader side waits for " + LIGHT_SAMPLE_GLSL_CONSUMER,
  });


  if (typeof window !== "undefined" && window.__mlLab) {
    window.__mlLab.lightSampleGeneration = lightSampleGenerationPass;
  }

  return { implemented: true, lightSampleGeneration: lightSampleGenerationPass };
}
