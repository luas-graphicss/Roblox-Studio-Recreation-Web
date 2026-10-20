import { bus } from "../core/eventBus.js";
import { Events } from "../datamodel/index.js";
import { WORLD_BOUNDS_STRIDE, createWorldBounds } from "./worldBounds.js";
import { writeConservativePartBounds } from "./partBoundsWriter.js";
import {
  GRID_QUERY_REFUSED,
  buildSpatialGrid,
  createSpatialGrid,
  queryGridBox,
  queryGridSegment,
} from "./spatialGridCore.js";

const MAXIMUM_INDEXED_PARTS = 20000;
const REBUILD_TRIGGER_PROPERTIES = new Set(["Position", "Size", "Rotation", "CFrame"]);

const indexedInstances = [];
const indexedBoundsFlat = [];
const grid = createSpatialGrid();
const scratchBounds = createWorldBounds();
const scratchEntries = [];

let indexedRoot = null;
let indexedInstanceCount = 0;
let indexNeedsRebuild = true;
let indexIsAvailable = false;

const statistics = {
  rebuilds: 0,
  indexedParts: 0,
  segmentQueries: 0,
  boxQueries: 0,
  candidatesReturned: 0,
  linearFallbacks: 0,
};

function isIndexEnabled() {
  return typeof window === "undefined" || window.__rswSceneQueryIndex !== false;
}

function isIndexablePart(instance) {
  return (
    !!instance &&
    instance.__isInstance === true &&
    typeof instance.hasProperty === "function" &&
    instance.hasProperty("Position") &&
    instance.hasProperty("Size")
  );
}

function markIndexStale() {
  indexNeedsRebuild = true;
}

function onPropertyChanged(event) {
  if (event && REBUILD_TRIGGER_PROPERTIES.has(event.property)) indexNeedsRebuild = true;
}

bus.on(Events.PropertyChanged, onPropertyChanged);
bus.on(Events.ChildAdded, markIndexStale);
bus.on(Events.ChildRemoved, markIndexStale);
bus.on(Events.Destroying, markIndexStale);

function rebuildIndex(root) {
  indexNeedsRebuild = false;
  indexIsAvailable = false;
  indexedInstanceCount = 0;
  let descendants;
  try {
    descendants = root.getDescendants();
  } catch (error) {
    return;
  }
  if (!Array.isArray(descendants)) return;
  for (let index = 0; index < descendants.length; index += 1) {
    const instance = descendants[index];
    if (!isIndexablePart(instance)) continue;
    if (typeof instance.isDestroyed === "function" && instance.isDestroyed()) continue;
    if (!writeConservativePartBounds(scratchBounds, instance)) continue;
    if (indexedInstanceCount >= MAXIMUM_INDEXED_PARTS) {

      indexedInstanceCount = 0;
      return;
    }
    const offset = indexedInstanceCount * WORLD_BOUNDS_STRIDE;
    indexedBoundsFlat[offset] = scratchBounds.minX;
    indexedBoundsFlat[offset + 1] = scratchBounds.minY;
    indexedBoundsFlat[offset + 2] = scratchBounds.minZ;
    indexedBoundsFlat[offset + 3] = scratchBounds.maxX;
    indexedBoundsFlat[offset + 4] = scratchBounds.maxY;
    indexedBoundsFlat[offset + 5] = scratchBounds.maxZ;
    indexedInstances[indexedInstanceCount] = instance;
    indexedInstanceCount += 1;
  }
  buildSpatialGrid(grid, indexedBoundsFlat, indexedInstanceCount);
  indexIsAvailable = grid.isUsable;
  statistics.rebuilds += 1;
  statistics.indexedParts = indexedInstanceCount;
}

function ensureIndexReady(root) {
  if (!root || typeof root.getDescendants !== "function") return false;
  if (root !== indexedRoot) {
    indexedRoot = root;
    indexNeedsRebuild = true;
  }
  if (indexNeedsRebuild) rebuildIndex(root);
  return indexIsAvailable;
}

function writeCandidateInstances(foundCount, outCandidates) {
  outCandidates.length = 0;
  for (let index = 0; index < foundCount; index += 1) {
    outCandidates.push(indexedInstances[scratchEntries[index]]);
  }
  statistics.candidatesReturned += foundCount;
  return foundCount;
}


export function queryRayCandidates(root, origin, direction, maxDistance, outCandidates) {
  if (!isIndexEnabled() || !ensureIndexReady(root)) {
    statistics.linearFallbacks += 1;
    return null;
  }
  const foundCount = queryGridSegment(
    grid,
    origin.x, origin.y, origin.z,
    direction.x, direction.y, direction.z,
    maxDistance, scratchEntries,
  );
  if (foundCount === GRID_QUERY_REFUSED) {
    statistics.linearFallbacks += 1;
    return null;
  }
  statistics.segmentQueries += 1;
  return writeCandidateInstances(foundCount, outCandidates);
}


export function queryBoxCandidates(root, bounds, outCandidates) {
  if (!isIndexEnabled() || !ensureIndexReady(root)) {
    statistics.linearFallbacks += 1;
    return null;
  }
  const foundCount = queryGridBox(grid, bounds, scratchEntries);
  if (foundCount === GRID_QUERY_REFUSED) {
    statistics.linearFallbacks += 1;
    return null;
  }
  statistics.boxQueries += 1;
  return writeCandidateInstances(foundCount, outCandidates);
}


if (typeof window !== "undefined") {
  window.__rswSceneQueryIndexQa = {
    statistics,
    isEnabled: isIndexEnabled,
    invalidate: markIndexStale,
  };
}
