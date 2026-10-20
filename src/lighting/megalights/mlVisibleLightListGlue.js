import {
  createVisibleLightListAccumulator,
  guidingTileCounts,
  VISIBLE_LIGHT_LIST_GATES,
  VISIBLE_LIGHT_LIST_OWNER,
  VISIBLE_LIGHT_LIST_PASS_NAME,
  VISIBLE_LIGHT_LIST_REFUSAL_CODE,
} from "./mlVisibleLightListCore.js";
import {
  createVisibleLightListTexels,
  encodeVisibleLightLists,
  visibleLightListTextureSize,
} from "./mlVisibleLightListEncodingCore.js";
import { selectGuidingTileStochastically } from "./mlTileGuidingCore.js";
import { CONTRIBUTION_SOURCE, estimateTileContributions } from "./mlTileContributionEstimateCore.js";
import { createLightScreenFootprintReader } from "./mlLightScreenFootprintGlue.js";
import { VISIBLE_LIGHT_LIST_UNIFORM_NAMES } from "./mlVisibleLightListGlsl.js";
import { MGL_GUIDING_TILE_SIZE, MGL_MAX_VISIBLE_LIGHTS_PER_TILE } from "./mlPipelineContract.js";

const FALLBACK_WIDTH = 1280;
const FALLBACK_HEIGHT = 720;

export const VISIBLE_LIGHT_LIST_RESIDUES = Object.freeze([
  "the list is reduced on the CPU: WebGL2 has no compute shader and no atomics",
  "observations come from projected light footprints until ML-F11 writes frameContext.lightSampleObservations",
  "the light index is the row of the frame light list until ML-F4 provides stable identifiers",
]);

function nowMilliseconds() {
  if (typeof performance !== "undefined" && performance && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
}

export function createVisibleLightListPass(dependencies) {
  const settings = dependencies || {};
  const THREE = settings.THREE || null;
  const renderer = settings.renderer || null;
  const lightRig = settings.lightRig || null;
  const telemetry = settings.telemetry || null;

  const tileSize = MGL_GUIDING_TILE_SIZE;
  const maxLightsPerTile = MGL_MAX_VISIBLE_LIGHTS_PER_TILE;
  const footprintReader = createLightScreenFootprintReader({ THREE });

  let accumulator = null;
  let texels = null;
  let listTexture = null;
  let textureSize = { width: 0, height: 0, texelCount: 0, floatCount: 0 };
  let grid = { width: 0, height: 0, tileCountX: 0, tileCountY: 0 };
  let internalFrameIndex = -1;
  let pendingScreenLights = [];
  let lastObservationSource = CONTRIBUTION_SOURCE.none;
  let lastAcceptedObservationCount = 0;
  let lastRefusedObservationCount = 0;
  let lastFilledSlotCount = 0;
  let lastCpuMilliseconds = 0;
  let lastPublishedSignature = "";

  const handle = {
    owner: VISIBLE_LIGHT_LIST_OWNER,
    passName: VISIBLE_LIGHT_LIST_PASS_NAME,
    ready: false,
    texture: null,
    tileSize,
    maxLightsPerTile,
    tileCountX: 0,
    tileCountY: 0,
    sourceFrameIndex: -1,
    observationSource: CONTRIBUTION_SOURCE.none,
    energyShareFromList: 0,
    uniformValues: {},
    listForTile(tileX, tileY) {
      return accumulator ? accumulator.listForTile(tileX, tileY) : [];
    },
    guidedLightsForPixel(request) {
      return guidedLightsForPixel(request);
    },
  };
  handle.uniformValues[VISIBLE_LIGHT_LIST_UNIFORM_NAMES.listTexture] = null;
  handle.uniformValues[VISIBLE_LIGHT_LIST_UNIFORM_NAMES.lightsPerTile] = maxLightsPerTile;
  handle.uniformValues[VISIBLE_LIGHT_LIST_UNIFORM_NAMES.guidingTileSize] = tileSize;

  function readResolution(frameContext) {
    const context = frameContext || {};
    const width = Number(context.width) || 0;
    const height = Number(context.height) || 0;
    if (width > 0 && height > 0) return { width: Math.floor(width), height: Math.floor(height) };
    if (renderer && typeof renderer.getSize === "function" && THREE && typeof THREE.Vector2 === "function") {
      const size = renderer.getSize(new THREE.Vector2());
      if (size && size.x > 0 && size.y > 0) return { width: Math.floor(size.x), height: Math.floor(size.y) };
    }
    return { width: FALLBACK_WIDTH, height: FALLBACK_HEIGHT };
  }

  function createListTexture() {
    if (!THREE || typeof THREE.DataTexture !== "function") return null;
    const texture = new THREE.DataTexture(texels, textureSize.width, textureSize.height, THREE.RGBAFormat, THREE.FloatType);
    texture.name = "mglVisibleLightList";
    texture.minFilter = THREE.NearestFilter;
    texture.magFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    if (THREE.ClampToEdgeWrapping !== undefined) {
      texture.wrapS = THREE.ClampToEdgeWrapping;
      texture.wrapT = THREE.ClampToEdgeWrapping;
    }
    texture.needsUpdate = true;
    return texture;
  }

  function ensureResources(resolution) {
    const counts = guidingTileCounts({ width: resolution.width, height: resolution.height, tileSize });
    if (accumulator && counts.tileCountX === grid.tileCountX && counts.tileCountY === grid.tileCountY) {
      grid.width = resolution.width;
      grid.height = resolution.height;
      return false;
    }


    grid = {
      width: resolution.width,
      height: resolution.height,
      tileCountX: counts.tileCountX,
      tileCountY: counts.tileCountY,
    };
    accumulator = createVisibleLightListAccumulator({
      tileCountX: counts.tileCountX,
      tileCountY: counts.tileCountY,
      maxLightsPerTile,
    });
    textureSize = visibleLightListTextureSize({
      tileCountX: counts.tileCountX,
      tileCountY: counts.tileCountY,
      maxLightsPerTile,
    });
    texels = createVisibleLightListTexels({
      tileCountX: counts.tileCountX,
      tileCountY: counts.tileCountY,
      maxLightsPerTile,
    });
    if (listTexture && typeof listTexture.dispose === "function") listTexture.dispose();
    listTexture = createListTexture();
    handle.texture = listTexture;
    handle.tileCountX = counts.tileCountX;
    handle.tileCountY = counts.tileCountY;
    handle.uniformValues[VISIBLE_LIGHT_LIST_UNIFORM_NAMES.listTexture] = listTexture;
    pendingScreenLights = [];
    return true;
  }

  function collectObservations(frameContext) {
    const context = frameContext || {};
    if (Array.isArray(context.lightSampleObservations) && context.lightSampleObservations.length > 0) {
      return {
        source: CONTRIBUTION_SOURCE.lightSampleBuffer,
        observations: context.lightSampleObservations,
      };
    }
    if (pendingScreenLights.length > 0) {
      const estimate = estimateTileContributions({
        screenLights: pendingScreenLights,
        tileSize,
        tileCountX: grid.tileCountX,
        tileCountY: grid.tileCountY,
      });
      return { source: CONTRIBUTION_SOURCE.screenFootprintEstimate, observations: estimate.observations };
    }
    return { source: CONTRIBUTION_SOURCE.none, observations: [] };
  }

  function captureScreenLightsForNextFrame(frameContext) {
    const context = frameContext || {};
    if (Array.isArray(context.screenLights)) {
      pendingScreenLights = context.screenLights;
      return;
    }
    if (!lightRig || typeof lightRig.list !== "function" || !context.camera) {
      pendingScreenLights = [];
      return;
    }
    const footprints = footprintReader.read({
      camera: context.camera,
      width: grid.width,
      height: grid.height,
      lights: lightRig.list(),
    });
    pendingScreenLights = footprints.screenLights;
  }

  function uploadPublishedLists() {
    const encoded = encodeVisibleLightLists({
      readTileList: (tileX, tileY) => accumulator.listForTile(tileX, tileY),
      tileCountX: grid.tileCountX,
      tileCountY: grid.tileCountY,
      maxLightsPerTile,
      destination: texels,
    });
    lastFilledSlotCount = encoded.filledSlotCount;
    if (listTexture) listTexture.needsUpdate = true;
  }

  function guidedLightsForPixel(request) {
    const source = request || {};
    if (!accumulator) return { tileX: 0, tileY: 0, neighbours: [], lights: [] };
    const selection = selectGuidingTileStochastically({
      pixelX: source.pixelX,
      pixelY: source.pixelY,
      tileSize,
      tileCountX: grid.tileCountX,
      tileCountY: grid.tileCountY,
      randomValue: source.randomValue,
    });
    return {
      tileX: selection.tileX,
      tileY: selection.tileY,
      neighbours: selection.neighbours,
      lights: accumulator.listForTile(selection.tileX, selection.tileY),
    };
  }

  function publishTelemetryWhenChanged() {
    if (!telemetry) return;
    const stats = accumulator.stats();
    const signature = [
      grid.tileCountX,
      grid.tileCountY,
      lastObservationSource,
      stats.tilesWithList,
      stats.entryCount,
      Math.round(stats.energyShareFromList * 1000),
      !!listTexture,
    ].join("|");
    if (signature === lastPublishedSignature) return;
    lastPublishedSignature = signature;
    telemetry.phase(VISIBLE_LIGHT_LIST_OWNER, {
      implemented: true,
      ready: stats.tilesWithList > 0,
      tileCountX: grid.tileCountX,
      tileCountY: grid.tileCountY,
      tilesWithList: stats.tilesWithList,
      guidedLightEntries: stats.entryCount,
      averageGuidedLightsPerTile: stats.averageEntriesPerTile,
      energyShareFromList: stats.energyShareFromList,
      observationSource: lastObservationSource,
      gpuTextureAvailable: !!listTexture,
    });
  }

  function execute(frameContext) {
    const startedAtMs = nowMilliseconds();
    const context = frameContext || {};
    ensureResources(readResolution(context));

    const frameIndex = Number.isFinite(Number(context.frameIndex))
      ? Math.floor(Number(context.frameIndex))
      : internalFrameIndex + 1;
    internalFrameIndex = frameIndex;

    const collected = collectObservations(context);
    lastObservationSource = collected.source;
    lastAcceptedObservationCount = 0;
    lastRefusedObservationCount = 0;

    accumulator.beginFrame(frameIndex);
    for (let index = 0; index < collected.observations.length; index++) {
      if (accumulator.recordContribution(collected.observations[index])) lastAcceptedObservationCount++;
      else lastRefusedObservationCount++;
    }
    accumulator.endFrame();

    uploadPublishedLists();
    captureScreenLightsForNextFrame(context);

    handle.ready = lastFilledSlotCount > 0;
    handle.sourceFrameIndex = accumulator.publishedFrameIndex();
    handle.observationSource = lastObservationSource;
    handle.energyShareFromList = accumulator.energyShareFromList();

    publishTelemetryWhenChanged();
    lastCpuMilliseconds = nowMilliseconds() - startedAtMs;

    if (frameContext) frameContext.visibleLightList = handle;
    return frameContext;
  }

  return {
    execute,

    handle: () => handle,

    guidedLightsForPixel,


    readTexels: () => texels,

    inspect() {
      return {
        owner: VISIBLE_LIGHT_LIST_OWNER,
        passName: VISIBLE_LIGHT_LIST_PASS_NAME,
        refuses: VISIBLE_LIGHT_LIST_REFUSAL_CODE,
        grid,
        textureSize,
        gpuTextureAvailable: !!listTexture,
        observationSource: lastObservationSource,
        acceptedObservationCount: lastAcceptedObservationCount,
        refusedObservationCount: lastRefusedObservationCount,
        filledSlotCount: lastFilledSlotCount,
        cpuMilliseconds: lastCpuMilliseconds,
        stats: accumulator ? accumulator.stats() : null,
        description: accumulator ? accumulator.describe() : null,
        gates: VISIBLE_LIGHT_LIST_GATES,
        residues: VISIBLE_LIGHT_LIST_RESIDUES,


        passCostShareOfMegaLights: null,
        passCostShareReason: "no total MegaLights cost to compare against before ML-F18 shades",
      };
    },

    dispose() {
      if (listTexture && typeof listTexture.dispose === "function") listTexture.dispose();
      listTexture = null;
      handle.texture = null;
      handle.uniformValues[VISIBLE_LIGHT_LIST_UNIFORM_NAMES.listTexture] = null;
      texels = null;
      accumulator = null;
    },
  };
}
