import * as pipelineContract from "./mlPipelineContract.js";
import * as compositionGlsl from "./mlCompositionGlsl.js";
import * as compositionGate from "./mlCompositionGateCore.js";

let loadedPatchRegistry = null;
let patchRegistryRequest = null;


function patchRegistry() {
  return loadedPatchRegistry;
}

function loadPatchRegistry() {
  if (loadedPatchRegistry) return Promise.resolve(loadedPatchRegistry);
  if (!patchRegistryRequest) {
    patchRegistryRequest = import("./runtime/megaLightsPatchRegistry.js").then(
      (registry) => {
        loadedPatchRegistry = registry;
        return registry;
      },
      () => null,
    );
  }
  return patchRegistryRequest;
}

export const COMPOSITION_PATCH_ID = "ml-f18-composition";
export const COMPOSITION_FLAG_ID = "MegaLightsComposition";
export const BASELINE_FLAG_ID = "MegaLightsBaseline";
export const COMPOSITION_UPLOAD_OWNER = "ML-F18:composition";
export const COMPOSITION_TEXTURE_UNIT_BUDGET_NAME = "ML-F20:history";

export function compositionPatchOrder() {
  const order = pipelineContract.MGL_PATCH_ORDER["ML-F18"];
  return Number.isFinite(order) ? order : 1000;
}

function countOrZero(value) {
  const asNumber = Number(value);
  return Number.isFinite(asNumber) && asNumber > 0 ? asNumber : 0;
}


export function createCompositionGlue(dependencies) {
  const settings = dependencies || {};
  const telemetry = settings.telemetry || null;
  const three = settings.THREE || null;
  const resolveMaterials =
    typeof settings.resolveMaterials === "function" ? settings.resolveMaterials : () => [];


  const requiredFlagIds = Array.isArray(settings.requiredFlagIds)
    ? settings.requiredFlagIds.slice()
    : [];

  const state = {
    patchRegistered: false,
    patchInRegistry: false,
    patchRegistryMissing: false,
    latchedMayCompose: false,
    verdict: null,
    uploadedFrameIndex: -1,
    uploadedTexelCount: 0,
    historyTexelsMissing: 0,
    uploadRefusal: "",
    textureWidth: 0,
    textureHeight: 0,
    renderWidth: 0,
    renderHeight: 0,
    transitionCount: 0,
    appliedAtLeastOnce: false,
  };
  const uploadSurfaces = {
    diffuseValues: null,
    specularValues: null,
    diffuseTexture: null,
    specularTexture: null,
  };
  let lastPublishedSignature = "";

  function publishWhenChanged() {
    if (!telemetry || typeof telemetry.phase !== "function") return;
    const verdict = state.verdict;
    const signature = [
      verdict ? verdict.refusal : "?",
      state.latchedMayCompose,
      state.textureWidth,
      state.textureHeight,
      state.uploadRefusal,
      state.appliedAtLeastOnce,
    ].join("|");
    if (signature === lastPublishedSignature) return;
    lastPublishedSignature = signature;
    telemetry.phase("ML-F18:composition", {
      patchId: COMPOSITION_PATCH_ID,
      anchor: compositionGlsl.COMPOSITION_ANCHOR_NAME,
      order: compositionPatchOrder(),
      mayCompose: state.latchedMayCompose,
      refusal: verdict ? verdict.refusal : null,
      refusalInPlainWords: verdict ? verdict.refusalInPlainWords : null,
      wouldBlackenTheScreen: verdict ? verdict.wouldBlackenTheScreen : null,
      counters: verdict,
      upload: {
        owner: COMPOSITION_UPLOAD_OWNER,
        standsInForTheMissingGpuUploadOfMlF20: true,
        refusal: state.uploadRefusal,
        width: state.textureWidth,
        height: state.textureHeight,
        texelsUploaded: state.uploadedTexelCount,
        texelsWithoutHistory: state.historyTexelsMissing,
        textureUnitBudget: COMPOSITION_TEXTURE_UNIT_BUDGET_NAME,
        newTextureUnitsSpent: 0,
      },
      glsl: compositionGlsl.describeCompositionGlsl(),
      gate: compositionGate.describeCompositionGate(),
      patchAppliedAtLeastOnce: state.appliedAtLeastOnce,
    });
  }


  function samplerIsWrittenByAnotherOwner(uniformName) {
    const registry = patchRegistry();
    if (!registry) return false;
    const reference = registry.uniformRef(uniformName);
    const value = reference ? reference.value : null;
    if (!value) return false;
    const writer = value.__mglUploadedBy;
    return typeof writer === "string" && writer !== COMPOSITION_UPLOAD_OWNER;
  }

  function ensureUploadSurfaces(width, height) {
    if (!three) return false;
    if (state.textureWidth === width && state.textureHeight === height && uploadSurfaces.diffuseTexture) {
      return true;
    }
    if (uploadSurfaces.diffuseTexture) uploadSurfaces.diffuseTexture.dispose();
    if (uploadSurfaces.specularTexture) uploadSurfaces.specularTexture.dispose();

    const texelCount = width * height;
    uploadSurfaces.diffuseValues = new Float32Array(texelCount * 4);
    uploadSurfaces.specularValues = new Float32Array(texelCount * 4);
    uploadSurfaces.diffuseTexture = createRadianceTexture(uploadSurfaces.diffuseValues, width, height);
    uploadSurfaces.specularTexture = createRadianceTexture(uploadSurfaces.specularValues, width, height);
    state.textureWidth = width;
    state.textureHeight = height;
    return true;
  }


  function createRadianceTexture(values, width, height) {
    const texture = new three.DataTexture(values, width, height, three.RGBAFormat, three.FloatType);
    texture.minFilter = three.NearestFilter;
    texture.magFilter = three.NearestFilter;
    texture.generateMipmaps = false;


    texture.flipY = false;
    if (three.NoColorSpace !== undefined) texture.colorSpace = three.NoColorSpace;
    texture.__mglUploadedBy = COMPOSITION_UPLOAD_OWNER;
    texture.needsUpdate = true;
    return texture;
  }

  function publishSampler(uniformName, texture) {
    const registry = patchRegistry();
    if (!registry) return false;
    if (samplerIsWrittenByAnotherOwner(uniformName)) return false;
    if (!registry.uniformRef(uniformName)) registry.registerUniform(uniformName, texture);
    else registry.setUniform(uniformName, texture);
    return true;
  }


  function publishRenderResolution(width, height) {
    const registry = patchRegistry();
    if (!three || !registry) return;
    if (state.renderWidth === width && state.renderHeight === height) return;
    state.renderWidth = width;
    state.renderHeight = height;
    const reference = registry.uniformRef(compositionGlsl.COMPOSITION_RESOLUTION_UNIFORM_NAME);
    const value = reference ? reference.value : null;
    if (value && value.isVector2) {
      value.set(width, height);
      return;
    }
    registry.setUniform(
      compositionGlsl.COMPOSITION_RESOLUTION_UNIFORM_NAME,
      new three.Vector2(width, height),
    );
  }

  function uploadDenoisedSignal(filtered, width, height) {
    if (!ensureUploadSurfaces(width, height)) {
      state.uploadRefusal = "three was not injected, so no texture could be uploaded";
      return false;
    }
    const diffuseValues = uploadSurfaces.diffuseValues;
    const specularValues = uploadSurfaces.specularValues;
    let texelsUploaded = 0;
    let texelsWithoutHistory = 0;

    for (let pixelY = 0; pixelY !== height; pixelY += 1) {

      const destinationRow = height - 1 - pixelY;
      for (let pixelX = 0; pixelX !== width; pixelX += 1) {
        const offset = (destinationRow * width + pixelX) * 4;
        const texel = filtered.readFilteredTexel(pixelX, pixelY);
        if (!texel) {


          diffuseValues[offset] = 0;
          diffuseValues[offset + 1] = 0;
          diffuseValues[offset + 2] = 0;
          diffuseValues[offset + 3] = 0;
          specularValues[offset] = 0;
          specularValues[offset + 1] = 0;
          specularValues[offset + 2] = 0;
          specularValues[offset + 3] = 0;
          texelsWithoutHistory += 1;
          continue;
        }
        const diffuse = texel.diffuse || { r: 0, g: 0, b: 0 };
        const specular = texel.specular || { r: 0, g: 0, b: 0 };
        const accumulatedFrameCount = countOrZero(texel.accumulatedFrameCount);
        diffuseValues[offset] = Number(diffuse.r) || 0;
        diffuseValues[offset + 1] = Number(diffuse.g) || 0;
        diffuseValues[offset + 2] = Number(diffuse.b) || 0;
        diffuseValues[offset + 3] = accumulatedFrameCount;
        specularValues[offset] = Number(specular.r) || 0;
        specularValues[offset + 1] = Number(specular.g) || 0;
        specularValues[offset + 2] = Number(specular.b) || 0;
        specularValues[offset + 3] = accumulatedFrameCount;
        texelsUploaded += 1;
      }
    }

    uploadSurfaces.diffuseTexture.needsUpdate = true;
    uploadSurfaces.specularTexture.needsUpdate = true;
    const samplerNames = compositionGlsl.COMPOSITION_SAMPLER_UNIFORM_NAMES;
    const diffusePublished = publishSampler(samplerNames[0], uploadSurfaces.diffuseTexture);
    const specularPublished = publishSampler(samplerNames[1], uploadSurfaces.specularTexture);
    state.uploadedTexelCount = texelsUploaded;
    state.historyTexelsMissing = texelsWithoutHistory;
    state.uploadRefusal =
      diffusePublished && specularPublished
        ? ""
        : "another owner already publishes the history samplers: the composition samples THEIR textures and uploaded none";
    return true;
  }


  function gateInputsFrom(frameContext, providedSignal) {
    const context = frameContext || {};


    const filtered = providedSignal || context.temporalFilteredShading || null;
    const shadedCounters =
      (context.shadedSignals && (context.shadedSignals.counters || context.shadedSignals.totals)) || {};
    const visibilityAssembly =
      (context.sampleShadingInputs && context.sampleShadingInputs.visibilityAssembly) || {};


    const unresolvedSampleCount =
      countOrZero(visibilityAssembly.samplesLeftUnknownForTheEstimator) +
      countOrZero(shadedCounters.unknownVisibilitySamples);

    return {
      filtered,
      signalPublished: !!(filtered && typeof filtered.readFilteredTexel === "function"),
      signalWidth: countOrZero(filtered ? filtered.width : 0),
      signalHeight: countOrZero(filtered ? filtered.height : 0),
      drawnSampleCount: countOrZero(shadedCounters.drawnSamples),
      shadedSampleCount: countOrZero(shadedCounters.shadedSamples),
      unresolvedSampleCount,
    };
  }


  function execute(frameContext, flagState) {
    const flags = flagState || {};
    const inputs = gateInputsFrom(frameContext, flags.denoisedSignal || null);
    const verdict = compositionGate.evaluateCompositionReadiness({
      flagOn: flags.flagOn === true,
      baselineFrozen: flags.baselineFrozen === true,
      signalPublished: inputs.signalPublished,
      signalWidth: inputs.signalWidth,
      signalHeight: inputs.signalHeight,
      drawnSampleCount: inputs.drawnSampleCount,
      shadedSampleCount: inputs.shadedSampleCount,
      unresolvedSampleCount: inputs.unresolvedSampleCount,
    });
    state.verdict = verdict;

    if (verdict.mayCompose) {
      const context = frameContext || {};
      const sceneInputs = context.sceneInputs || null;


      publishRenderResolution(
        countOrZero(flags.renderWidth) ||
          countOrZero(sceneInputs ? sceneInputs.width : 0) ||
          inputs.signalWidth,
        countOrZero(flags.renderHeight) ||
          countOrZero(sceneInputs ? sceneInputs.height : 0) ||
          inputs.signalHeight,
      );
      uploadDenoisedSignal(inputs.filtered, inputs.signalWidth, inputs.signalHeight);
      state.uploadedFrameIndex = countOrZero(context.frameIndex);
    }


    const nextLatch = verdict.mayCompose === true;
    if (nextLatch !== state.latchedMayCompose) {
      state.latchedMayCompose = nextLatch;
      state.transitionCount += 1;
      const registry = patchRegistry();
      if (registry) registry.healMaterials(resolveMaterials());
    }
    publishWhenChanged();
    return verdict;
  }


  function installPatch() {
    if (state.patchRegistered) return { patchId: COMPOSITION_PATCH_ID, alreadyRegistered: true };
    state.patchRegistered = true;

    loadPatchRegistry().then((registry) => {
      if (!registry) {
        state.patchRegistryMissing = true;
        publishWhenChanged();
        return;
      }
      registerCompositionPatch(registry);
      state.patchInRegistry = true;
      publishWhenChanged();
    });

    return {
      patchId: COMPOSITION_PATCH_ID,
      anchor: compositionGlsl.COMPOSITION_ANCHOR_NAME,
      order: compositionPatchOrder(),
      flagId: COMPOSITION_FLAG_ID,
    };
  }

  function registerCompositionPatch(registry) {
    registry.registerPatch({
      id: COMPOSITION_PATCH_ID,
      phase: "ML-F18",
      anchor: compositionGlsl.COMPOSITION_ANCHOR_NAME,
      order: compositionPatchOrder(),
      materialPaths: null,
      isActive(patchContext) {
        const flag = typeof patchContext.flag === "function" ? patchContext.flag : () => false;
        if (flag(BASELINE_FLAG_ID) === true) return false;
        if (flag(COMPOSITION_FLAG_ID) !== true) return false;
        for (let index = 0; index !== requiredFlagIds.length; index += 1) {
          if (flag(requiredFlagIds[index]) !== true) return false;
        }

        return state.latchedMayCompose === true;
      },
      apply(patchContext) {


        const declared = patchContext.insertBeforeChunk(
          "fragment",
          "common",
          compositionGlsl.buildCompositionDeclarations(),
        );
        if (!declared) return false;
        const composed = patchContext.patchChunk(
          "fragment",
          compositionGlsl.COMPOSITION_CHUNK_NAME,
          (chunkSource) => compositionGlsl.appendCompositionToLightsFragmentBegin(chunkSource),
        );
        if (!composed) return false;
        state.appliedAtLeastOnce = true;
        return true;
      },
    });
  }

  return {
    installPatch,
    execute,
    inspect() {
      return {
        patchId: COMPOSITION_PATCH_ID,
        flagId: COMPOSITION_FLAG_ID,
        requiredFlagIds: requiredFlagIds.slice(),
        anchor: compositionGlsl.COMPOSITION_ANCHOR_NAME,
        order: compositionPatchOrder(),
        mayCompose: state.latchedMayCompose,
        verdict: state.verdict,
        transitionCount: state.transitionCount,
        patchInRegistry: state.patchInRegistry,
        patchRegistryMissing: state.patchRegistryMissing,
        patchAppliedAtLeastOnce: state.appliedAtLeastOnce,
        upload: {
          owner: COMPOSITION_UPLOAD_OWNER,
          width: state.textureWidth,
          height: state.textureHeight,
          texelsUploaded: state.uploadedTexelCount,
          texelsWithoutHistory: state.historyTexelsMissing,
          refusal: state.uploadRefusal,
          frameIndex: state.uploadedFrameIndex,
          newTextureUnitsSpent: 0,
          textureUnitBudget: COMPOSITION_TEXTURE_UNIT_BUDGET_NAME,
        },
        renderResolution: { width: state.renderWidth, height: state.renderHeight },
        glsl: compositionGlsl.describeCompositionGlsl(),
        gate: compositionGate.describeCompositionGate(),
      };
    },
    disposeTextures() {
      if (uploadSurfaces.diffuseTexture) uploadSurfaces.diffuseTexture.dispose();
      if (uploadSurfaces.specularTexture) uploadSurfaces.specularTexture.dispose();
      uploadSurfaces.diffuseTexture = null;
      uploadSurfaces.specularTexture = null;
      state.textureWidth = 0;
      state.textureHeight = 0;
    },
  };
}
