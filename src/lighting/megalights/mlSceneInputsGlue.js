import { createGBufferFillPass } from "./mlGBufferGlue.js";
import { createHierarchicalDepthPass } from "./mlHzbGlue.js";
import {
  validateSceneInputReport,
  sceneInputAttachmentNames,
  SCENE_INPUT_TOLERANCES,
  HIERARCHICAL_DEPTH_BUFFER_NAME,
} from "./mlSceneInputsCore.js";
import { MAXIMUM_VELOCITY_IN_UV, VELOCITY_ENCODING_REVISION } from "./mlVelocityEncodingCore.js";

export const SCENE_INPUTS_OWNER = "ML-F3";

export function createSceneInputsPass(dependencies) {
  const THREE = dependencies.THREE;
  const renderer = dependencies.renderer;
  const gBuffer = dependencies.gBuffer;
  const telemetry = dependencies.telemetry || null;

  const gBufferFillPass = createGBufferFillPass({ THREE, renderer, gBuffer });
  const hierarchicalDepthPass = createHierarchicalDepthPass({ THREE, renderer });


  const sceneInputsHandle = {
    owner: SCENE_INPUTS_OWNER,
    ready: false,
    width: 0,
    height: 0,
    textures: { sceneDepth: null, sceneNormal: null, sceneAlbedo: null, sceneVelocity: null },
    hierarchicalDepth: {
      name: HIERARCHICAL_DEPTH_BUFFER_NAME,
      built: false,
      levelCount: 0,
      textureFor: (levelIndex) => hierarchicalDepthPass.textureFor(levelIndex),
      levelSize: (levelIndex) => hierarchicalDepthPass.levelSize(levelIndex),
    },
    camera: { near: 0, far: 0 },
    velocityEncoding: { revision: VELOCITY_ENCODING_REVISION, maximumVelocityInUv: MAXIMUM_VELOCITY_IN_UV },
  };

  let lastReport = null;
  let lastValidation = null;
  let lastPublishedSignature = "";

  function buildReport(fillReport, pyramidReport) {
    const attachments = {};
    sceneInputAttachmentNames().forEach((attachmentName) => {
      attachments[attachmentName] = { present: !!gBuffer.textureFor(attachmentName) };
    });
    return {
      gBufferAvailable: fillReport.filled,
      reason: fillReport.reason,
      width: fillReport.width,
      height: fillReport.height,
      attachments,
      hierarchicalDepth: {
        built: !!pyramidReport.built,
        levelCount: pyramidReport.levelCount,
        width: pyramidReport.width,
        height: pyramidReport.height,
      },
      meshCount: fillReport.meshCount,
      skippedTransparentMeshCount: fillReport.skippedTransparentMeshCount,
      skippedSkinnedMeshCount: fillReport.skippedSkinnedMeshCount,
      instancedMeshCount: fillReport.instancedMeshCount,
      velocityValid: fillReport.velocityValid,
      extraRenderPassesPerFrame: fillReport.filled ? 1 + pyramidReport.levelCount : 0,
    };
  }

  function publishWhenChanged(report, validation) {
    if (!telemetry) return;
    const signature = [
      report.gBufferAvailable,
      report.width,
      report.height,
      report.meshCount,
      report.hierarchicalDepth.levelCount,
      report.velocityValid,
      validation.valid,
      validation.problems.length,
    ].join("|");
    if (signature === lastPublishedSignature) return;
    lastPublishedSignature = signature;
    telemetry.phase(SCENE_INPUTS_OWNER, {
      implemented: true,
      ready: validation.valid,
      width: report.width,
      height: report.height,
      meshesWritten: report.meshCount,
      skippedTransparentMeshes: report.skippedTransparentMeshCount,
      skippedSkinnedMeshes: report.skippedSkinnedMeshCount,
      instancedMeshes: report.instancedMeshCount,
      hierarchicalDepthLevels: report.hierarchicalDepth.levelCount,
      hierarchicalDepthBuilt: report.hierarchicalDepth.built,
      velocityValid: report.velocityValid,
      extraRenderPassesPerFrame: report.extraRenderPassesPerFrame,
      problems: validation.problems,
    });
  }

  function execute(frameContext) {
    const renderInfo = renderer.info && renderer.info.render ? renderer.info.render : null;
    const frameCountBeforePass = renderInfo ? renderInfo.frame : 0;

    const fillReport = gBufferFillPass.execute(frameContext);
    let pyramidReport = { built: false, levelCount: hierarchicalDepthPass.levelCount(), width: 0, height: 0 };
    if (fillReport.filled) {
      pyramidReport = hierarchicalDepthPass.execute({
        sceneDepthTexture: gBuffer.textureFor("sceneDepth"),
        width: fillReport.width,
        height: fillReport.height,
        farPlane: frameContext && frameContext.camera ? frameContext.camera.far : 600,
      });
    }

    const report = buildReport(fillReport, pyramidReport);
    const validation = validateSceneInputReport(report);
    lastReport = report;
    lastValidation = validation;

    sceneInputsHandle.ready = validation.valid;
    sceneInputsHandle.width = report.width;
    sceneInputsHandle.height = report.height;
    sceneInputAttachmentNames().forEach((attachmentName) => {
      sceneInputsHandle.textures[attachmentName] = gBuffer.textureFor(attachmentName);
    });
    sceneInputsHandle.hierarchicalDepth.built = report.hierarchicalDepth.built;
    sceneInputsHandle.hierarchicalDepth.levelCount = report.hierarchicalDepth.levelCount;
    if (frameContext && frameContext.camera) {
      sceneInputsHandle.camera.near = frameContext.camera.near;
      sceneInputsHandle.camera.far = frameContext.camera.far;
    }

    if (frameContext) frameContext.sceneInputs = sceneInputsHandle;
    publishWhenChanged(report, validation);


    if (renderInfo) renderInfo.frame = frameCountBeforePass;
    return frameContext;
  }

  return {
    execute,


    inspect() {
      return {
        owner: SCENE_INPUTS_OWNER,
        report: lastReport,
        validation: lastValidation,
        tolerances: SCENE_INPUT_TOLERANCES,
        hierarchicalDepth: hierarchicalDepthPass.describe(),
        velocityEncoding: sceneInputsHandle.velocityEncoding,
      };
    },

    handle: () => sceneInputsHandle,
    readAttachmentPixels: (request) => gBufferFillPass.readAttachmentPixels(request),
    readHierarchicalDepthLevel: (levelIndex, rectangle) => hierarchicalDepthPass.readLevel(levelIndex, rectangle),
    releaseReadbackResources: () => gBufferFillPass.releaseReadbackResources(),

    dispose() {
      gBufferFillPass.dispose();
      hierarchicalDepthPass.dispose();
    },
  };
}
