import { requireSettingsSession } from "./settingsSession.js";
import { hasOwn, requireIdentifier, requireNumber, freezeData } from "./settingsValidation.js";
import { volumeInfluence } from "./volumeGeometry.js";

export const SETTINGS_BLEND_POLICY = Object.freeze({ numeric: "sequential-linear", discrete: "last-positive", priority: "ascending", tieBreak: "ascending-id-code-unit", camera: "after-volumes", auto: "authored-default-or-schema-default", referenceStatus: "unverified" });

function compileOverrides(schema, overrides, defaults) {
  return Object.entries(overrides).filter(([, entry]) => entry.enabled !== false).map(([name, entry]) => {
    const property = schema.get(name);
    return { property, value: entry.value === null || entry.value === "AUTO" ? defaults[name] : entry.value };
  });
}

function blendValues(values, entries, weight) {
  if (weight === 0) return;
  for (const { property, value } of entries) {
    if (weight === 1 || property.blend === "last-positive") values[property.name] = value;
    else if (property.kind === "vector") values[property.name] = value.map((component, index) => values[property.name][index] * (1 - weight) + component * weight);
    else values[property.name] = values[property.name] * (1 - weight) + value * weight;
  }
}

function layerWeight(layer) { return layer?.enabled === false ? 0 : layer?.blendWeight ?? 1; }

export function createVolumeResolver(session, { maxViews = 16 } = {}) {
  requireSettingsSession(session);
  if (!Number.isInteger(maxViews) || maxViews < 1 || maxViews > 1024) throw new TypeError("View cache limit must be 1..1024");
  const cache = new Map();
  const counters = { cacheHits: 0, resolutions: 0, spatialEvaluations: 0, compilations: 0 };
  let compiled = null;
  let disposed = false;

  function prepare() {
    if (disposed) throw new Error("Settings resolver is disposed");
    const state = session.snapshot();
    if (compiled?.state === state) return compiled;
    const { schema } = session;
    const { document } = state;
    const defaults = Object.fromEntries(schema.properties.map((property) => [property.name, property.defaultValue]));
    blendValues(defaults, compileOverrides(schema, document.defaults, defaults), 1);
    freezeData(defaults);
    const ordered = [...document.volumes].sort((left, right) => (left.priority ?? 0) - (right.priority ?? 0) || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
    compiled = { state, defaults, ordered, volumeEntries: ordered.map((volume) => compileOverrides(schema, volume.overrides, defaults)), globalEntries: compileOverrides(schema, document.global.overrides, defaults), cameraEntries: new Map(Object.entries(document.cameras).map(([viewId, layer]) => [viewId, compileOverrides(schema, layer.overrides, defaults)])), needsPosition: ordered.some((volume) => volume.enabled !== false && volume.blendWeight !== 0 && volume.unbound !== true) };
    counters.compilations += 1;
    return compiled;
  }

  function resolve({ viewId, position } = {}) {
    requireIdentifier(viewId, "View id");
    const current = prepare();
    let horizontal = 0;
    let vertical = 0;
    let depth = 0;
    if (current.needsPosition) {
      if ((!Array.isArray(position) && !ArrayBuffer.isView(position)) || position.length !== 3) throw new TypeError("Bound volumes require a three-component world position");
      horizontal = requireNumber(position[0], "Camera position x");
      vertical = requireNumber(position[1], "Camera position y");
      depth = requireNumber(position[2], "Camera position z");
    }
    const previous = cache.get(viewId);
    const sameSpatialInput = previous && previous.spatialRevision === current.state.revisions.spatial && previous.horizontal === horizontal && previous.vertical === vertical && previous.depth === depth;
    if (sameSpatialInput && previous.documentRevision === current.state.revisions.document) {
      cache.delete(viewId);
      cache.set(viewId, previous);
      counters.cacheHits += 1;
      return previous.result;
    }
    let weights = sameSpatialInput ? previous.weights : null;
    if (!weights) {
      const cameraPosition = [horizontal, vertical, depth];
      weights = current.ordered.map((volume) => volumeInfluence(volume, cameraPosition));
      counters.spatialEvaluations += current.ordered.length;
    }
    if (previous && previous.documentRevision === current.state.revisions.document && weights.length === previous.weights.length && weights.every((weight, index) => weight === previous.weights[index])) {
      previous.horizontal = horizontal;
      previous.vertical = vertical;
      previous.depth = depth;
      cache.delete(viewId);
      cache.set(viewId, previous);
      counters.cacheHits += 1;
      return previous.result;
    }
    const values = { ...current.defaults };
    const contributors = [];
    const { document, revisions } = current.state;
    const globalWeight = layerWeight(document.global);
    blendValues(values, current.globalEntries, globalWeight);
    if (globalWeight > 0 && current.globalEntries.length) contributors.push({ kind: "global", weight: globalWeight });
    current.ordered.forEach((volume, index) => {
      blendValues(values, current.volumeEntries[index], weights[index]);
      if (weights[index] > 0 && current.volumeEntries[index].length) contributors.push({ kind: "volume", id: volume.id, priority: volume.priority ?? 0, weight: weights[index] });
    });
    const camera = hasOwn(document.cameras, viewId) ? document.cameras[viewId] : null;
    if (camera) {
      const weight = layerWeight(camera);
      const entries = current.cameraEntries.get(viewId);
      blendValues(values, entries, weight);
      if (weight > 0 && entries.length) contributors.push({ kind: "camera", viewId, weight });
    }
    const result = freezeData({ schemaId: session.schema.id, schemaVersion: session.schema.version, viewId, values, contributors, revisions, policy: SETTINGS_BLEND_POLICY });
    cache.delete(viewId);
    cache.set(viewId, { horizontal, vertical, depth, spatialRevision: revisions.spatial, documentRevision: revisions.document, weights, result });
    while (cache.size > maxViews) cache.delete(cache.keys().next().value);
    counters.resolutions += 1;
    return result;
  }

  return Object.freeze({ resolve, needsPosition: () => prepare().needsPosition, stats: () => ({ ...counters, liveViews: cache.size, maxViews }), clear: () => cache.clear(), dispose() { if (disposed) return; disposed = true; compiled = null; cache.clear(); } });
}
