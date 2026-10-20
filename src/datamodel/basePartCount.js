import { bus } from "../core/eventBus.js";
import { Events } from "./instance.js";

export const BASE_PART_CLASS_NAMES = Object.freeze([
  "Part",
  "WedgePart",
  "CornerWedgePart",
  "TrussPart",
  "MeshPart",
  "SpawnLocation",
  "Seat",
  "VehicleSeat",
  "UnionOperation",
  "NegateOperation",
]);

const basePartClassNames = new Set(BASE_PART_CLASS_NAMES);

let countedDataModel = null;
let cachedCount = null;
let subscribedToSceneMutations = false;

function invalidateCachedCount() {
  cachedCount = null;
}

function subscribeToSceneMutationsOnce() {
  if (subscribedToSceneMutations) return;
  subscribedToSceneMutations = true;
  bus.on(Events.ChildAdded, invalidateCachedCount);
  bus.on(Events.ChildRemoved, invalidateCachedCount);
  bus.on(Events.Destroying, invalidateCachedCount);
}

function scanBasePartCount(dataModel) {
  let count = 0;
  for (const instance of dataModel.getDescendants()) {
    if (basePartClassNames.has(instance.className)) count += 1;
  }
  return count;
}

export function isBasePartClassName(className) {
  return basePartClassNames.has(className);
}


export function getBasePartCount(dataModel) {
  if (!dataModel || typeof dataModel.getDescendants !== "function") return null;
  subscribeToSceneMutationsOnce();
  if (dataModel !== countedDataModel) {
    countedDataModel = dataModel;
    cachedCount = null;
  }
  if (cachedCount === null) cachedCount = scanBasePartCount(dataModel);
  return cachedCount;
}
