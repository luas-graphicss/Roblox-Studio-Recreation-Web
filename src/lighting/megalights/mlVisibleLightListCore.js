import {
  MGL_DISOCCLUSION_FRAME_COUNT,
  MGL_GUIDING_TILE_SIZE,
  MGL_MAX_VISIBLE_LIGHTS_PER_TILE,
} from "./mlPipelineContract.js";

export const VISIBLE_LIGHT_LIST_OWNER = "ML-F9";
export const VISIBLE_LIGHT_LIST_PASS_NAME = "visibleLightList";
export const VISIBLE_LIGHT_LIST_BUFFER_NAME = "visibleLightList";
export const VISIBLE_LIGHT_LIST_REFUSAL_CODE = "visibleLightList.notTheOnlySource";


export const EMPTY_LIGHT_INDEX = -1;


export const DEFAULT_DECAY_PER_FRAME = 0.6;


export const MINIMUM_TILE_WEIGHT = 1e-5;


export const VISIBLE_LIGHT_LIST_GATES = Object.freeze({
  minimumEnergyShareFromList: 0.8,
  energyShareWarmupFrames: 8,
  maximumRecoveryFrames: MGL_DISOCCLUSION_FRAME_COUNT,
  minimumTileBorderStructuralSimilarity: 0.99,
  maximumPassCostShareOfMegaLights: 0.05,
});

const EMPTY_TILE_LIST = Object.freeze([]);


export function guidingTileCounts(resolution) {
  const request = resolution || {};
  const tileSize = Math.max(1, Math.floor(request.tileSize || MGL_GUIDING_TILE_SIZE));
  const width = Math.max(1, Math.floor(request.width || 1));
  const height = Math.max(1, Math.floor(request.height || 1));
  return {
    tileSize,
    tileCountX: Math.ceil(width / tileSize),
    tileCountY: Math.ceil(height / tileSize),
  };
}


function byWeightThenLightIndex(left, right) {
  if (right.weight !== left.weight) return right.weight - left.weight;
  return left.lightIndex - right.lightIndex;
}


export function createVisibleLightListAccumulator(options) {
  const settings = options || {};
  const tileCountX = Math.max(1, Math.floor(settings.tileCountX || 1));
  const tileCountY = Math.max(1, Math.floor(settings.tileCountY || 1));
  const maxLightsPerTile = Math.min(
    MGL_MAX_VISIBLE_LIGHTS_PER_TILE,
    Math.max(1, Math.floor(settings.maxLightsPerTile || MGL_MAX_VISIBLE_LIGHTS_PER_TILE)),
  );
  const decayPerFrame =
    settings.decayPerFrame === undefined
      ? DEFAULT_DECAY_PER_FRAME
      : Math.min(1, Math.max(0, Number(settings.decayPerFrame)));
  const minimumWeight =
    settings.minimumWeight === undefined ? MINIMUM_TILE_WEIGHT : Math.max(0, Number(settings.minimumWeight));

  let publishedListsByTile = new Map();
  let pendingObservationsByTile = new Map();
  let publishedFrameIndex = -1;
  let openFrameIndex = -1;
  let currentFrameEnergy = createEnergyCounters();
  let lastFrameEnergy = createEnergyCounters();
  let refusedObservationCount = 0;

  function createEnergyCounters() {
    return { total: 0, coveredByPublishedList: 0, observationCount: 0 };
  }

  function tileKeyOf(tileX, tileY) {
    return tileY * tileCountX + tileX;
  }

  function isInsideGrid(tileX, tileY) {
    return tileX >= 0 && tileY >= 0 && tileX < tileCountX && tileY < tileCountY;
  }

  function publishedListOf(tileKey) {
    return publishedListsByTile.get(tileKey) || EMPTY_TILE_LIST;
  }

  function publishedListContains(tileKey, lightIndex) {
    const entries = publishedListOf(tileKey);
    for (let index = 0; index < entries.length; index++) {
      if (entries[index].lightIndex === lightIndex) return true;
    }
    return false;
  }

  return {

    beginFrame(frameIndex) {
      openFrameIndex = frameIndex === undefined ? publishedFrameIndex + 1 : Math.floor(Number(frameIndex));
      pendingObservationsByTile = new Map();
      currentFrameEnergy = createEnergyCounters();
      return openFrameIndex;
    },


    recordContribution(observation) {
      if (openFrameIndex < 0) {
        refusedObservationCount++;
        return false;
      }
      const request = observation || {};
      const tileX = Math.floor(Number(request.tileX));
      const tileY = Math.floor(Number(request.tileY));
      const lightIndex = Math.floor(Number(request.lightIndex));
      const energy = Number(request.energy);
      const isValid =
        isInsideGrid(tileX, tileY) &&
        lightIndex >= 0 &&
        isFinite(energy) &&
        energy > 0;
      if (!isValid) {


        refusedObservationCount++;
        return false;
      }

      const tileKey = tileKeyOf(tileX, tileY);
      currentFrameEnergy.total += energy;
      currentFrameEnergy.observationCount++;


      if (publishedListContains(tileKey, lightIndex)) {
        currentFrameEnergy.coveredByPublishedList += energy;
      }

      let observationsByLightIndex = pendingObservationsByTile.get(tileKey);
      if (!observationsByLightIndex) {
        observationsByLightIndex = new Map();
        pendingObservationsByTile.set(tileKey, observationsByLightIndex);
      }
      const existing = observationsByLightIndex.get(lightIndex);
      if (existing) {
        existing.energy += energy;
        existing.needsShadowTrace = existing.needsShadowTrace || !!request.needsShadowTrace;
      } else {
        observationsByLightIndex.set(lightIndex, {
          energy,
          needsShadowTrace: !!request.needsShadowTrace,
          shapeIndex: Math.max(0, Math.floor(Number(request.shapeIndex) || 0)),
        });
      }
      return true;
    },


    endFrame() {
      if (openFrameIndex < 0) {
        return { published: false, reason: "endFrame() without beginFrame()" };
      }

      const tileKeys = new Set();
      publishedListsByTile.forEach((entries, tileKey) => tileKeys.add(tileKey));
      pendingObservationsByTile.forEach((observations, tileKey) => tileKeys.add(tileKey));

      const nextPublishedListsByTile = new Map();
      let entryCount = 0;

      tileKeys.forEach((tileKey) => {
        const candidatesByLightIndex = new Map();

        publishedListOf(tileKey).forEach((entry) => {
          const decayedWeight = entry.weight * decayPerFrame;
          if (decayedWeight < minimumWeight) return;
          candidatesByLightIndex.set(entry.lightIndex, {
            lightIndex: entry.lightIndex,
            weight: decayedWeight,
            needsShadowTrace: entry.needsShadowTrace,
            shapeIndex: entry.shapeIndex,
            lastSeenFrameIndex: entry.lastSeenFrameIndex,
          });
        });

        const observations = pendingObservationsByTile.get(tileKey);
        if (observations) {
          observations.forEach((observation, lightIndex) => {
            const decayed = candidatesByLightIndex.get(lightIndex);
            candidatesByLightIndex.set(lightIndex, {
              lightIndex,
              weight: Math.max(observation.energy, decayed ? decayed.weight : 0),
              needsShadowTrace: observation.needsShadowTrace || (decayed ? decayed.needsShadowTrace : false),
              shapeIndex: observation.shapeIndex,
              lastSeenFrameIndex: openFrameIndex,
            });
          });
        }

        const entries = Array.from(candidatesByLightIndex.values())
          .filter((entry) => entry.weight >= minimumWeight)
          .sort(byWeightThenLightIndex)
          .slice(0, maxLightsPerTile);

        if (entries.length > 0) {
          nextPublishedListsByTile.set(tileKey, entries);
          entryCount += entries.length;
        }
      });

      publishedListsByTile = nextPublishedListsByTile;
      publishedFrameIndex = openFrameIndex;
      lastFrameEnergy = currentFrameEnergy;
      pendingObservationsByTile = new Map();
      openFrameIndex = -1;

      return {
        published: true,
        publishedFrameIndex,
        tilesWithList: publishedListsByTile.size,
        entryCount,
        energyShareFromList: energyShareOf(lastFrameEnergy),
      };
    },


    listForTile(tileX, tileY) {
      if (!isInsideGrid(tileX, tileY)) return EMPTY_TILE_LIST;
      return publishedListOf(tileKeyOf(tileX, tileY));
    },

    containsLight(tileX, tileY, lightIndex) {
      if (!isInsideGrid(tileX, tileY)) return false;
      return publishedListContains(tileKeyOf(tileX, tileY), Math.floor(Number(lightIndex)));
    },

    publishedFrameIndex() {
      return publishedFrameIndex;
    },


    energyShareFromList() {
      return energyShareOf(lastFrameEnergy);
    },

    describe() {
      return {
        owner: VISIBLE_LIGHT_LIST_OWNER,
        tileCountX,
        tileCountY,
        maxLightsPerTile,
        decayPerFrame,
        minimumWeight,
        gates: VISIBLE_LIGHT_LIST_GATES,
        refuses: VISIBLE_LIGHT_LIST_REFUSAL_CODE,
      };
    },

    stats() {
      let entryCount = 0;
      publishedListsByTile.forEach((entries) => {
        entryCount += entries.length;
      });
      const tilesWithList = publishedListsByTile.size;
      return {
        publishedFrameIndex,
        tilesWithList,
        entryCount,
        averageEntriesPerTile: tilesWithList > 0 ? entryCount / tilesWithList : 0,
        energyShareFromList: energyShareOf(lastFrameEnergy),
        observationCount: lastFrameEnergy.observationCount,
        refusedObservationCount,
      };
    },

    reset() {
      publishedListsByTile = new Map();
      pendingObservationsByTile = new Map();
      publishedFrameIndex = -1;
      openFrameIndex = -1;
      currentFrameEnergy = createEnergyCounters();
      lastFrameEnergy = createEnergyCounters();
      refusedObservationCount = 0;
    },
  };
}

function energyShareOf(counters) {
  if (!counters || !(counters.total > 0)) return 0;
  return counters.coveredByPublishedList / counters.total;
}
