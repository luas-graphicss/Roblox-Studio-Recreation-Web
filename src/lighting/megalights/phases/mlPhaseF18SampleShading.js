import { mlQa } from "../runtime/megaLightsTelemetry.js";
import { isFlagActive, registerFlag } from "../runtime/megaLightsFlagRegistry.js";
import { registerPass } from "../mlPassGraph.js";
import * as pipelineContract from "../mlPipelineContract.js";
import {
  SAMPLE_SHADING_OWNER,
  SAMPLE_SHADING_PASS_NAME,
  createSampleShadingPass,
} from "../mlSampleShadingGlue.js";
import { SAMPLE_SHADING_ACCEPTANCE } from "../mlSampleShadingStatsCore.js";
import { SAMPLE_SHADING_ENFORCED_REFUSALS } from "../mlSampleShadingCore.js";
import { createSampleShadingInputsBridge } from "../mlSampleShadingInputsBridge.js";
import { createDenoiseInputsBridge } from "../mlDenoiseInputsBridge.js";
import { createDenoisedSignalLatch } from "../mlDenoisedSignalLatch.js";
import {
  BASELINE_FLAG_ID,
  COMPOSITION_FLAG_ID,
  createCompositionGlue,
} from "../mlCompositionGlue.js";

export const PHASE_ID = "ML-F18";
export const FLAG_ID = "MegaLightsSampleShading";


export const INPUTS_BRIDGE_FLAG_ID = "MegaLightsSampleShadingInputs";
export { COMPOSITION_FLAG_ID };


const SHARED_LIGHTING_TEXTURE_UNITS = 0;
const DEFAULT_TIER = "medio";
const SAMPLES_PER_PIXEL_WITHOUT_A_TIER = 1;

function reservedPatchOrderOf(phaseId) {
  const patchOrderByPhase = pipelineContract.MGL_PATCH_ORDER || {};
  const order = patchOrderByPhase[phaseId];
  return Number.isFinite(order) ? order : null;
}

export function installPhase(installContext) {
  const context = installContext || {};
  const telemetry = context.mlQa || mlQa;
  const bench = context.bench || null;
  const currentTier = () => (bench && bench.tier ? bench.tier : DEFAULT_TIER);


  function resolveLabMember(memberName) {
    if (bench && bench[memberName]) return bench[memberName];
    if (typeof window !== "undefined" && window.__mlLab && window.__mlLab[memberName]) {
      return window.__mlLab[memberName];
    }
    return null;
  }


  function collectSceneMaterials() {
    const sceneMember = resolveLabMember("scene");
    const scene = typeof sceneMember === "function" ? sceneMember() : sceneMember;
    if (!scene || typeof scene.traverse !== "function") return [];
    const materials = [];
    scene.traverse((object) => {
      const material = object ? object.material : null;
      if (!material) return;
      if (Array.isArray(material)) {
        for (let index = 0; index !== material.length; index += 1) materials.push(material[index]);
        return;
      }
      materials.push(material);
    });
    return materials;
  }


  const tierSamplesPerPixel = () => {
    const defaults =
      typeof pipelineContract.tierDefaults === "function"
        ? pipelineContract.tierDefaults(currentTier())
        : null;
    const budget = Number(defaults && defaults.samplesPerPixel);
    return Number.isFinite(budget) && budget >= 1 ? budget : SAMPLES_PER_PIXEL_WITHOUT_A_TIER;
  };

  registerFlag({
    id: FLAG_ID,
    phase: PHASE_ID,
    description:
      "replaces direct shading with the MegaLights estimate: diffuse and specular written apart, albedo and EnvBRDF factored out of both",
    defaultsByTier: { fraco: false, medio: true, forte: true },
  });

  registerFlag({
    id: INPUTS_BRIDGE_FLAG_ID,
    phase: PHASE_ID,
    description:
      "assembles sampleShadingInputs, and the ML-F19 and ML-F20 bundles, from what ML-F3, ML-F11 and ML-F17 already publish; it reads the G-buffer back to the CPU once per frame, which is why the weak tier never pays for it",
    defaultsByTier: { fraco: false, medio: true, forte: true },
  });

  registerFlag({
    id: COMPOSITION_FLAG_ID,
    phase: PHASE_ID,
    description:
      "injects the composition at patch order 160 and replaces direct lighting with the denoised signal; it refuses to inject unless the frame proves a signal, so a refusal keeps the legacy lighting instead of blackening the screen",
    defaultsByTier: { fraco: false, medio: true, forte: true },
  });

  const pass = createSampleShadingPass({
    telemetry,
    samplesPerPixel: tierSamplesPerPixel,
    THREE: context.THREE || null,
  });

  const inputsBridge = createSampleShadingInputsBridge({
    telemetry,
    resolveAttachmentReader: () => {
      const sceneInputs = resolveLabMember("sceneInputs");
      if (!sceneInputs || typeof sceneInputs.readAttachmentPixels !== "function") return null;
      return (request) => sceneInputs.readAttachmentPixels(request);
    },
    resolveSampleVisibility: (frameContext) => {
      const tracePolicy = resolveLabMember("tracePolicy");
      if (!tracePolicy || typeof tracePolicy.execute !== "function") return null;
      return tracePolicy.execute(frameContext);
    },
  });

  const denoiseInputsBridge = createDenoiseInputsBridge({ telemetry });


  const denoisedSignalLatch = createDenoisedSignalLatch();


  let publishedLatchHasSignal = null;

  const composition = createCompositionGlue({
    telemetry,
    THREE: context.THREE || null,
    resolveMaterials: collectSceneMaterials,
    requiredFlagIds: [FLAG_ID],
  });
  composition.installPatch();

  registerPass(SAMPLE_SHADING_PASS_NAME, {
    owner: SAMPLE_SHADING_OWNER,
    isEnabled: () => isFlagActive(FLAG_ID, currentTier()),
    execute: (frameContext) => {
      const tier = currentTier();


      denoisedSignalLatch.rememberFrame(frameContext);
      const latchHasSignal = denoisedSignalLatch.readSignal() !== null;
      if (latchHasSignal !== publishedLatchHasSignal) {
        publishedLatchHasSignal = latchHasSignal;
        telemetry.phase("ML-F18:signalLatch", denoisedSignalLatch.inspect());
      }


      const shadingFrame = isFlagActive(INPUTS_BRIDGE_FLAG_ID, tier)
        ? inputsBridge.execute(frameContext)
        : null;
      if (shadingFrame && shadingFrame.ready) {
        denoiseInputsBridge.execute(frameContext, shadingFrame);
      }


      const shadedContext = pass.execute(frameContext) || frameContext;


      composition.execute(shadedContext, {
        flagOn: isFlagActive(COMPOSITION_FLAG_ID, tier),
        baselineFrozen: isFlagActive(BASELINE_FLAG_ID, tier),
        denoisedSignal: denoisedSignalLatch.readSignal(),


        renderWidth: shadingFrame ? shadingFrame.fullWidth : 0,
        renderHeight: shadingFrame ? shadingFrame.fullHeight : 0,
      });
      return shadedContext;
    },
  });

  telemetry.textureUnit(PHASE_ID, SHARED_LIGHTING_TEXTURE_UNITS);
  telemetry.phase(PHASE_ID, {
    implemented: true,
    title: "Sample shading with albedo factored out",
    block: "E",
    ownsPass: SAMPLE_SHADING_PASS_NAME,
    flag: FLAG_ID,
    sharedLightingTextureUnits: SHARED_LIGHTING_TEXTURE_UNITS,
    sharedLightingTextureUnitsBorrowedFrom:
      "ML-F20:history, 2 units the contract already reserves; the composition samples them and declares 0 NEW units instead of counting them twice",
    injectsGlslInSharedProgram: false,
    injectsGlslInSharedProgramWhenTheCompositionGateOpens: true,
    reservedPatchOrder: reservedPatchOrderOf(PHASE_ID),
    reservedPatchOrderIsUsedBy: composition.inspect(),
    writesBuffers: ["shadedDiffuse", "shadedSpecular"],
    factoredOut: ["albedo", "envBrdf"],
    uniforms: pass.programUniformValues(),
    ownedUniforms: pass.ownedUniformNames(),
    enforcedRefusals: SAMPLE_SHADING_ENFORCED_REFUSALS,
    acceptance: SAMPLE_SHADING_ACCEPTANCE,
    assembledInputs: {
      flag: INPUTS_BRIDGE_FLAG_ID,
      bridge: inputsBridge.inspect(),
      denoiseChain: denoiseInputsBridge.inspect(),
      denoisedSignalLatch: "published live under ML-F18:signalLatch, because a snapshot taken at install would report hasSignal false forever",
    },
    waitingFor:
      "the GPU path. What is wired here is the CPU reference path, so no number measured through it is a performance number: the GLSL resolver of ML-F7 and real ML-F17 tracers still refuse on the GPU, and the composition samples a NEAREST filtered grid instead of a bilinear upsample",
  });

  return {
    implemented: true,
    phaseId: PHASE_ID,
    flagId: FLAG_ID,
    passName: SAMPLE_SHADING_PASS_NAME,
    pass,
    inspect: () => pass.inspect(),
  };
}
