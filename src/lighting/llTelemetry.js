import { deepCloneJsonValue } from "../core/deepCloneJsonValue.js";


const MAX_STORED_ERRORS = 60;


const DEFAULT_TIER = "medio";

function createEmptyRenderStats() {
  return {
    fps: 0,
    frameMs: 0,
    frameMsP95: 0,
    frames: 0,
    drawCalls: 0,
    triangles: 0,
    programs: 0,
    textures: 0,
  };
}

function createEmptyLightCounts() {
  return { total: 0, withShadow: 0, byKind: {} };
}

const state = {
  version: 1,
  bootedAt: Date.now(),
  tier: DEFAULT_TIER,
  scene: null,
  render: createEmptyRenderStats(),
  lights: createEmptyLightCounts(),
  appliedPatches: [],
  anchors: {},
  uniforms: {},
  textureUnits: {},
  phases: {},
  errors: [],
};

function deepClone(value) {
  try {
    return deepCloneJsonValue(value);
  } catch (error) {
    return null;
  }
}

function errorMessageOf(error) {
  if (error && typeof error === "object" && typeof error.message === "string") return error.message;
  return String(error);
}

export const localLightTelemetry = {

  getSnapshot() {
    return deepClone(state);
  },


  getMutableState() {
    return state;
  },

  setTier(tier) {
    if (typeof tier === "string" && tier) state.tier = tier;
    return state.tier;
  },

  setScene(sceneId) {
    state.scene = sceneId == null ? null : String(sceneId);
    return state.scene;
  },

  setRenderStats(stats) {
    Object.assign(state.render, stats || {});
    return state.render;
  },

  setLightCounts(counts) {
    state.lights = Object.assign(createEmptyLightCounts(), counts || {});
    return state.lights;
  },

  setAppliedPatches(patchIds) {
    state.appliedPatches = Array.isArray(patchIds) ? patchIds.slice() : [];
    return state.appliedPatches;
  },


  setAnchor(anchorId, found, detail) {
    state.anchors[anchorId] = { found: !!found, detail: detail || "" };
    return state.anchors[anchorId];
  },

  setUniform(name, value) {
    state.uniforms[name] = value;
    return value;
  },


  setTextureUnits(phaseOrFeatureId, count) {
    state.textureUnits[phaseOrFeatureId] = Number(count) || 0;
    return state.textureUnits[phaseOrFeatureId];
  },

  getTotalTextureUnits() {
    let total = 0;
    for (const id in state.textureUnits) total += Number(state.textureUnits[id]) || 0;
    return total;
  },


  setPhase(phaseId, data) {
    state.phases[phaseId] = Object.assign({}, state.phases[phaseId] || {}, data || {});
    return state.phases[phaseId];
  },

  getPhase(phaseId) {
    return state.phases[phaseId] ? deepClone(state.phases[phaseId]) : null;
  },

  addError(error, context) {
    state.errors.push({ at: Date.now(), message: errorMessageOf(error), context: context || "" });
    if (state.errors.length > MAX_STORED_ERRORS) state.errors.shift();
    return state.errors.length;
  },

  clearErrors() {
    state.errors.length = 0;
    return 0;
  },
};


localLightTelemetry.texUnit = localLightTelemetry.setTextureUnits;
localLightTelemetry.texUnitsTotal = localLightTelemetry.getTotalTextureUnits;
localLightTelemetry.fase = localLightTelemetry.setPhase;
localLightTelemetry.erro = localLightTelemetry.addError;
localLightTelemetry.bruto = localLightTelemetry.getMutableState;
localLightTelemetry.get = localLightTelemetry.getSnapshot;


export const llQa = localLightTelemetry;

if (typeof window !== "undefined") {

  window.__llQa = localLightTelemetry;
}
