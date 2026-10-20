import { BRIDGE_CONFIGURATION, BRIDGE_STAGES, BRIDGE_FEATURES, BRIDGE_DOMAINS, bridgeStageResources } from "./bridgeContract.js";
import { requireBridgeAdapters } from "./bridgeAdapters.js";
import { requireKeys, requireName, requireInteger, freezeData } from "./bridgeValidation.js";

const configurations = new WeakSet();
const signalKinds = ["coverage", "reactive", "velocity"];

function normalizeSignals(input, label) {
  requireKeys(input, signalKinds, label);
  return Object.freeze(Object.fromEntries(signalKinds.map((kind) => [kind, requireName(input[kind], `${label}.${kind}`)])));
}

export function createBridgeConfiguration(input) {
  requireKeys(input, ["id", "inputKind", "boundaryResource", "primaryDomains", "requirements", "adapters", "stages", "routes", "settingsResource", "controlReceiptResource", "gpuValidation", "maxViews", "auditOrder"], "configuration");
  const id = requireName(input.id, "profile id");
  const inputKind = input.inputKind ?? "raster";
  if (!["raster", "pathTracing"].includes(inputKind)) throw new TypeError("CP-F27 unsupported lighting input kind");
  const adapters = requireBridgeAdapters(input.adapters);
  const boundaryResource = requireName(input.boundaryResource, "boundary resource");
  const primaryDomains = input.primaryDomains ?? ["opaque", "masked"];
  if (!Array.isArray(primaryDomains) || !primaryDomains.length || new Set(primaryDomains).size !== primaryDomains.length || primaryDomains.some((domain) => !BRIDGE_DOMAINS.includes(domain))) throw new TypeError("CP-F27 invalid primary domains");
  const requirements = (input.requirements ?? []).map((requirement) => {
    requireKeys(requirement, ["feature", "mode", "owner"], "requirement");
    if (!BRIDGE_FEATURES.includes(requirement.feature)) throw new TypeError("CP-F27 unknown feature requirement");
    return Object.freeze({ feature: requirement.feature, mode: requireName(requirement.mode, "required mode"), owner: requireName(requirement.owner, "required owner") });
  });
  if (new Set(requirements.map((entry) => entry.feature)).size !== requirements.length) throw new Error("CP-F27 duplicate feature requirement");
  if (inputKind === "pathTracing" && !requirements.some((entry) => entry.feature === "pathTracing")) throw new Error("CP-F27 path-tracing input requires a real pathTracing provider");
  const auditOrder = requireInteger(input.auditOrder ?? 2690, "audit order", 0, 1000000);
  const usedLayers = new Set();
  const usedColorResources = new Set();
  const stages = (input.stages ?? []).map((stage) => {
    requireKeys(stage, ["stage", "order", "background", "layers"], "stage");
    if (!BRIDGE_STAGES.includes(stage.stage)) throw new TypeError("CP-F27 unsupported composition stage");
    const order = requireInteger(stage.order ?? 2700, "composition order", 0, 1000000);
    if (stage.stage === "beforeDof" && order <= auditOrder) throw new Error("CP-F27 composition must follow its boundary audit");
    const background = normalizeSignals(stage.background, "background signals");
    if (!Array.isArray(stage.layers) || !stage.layers.length || stage.layers.length > 8) throw new TypeError("CP-F27 each stage requires 1..8 ordered layers");
    const layers = stage.layers.map((layer) => {
      requireKeys(layer, ["id", "domain", "color", "signals"], "layer");
      const layerId = requireName(layer.id, "layer id");
      const color = requireName(layer.color, "layer color resource");
      if (usedLayers.has(layerId) || usedColorResources.has(color)) throw new Error("CP-F27 duplicate layer composition across stages");
      if (!["translucent", "particle", "water", "sky", "substrate"].includes(layer.domain)) throw new TypeError("CP-F27 unsupported translucent domain");
      usedLayers.add(layerId);
      usedColorResources.add(color);
      return Object.freeze({ id: layerId, domain: layer.domain, color, signals: normalizeSignals(layer.signals, "layer signals") });
    });
    return Object.freeze({ stage: stage.stage, order, background, layers: Object.freeze(layers), outputs: bridgeStageResources(stage.stage) });
  }).sort((left, right) => BRIDGE_STAGES.indexOf(left.stage) - BRIDGE_STAGES.indexOf(right.stage));
  if (new Set(stages.map((stage) => stage.stage)).size !== stages.length) throw new Error("CP-F27 duplicate composition stage");
  const availableOutputs = new Set();
  for (const stage of stages) {
    const resources = [...Object.values(stage.background), ...stage.layers.flatMap((layer) => [layer.color, ...Object.values(layer.signals)])];
    for (const resource of resources) if (resource.startsWith("CP-F27.") && !availableOutputs.has(resource)) throw new Error(`CP-F27 forward dependency or feedback: ${resource}`);
    for (const output of Object.values(stage.outputs)) availableOutputs.add(output);
  }
  const usedParameters = new Set();
  const routes = (input.routes ?? []).map((route) => {
    requireKeys(route, ["property", "feature", "parameter"], "control route");
    const property = requireName(route.property, "control property");
    const parameter = requireName(route.parameter, "owner parameter");
    if (!BRIDGE_FEATURES.includes(route.feature)) throw new TypeError("CP-F27 unsupported control owner feature");
    const key = `${route.feature}:${parameter}`;
    if (usedParameters.has(key)) throw new Error("CP-F27 duplicate control destination");
    usedParameters.add(key);
    return Object.freeze({ property, feature: route.feature, parameter });
  });
  const settingsResource = routes.length ? requireName(input.settingsResource, "resolved settings resource") : null;
  const controlReceiptResource = routes.length ? requireName(input.controlReceiptResource, "control receipt resource") : null;
  if ([boundaryResource, settingsResource, controlReceiptResource].some((name) => name?.startsWith("CP-F27."))) throw new Error("CP-F27 host declarations cannot shadow owned resources");
  const gpuValidation = input.gpuValidation ?? "readback";
  if (!["readback", "mask-only"].includes(gpuValidation)) throw new TypeError("CP-F27 invalid GPU validation mode");
  const maxViews = requireInteger(input.maxViews ?? 4, "view budget", 1, 16);
  const configuration = Object.freeze({ id, inputKind, boundaryResource, primaryDomains: Object.freeze([...primaryDomains]), requirements: Object.freeze(requirements), adapters, stages: Object.freeze(stages), routes: Object.freeze(routes), settingsResource, controlReceiptResource, gpuValidation, maxViews, auditOrder });
  configurations.add(configuration);
  return configuration;
}

export function requireBridgeConfiguration(configuration) {
  if (!configurations.has(configuration)) throw new TypeError("CP-F27 requires a validated configuration");
  return configuration;
}

export function attachBridgeConfiguration(settings, configuration) {
  requireBridgeConfiguration(configuration);
  if (typeof settings?.get !== "function" || typeof settings?.set !== "function") throw new TypeError("CP-F27 requires the B00 settings store");
  const previous = settings.get(BRIDGE_CONFIGURATION);
  settings.set(BRIDGE_CONFIGURATION, configuration);
  let detached = false;
  return () => {
    if (detached) return;
    detached = true;
    if (settings.get(BRIDGE_CONFIGURATION) === configuration) settings.set(BRIDGE_CONFIGURATION, previous);
  };
}

export function describeBridgeProfile(configuration) {
  requireBridgeConfiguration(configuration);
  const { adapters, ...profile } = configuration;
  return freezeData({ ...profile, adapters: adapters.describe(), referenceStatus: "BLOCKED_REFERENCE" });
}
