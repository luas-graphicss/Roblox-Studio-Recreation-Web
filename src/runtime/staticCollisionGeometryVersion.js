import { bus } from "../core/eventBus.js";
import { Events } from "../datamodel/index.js";


export const STATIC_COLLISION_PROPERTIES = Object.freeze([
  "Position",
  "Size",
  "Rotation",
  "CFrame",
  "Anchored",
  "CanCollide",
  "Shape",
  "Parent",
]);

const staticCollisionPropertyNames = new Set(STATIC_COLLISION_PROPERTIES);


export const STATIC_COLLISION_MAX_CACHE_AGE_MS = 30000;

let mutationCount = 0;
let lastVersionChangeAtMs = 0;
let subscribedToSceneMutations = false;

function nowMs() {
  return typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
}

function bumpVersion() {
  mutationCount += 1;
  lastVersionChangeAtMs = nowMs();
}

function handlePropertyChanged(payload) {
  const propertyName = payload && payload.property;

  if (!propertyName || staticCollisionPropertyNames.has(propertyName)) bumpVersion();
}

function subscribeToSceneMutationsOnce() {
  if (subscribedToSceneMutations) return;
  subscribedToSceneMutations = true;
  lastVersionChangeAtMs = nowMs();
  bus.on(Events.ChildAdded, bumpVersion);
  bus.on(Events.ChildRemoved, bumpVersion);
  bus.on(Events.Destroying, bumpVersion);
  bus.on(Events.PropertyChanged, handlePropertyChanged);
}


export function getStaticCollisionGeometryVersion() {
  subscribeToSceneMutationsOnce();
  if (nowMs() - lastVersionChangeAtMs >= STATIC_COLLISION_MAX_CACHE_AGE_MS) bumpVersion();
  return mutationCount;
}


export function getStaticCollisionGeometryVersionStateForTests() {
  return { mutationCount, lastVersionChangeAtMs, subscribedToSceneMutations };
}
