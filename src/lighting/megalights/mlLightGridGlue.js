import {
  describeLightGridGeometry,
  LIGHT_GRID_CELL_COUNT,
  LIGHT_GRID_TILE_COUNT_X,
  LIGHT_GRID_TILE_COUNT_Y,
  LIGHT_GRID_DEPTH_SLICE_COUNT,
} from "./mlLightGridCore.js";
import {
  packLightGrid,
  lightGridMemoryReport,
  DEFAULT_MAXIMUM_LIGHTS_PER_CELL,
  LIGHT_GRID_TEXEL_LAYOUT,
} from "./mlLightListPackingCore.js";
import {
  createCellVisibilityTest,
  hierarchicalDepthLevelForTileGrid,
} from "./mlLightGridHzbCullCore.js";
import { createLightGridCache } from "./mlLightGridCacheCore.js";
import { createLightGridTextureUpload } from "./mlLightGridTextureUpload.js";

export const LIGHT_GRID_OWNER = "ML-F5";
export const LIGHT_GRID_PASS_NAME = "lightGrid";


export const FALLBACK_ATTENUATION_RADIUS = 25;

function attenuationRadiusOf(light) {
  const declaredRadius = Number(light.userData && light.userData.attenuationRadius);
  if (Number.isFinite(declaredRadius) && declaredRadius > 0) return declaredRadius;
  const range = Number(light.distance);
  if (Number.isFinite(range) && range > 0) return range;
  return FALLBACK_ATTENUATION_RADIUS;
}

function isLocalLight(object) {
  if (!object || !object.isLight) return false;
  return !object.isAmbientLight && !object.isDirectionalLight && !object.isHemisphereLight;
}


function toViewSpace(worldPosition, viewMatrixElements) {
  const elements = viewMatrixElements;
  const worldX = worldPosition.x;
  const worldY = worldPosition.y;
  const worldZ = worldPosition.z;
  return {
    viewX: elements[0] * worldX + elements[4] * worldY + elements[8] * worldZ + elements[12],
    viewY: elements[1] * worldX + elements[5] * worldY + elements[9] * worldZ + elements[13],
    viewDepth: -(elements[2] * worldX + elements[6] * worldY + elements[10] * worldZ + elements[14]),
  };
}

function isUsableDepthLevel(level) {
  return !!(
    level &&
    Number.isFinite(level.width) &&
    Number.isFinite(level.height) &&
    level.width > 0 &&
    level.height > 0 &&
    level.minimum &&
    level.maximum &&
    level.minimum.length >= level.width * level.height &&
    level.maximum.length >= level.width * level.height
  );
}


export function createLightGridPass(dependencies) {
  const settings = dependencies || {};
  const THREE = settings.THREE;
  const telemetry = settings.telemetry || null;
  const hierarchicalDepthSource = settings.hierarchicalDepth || null;
  const maximumLightsPerCell = Number(settings.maximumLightsPerCell) || DEFAULT_MAXIMUM_LIGHTS_PER_CELL;

  const lightsInViewSpace = [];
  const lightSourceObjects = [];


  const gridTextureUpload = createLightGridTextureUpload(THREE);


  const lightWorldPosition = THREE ? new THREE.Vector3() : null;
  let lastReport = null;
  const gridCache = createLightGridCache();
  let lastPackedGrid = null;
  let lastPackedSourceGrid = null;
  let lastMemoryReport = null;

  const gridHandle = {
    owner: LIGHT_GRID_OWNER,
    ready: false,
    geometry: describeLightGridGeometry(),
    gridSize: [LIGHT_GRID_TILE_COUNT_X, LIGHT_GRID_TILE_COUNT_Y, LIGHT_GRID_DEPTH_SLICE_COUNT],
    texture: null,
    textureLayout: LIGHT_GRID_TEXEL_LAYOUT,
    cellCount: LIGHT_GRID_CELL_COUNT,
    lightIndicesByCell: null,
    statistics: null,
  };

  function collectLightsFromScene(scene, viewMatrixElements) {
    lightsInViewSpace.length = 0;
    lightSourceObjects.length = 0;
    if (!scene || typeof scene.traverse !== "function") return;
    scene.traverse((object) => {
      if (!isLocalLight(object)) return;
      if (object.intensity !== undefined && !(object.intensity > 0)) return;
      object.updateWorldMatrix(true, false);


      const worldPosition = object.getWorldPosition(lightWorldPosition);
      const viewPosition = toViewSpace(worldPosition, viewMatrixElements);
      lightsInViewSpace.push({
        viewX: viewPosition.viewX,
        viewY: viewPosition.viewY,
        viewDepth: viewPosition.viewDepth,
        attenuationRadius: attenuationRadiusOf(object),
      });
      lightSourceObjects.push(object);
    });
  }


  function collectLights(frameContext, viewMatrixElements) {
    const lightSceneData = frameContext && frameContext.lightSceneData;
    if (lightSceneData && Array.isArray(lightSceneData.lightsInViewSpace)) {
      lightsInViewSpace.length = 0;
      for (let index = 0; index < lightSceneData.lightsInViewSpace.length; index++) {
        lightsInViewSpace.push(lightSceneData.lightsInViewSpace[index]);
      }
      return "ML-F4 lightSceneData";
    }
    const scene = (frameContext && frameContext.scene) || settings.scene || null;
    collectLightsFromScene(scene, viewMatrixElements);
    return "scene traversal (ML-F4 is still a stub)";
  }

  function resolveHierarchicalDepthLevel() {
    if (!hierarchicalDepthSource || typeof hierarchicalDepthSource.readLevel !== "function") {
      return { level: null, levelIndex: -1, reason: "ML-F3 hierarchical depth not available" };
    }
    let levelSizes = [];
    try {
      levelSizes =
        typeof hierarchicalDepthSource.levelSizes === "function" ? hierarchicalDepthSource.levelSizes() : [];
    } catch (error) {
      return { level: null, levelIndex: -1, reason: "levelSizes() threw: " + String(error && error.message) };
    }
    const levelIndex = hierarchicalDepthLevelForTileGrid(levelSizes);
    if (levelIndex < 0) return { level: null, levelIndex: -1, reason: "no pyramid level covers the tile grid" };

    let level = null;
    try {
      level = hierarchicalDepthSource.readLevel(levelIndex);
    } catch (error) {
      return { level: null, levelIndex, reason: "readLevel() threw: " + String(error && error.message) };
    }
    if (!isUsableDepthLevel(level)) {


      return { level: null, levelIndex, reason: "pyramid level has no usable min/max data" };
    }
    return { level, levelIndex, reason: "" };
  }

  function execute(frameContext) {
    const camera = frameContext && frameContext.camera;
    if (!camera || !camera.projectionMatrix || !camera.matrixWorldInverse) {
      gridHandle.ready = false;
      lastReport = { ready: false, reason: "frame context has no camera with a projection matrix" };
      return frameContext;
    }

    const projectionElements = camera.projectionMatrix.elements;
    const gridCamera = {
      near: camera.near,
      far: camera.far,
      projectionScaleX: projectionElements[0],
      projectionScaleY: projectionElements[5],
    };

    const lightSource = collectLights(frameContext, camera.matrixWorldInverse.elements);
    const hierarchicalDepth = resolveHierarchicalDepthLevel();
    const visibilityTest = createCellVisibilityTest({ level: hierarchicalDepth.level });

    const gridBuild = gridCache.build({
      lights: lightsInViewSpace,
      camera: gridCamera,
      isCellVisible: hierarchicalDepth.level ? visibilityTest.isCellVisible : null,
    });
    const grid = gridBuild.grid;
    const reusePackedGrid = gridBuild.reused && lastPackedGrid !== null && lastPackedSourceGrid === grid;
    const packed = reusePackedGrid ? lastPackedGrid : packLightGrid({
      lightIndicesByCell: grid.lightIndicesByCell,
      cellCount: LIGHT_GRID_CELL_COUNT,
      maximumLightsPerCell,
    });
    const memory = reusePackedGrid ? lastMemoryReport : lightGridMemoryReport(packed);
    const upload = reusePackedGrid
      ? { texture: gridHandle.texture, uploaded: false }
      : gridTextureUpload.uploadWhenChanged(packed);
    lastPackedGrid = packed;
    lastPackedSourceGrid = grid;
    lastMemoryReport = memory;

    gridHandle.ready = true;
    gridHandle.texture = upload.texture;
    gridHandle.lightIndicesByCell = grid.lightIndicesByCell;
    gridHandle.statistics = grid.statistics;
    gridHandle.packed = packed;

    lastReport = {
      ready: true,
      lightSource,
      lightCount: lightsInViewSpace.length,
      hierarchicalDepthAvailable: !!hierarchicalDepth.level,
      hierarchicalDepthLevel: hierarchicalDepth.levelIndex,
      hierarchicalDepthReason: hierarchicalDepth.reason,
      cullStatistics: visibilityTest.statistics,
      gridStatistics: grid.statistics,
      gridReused: gridBuild.reused,
      packedGridReused: reusePackedGrid,
      candidateTestsThisFrame: gridBuild.candidateTests,
      memory,
      textureWidth: packed.textureWidth,
      textureHeight: packed.textureHeight,
      textureUploaded: upload.uploaded,
    };

    if (telemetry) {
      telemetry.phase(LIGHT_GRID_OWNER, {
        implemented: true,
        ready: true,
        lightCount: lastReport.lightCount,
        lightSource,
        occludedCellsSkipped: visibilityTest.statistics.skippedCellCount,
        hierarchicalDepthAvailable: lastReport.hierarchicalDepthAvailable,
        hierarchicalDepthReason: hierarchicalDepth.reason,
        mainWorkReductionRatio: grid.statistics.mainWorkReductionRatio,
        packedBytes: memory.packedBytes,
        packedOverUnpackedRatio: memory.fixedCapacityRatio,
        droppedLightCount: memory.droppedLightCount,
        gridTextureUploaded: upload.uploaded,
        gridReused: gridBuild.reused,
        candidateTestsThisFrame: gridBuild.candidateTests,
      });
      if (memory.droppedLightCount > 0) {

        telemetry.error(
          "light grid dropped " + memory.droppedLightCount + " light(s): " + memory.saturatedCellCount +
            " cell(s) hit the ceiling of " + maximumLightsPerCell,
          LIGHT_GRID_OWNER + ".packLightGrid",
        );
      }
    }

    if (frameContext) frameContext.lightGrid = gridHandle;
    return frameContext;
  }

  return {
    execute,
    handle: () => gridHandle,
    inspect: () => ({
      owner: LIGHT_GRID_OWNER,
      report: lastReport,
      geometry: describeLightGridGeometry(),
      gridTexture: gridTextureUpload.describe(),
      gridCache: gridCache.describe(),
    }),
    dispose() {
      gridCache.reset();
      lastPackedGrid = null;
      lastPackedSourceGrid = null;
      lastMemoryReport = null;
      gridHandle.ready = false;
      gridHandle.texture = null;
      gridHandle.packed = null;
      gridHandle.lightIndicesByCell = null;
      gridHandle.statistics = null;
      gridTextureUpload.dispose();
    },
  };
}
