import { BRIDGE_OWNER, BRIDGE_CONFIGURATION, BRIDGE_ENABLED, BRIDGE_BOUNDARY } from "./bridgeContract.js";
import { requireBridgeConfiguration } from "./bridgeProfile.js";
import { validateLightingBoundary } from "./lightingBoundary.js";
import { validateBridgeColor, validateBridgeSignals, validateBridgeLayer } from "./bridgeInputs.js";
import { createBridgeGpuRenderer } from "./bridgeGpuRenderer.js";
import { makeBridgeOutputs } from "./bridgeOutputResources.js";

function valueResource(value, frame, provenance) {
  return Object.freeze({ value, frameId: frame.frameId, viewId: frame.viewId, generation: frame.generation, provenance });
}

function readSignals(context, bindings) {
  return Object.fromEntries(Object.entries(bindings).map(([kind, resource]) => [kind, context.read(resource)]));
}

function resolveEnabled(settings) {
  const value = settings.get(BRIDGE_ENABLED);
  if (value === undefined || value === null || value === "AUTO") return true;
  if (typeof value !== "boolean") throw new TypeError("CP-F27 enabled must be boolean or AUTO");
  return value;
}

export function installLightingBridge(services) {
  if (typeof services.settings?.get !== "function") throw new TypeError("CP-F27 requires the settings store");
  const configured = services.settings.get(BRIDGE_CONFIGURATION);
  const configuration = configured === undefined ? null : requireBridgeConfiguration(configured);
  const unregisters = [];
  let renderer = null;
  let disposed = false;
  function cleanup() {
    if (disposed) return;
    disposed = true;
    for (const unregister of unregisters.reverse()) unregister();
    renderer?.dispose();
  }
  try {
    const auditReads = ["$color"];
    if (configuration) {
      auditReads.push(configuration.boundaryResource);
      if (configuration.routes.length) auditReads.push(configuration.settingsResource, configuration.controlReceiptResource);
    }
    unregisters.push(services.graph.register({
      id: `${BRIDGE_OWNER}.auditLightingBoundary`, owner: BRIDGE_OWNER, stage: "beforeDof", order: configuration?.auditOrder ?? 2690, reads: [...new Set(auditReads)], writes: [BRIDGE_BOUNDARY], transformsColor: false,
      execute(context) {
        if (disposed) throw new Error("CP-F27 phase is disposed");
        if (context.settings.get(BRIDGE_CONFIGURATION) !== configured) throw new Error("CP-F27 structural bindings changed; reinstall the phase");
        if (context.frame.referenceMode) throw new Error("CP-F27 BLOCKED_REFERENCE: no verified UE5.9 profile");
        const value = configuration ? validateLightingBoundary(configuration, context) : Object.freeze({ status: "unconfigured", reason: "BLOCKED_PROVIDER: attach an explicit lighting profile before installation", referenceStatus: "BLOCKED_REFERENCE" });
        const provenance = context.read(configuration ? configuration.boundaryResource : "$color").provenance;
        context.publish(BRIDGE_BOUNDARY, valueResource(value, context.frame, provenance));
      }
    }));
    for (const stage of configuration?.stages ?? []) {
      const reads = ["$color", BRIDGE_BOUNDARY, ...Object.values(stage.background), ...stage.layers.flatMap((layer) => [layer.color, ...Object.values(layer.signals)])];
      unregisters.push(services.graph.register({
        id: `${BRIDGE_OWNER}.compose.${stage.stage}`, owner: BRIDGE_OWNER, stage: stage.stage, order: stage.order, reads: [...new Set(reads)], writes: Object.values(stage.outputs), transformsColor: true,
        execute(context) {
          const enabled = resolveEnabled(context.settings);
          const color = validateBridgeColor(context.read("$color"), context.frame);
          const audit = context.read(BRIDGE_BOUNDARY).value;
          let current = { color, ...validateBridgeSignals(readSignals(context, stage.background), context.frame, color, "background") };
          const composedIds = [...(color.compositedLayerIds ?? audit.compositedLayerIds)];
          const layers = stage.layers.map((definition) => ({ definition, color: validateBridgeLayer(context.read(definition.color), definition, stage.stage, context.frame, color, composedIds), ...validateBridgeSignals(readSignals(context, definition.signals), context.frame, color, definition.id) }));
          if (!renderer) renderer = createBridgeGpuRenderer(services, configuration);
          for (let index = 0; index < layers.length; index++) {
            const layer = layers[index];
            const targets = renderer.render(context.frame, stage.stage, index % 2, current, layer, enabled);
            if (enabled) composedIds.push(layer.definition.id);
            current = makeBridgeOutputs(targets, current.color, context.frame, composedIds, configuration.gpuValidation);
          }
          for (const [kind, resourceName] of Object.entries(stage.outputs)) context.publish(resourceName, current[kind]);
          return { color: current.color };
        }
      }));
    }
    services.report?.({ phase: BRIDGE_OWNER, event: "lighting-bridge-installed", profileId: configuration?.id ?? null, status: configuration ? "configured" : "unconfigured", compositionStages: configuration?.stages.map((entry) => entry.stage) ?? [], synchronousReadback: configuration?.gpuValidation === "readback", referenceStatus: "BLOCKED_REFERENCE" });
    cleanup.releaseView = (viewId) => renderer?.releaseView(viewId);
    return cleanup;
  } catch (error) {
    cleanup();
    throw error;
  }
}
