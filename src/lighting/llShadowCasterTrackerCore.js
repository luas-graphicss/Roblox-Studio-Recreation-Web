export const TELEPORT_DISTANCE_DEFAULT = 12;
export const BOX_MATCH_EPSILON = 1e-4;

function numberOr(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function worldBoxFromMinMax(min, max) {
  if (!min || !max) return null;
  const box = {
    min: [numberOr(min[0], NaN), numberOr(min[1], NaN), numberOr(min[2], NaN)],
    max: [numberOr(max[0], NaN), numberOr(max[1], NaN), numberOr(max[2], NaN)],
  };
  const everyValueIsFinite = box.min.concat(box.max).every((value) => Number.isFinite(value));
  return everyValueIsFinite ? box : null;
}

export function normalizeWorldBox(worldBox) {
  if (!worldBox) return null;
  return worldBoxFromMinMax(worldBox.min, worldBox.max);
}

export function unionOfWorldBoxes(first, second) {
  const a = normalizeWorldBox(first);
  const b = normalizeWorldBox(second);
  if (!a) return b;
  if (!b) return a;
  return {
    min: [Math.min(a.min[0], b.min[0]), Math.min(a.min[1], b.min[1]), Math.min(a.min[2], b.min[2])],
    max: [Math.max(a.max[0], b.max[0]), Math.max(a.max[1], b.max[1]), Math.max(a.max[2], b.max[2])],
  };
}

export function worldBoxesAreEqual(first, second, epsilon) {
  if (!first || !second) return false;
  const tolerance = numberOr(epsilon, BOX_MATCH_EPSILON);
  for (let axis = 0; 3 > axis; axis++) {
    if (Math.abs(first.min[axis] - second.min[axis]) > tolerance) return false;
    if (Math.abs(first.max[axis] - second.max[axis]) > tolerance) return false;
  }
  return true;
}

export function worldBoxCenter(worldBox) {
  const box = normalizeWorldBox(worldBox);
  if (!box) return null;
  return [(box.min[0] + box.max[0]) / 2, (box.min[1] + box.max[1]) / 2, (box.min[2] + box.max[2]) / 2];
}

export function expandWorldBox(worldBox, margin) {
  const box = normalizeWorldBox(worldBox);
  if (!box) return null;
  const grow = Math.max(0, numberOr(margin, 0));
  return {
    min: [box.min[0] - grow, box.min[1] - grow, box.min[2] - grow],
    max: [box.max[0] + grow, box.max[1] + grow, box.max[2] + grow],
  };
}

export function distanceBetween(first, second) {
  if (!first || !second) return 0;
  return Math.hypot(second[0] - first[0], second[1] - first[1], second[2] - first[2]);
}


export function isTeleportJump(previousCenter, currentCenter, thresholdDistance) {
  if (!previousCenter || !currentCenter) return false;
  return distanceBetween(previousCenter, currentCenter) > numberOr(thresholdDistance, TELEPORT_DISTANCE_DEFAULT);
}


export function worldBoxStateKey(worldBox) {
  const box = normalizeWorldBox(worldBox);
  if (!box) return "empty";
  return box.min
    .concat(box.max)
    .map((value) => (Math.round(value * 1000) / 1000).toFixed(3))
    .join(",");
}

export function createShadowCasterTracker(options) {
  const settings = options || {};
  const teleportDistance = numberOr(settings.teleportDistance, TELEPORT_DISTANCE_DEFAULT);
  const boxEpsilon = numberOr(settings.boxEpsilon, BOX_MATCH_EPSILON);
  const previousByKey = new Map();


  function trackPulse(snapshots) {
    const list = Array.isArray(snapshots) ? snapshots : [];
    const seenKeys = new Set();
    const dirtyBoxes = [];
    const movedKeys = [];
    const addedKeys = [];
    const removedKeys = [];
    let teleported = false;

    list.forEach((snapshot) => {
      if (!snapshot || snapshot.key === undefined) return;
      const box = normalizeWorldBox(snapshot.box);
      if (!box) return;
      const key = String(snapshot.key);
      seenKeys.add(key);
      const stateKey = snapshot.stateKey === undefined ? worldBoxStateKey(box) : String(snapshot.stateKey);
      const previous = previousByKey.get(key);
      if (!previous) {
        addedKeys.push(key);
        dirtyBoxes.push(box);
      } else if (previous.stateKey !== stateKey || !worldBoxesAreEqual(previous.box, box, boxEpsilon)) {
        movedKeys.push(key);
        dirtyBoxes.push(unionOfWorldBoxes(previous.box, box));
        if (isTeleportJump(worldBoxCenter(previous.box), worldBoxCenter(box), teleportDistance)) teleported = true;
      }
      previousByKey.set(key, { box: box, stateKey: stateKey });
    });

    previousByKey.forEach((entry, key) => {
      if (seenKeys.has(key)) return;
      removedKeys.push(key);
      dirtyBoxes.push(entry.box);
    });
    removedKeys.forEach((key) => previousByKey.delete(key));

    return {
      dirtyBoxes: dirtyBoxes,
      movedKeys: movedKeys,
      addedKeys: addedKeys,
      removedKeys: removedKeys,
      casterCount: seenKeys.size,
      movingCount: movedKeys.length,
      staticCount: Math.max(0, seenKeys.size - movedKeys.length - addedKeys.length),
      teleported: teleported,
    };
  }

  return {
    trackPulse: trackPulse,
    knownCasterCount: () => previousByKey.size,
    snapshotOf: (key) => previousByKey.get(String(key)) || null,
    forget: (key) => previousByKey.delete(String(key)),
    reset: () => previousByKey.clear(),
  };
}
