import {
  SA_META_TEXELS,
  SA_ML_MAX,
  SA_PAD,
  createSaAllocator,
  saAtlasSizeFor,
  saClearMetaEntry,
  saSlotUv,
  saWriteMetaEntry,
} from "../shadowAtlasCore.js";
import { planPageRequests, resolutionByLightId } from "./mlVsmEligibilityCore.js";
import {
  DEFAULT_MAXIMUM_PAGES_PER_FRAME,
  createPageResidency,
  lightPageSignature,
} from "./mlVsmPageResidencyCore.js";
import {
  VSM_UNKNOWN_REASON,
  projectSampleIntoPage,
  resolveSampleVisibility,
  unpackDepth01FromRgbaBytes,
} from "./mlVsmSampleCore.js";
import { buildVirtualShadowMapGlsl, describeVirtualShadowMapGlsl } from "./mlVsmSampleGlsl.js";
import { createVsmFrameScratch } from "./mlVsmFrameScratch.js";
import { MGL_LIGHT_SHAPE, MGL_TRACE_RESULT } from "./mlPipelineContract.js";

export const VIRTUAL_SHADOW_MAP_PASS_NAME = "virtualShadowMapTrace";


export const DEFAULT_MAXIMUM_ATLAS_SIZE = 2048;

const PROBE_WINDOW_RADIUS_IN_TEXELS = 2;

function quantizedHashOfNumber(hash, value) {
  const quantized = Math.round((Number(value) || 0) * 1000);
  let mixed = hash ^ (quantized >>> 0);
  mixed = Math.imul(mixed, 16777619);
  return mixed >>> 0;
}


let accumulatedGeometryRevision = 2166136261;

function accumulateShadowCasterRevision(object) {
  if (!object.isMesh || !object.castShadow) return;
  const elements = object.matrixWorld.elements;
  for (let index = 12; index !== 15; index++) {
    accumulatedGeometryRevision = quantizedHashOfNumber(accumulatedGeometryRevision, elements[index]);
  }
  accumulatedGeometryRevision = quantizedHashOfNumber(accumulatedGeometryRevision, elements[0]);
  accumulatedGeometryRevision = quantizedHashOfNumber(accumulatedGeometryRevision, elements[5]);
  accumulatedGeometryRevision = quantizedHashOfNumber(accumulatedGeometryRevision, elements[10]);
}

function computeSceneGeometryRevision(scene) {
  accumulatedGeometryRevision = 2166136261;
  scene.traverseVisible(accumulateShadowCasterRevision);
  return accumulatedGeometryRevision;
}

export function createVirtualShadowMapPass(options) {
  const settings = options || {};
  const THREE = settings.THREE;
  const telemetry = settings.telemetry || null;
  const maximumAtlasSize = Math.max(256, Math.floor(Number(settings.maximumAtlasSize) || DEFAULT_MAXIMUM_ATLAS_SIZE));
  const maximumPagesPerFrame = Math.max(
    1,
    Math.floor(Number(settings.maximumPagesPerFrame) || DEFAULT_MAXIMUM_PAGES_PER_FRAME),
  );

  const residency = createPageResidency({ maximumPagesPerFrame });
  const metaData = new Float32Array(SA_ML_MAX * SA_META_TEXELS * 4);
  const cameraById = new Map();
  const pageByLightId = new Map();


  const PROBE_WINDOW_SIZE_IN_TEXELS = PROBE_WINDOW_RADIUS_IN_TEXELS * 2 + 1;
  const shadowCastingLights = [];
  const descriptorByLight = new WeakMap();
  const lightById = new Map();
  const viewProjectionByLightId = new Map();
  let frameScratch = null;
  let probeOriginTexelX = 0;
  let probeOriginTexelY = 0;


  function scratch() {
    if (!frameScratch) frameScratch = createVsmFrameScratch(THREE, PROBE_WINDOW_SIZE_IN_TEXELS);
    return frameScratch;
  }


  function readProbeDepth01(atlasU, atlasV) {
    const windowPixels = scratch().probeWindowPixels;
    const texelX = Math.floor(atlasU * atlasSize) - probeOriginTexelX;
    const texelY = Math.floor(atlasV * atlasSize) - probeOriginTexelY;
    if (!(texelX >= 0) || !(texelY >= 0)) return null;
    if (texelX >= PROBE_WINDOW_SIZE_IN_TEXELS || texelY >= PROBE_WINDOW_SIZE_IN_TEXELS) return null;
    const offset = (texelY * PROBE_WINDOW_SIZE_IN_TEXELS + texelX) * 4;
    return unpackDepth01FromRgbaBytes(
      windowPixels[offset],
      windowPixels[offset + 1],
      windowPixels[offset + 2],
      windowPixels[offset + 3],
    );
  }

  let allocator = null;
  let atlasTarget = null;
  let atlasSize = 0;
  let depthMaterial = null;
  let previousResolutionById = {};
  let lastReport = { ready: false, reason: "not executed yet" };

  function reportNotReady(reason) {
    lastReport = { ready: false, reason, pagesRendered: 0, atlasAwake: false };
    if (telemetry) telemetry.phase("ML-F15", { implemented: true, atlasAwake: false, reason });
    return lastReport;
  }

  function ensureAtlasTarget(renderer) {
    if (atlasTarget) return atlasTarget;
    const maxTextureSize = (renderer.capabilities && renderer.capabilities.maxTextureSize) || 2048;
    const engineAtlasSize = saAtlasSizeFor(maxTextureSize, false);


    if (engineAtlasSize === 0) return null;
    atlasSize = Math.min(engineAtlasSize, maximumAtlasSize);
    atlasTarget = new THREE.WebGLRenderTarget(atlasSize, atlasSize, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      depthBuffer: true,
      stencilBuffer: false,
      generateMipmaps: false,
    });
    atlasTarget.texture.name = "uMglShadowAtlas";
    atlasTarget.texture.generateMipmaps = false;
    allocator = createSaAllocator(atlasSize);
    depthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    depthMaterial.name = "mglShadowPageDepth";
    return atlasTarget;
  }


  function describeLight(light, cameraWorldPosition) {
    const temporaries = scratch();
    const lightWorldPosition = temporaries.lightWorldPosition;
    const targetWorldPosition = temporaries.targetWorldPosition;
    const direction = temporaries.lightDirection;

    light.getWorldPosition(lightWorldPosition);
    targetWorldPosition.set(0, 0, 0);
    if (light.target) light.target.getWorldPosition(targetWorldPosition);
    direction.subVectors(targetWorldPosition, lightWorldPosition);
    if (direction.lengthSq() < 1e-8) direction.set(0, -1, 0);
    direction.normalize();

    const shadowCamera = light.shadow ? light.shadow.camera : null;
    const near = shadowCamera && shadowCamera.near > 0 ? shadowCamera.near : 0.5;
    const attenuationRadius = light.distance > 0
      ? light.distance
      : (shadowCamera && shadowCamera.far > 0 ? shadowCamera.far : 50);

    let descriptor = descriptorByLight.get(light);
    if (!descriptor) {
      descriptor = { position: [0, 0, 0], direction: [0, 0, 0] };
      descriptorByLight.set(light, descriptor);
    }
    descriptor.id = light.name || light.uuid;
    descriptor.shape = MGL_LIGHT_SHAPE.sphere;
    descriptor.isSpot = true;
    descriptor.castsShadow = !!light.castShadow;
    descriptor.intensity = Number(light.intensity) || 0;
    descriptor.distanceToViewer = lightWorldPosition.distanceTo(cameraWorldPosition);
    descriptor.coneAngle = Number(light.angle) || 0;
    descriptor.attenuationRadius = attenuationRadius;
    descriptor.near = near;
    descriptor.position[0] = lightWorldPosition.x;
    descriptor.position[1] = lightWorldPosition.y;
    descriptor.position[2] = lightWorldPosition.z;
    descriptor.direction[0] = direction.x;
    descriptor.direction[1] = direction.y;
    descriptor.direction[2] = direction.z;
    descriptor.threeLight = light;
    return descriptor;
  }


  function collectSpotLight(object) {


    if (object.isSpotLight) shadowCastingLights.push(describeLight(object, scratch().cameraWorldPosition));
  }

  function collectShadowCastingLights(scene, camera) {
    camera.getWorldPosition(scratch().cameraWorldPosition);
    shadowCastingLights.length = 0;
    scene.traverseVisible(collectSpotLight);
    return shadowCastingLights;
  }

  function ensureLightCamera(lightDescriptor) {
    let camera = cameraById.get(lightDescriptor.id);
    if (!camera) {
      camera = new THREE.PerspectiveCamera(60, 1, 0.5, 50);
      camera.name = "mglShadowPageCamera:" + lightDescriptor.id;
      cameraById.set(lightDescriptor.id, camera);
    }
    const fieldOfViewInDegrees = Math.min(175, Math.max(1, (2 * lightDescriptor.coneAngle * 180) / Math.PI));
    camera.fov = fieldOfViewInDegrees;
    camera.aspect = 1;
    camera.near = lightDescriptor.near;
    camera.far = Math.max(lightDescriptor.near + 0.01, lightDescriptor.attenuationRadius);
    camera.position.set(lightDescriptor.position[0], lightDescriptor.position[1], lightDescriptor.position[2]);


    if (Math.abs(lightDescriptor.direction[1]) > 0.99) camera.up.set(0, 0, 1);
    else camera.up.set(0, 1, 0);
    camera.lookAt(
      lightDescriptor.position[0] + lightDescriptor.direction[0],
      lightDescriptor.position[1] + lightDescriptor.direction[1],
      lightDescriptor.position[2] + lightDescriptor.direction[2],
    );
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    return camera;
  }


  function viewProjectionOf(lightId, camera) {
    const viewProjection = scratch().viewProjectionMatrix;
    viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    let elements = viewProjectionByLightId.get(lightId);
    if (!elements) {
      elements = new Float64Array(16);
      viewProjectionByLightId.set(lightId, elements);
    }
    for (let index = 0; index !== 16; index++) elements[index] = viewProjection.elements[index];
    return elements;
  }


  function renderSceneDepthIntoPage(renderer, scene, page, camera) {
    const previousRenderTarget = renderer.getRenderTarget();
    const previousOverrideMaterial = scene.overrideMaterial;
    const previousScissorTest = renderer.getScissorTest();
    const previousAutoClear = renderer.autoClear;
    const temporaries = scratch();
    const previousViewport = temporaries.preservedViewport;
    const previousScissor = temporaries.preservedScissor;
    const previousClearColor = temporaries.preservedClearColor;
    renderer.getViewport(previousViewport);
    renderer.getScissor(previousScissor);
    renderer.getClearColor(previousClearColor);
    const previousClearAlpha = renderer.getClearAlpha();

    try {
      scene.overrideMaterial = depthMaterial;
      renderer.setRenderTarget(atlasTarget);
      renderer.setViewport(page.x, page.y, page.res, page.res);
      renderer.setScissor(page.x, page.y, page.res, page.res);


      renderer.setScissorTest(true);
      renderer.autoClear = true;


      renderer.setClearColor(0x000000, 1);
      renderer.render(scene, camera);
      return true;
    } finally {
      scene.overrideMaterial = previousOverrideMaterial;
      renderer.setRenderTarget(previousRenderTarget);
      renderer.setViewport(previousViewport);
      renderer.setScissor(previousScissor);
      renderer.setScissorTest(previousScissorTest);
      renderer.setClearColor(previousClearColor, previousClearAlpha);
      renderer.autoClear = previousAutoClear;
    }
  }

  function execute(frameContext) {
    const context = frameContext || {};
    const renderer = context.renderer || settings.renderer || null;
    const scene = context.scene || settings.scene || null;
    const camera = context.camera || settings.camera || null;
    if (!THREE || !renderer || !scene || !camera) {
      reportNotReady("pass needs THREE, renderer, scene and camera");
      return context;
    }
    if (!ensureAtlasTarget(renderer)) {
      reportNotReady("gpu max texture size is below the engine atlas floor of 2048");
      return context;
    }

    const tierName = context.tier || "medio";
    const lights = collectShadowCastingLights(scene, camera);
    lightById.clear();
    for (let index = 0; index !== lights.length; index++) lightById.set(lights[index].id, lights[index]);
    const plan = planPageRequests({ lights, tierName, previousResolutionById });
    const allocation = allocator.plan(plan.requests);

    const signatureById = {};
    const rankById = {};
    plan.requests.forEach((request) => {
      rankById[request.id] = request.rank;
      signatureById[request.id] = lightPageSignature(lightById.get(request.id));
    });

    const sceneRevision = computeSceneGeometryRevision(scene);
    const residencyPlan = residency.plan({
      placedPages: allocation.placed,
      signatureById,
      rankById,
      sceneRevision,
    });
    const pageIdsToRender = new Set(residencyPlan.render.map((page) => page.id));


    const previousPageState = new Map(pageByLightId);
    pageByLightId.clear();
    metaData.fill(0);

    let renderedPageCount = 0;
    let failedPageCount = 0;

    allocation.placed.forEach((placedPage, metaIndex) => {
      const lightDescriptor = lightById.get(placedPage.id);
      if (!lightDescriptor) return;
      const lightCamera = ensureLightCamera(lightDescriptor);
      const slotUv = saSlotUv(placedPage.x, placedPage.y, placedPage.res, atlasSize, SA_PAD);
      const previousState = previousPageState.get(placedPage.id);
      let pageRendered = !!(previousState && previousState.pageRendered);
      let viewProjection = previousState ? previousState.viewProjection : null;

      if (pageIdsToRender.has(placedPage.id)) {
        viewProjection = viewProjectionOf(placedPage.id, lightCamera);
        let drawn = false;
        try {
          drawn = renderSceneDepthIntoPage(renderer, scene, placedPage, lightCamera);
        } catch (error) {
          failedPageCount++;
          if (telemetry) telemetry.error(error, "ML-F15.renderSceneDepthIntoPage");
        }
        if (drawn) {


          residency.markRendered(placedPage, signatureById[placedPage.id], sceneRevision);
          pageRendered = true;
          renderedPageCount++;
        }
      } else if (!viewProjection) {
        viewProjection = viewProjectionOf(placedPage.id, lightCamera);
      }

      if (metaIndex < SA_ML_MAX) {
        if (pageRendered) saWriteMetaEntry(metaData, metaIndex, viewProjection, slotUv);
        else saClearMetaEntry(metaData, metaIndex);
      }

      pageByLightId.set(placedPage.id, {
        id: placedPage.id,
        rank: rankById[placedPage.id],
        metaIndex,
        x: placedPage.x,
        y: placedPage.y,
        res: placedPage.res,
        slotUv,
        viewProjection,
        pageRendered,
        isNew: !!placedPage.isNew,
      });
    });

    previousResolutionById = resolutionByLightId(plan.requests);


    if (allocation.fails > 0 && telemetry) {
      telemetry.error(
        allocation.fails + " eligible light(s) got no atlas slot; they stay on the legacy shadow path",
        "ML-F15.execute",
      );
    }

    lastReport = {
      ready: true,
      reason: "",
      tierName,
      atlasSize,
      lightLimit: plan.limit,
      lightsSeen: lights.length,
      eligibleCount: plan.eligibleCount,
      requestedPageCount: plan.requests.length,
      allocatedPageCount: allocation.placed.length,
      pagesRendered: renderedPageCount,
      pagesReused: residencyPlan.statistics.reusedPageCount,
      pagesDeferred: residencyPlan.statistics.deferredPageCount,
      pagesFailed: failedPageCount,
      allocatorEvictions: allocation.evictions,
      allocatorFails: allocation.fails,
      refusedCount: plan.refused.length,
      refusals: plan.refused,
      sceneRevision,


      atlasAwake: renderedPageCount > 0 || pageByLightId.size > 0,
    };

    if (telemetry) {
      telemetry.phase("ML-F15", {
        implemented: true,
        atlasAwake: lastReport.atlasAwake,
        atlasSize,
        lightLimit: plan.limit,
        allocatedPageCount: lastReport.allocatedPageCount,
        pagesRendered: renderedPageCount,
        pagesReused: lastReport.pagesReused,
        pagesDeferred: lastReport.pagesDeferred,
        refusedCount: lastReport.refusedCount,
        textureUnitsUsed: 1,
      });
    }

    context.virtualShadowMap = handle();
    return context;
  }


  function probeVisibility(probe) {
    const request = probe || {};
    const renderer = request.renderer || settings.renderer || null;
    const page = pageByLightId.get(request.lightId);
    const worldPoint = Array.isArray(request.worldPoint) ? request.worldPoint : null;
    const worldNormal = Array.isArray(request.worldNormal) ? request.worldNormal : null;

    if (!page) {
      return { result: MGL_TRACE_RESULT.unknown, reason: VSM_UNKNOWN_REASON.lightHasNoPage, visibility: 0 };
    }
    if (!page.pageRendered) {
      return { result: MGL_TRACE_RESULT.unknown, reason: VSM_UNKNOWN_REASON.pageNeverRendered, visibility: 0 };
    }
    if (!renderer || !atlasTarget || !worldPoint) {
      return { result: MGL_TRACE_RESULT.unknown, reason: VSM_UNKNOWN_REASON.noDepthReader, visibility: 0 };
    }

    const projection = projectSampleIntoPage({
      lightViewProjection: page.viewProjection,
      slotUv: page.slotUv,
      worldPoint,
    });
    if (!projection.ok) {
      return { result: MGL_TRACE_RESULT.unknown, reason: projection.reason, visibility: 0 };
    }

    const windowSize = PROBE_WINDOW_RADIUS_IN_TEXELS * 2 + 1;
    const centerTexelX = Math.floor(projection.atlasU * atlasSize);
    const centerTexelY = Math.floor(projection.atlasV * atlasSize);
    const originTexelX = Math.min(
      Math.max(centerTexelX - PROBE_WINDOW_RADIUS_IN_TEXELS, page.x),
      page.x + page.res - windowSize,
    );
    const originTexelY = Math.min(
      Math.max(centerTexelY - PROBE_WINDOW_RADIUS_IN_TEXELS, page.y),
      page.y + page.res - windowSize,
    );


    const pixels = scratch().probeWindowPixels;
    renderer.readRenderTargetPixels(atlasTarget, originTexelX, originTexelY, windowSize, windowSize, pixels);
    probeOriginTexelX = originTexelX;
    probeOriginTexelY = originTexelY;

    const resolved = resolveSampleVisibility({
      lightViewProjection: page.viewProjection,
      slotUv: page.slotUv,
      pageResolution: page.res,
      atlasSize,
      worldPoint,
      worldNormal,
      pageRendered: page.pageRendered,
      readDepth01: readProbeDepth01,
    });
    return Object.assign({ lightId: page.id, pageResolution: page.res }, resolved);
  }

  function handle() {
    return {
      owner: "ML-F15",
      passName: VIRTUAL_SHADOW_MAP_PASS_NAME,
      ready: !!atlasTarget,
      atlasSize,
      atlasTexture: atlasTarget ? atlasTarget.texture : null,

      uniformValues: {
        uMglShadowAtlas: atlasTarget ? atlasTarget.texture : null,
        uMglShadowAtlasSize: [atlasSize, atlasSize],
        uMglVirtualShadowMapLightLimit: lastReport.lightLimit || 0,
      },


      metaData,
      metaTexelsPerLight: SA_META_TEXELS,
      pages: Array.from(pageByLightId.values()),
      pageOf(lightId) {
        return pageByLightId.get(lightId) || null;
      },
      report: lastReport,
      glsl: { build: buildVirtualShadowMapGlsl, describe: describeVirtualShadowMapGlsl },
      probeVisibility,
    };
  }

  function inspect() {
    return Object.assign({}, lastReport, {
      pages: Array.from(pageByLightId.values()).map((page) => ({
        id: page.id,
        rank: page.rank,
        x: page.x,
        y: page.y,
        res: page.res,
        pageRendered: page.pageRendered,
      })),
    });
  }

  function dispose() {
    if (atlasTarget) atlasTarget.dispose();
    if (depthMaterial) depthMaterial.dispose();
    atlasTarget = null;
    depthMaterial = null;
    allocator = null;
    atlasSize = 0;
    cameraById.clear();
    pageByLightId.clear();
    lightById.clear();
    viewProjectionByLightId.clear();
    shadowCastingLights.length = 0;
    frameScratch = null;
    residency.clear();
    previousResolutionById = {};
    lastReport = { ready: false, reason: "disposed" };
  }

  return { execute, handle, inspect, probeVisibility, dispose, renderSceneDepthIntoPage };
}
