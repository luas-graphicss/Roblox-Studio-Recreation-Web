import { bus } from "../core/eventBus.js";
import { Events } from "./instance.js";

const EMPTY_INSTANCE_LIST = Object.freeze([]);


let sceneMutationCount = 0;
let subscribedToSceneMutations = false;


let groupingByRoot = new WeakMap();

const statistics = {
  rebuildCount: 0,
  indexedReadCount: 0,
  fallbackReadCount: 0,
  lastRebuildInstanceCount: 0,
};

function bumpSceneMutationCount() {
  sceneMutationCount += 1;
}

function subscribeToSceneMutationsOnce() {
  if (subscribedToSceneMutations) return;
  subscribedToSceneMutations = true;
  bus.on(Events.ChildAdded, bumpSceneMutationCount);
  bus.on(Events.ChildRemoved, bumpSceneMutationCount);
  bus.on(Events.Destroying, bumpSceneMutationCount);
  bus.on(Events.ParentChanged, bumpSceneMutationCount);
}

function isClassIndexEnabled() {
  if (typeof window === "undefined") return true;
  return window.__rswClassIndex !== false;
}

function canBeIndexed(root) {
  return !!root && typeof root.getDescendants === "function";
}

function isUsableClassName(className) {
  return typeof className === "string" && className.length > 0;
}


function buildGrouping(root) {
  const instancesByClassName = new Map();
  const descendantOrderByClassName = new Map();
  let descendantIndex = 0;
  for (const instance of root.getDescendants()) {
    const className = instance ? instance.className : null;
    if (!isUsableClassName(className)) continue;
    let instances = instancesByClassName.get(className);
    if (!instances) {
      instances = [];
      instancesByClassName.set(className, instances);
      descendantOrderByClassName.set(className, []);
    }
    instances.push(instance);
    descendantOrderByClassName.get(className).push(descendantIndex);
    descendantIndex += 1;
  }
  statistics.rebuildCount += 1;
  statistics.lastRebuildInstanceCount = descendantIndex;
  return {
    builtAtMutationCount: sceneMutationCount,
    instancesByClassName,
    descendantOrderByClassName,
  };
}

function getGrouping(root) {
  subscribeToSceneMutationsOnce();
  const cached = groupingByRoot.get(root);
  if (cached && cached.builtAtMutationCount === sceneMutationCount) return cached;
  const grouping = buildGrouping(root);
  groupingByRoot.set(root, grouping);
  return grouping;
}


function sweepDescendantsOfClasses(root, classNames) {
  const found = [];
  for (const instance of root.getDescendants()) {
    if (instance && classNames.has(instance.className)) found.push(instance);
  }
  return found;
}


function mergeBucketsInDescendantOrder(grouping, classNames) {
  const cursors = [];
  for (const className of classNames) {
    const instances = grouping.instancesByClassName.get(className);
    if (!instances || instances.length === 0) continue;
    cursors.push({
      instances,
      descendantOrder: grouping.descendantOrderByClassName.get(className),
      nextIndex: 0,
    });
  }
  if (cursors.length === 0) return EMPTY_INSTANCE_LIST;
  if (cursors.length === 1) return cursors[0].instances;
  const merged = [];
  for (;;) {
    let bestCursor = null;
    for (const cursor of cursors) {
      if (cursor.nextIndex >= cursor.instances.length) continue;
      if (
        bestCursor === null ||
        cursor.descendantOrder[cursor.nextIndex] < bestCursor.descendantOrder[bestCursor.nextIndex]
      ) {
        bestCursor = cursor;
      }
    }
    if (bestCursor === null) return merged;
    merged.push(bestCursor.instances[bestCursor.nextIndex]);
    bestCursor.nextIndex += 1;
  }
}


export function getInstancesOfClass(root, className) {
  if (!canBeIndexed(root) || !isUsableClassName(className)) return EMPTY_INSTANCE_LIST;
  if (!isClassIndexEnabled()) {
    statistics.fallbackReadCount += 1;
    return sweepDescendantsOfClasses(root, new Set([className]));
  }
  statistics.indexedReadCount += 1;
  return getGrouping(root).instancesByClassName.get(className) || EMPTY_INSTANCE_LIST;
}


export function getInstancesOfAnyClass(root, classNames) {
  if (!canBeIndexed(root) || !classNames) return EMPTY_INSTANCE_LIST;
  const requestedClassNames = [];
  for (const className of classNames) {
    if (isUsableClassName(className) && !requestedClassNames.includes(className)) {
      requestedClassNames.push(className);
    }
  }
  if (requestedClassNames.length === 0) return EMPTY_INSTANCE_LIST;
  if (!isClassIndexEnabled()) {
    statistics.fallbackReadCount += 1;
    return sweepDescendantsOfClasses(root, new Set(requestedClassNames));
  }
  statistics.indexedReadCount += 1;
  return mergeBucketsInDescendantOrder(getGrouping(root), requestedClassNames);
}


export function invalidateClassIndex() {
  bumpSceneMutationCount();
}


export function getClassIndexStatistics() {
  return {
    rebuildCount: statistics.rebuildCount,
    indexedReadCount: statistics.indexedReadCount,
    fallbackReadCount: statistics.fallbackReadCount,
    lastRebuildInstanceCount: statistics.lastRebuildInstanceCount,
    sceneMutationCount,
    enabled: isClassIndexEnabled(),
  };
}


export function resetClassIndexForTests() {
  groupingByRoot = new WeakMap();
  sceneMutationCount = 0;
  statistics.rebuildCount = 0;
  statistics.indexedReadCount = 0;
  statistics.fallbackReadCount = 0;
  statistics.lastRebuildInstanceCount = 0;
}

if (typeof window !== "undefined") {
  window.__rswClassIndexQa = {
    statistics: getClassIndexStatistics,
    invalidate: invalidateClassIndex,
  };
}
