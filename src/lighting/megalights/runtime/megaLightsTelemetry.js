import { deepCloneJsonValue } from "../../../core/deepCloneJsonValue.js";

const state = {
  version: 1,
  host: "engine",
  bootedAt: Date.now(),
  tier: "medio",
  scene: null,
  render: {
    framesPerSecond: 0,
    frameMilliseconds: 0,
    frameMillisecondsP95: 0,
    frames: 0,
    drawCalls: 0,
    triangles: 0,
    programs: 0,
    textures: 0,
    frameSource: "not started",
    realClockFrozen: false,
  },
  lights: { total: 0, withShadow: 0, byShape: {} },
  passGraph: { executed: [], stubbed: [], skipped: [], errors: [] },
  phaseRegistry: { total: 0, loaded: [], pending: [], failed: [] },
  appliedPatches: [],
  anchors: {},
  uniforms: {},
  textureUnits: {},
  phases: {},
  errors: [],
};

const MAX_RECORDED_ERRORS = 80;

function deepClone(value) {
  try {
    return deepCloneJsonValue(value);
  } catch (error) {
    return null;
  }
}

function describeErrorContext(context) {
  if (context === null || context === undefined) return "";
  if (typeof context === "string") return context;
  try {
    return JSON.stringify(context);
  } catch (error) {
    return String(context);
  }
}

export const megaLightsTelemetry = {

  get() {
    return deepClone(state);
  },


  raw() {
    return state;
  },

  render(values) {
    Object.assign(state.render, values || {});
  },

  scene(sceneId) {
    state.scene = sceneId;
  },

  tier(tierName) {
    state.tier = tierName;
  },

  lights(values) {
    state.lights = Object.assign({ total: 0, withShadow: 0, byShape: {} }, values || {});
  },

  passGraph(values) {
    state.passGraph = Object.assign({ executed: [], stubbed: [], skipped: [], errors: [] }, values || {});
  },

  phaseRegistry(values) {
    state.phaseRegistry = Object.assign({ total: 0, loaded: [], pending: [], failed: [] }, values || {});
  },

  appliedPatches(patchIds) {
    state.appliedPatches = (patchIds || []).slice();
  },

  anchor(anchorName, isAvailable, detail) {
    state.anchors[anchorName] = { ok: !!isAvailable, detail: detail || "" };
  },

  uniform(uniformName, summarizedValue) {
    state.uniforms[uniformName] = summarizedValue;
  },


  textureUnit(phaseId, unitCount) {
    state.textureUnits[phaseId] = unitCount;
  },

  totalTextureUnits() {
    return Object.keys(state.textureUnits).reduce(
      (total, key) => total + (Number(state.textureUnits[key]) || 0),
      0,
    );
  },

  phase(phaseId, values) {
    state.phases[phaseId] = Object.assign({}, state.phases[phaseId] || {}, values || {});
  },

  error(errorOrMessage, context) {
    state.errors.push({
      at: Date.now(),
      message: String((errorOrMessage && errorOrMessage.message) || errorOrMessage),
      context: describeErrorContext(context),
    });
    if (state.errors.length > MAX_RECORDED_ERRORS) state.errors.shift();
  },

  clearErrors() {
    state.errors.length = 0;
  },
};


export { megaLightsTelemetry as mlQa };

if (typeof window !== "undefined") {
  window.__rswMegaLightsQa = { get: () => megaLightsTelemetry.get() };
}
